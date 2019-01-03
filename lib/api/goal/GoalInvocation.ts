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

import { GitProject } from "@atomist/automation-client";
import { ProgressLog } from "../../spi/log/ProgressLog";
import { RepoContext } from "../context/SdmContext";
import { SoftwareDeliveryMachineConfiguration } from "../machine/SoftwareDeliveryMachineOptions";
import { PushTest } from "../mapping/PushTest";
import { ExecuteGoalResult } from "./ExecuteGoalResult";
import { Goal } from "./Goal";
import { SdmGoalEvent } from "./SdmGoalEvent";

/**
 * Type of all goal invocation functions. This is a key extension
 * point for SDMs.
 */
export type ExecuteGoal =
    (r: GoalInvocation) => Promise<void | ExecuteGoalResult>;

export type PrepareForGoalExecution =
    (p: GitProject, r: GoalInvocation) => Promise<void | ExecuteGoalResult>;

export enum GoalProjectListenerEvent {
    before = "before",
    after = "after",
}

export type GoalProjectListener =
    (p: GitProject, r: GoalInvocation, event: GoalProjectListenerEvent) => Promise<void | ExecuteGoalResult>;

export interface GoalProjectListenerRegistration {
    name: string;
    listener: GoalProjectListener;
    pushTest?: PushTest;
    events?: GoalProjectListenerEvent[];
}

export interface GoalInvocation extends RepoContext {

    /**
     * This SDM's current configuration
     */
    configuration: SoftwareDeliveryMachineConfiguration;

    /**
     * The goal that we are currently executing
     */
    goal: Goal;

    /**
     * The goal event that triggered this execution
     * @deprecated use goalEvent
     */
    sdmGoal: SdmGoalEvent;

    /**
     * The goal event that triggered this execution
     */
    goalEvent: SdmGoalEvent;

    /**
     * Progress log to write output to
     *
     * Use this to write user-level log messages that you want to see in the log stream
     */
    progressLog: ProgressLog;

}

/**
 * Convenience function that takes a PrepareForGoalExecution and invokes it for after goal project events.
 * @param listener
 */
export function afterListener(listener: PrepareForGoalExecution): GoalProjectListener {
    return async (p, r, event) => {
        if (event === GoalProjectListenerEvent.after) {
            return listener(p, r);
        }
    };
}

/**
 * Convenience function that takes a PrepareForGoalExecution and invokes it for before goal project events.
 * @param listener
 */
export function beforeListener(listener: PrepareForGoalExecution): GoalProjectListener {
    return async (p, r, event) => {
        if (event === GoalProjectListenerEvent.before) {
            return listener(p, r);
        }
    };
}
