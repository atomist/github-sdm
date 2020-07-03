/*
 * Copyright © 2020 Atomist, Inc.
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

import { logger } from "@atomist/automation-client/lib/util/logger";
import { doWithRetry, RetryOptions } from "@atomist/automation-client/lib/util/retry";
import { ExecuteGoalResult } from "../ExecuteGoalResult";
import { Goal, GoalDefinition } from "../Goal";
import { ExecuteGoal, GoalInvocation } from "../GoalInvocation";
import { goal } from "../GoalWithFulfillment";

/**
 * Minimum information needed to create a goal
 */
export interface EssentialGoalInfo extends Partial<GoalDefinition> {
    displayName: string;
}

/**
 * Rules for waiting for a predicated goal.
 * Specify timeout in seconds or milliseconds.
 */
export interface WaitRules {
    timeoutSeconds?: number;

    timeoutMillis?: number;

    retries?: number;

    condition: (gi: GoalInvocation) => Promise<boolean>;
}

const DefaultWaitRules: Partial<WaitRules> = {
    timeoutSeconds: 1,
    retries: 1000,
};

/**
 * Create a goal from the given executor, waiting until a condition is satisfied,
 * with a given timeout.
 * @param {EssentialGoalInfo} egi
 * @param {ExecuteGoal} goalExecutor
 * @param w rules for waiting
 * @return {Goal}
 */
export function createPredicatedGoal(egi: EssentialGoalInfo, goalExecutor: ExecuteGoal, w: WaitRules): Goal {
    return goal(egi, createPredicatedGoalExecutor(egi.displayName, goalExecutor, w));
}

/**
 * Wrap provided ExecuteGoal instance with WaitRules processing
 * @param {string} uniqueName
 * @param {ExecuteGoal} goalExecutor
 * @param w rules for waiting
 * @return {ExecuteGoal}
 */
export function createPredicatedGoalExecutor(
    uniqueName: string,
    goalExecutor: ExecuteGoal,
    w: WaitRules,
    unref: boolean = true,
): ExecuteGoal {
    if (!!w.timeoutSeconds && !!w.timeoutMillis) {
        throw new Error("Invalid combination: Cannot specify timeoutSeconds and timeoutMillis: Choose one");
    }
    const waitRulesToUse: WaitRules = {
        ...DefaultWaitRules,
        ...w,
    };
    waitRulesToUse.timeoutMillis = waitRulesToUse.timeoutMillis || 1000 * w.timeoutSeconds;

    return async gi => {
        let tries = 1;
        while (true) {
            if (tries > waitRulesToUse.retries) {
                throw new Error(`Goal '${uniqueName}' timed out after max retries: ${JSON.stringify(waitRulesToUse)}`);
            }
            if (await waitRulesToUse.condition(gi)) {
                return goalExecutor(gi);
            }
            tries++;
            logger.debug("Waiting %dms for '%s'", waitRulesToUse.timeoutMillis, uniqueName);
            await wait(waitRulesToUse.timeoutMillis, unref);
        }
    };
}

export function createRetryingGoalExecutor(
    uniqueName: string,
    goalExecutor: ExecuteGoal,
    retry: RetryOptions,
): ExecuteGoal {
    return gi =>
        doWithRetry<void | ExecuteGoalResult>(
            async () => {
                const result = await goalExecutor(gi);
                if (!!result && result.code !== 0) {
                    throw new Error(`Goal '${uniqueName}' failed with non-zero code`);
                }
                return result;
            },
            `Invoking goal '${uniqueName}'`,
            { log: false, ...retry },
        );
}

function wait(timeoutMillis: number, unref: boolean): Promise<void> {
    return new Promise<void>(resolve => {
        const timer = setTimeout(resolve, timeoutMillis);
        if (unref) {
            timer.unref();
        }
    });
}
