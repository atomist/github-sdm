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

import { GoalDefinition } from "../Goal";
import { GoalWithFulfillment, Fulfillment } from "../GoalWithFulfillment";
import { ExecuteGoal } from "../GoalInvocation";
import { IndependentOfEnvironment } from "../support/environment";

export interface EssentialGoalInfo extends Partial<GoalDefinition> {

    displayName: string
}

/**
 * Goal implementation that allows a goal to be defined with basic information
 * and an action callback.
 */
export class CallbackGoal extends GoalWithFulfillment {

    constructor(egi: EssentialGoalInfo, goalExecutor: ExecuteGoal) {
        super({
            // TODO fix unique name generation
            uniqueName: egi.displayName,
            environment: IndependentOfEnvironment,
            completedDescription: `${egi.displayName} completed`,
            workingDescription: `Working: ${egi.displayName}`,
            failedDescription: `${egi.displayName} failed`,
            waitingForApprovalDescription: `${egi.displayName} waiting for approval`,
            canceledDescription: `${egi.displayName} canceled`,
            stoppedDescription: `${egi.displayName} stopped`,
            ...egi,
        });
        const fulfillment: Fulfillment = {
            name: this.definition.uniqueName,
            goalExecutor,
        };
        super.with(fulfillment);
    }

}

