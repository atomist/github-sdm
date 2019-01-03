/*
 * Copyright © 2018 Atomist, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {
    HandlerContext,
    logger,
    RemoteRepoRef,
    Success,
} from "@atomist/automation-client";
import { EditResult } from "@atomist/automation-client/lib/operations/edit/projectEditor";
import { combineEditResults } from "@atomist/automation-client/lib/operations/edit/projectEditorOps";
import * as _ from "lodash";
import { sprintf } from "sprintf-js";
import { ExecuteGoalResult } from "../../api/goal/ExecuteGoalResult";
import {
    ExecuteGoal,
    GoalInvocation,
} from "../../api/goal/GoalInvocation";
import { ReportProgress } from "../../api/goal/progress/ReportProgress";
import { PushImpactListenerInvocation } from "../../api/listener/PushImpactListener";
import { AutofixRegistration } from "../../api/registration/AutofixRegistration";
import { PushAwareParametersInvocation } from "../../api/registration/PushAwareParametersInvocation";
import { ProgressLog } from "../../spi/log/ProgressLog";
import { SdmGoalState } from "../../typings/types";
import { confirmEditedness } from "../command/transform/confirmEditedness";
import { minimalClone } from "../goal/minimalClone";
import {
    ProgressTest,
    testProgressReporter,
} from "../goal/progress/progress";
import { toScalarProjectEditor } from "../machine/handlerRegistrations";
import { createPushImpactListenerInvocation } from "./createPushImpactListenerInvocation";
import { relevantCodeActions } from "./relevantCodeActions";

/**
 * Execute autofixes against this push
 * Throw an error on failure
 * @param {AutofixRegistration[]} registrations
 * @return ExecuteGoal
 */
export function executeAutofixes(registrations: AutofixRegistration[]): ExecuteGoal {
    return async (goalInvocation: GoalInvocation): Promise<ExecuteGoalResult> => {
        const { id, configuration, goalEvent, credentials, context, progressLog } = goalInvocation;
        progressLog.write(sprintf("Attempting to apply %d configured autofixes", registrations.length));
        try {
            if (registrations.length === 0) {
                return Success;
            }
            const push = goalEvent.push;
            const appliedAutofixes: AutofixRegistration[] = [];
            const editResult = await configuration.sdm.projectLoader.doWithProject<EditResult>({
                    credentials,
                    id,
                    context,
                    readOnly: false,
                    cloneOptions: minimalClone(push),
                },
                async project => {
                    if ((await project.gitStatus()).sha !== id.sha) {
                        return {
                            success: true,
                            edited: false,
                            target: project,
                            description: "Autofixes not executing | new commits on branch",
                        };
                    }
                    const cri: PushImpactListenerInvocation = await createPushImpactListenerInvocation(goalInvocation, project);
                    const relevantAutofixes: AutofixRegistration[] =
                        filterImmediateAutofixes(await relevantCodeActions(registrations, cri), goalInvocation);
                    progressLog.write(sprintf("Applying %d relevant autofixes of %d to %s/%s: '%s' of configured '%s'",
                        relevantAutofixes.length,
                        registrations.length,
                        cri.id.owner,
                        cri.id.repo,
                        relevantAutofixes.map(a => a.name).join(", "),
                        registrations.map(a => a.name).join(", ")));
                    let cumulativeResult: EditResult = {
                        target: cri.project,
                        success: true,
                        edited: false,
                    };

                    for (const autofix of _.flatten(relevantAutofixes)) {
                        const thisEdit = await runOne(cri, autofix, progressLog);
                        if (thisEdit.edited) {
                            appliedAutofixes.push(autofix);
                        }
                        cumulativeResult = combineEditResults(cumulativeResult, thisEdit);
                    }
                    if (cumulativeResult.edited) {
                        await cri.project.push();
                    }
                    return cumulativeResult;
                });
            if (editResult.edited) {
                // Send back a stop state to skip downstream goals
                return {
                    code: 0,
                    message: "Edited",
                    description: goalInvocation.goal.stoppedDescription,
                    state: SdmGoalState.stopped,
                    phase: detailMessage(appliedAutofixes),
                };
            }
            return {
                code: 0,
                description: (editResult as any).description,
            };
        } catch (err) {
            logger.warn("Autofixes failed with '%s':\n%s", err.message, err.stack);
            progressLog.write(sprintf("Autofixes failed with '%s'", err.message));
            return {
                code: 1,
                message: err.message,
            };
        }
    };
}

