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

import { ProjectOperationCredentials } from "@atomist/automation-client/operations/common/ProjectOperationCredentials";

import { logger } from "@atomist/automation-client";
import { RemoteRepoRef } from "@atomist/automation-client/operations/common/RepoId";
import { requiresApproval } from "../../../handlers/events/delivery/verify/approvalGate";
import { BaseContext, GitHubStatusAndFriends, GitHubStatusContext, GoalEnvironment } from "./gitHubContext";

export interface GoalDefinition {
    environment: GoalEnvironment;
    orderedName: string;
    displayName?: string;
    completedDescription?: string;
    workingDescription?: string;
    failedDescription?: string;
}

export type PreconditionsStatus = "waiting" | "success" | "failure";

/**
 * Represents a delivery action, such as Build or Deploy.
 */
export class Goal {

    public readonly context: GitHubStatusContext;
    public readonly name: string;
    public readonly definition: GoalDefinition;

    get completedDescription() {
        return this.definition.completedDescription || ("Complete: " + this.name);
    }

    get workingDescription() {
        return this.definition.workingDescription || ("Working: " + this.name);
    }

    get failedDescription() {
        return this.definition.failedDescription || ("Failed: " + this.name);
    }

    get requestedDescription() {
        return "Planning to " + this.name;
    }

    get retryIntent() {
        return "trigger " + this.name;
    }

    constructor(definition: GoalDefinition) {
        this.definition = definition;

        const numberAndName = /([0-9\.]+)-(.*)/;
        const matchGoal = definition.orderedName.match(numberAndName);
        if (!matchGoal) {
            logger.debug(`Ordered name must be '#-name'. Did not find number and name in ${definition.orderedName}`);
            return;
        }

        this.name = definition.displayName || matchGoal[2];
        this.context = BaseContext + definition.environment + definition.orderedName;
    }

    // TODO decouple from github statuses
    public async preconditionsStatus(creds: ProjectOperationCredentials,
                                     id: RemoteRepoRef,
                                     sub: GitHubStatusAndFriends): Promise<PreconditionsStatus> {
        return "success";
    }
}

export class GoalWithPrecondition extends Goal {

    public readonly dependsOn: Goal[];

    constructor(definition: GoalDefinition, ...dependsOn: Goal[]) {
        super(definition);
        this.dependsOn = dependsOn;
    }

    public async preconditionsStatus(creds: ProjectOperationCredentials,
                                     id: RemoteRepoRef,
                                     sub: GitHubStatusAndFriends): Promise<PreconditionsStatus> {
        const checks = this.dependsOn.map(pg => checkPreconditionStatus(sub, pg));
        const errors: string[] = checks.filter(r => r.error !== undefined)
            .map(r => r.error);
        const reasonsToWait: string[] = checks.filter(r => r.wait !== undefined).map(r => r.wait);

        errors.forEach(e => logger.debug("Could not establish preconditions for " + this.name + ": " + e));
        reasonsToWait.forEach(e => logger.debug("Not triggering " + this.name + ": " + e));
        if (errors.length > 0) {
            logger.info("Preconditions failed on goal %s with dependencies '%s' on %j: Errors=[%s]; reasons to wait=[%s]",
                this.name, this.dependsOn.map(g => g.name),
                id, errors.join(","), reasonsToWait.join(","));
            return "failure";
        }
        if (reasonsToWait.length > 0) {
            logger.debug("Preconditions not yet met on goal %s with dependencies '%s' on %j: Errors=[%s]; reasons to wait=[%s]",
                this.name, this.dependsOn.map(g => g.name),
                id, errors.join(","), reasonsToWait.join(","));
            return "waiting";
        }
        return "success";
    }
}

function checkPreconditionStatus(sub: GitHubStatusAndFriends, pg: Goal): { wait?: string, error?: string } {
    const detectedStatus = sub.siblings.find(gs => gs.context === pg.context);
    if (!detectedStatus) {
        return {wait: "Did not find a status for " + pg.context};
    }
    if (detectedStatus.state === "pending") {
        return {wait: "Precondition '" + pg.name + "' not yet successful"};
    }
    if (detectedStatus.state !== "success") {
        return {error: "Precondition '" + pg.name + `' in state [${detectedStatus.state}]`};
    }
    if (requiresApproval(detectedStatus)) {
        return {wait: "Precondition '" + pg.name + "' requires approval"};
    }
    return {};
}

export function currentGoalIsStillPending(currentGoal: GitHubStatusContext, status: GitHubStatusAndFriends): boolean {
    const myStatus = status.siblings.find(s => s.context === currentGoal);
    if (!myStatus) {
        logger.debug("Status.context is %s but there is nothing with this context", currentGoal);
        return false;
    }
    if (myStatus.state === "pending" && myStatus.description.startsWith("Planning")) {
        return true;
    }
    if (myStatus.state === "failure" && myStatus.description.startsWith("Skip")) {
        return true;
    }
    logger.debug(`${currentGoal} is not still planned or skipped, so I'm not running it.
    State: ${myStatus.state} Description: ${myStatus.description}`);
    return false;
}
