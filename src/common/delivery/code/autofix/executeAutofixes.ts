/*
 * Copyright © 2018 Atomist, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { HandlerContext, logger, Success } from "@atomist/automation-client";
import { GitHubRepoRef } from "@atomist/automation-client/operations/common/GitHubRepoRef";
import { RemoteRepoRef } from "@atomist/automation-client/operations/common/RepoId";
import { EditResult, toEditor } from "@atomist/automation-client/operations/edit/projectEditor";
import { GitProject } from "@atomist/automation-client/project/git/GitProject";
import * as _ from "lodash";
import { StatusForExecuteGoal } from "../../../../typings/types";
import { confirmEditedness } from "../../../../util/git/confirmEditedness";
import { ProjectListenerInvocation } from "../../../listener/Listener";
import { ProjectLoader } from "../../../repo/ProjectLoader";
import { addressChannelsFor, messageDestinationsFor } from "../../../slack/addressChannels";
import { teachToRespondInEventHandler } from "../../../slack/contextMessageRouting";
import { ExecuteGoalInvocation, ExecuteGoalResult, GoalExecutor } from "../../goals/goalExecution";
import { AutofixRegistration, relevantCodeActions } from "../codeActionRegistrations";

/**
 * Execute autofixes against this push
 * Throw an error on failure
 * @param projectLoader use to load projects
 * @param {AutofixRegistration[]} registrations
 * @return GoalExecutor
 */
export function executeAutofixes(projectLoader: ProjectLoader, registrations: AutofixRegistration[]): GoalExecutor {
    return async (status: StatusForExecuteGoal.Fragment,
                  context: HandlerContext,
                  egi: ExecuteGoalInvocation): Promise<ExecuteGoalResult> => {
        logger.info("Executing %d autofixes", registrations.length);
        try {
            const commit = status.commit;
            const credentials = {token: egi.githubToken};
            const smartContext = teachToRespondInEventHandler(context, messageDestinationsFor(commit.repo, context));
            if (registrations.length === 0) {
                return Success;
            }
            const push = commit.pushes[0];
            const editableRepoRef = new GitHubRepoRef(commit.repo.owner, commit.repo.name, push.branch);
            const editResult = await projectLoader.doWithProject<EditResult>({
                    credentials,
                    id: editableRepoRef,
                    context,
                    readOnly: false,
                },
                async project => {
                    const pti: ProjectListenerInvocation = {
                        id: editableRepoRef,
                        project,
                        credentials,
                        context,
                        addressChannels: addressChannelsFor(commit.repo, context),
                        push,
                    };
                    const relevantAutofixes: AutofixRegistration[] = await
                        relevantCodeActions<AutofixRegistration>(registrations, pti);
                    logger.info("Will apply %d eligible autofixes of %d to %j",
                        relevantAutofixes.length, registrations.length, pti.id);
                    let cumulativeResult: EditResult = {
                        target: pti.project,
                        success: true,
                        edited: false,
                    };
                    for (const autofix of _.flatten(relevantAutofixes)) {
                        const thisEdit = await runOne(pti.project, smartContext, autofix);
                        cumulativeResult = combineEditResults(cumulativeResult, thisEdit);
                    }
                    if (cumulativeResult.edited) {
                        await pti.project.push();
                    }
                    return cumulativeResult;
                });
            if (editResult.edited) {
                // Send back an error code, because we want to stop execution of goals after this
                return {code: 1, message: "Edited"};
            }
            return Success;
        } catch (err) {
            logger.warn("Autofixes failed with %s: Ignoring failure", err.message);
            return Success;
        }
    };
}

async function runOne(project: GitProject, ctx: HandlerContext, autofix: AutofixRegistration) {
    logger.info("About to edit %s with autofix %s", (project.id as RemoteRepoRef).url, autofix.name);
    const tentativeEditResult = await toEditor(autofix.action)(project, ctx);
    const editResult = await confirmEditedness(tentativeEditResult);

    if (!editResult.success) {
        await project.revert();
        logger.warn("Edited %s with autofix %s and success=false, edited=%d",
            (project.id as RemoteRepoRef).url, autofix.name, editResult.edited);
    } else if (editResult.edited) {
        await project.commit(`Autofix: ${autofix.name}\n\n[atomist]`);
    } else {
        logger.debug("No changes by autofix %s", autofix.name);
    }
    return editResult;
}

// TODO will be exported in client
function combineEditResults(r1: EditResult, r2: EditResult): EditResult {
    return {
        ...r1,
        ...r2,
        edited: (r1.edited || r2.edited) ? true :
            (r1.edited === false && r2.edited === false) ? false : undefined,
        success: r1.success && r2.success,
    };
}
