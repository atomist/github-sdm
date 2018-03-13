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

import { failure, HandlerContext, logger, } from "@atomist/automation-client";
import { GitHubRepoRef } from "@atomist/automation-client/operations/common/GitHubRepoRef";
import { ProjectOperationCredentials, TokenCredentials, } from "@atomist/automation-client/operations/common/ProjectOperationCredentials";
import { RemoteRepoRef } from "@atomist/automation-client/operations/common/RepoId";
import { OnAnySuccessStatus } from "../../../../../typings/types";
import { createStatus } from "../../../../../util/github/ghub";
import { ExecuteGoalInvocation, Executor } from "../../ExecuteGoalOnSuccessStatus";

export type K8Target = "testing" | "production";

export const K8TargetBase = "deploy/atomist/k8s/";

export function k8AutomationDeployContext(target: K8Target): string {
    return `${K8TargetBase}${target}`;
}

export function requestDeployToK8s(target: K8Target): Executor {
    return async (status: OnAnySuccessStatus.Status, ctx: HandlerContext, params: ExecuteGoalInvocation) => {

        const commit = status.commit;
        const image = status.commit.image;
        const id = new GitHubRepoRef(commit.repo.owner, commit.repo.name, commit.sha);

        if (!image) {
            logger.warn(`No image found on commit ${commit.sha}; can't deploy`);
            return Promise.resolve(failure(new Error("No image linked")));
        }

        logger.info(`Requesting deploy. Triggered by ${status.state} status: ${status.context}: ${status.description}`);
        await createStatus(params.githubToken, id as GitHubRepoRef, {
            context: k8AutomationDeployContext(target),
            state: "pending",
            description: "Requested deploy by k8-automation",
        });
    };
}

export async function undeployFromK8s(creds: ProjectOperationCredentials,
                                      id: RemoteRepoRef,
                                      env: string) {
    const undeployContext = "undeploy/atomist/k8s/" + env;
    await createStatus((creds as TokenCredentials).token, id as GitHubRepoRef, {
        context: undeployContext,
        state: "pending",
        description: `Requested undeploy from ${env} by k8-automation`,
    }).catch(err => Promise.resolve(new Error(`Could not undeploy from ${env}: ${err.message}`)));
}
