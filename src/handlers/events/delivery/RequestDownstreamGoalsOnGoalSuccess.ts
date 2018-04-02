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

import { EventFired, EventHandler, HandleEvent, HandlerContext, HandlerResult, logger, Success, } from "@atomist/automation-client";
import { subscription } from "@atomist/automation-client/graph/graphQL";
import { fetchGoalsForCommit } from "../../../common/delivery/goals/fetchGoalsOnCommit";
import { updateGoal } from "../../../common/delivery/goals/storeGoals";
import { SdmGoal, SdmGoalKey } from "../../../ingesters/sdmGoalIngester";
import { OnAnySuccessStatus, OnSuccessStatus } from "../../../typings/types";
import { providerIdFromStatus, repoRefFromStatus } from "../../../util/git/repoRef";
import { preconditionsAreMet } from "../../../common/delivery/goals/goalPreconditions";
import Status = OnSuccessStatus.Status;

/**
 * Respond to a failure status by failing downstream goals
 */
@EventHandler("Move downstream goals from 'planned' to 'success' when preconditions are met",
    subscription("OnAnySuccessStatus"))
export class RequestDownstreamGoalsOnGoalSuccess implements HandleEvent<OnAnySuccessStatus.Subscription> {

    // #98: GitHub Status->SdmGoal: I believe all the goal state updates in this SDM
    // are now happening on the SdmGoal. This subscription can change to be on SdmGoal state.
    public async handle(event: EventFired<OnAnySuccessStatus.Subscription>,
                        ctx: HandlerContext): Promise<HandlerResult>  {
        const status: Status = event.data.Status[0];

        if (status.state !== "success") { // atomisthq/automation-api#395 (probably not an issue for Status but will be again for SdmGoal)
            logger.debug(`********* success reported when the state was=[${status.state}]`);
            return Promise.resolve(Success);
        }

        const id = repoRefFromStatus(status);
        const goals = await fetchGoalsForCommit(ctx, id, providerIdFromStatus(status)) as SdmGoal[];
        const successfulGoal = goals.find(g => g.externalKey === status.context) as SdmGoal;

        const goalsToRequest = goals.filter(g => isDirectlyDependentOn(successfulGoal, g))
            .filter(shouldBePlannedOrSkipped)
            .filter(g => preconditionsAreMet(g, { goalsForCommit: goals}));

        /*
         * #294 Intention: for custom descriptions per goal, we need to look up the Goal.
         * This is the only reason to do that here.
         * I want to maintain a list in the SDM of all goals that can be assigned by rules,
         * and pass them here for mapping from SdmGoalKey -> Goal. Then, we can use
         * the requestDescription defined on that Goal.
         */
        await Promise.all(goalsToRequest.map(g => updateGoal(ctx, g, {
            state: "requested",
            description: `Ready to ` + g.name,
        })));

        return Success;
    }
}

function shouldBePlannedOrSkipped(dependentGoal: SdmGoal) {
    if (dependentGoal.state === "planned") {
        return true;
    }
    if (dependentGoal.state === "skipped") {
        logger.info("Goal %s was skipped, but now maybe it can go", dependentGoal.name);
        return true;
    }
    if (dependentGoal.state === "failure" && dependentGoal.retryFeasible) {
        logger.info("Goal %s failed, but maybe we will retry it", dependentGoal.name);
        return true;
    }
    logger.warn("Goal %s in state %s will not be requested", dependentGoal.name, dependentGoal.state);
    return false;
}

function mapKeyToGoal<T extends SdmGoalKey>(goals: T[]): (SdmGoalKey) => T {
    return (keyToFind: SdmGoalKey) => {
        const found = goals.find(g => g.goalSet === keyToFind.goalSet &&
            g.environment === keyToFind.environment &&
            g.name === keyToFind.name);
        return found;
    };
}

function isDirectlyDependentOn(successfulGoal: SdmGoalKey, goal: SdmGoal): boolean {
    if (!goal) {
        logger.warn("Internal error: Trying to work out if %j is dependent on null or undefined goal", successfulGoal);
        return false;
    }
    if (!goal.preConditions || goal.preConditions.length === 0) {
        return false; // no preconditions? not dependent
    }
    if (mapKeyToGoal(goal.preConditions)(successfulGoal)) {
        logger.debug("%s depends on %s", goal.name, successfulGoal.name);
        return true; // the failed goal is one of my preconditions? dependent
    }
    return false;
}