function detailMessage(appliedAutofixes: AutofixRegistration[]): string {
    // We show only two autofixes by name here as otherwise the message is going to get too long
    if (appliedAutofixes.length <= 2) {
        return `${appliedAutofixes.map(af => af.name).join(", ")}`;
    } else {
        return `${appliedAutofixes.length} autofixes`;
    }
}

async function runOne(cri: PushImpactListenerInvocation,
                      autofix: AutofixRegistration,
                      progressLog: ProgressLog): Promise<EditResult> {
    const project = cri.project;
    progressLog.write(sprintf("About to transform %s with autofix '%s'", (project.id as RemoteRepoRef).url, autofix.name));
    try {
        const arg2: HandlerContext & PushAwareParametersInvocation<any> = {
            ...cri.context,
            ...cri,
            push: cri,
        } as any;
        const tentativeEditResult = await toScalarProjectEditor(autofix.transform)(
            project,
            arg2,
            autofix.parametersInstance);
        const editResult = await confirmEditedness(tentativeEditResult);

        if (!editResult.success) {
            await project.revert();
            logger.warn("Edited %s with autofix %s and success=false, edited=%d",
                (project.id as RemoteRepoRef).url, autofix.name, editResult.edited);
            progressLog.write(sprintf("Edited %s with autofix %s and success=false, edited=%d",
                (project.id as RemoteRepoRef).url, autofix.name, editResult.edited));
            if (!!autofix.options && autofix.options.ignoreFailure) {
                // Say we didn't edit and can keep going
                return { target: project, edited: false, success: false };
            }
        } else if (editResult.edited) {
            progressLog.write(sprintf("Autofix '%s' made changes", autofix.name));
            await project.commit(generateCommitMessageForAutofix(autofix));
        } else {
            progressLog.write(sprintf("Autofix '%s' made no changes", autofix.name));
            logger.debug("No changes were made by autofix %s", autofix.name);
        }
        return editResult;
    } catch (err) {
        if (!autofix.options || !autofix.options.ignoreFailure) {
            throw err;
        }
        await project.revert();
        logger.warn("Ignoring autofix failure %s on %s with autofix %s",
            err.message, (project.id as RemoteRepoRef).url, autofix.name);
        progressLog.write(sprintf("Ignoring autofix failure %s on %s with autofix %s",
            err.message, (project.id as RemoteRepoRef).url, autofix.name));
        return { target: project, success: false, edited: false };
    }
}

/**
 * Filter any provided autofixes whose results were included in the commits of the current push.
 * @param {AutofixRegistration[]} autofixes
 * @param {GoalInvocation} gi
 * @returns {AutofixRegistration[]}
 */
export function filterImmediateAutofixes(autofixes: AutofixRegistration[],
                                         gi: GoalInvocation): AutofixRegistration[] {
    return autofixes.filter(
        af => !(gi.goalEvent.push.commits || [])
            .some(c => c.message === generateCommitMessageForAutofix(af)));
}

/**
 * Generate a commit message for the provided autofix.
 * @param {AutofixRegistration} autofix
 * @returns {string}
 */
export function generateCommitMessageForAutofix(autofix: AutofixRegistration): string {
    const name = autofix.name.toLowerCase().replace(/ /g, "_");
    return `Autofix: ${autofix.name}\n\n[atomist:generated] [atomist:autofix=${name}]`;
}

export const AutofixProgressTests: ProgressTest[] = [{
    test: /About to edit .* autofix '(.*)'/i,
    phase: "$1",
}];

/**
 * Default ReportProgress for running autofixes
 */
export const AutofixProgressReporter: ReportProgress = testProgressReporter(...AutofixProgressTests);
