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

import {
    ingester,
    IngesterBuilder,
    type,
} from "@atomist/automation-client";

export const GoalRootType = "SdmGoal";

export type GoalState = "planned" | "requested" | "in_process" | "waiting_for_approval" | "success" | "failure" | "skipped";

export interface SdmGoal extends SdmGoalKey {
    sha: string;
    branch: string;

    repo: {
        name: string;
        owner: string;
        providerId: string;
    };

    description: string;
    url?: string;
    state: GoalState;
    ts: number;

    error?: string;
    retryFeasible?: boolean;

    approval?: SdmProvenance;

    provenance: SdmProvenance[];

    preConditions: SdmGoalKey[];

    externalKey?: string;
}

export interface SdmProvenance {
    correlationId: string;
    registration: string;
    version: string;
    name: string;
    ts: number;

    userId?: string;
    channelId?: string;
}

export interface SdmGoalKey {
    goalSet: string;
    environment: string;
    name: string;
}

export function goalKeyEquals(a: SdmGoalKey, b: SdmGoal): boolean {
    return a.goalSet === b.goalSet &&
        a.environment === b.environment &&
        a.name === b.name;
}

export const SdmGoalIngester: IngesterBuilder = ingester(GoalRootType)
    .withType(type("SdmRepository")
        .withStringField("name")
        .withStringField("owner")
        .withStringField("providerId"))
    .withType(type("SdmCondition")
        .withStringField("goalSet")
        .withStringField("environment")
        .withStringField("name"))
    .withType(type("SdmProvenance")
        .withStringField("correlationId")
        .withStringField("registration")
        .withStringField("name")
        .withStringField("version")
        .withIntField("ts")
        .withStringField("userId")
        .withStringField("channelId"))
    .withType(type(GoalRootType)
        .withStringField(
            "goalSet",
            "Goal set the goal is a part of",
            ["compositeId"])
        .withStringField(
            "environment",
            "Environment the goal runs in",
            ["compositeId"])
        .withStringField(
            "name",
            "Name of the goal",
            ["compositeId"])
        .withStringField(
            "sha",
            "Commit that the goal belongs to",
            ["compositeId"])
        .withStringField(
            "branch",
            "Branch of the goal's commit",
            ["compositeId"])
        .withObjectField(
            "repo",
            "SdmRepository",
            "Repository the commit was observed from",
            ["name", "owner", "providerId"])
        .withStringField(
            "description",
            "Description of the goal")
        .withStringField(
            "url",
            "URL of the goal")
        .withStringField(
            "state",
            "State of goal")
        .withStringField(
            "externalKey",
            "key to a corresponding commit status in GitHub/BitBucket (optional)")
        .withIntField(
            "ts",
            "Timestamp of goal")
        .withStringField(
            "error",
            "Error occurred during goal execution")
        .withBooleanField(
            "retryFeasible",
            "Goal can be retried")
        .withListObjectField(
            "preConditions",
            "SdmCondition",
            "Preconditions of goal")
        .withObjectField(
            "approval",
            "SdmProvenance",
            "Where and how the goal was approved")
        .withListObjectField(
            "provenance",
            "SdmProvenance",
            "Changes to goal"));
