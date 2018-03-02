/*
 * Copyright © 2017 Atomist, Inc.
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

import { GraphQL, HandlerResult, logger, Secret, Secrets, Success } from "@atomist/automation-client";
import { EventFired, EventHandler, HandleEvent, HandlerContext } from "@atomist/automation-client/Handlers";
import { GitHubRepoRef } from "@atomist/automation-client/operations/common/GitHubRepoRef";
import { PlannedPhase } from "../../../../../common/phases/Phases";
import { createStatus } from "../../../../../util/github/ghub";
import { K8AutomationDeployContext } from "./RequestDeployOnSuccessStatus";
import {OnAnyStatus} from "../../../../../typings/types";
import {NoticeK8sDeployCompletionOnStatus} from "./NoticeK8sDeployCompletion";

/**
 * Deploy a published artifact identified in an ImageLinked event.
 */
@EventHandler("Request k8s deploy of linked artifact",
    GraphQL.subscriptionFromFile("graphql/subscription/OnAParticularStatus.graphql", undefined,
        {context: K8AutomationDeployContext + "production"}))
export class NoticeK8sProductionDeployCompletionOnStatus extends NoticeK8sDeployCompletionOnStatus {
    environment = "production";
}
