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

import { GraphQL, Secret, Secrets } from "@atomist/automation-client";
import {
    EventFired,
    EventHandler,
    failure,
    HandleEvent,
    HandlerContext,
    HandlerResult,
    Success,
} from "@atomist/automation-client/Handlers";
import { GitHubRepoRef } from "@atomist/automation-client/operations/common/GitHubRepoRef";
import {
    ProjectOperationCredentials,
    TokenCredentials,
} from "@atomist/automation-client/operations/common/ProjectOperationCredentials";
import { GitCommandGitProject } from "@atomist/automation-client/project/git/GitCommandGitProject";
import { GitProject } from "@atomist/automation-client/project/git/GitProject";
import { OnPush } from "../../../typings/types";
import { AddressChannels, addressChannelsFor } from "../../commands/editors/toclient/addressChannels";
import { createStatus } from "../../commands/editors/toclient/ghub";

/**
 * Scan code on a PR. Result is setting GitHub status with context = "scan"
 */
@EventHandler("Scan code on PR",
    GraphQL.subscriptionFromFile("graphql/subscription/OnPush.graphql"))
export class ScanOnPush implements HandleEvent<OnPush.Subscription> {

    @Secret(Secrets.OrgToken)
    private githubToken: string;

    public handle(event: EventFired<OnPush.Subscription>, ctx: HandlerContext, params: this): Promise<HandlerResult> {
        const push: OnPush.Push = event.data.Push[0];
        const commit = push.commits[0];

        const msg = `Scanning sources after push: \`${commit.sha}\` - _${commit.message}_`;
        console.log(msg);

        const id = new GitHubRepoRef(push.repo.owner, push.repo.name, commit.sha);

        const creds = {token: params.githubToken };

        const communicator = addressChannelsFor(push.repo, ctx);

        return GitCommandGitProject.cloned(creds, id)
            .then(p => {
                return withProject(p, creds, communicator, ctx)
                    .then(() => communicator(msg))
                    .then(() => Success, failure);
            });
    }
}

// TODO have steps and break out if any of them fails
function withProject(p: GitProject, creds: ProjectOperationCredentials, addressChannels: AddressChannels, ctx: HandlerContext): Promise<any> {
    return p.findFile("pom.xml")
        .then(() => markScanned(p.id as GitHubRepoRef, creds))
        .catch(err => {
            // This will terminate pipeline
            console.log("Error was " + err);
            return addressChannels("This project has no pom. Cannot deploy");
        });
}

export const ScanBase = "https://scan.atomist.com";

function markScanned(id: GitHubRepoRef, creds: ProjectOperationCredentials): Promise<any> {
    console.log(`Create status with tok=${JSON.stringify(creds)}`);
    return createStatus((creds as TokenCredentials).token, id, {
        state: "success",
        target_url: `${ScanBase}/${id.owner}/${id.repo}/${id.sha}`,
        context: "scan",
    });
}
