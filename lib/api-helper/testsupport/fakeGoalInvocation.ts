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

import { guid } from "@atomist/automation-client/lib/internal/util/string";
import { RemoteRepoRef, RepoId } from "@atomist/automation-client/lib/operations/common/RepoId";
import { logger } from "@atomist/automation-client/lib/util/logger";
import { LoggingProgressLog } from "../../api-helper/log/LoggingProgressLog";
import { NoPreferenceStore } from "../../api/context/preferenceStore";
import { createSkillContext } from "../../api/context/skillContext";
import { Goal } from "../../api/goal/Goal";
import { GoalInvocation } from "../../api/goal/GoalInvocation";
import { SdmGoalEvent } from "../../api/goal/SdmGoalEvent";
import { IndependentOfEnvironment } from "../../api/goal/support/environment";
import { SoftwareDeliveryMachineOptions } from "../../api/machine/SoftwareDeliveryMachineOptions";
import { SdmGoalState } from "../../typings/types";
import { fakeContext } from "./fakeContext";

/**
 * Useful testing support
 * @param {RemoteRepoRef} id
 * @return {GoalInvocation}
 */
export function fakeGoalInvocation(id: RemoteRepoRef, options?: SoftwareDeliveryMachineOptions): GoalInvocation {
    return {
        credentials: { token: "foobar" },
        context: fakeContext("T1111"),
        id,
        addressChannels: async m => {
            logger.info("channels > " + m);
        },
        preferences: NoPreferenceStore,
        progressLog: new LoggingProgressLog("fake"),
        goalEvent: fakeSdmGoal(id),
        goal: fakeGoal("fake goal"),
        configuration: {
            sdm: {
                ...options,
            },
        } as any,
        skill: createSkillContext(fakeContext("T1111")),
    };
}

function fakeSdmGoal(id: RepoId): SdmGoalEvent {
    return {
        uniqueName: "hi",
        name: "Hello",
        goalSet: "goal set",
        registration: "foo",
        goalSetId: "xuf",
        ts: 42,
        provenance: [],
        preConditions: [],
        environment: "0-code",
        fulfillment: {
            method: "other",
            registration: "@atomist/sdm",
            name: "something",
        },
        repo: {
            name: id.repo,
            owner: id.owner,
            providerId: "asdfdas",
        },
        sha: "abc",
        branch: "master",
        state: SdmGoalState.requested,
        push: {
            repo: {
                org: {
                    owner: id.owner,
                    provider: {
                        providerId: "skdfjasd",
                        apiUrl: "https://api.github.com",
                    },
                },
                name: id.repo,
                channels: [
                    {
                        name: "foo",
                        id: "1",
                        team: {
                            id: "T357",
                        },
                    },
                ],
            },
            commits: [{ sha: guid() }],
        },
    };
}

function fakeGoal(name: string): Goal {
    return new Goal({
        uniqueName: name,
        displayName: name,
        environment: IndependentOfEnvironment,
    });
}
