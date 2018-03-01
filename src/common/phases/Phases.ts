import { GitHubRepoRef } from "@atomist/automation-client/operations/common/GitHubRepoRef";
import {
    ProjectOperationCredentials,
    TokenCredentials,
} from "@atomist/automation-client/operations/common/ProjectOperationCredentials";
import { StatusState } from "../../typings/types";
import { createStatus, State } from "../../util/github/ghub";

import { logger } from "@atomist/automation-client";
import * as stringify from "json-stringify-safe";
import { ApprovalGateParam } from "../../handlers/events/delivery/verify/approvalGate";
import { contextIsAfter, GitHubStatusContext, splitContext } from "./gitHubContext";

export interface PlannedPhase {
    context: GitHubStatusContext;
    name: string;
}

// exported for testing
export function parseContext(context: GitHubStatusContext): PlannedPhase {
    return {context, name: splitContext(context).name};
}

export class Phases {

    constructor(public phases: GitHubStatusContext[], private plannedPhaseByContext?: { [key: string]: PlannedPhase }) {
    }

    /**
     * Return next phase if this is a phase
     * @param {string} context
     * @return {GitHubStatusContext}
     */
    public nextPhase(phase: string): GitHubStatusContext {
        const index = this.phases.indexOf(phase);
        if (index !== this.phases.length - 1) {
            return this.phases[index + 1];
        }
        return undefined;
    }

    public setAllToPending(id: GitHubRepoRef, creds: ProjectOperationCredentials): Promise<any> {
        const self = this;
        return Promise.all(this.phases.map(phase =>
            setStatus(id, phase, "pending", creds,
                `Planning to ${self.contextToPlannedPhase(self, phase).name}`)));
    }

    // rod, why the self argument?
    private contextToPlannedPhase(self: this, context: GitHubStatusContext) {
        if (self.plannedPhaseByContext && self.plannedPhaseByContext[context]) {
            return self.plannedPhaseByContext[context];
        } else {
            return parseContext(context);
        }
    }

}

function setStatus(id: GitHubRepoRef, context: GitHubStatusContext,
                   state: State,
                   creds: ProjectOperationCredentials,
                   description: string = context): Promise<any> {
    return createStatus((creds as TokenCredentials).token, id, {
        state,
        target_url: `${id.url}/commit/${id.sha}`,
        context,
        description,
    });
}
export interface GitHubStatus {
    context?: GitHubStatusContext;
    description?: string;
    state?: StatusState;
    targetUrl?: string;
}
export interface GitHubStatusAndFriends extends GitHubStatus {
    siblings: GitHubStatus[];
}

export function currentPhaseIsStillPending(currentPhase: GitHubStatusContext, status: GitHubStatusAndFriends): boolean {
    const result = status.siblings.find(s => s.state === "pending" && s.context === currentPhase);
    if (!result) {
        logger.debug(`${currentPhase} wanted to run but it wasn't pending`);
        return false;
    }
    if (!result.description.startsWith("Planning")) {
        logger.debug(`${currentPhase} is not still planned, so I'm not running it. Description: ${result.description}`);
        return false;
    }
    return true;
}

export function nothingFailed(status: GitHubStatusAndFriends): boolean {
    return !status.siblings.some(sib => ["failure", "error"].includes(sib.state));
}

export function previousPhaseSucceeded(expectedPhases: Phases, currentPhase: GitHubStatusContext, status: GitHubStatusAndFriends): boolean {
    if (status.state !== "success" ) {
        logger.info(`********* Previous state ${status.context} wasn't success, but [${status.state}]`);
        return false;
    }
    if (status.targetUrl.endsWith(ApprovalGateParam)) {
        logger.info(`Approval gate detected in ${status.context}`);
        return false;
    }

    const whereAmI = expectedPhases.phases.indexOf(currentPhase);
    if (whereAmI < 0) {
        logger.warn(`Inconsistency! Phase ${currentPhase} is not part of Phases ${stringify(expectedPhases)}`);
        return false;
    }
    if (whereAmI === 0) {
        logger.info(`${currentPhase} is the first step.`);
        // TODO is this OK?
        return true;
    }
    const previousPhase = expectedPhases.phases[whereAmI - 1];
    if (previousPhase === status.context) {
        return true;
    } else {
        logger.info(`${previousPhase} is right before ${currentPhase}; ignoring success of ${status.context}`);
        return false;
    }
}
