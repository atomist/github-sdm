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

import {
    failure,
    GraphQL,
    HandleCommand,
    HandlerResult,
    logger,
    Secret,
    Secrets,
    Success,
} from "@atomist/automation-client";
import { EventFired, EventHandler, HandlerContext } from "@atomist/automation-client/Handlers";
import { commandHandlerFrom } from "@atomist/automation-client/onCommand";
import { GitHubRepoRef } from "@atomist/automation-client/operations/common/GitHubRepoRef";
import { RemoteRepoRef } from "@atomist/automation-client/operations/common/RepoId";
import { buttonForCommand } from "@atomist/automation-client/spi/message/MessageClient";
import {
    currentPhaseIsStillPending,
    GitHubStatusAndFriends,
    Goal,
    Goals,
    previousGoalSucceeded,
} from "../../../../common/goals/Goal";
import { createEphemeralProgressLog } from "../../../../common/log/EphemeralProgressLog";
import { addressChannelsFor } from "../../../../common/slack/addressChannels";
import { ArtifactStore } from "../../../../spi/artifact/ArtifactStore";
import { Deployer } from "../../../../spi/deploy/Deployer";
import { TargetInfo } from "../../../../spi/deploy/Deployment";
import { OnAnySuccessStatus } from "../../../../typings/types";
import { EventWithCommand, RetryDeployParameters } from "../../../commands/RetryDeploy";
import { StatusSuccessHandler } from "../../StatusSuccessHandler";
import { deploy } from "./deploy";

/**
 * Deploy a published artifact identified in an ImageLinked event.
 */
@EventHandler("Deploy linked artifact",
    GraphQL.subscriptionFromFile("graphql/subscription/OnAnySuccessStatus.graphql"))
export class DeployFromLocalOnSuccessStatus<T extends TargetInfo> implements StatusSuccessHandler, EventWithCommand {

    @Secret(Secrets.OrgToken)
    private githubToken: string;

    /**
     *
     * @param {Goals} phases
     * @param {Goal} deployGoal
     * @param {Goal} endpointGoal
     * @param {ArtifactStore} artifactStore
     * @param {Deployer<T extends TargetInfo>} deployer
     * @param {(id: RemoteRepoRef) => T} targeter tells what target to use for this repo.
     * For example, we may wish to deploy different repos to different Cloud Foundry spaces
     * or Kubernetes clusters
     */
    constructor(private deployGoal: Goal,
                private endpointGoal: Goal,
                private artifactStore: ArtifactStore,
                public deployer: Deployer<T>,
                private targeter: (id: RemoteRepoRef) => T) {
    }

    public get commandName() {
        return "RetryDeployLocal";
    }

    public correspondingCommand(): HandleCommand {
        return commandHandlerFrom((ctx: HandlerContext, commandParams: RetryDeployParameters) => {
            return deploy({
                deployPhase: this.deployGoal,
                endpointPhase: this.endpointGoal,
                id: new GitHubRepoRef(commandParams.owner, commandParams.repo, commandParams.sha),
                githubToken: commandParams.githubToken,
                targetUrl: commandParams.targetUrl,
                artifactStore: this.artifactStore,
                deployer: this.deployer,
                targeter: this.targeter,
                ac: (msg, opts) => ctx.messageClient.respond(msg, opts),
                team: ctx.teamId,
                retryButton: buttonForCommand({text: "Retry"}, this.commandName, {
                    ...commandParams,
                }),
                logFactory: createEphemeralProgressLog,
            });
        }, RetryDeployParameters, this.commandName);
    }

    public async handle(event: EventFired<OnAnySuccessStatus.Subscription>, ctx: HandlerContext, params: this): Promise<HandlerResult> {
        const status = event.data.Status[0];
        const commit = status.commit;
        const image = status.commit.image;

        const id = new GitHubRepoRef(commit.repo.owner, commit.repo.name, commit.sha);

        const statusAndFriends: GitHubStatusAndFriends = {
            context: status.context,
            state: status.state,
            targetUrl: status.targetUrl,
            description: status.description,
            siblings: status.commit.statuses,
        };

        if (!params.deployGoal.preconditionsMet({token: params.githubToken}, id, statusAndFriends)) {
            logger.info("Preconditions not met for goal %s on %j", params.deployGoal, id);
            return Success;
        }

        if (!currentPhaseIsStillPending(params.deployGoal.context, statusAndFriends)) {
            return Success;
        }

        if (!image) {
            logger.warn(`No image found on commit ${commit.sha}; can't deploy`);
            return failure(new Error("No image linked"));
        }

        logger.info(`Running deploy. Triggered by ${status.state} status: ${status.context}: ${status.description}`);
        const retryButton = buttonForCommand({text: "Retry"}, this.commandName, {
            repo: commit.repo.name,
            owner: commit.repo.owner,
            sha: commit.sha,
            targetUrl: image.imageName,
        });

        await dedup(commit.sha, () =>
            deploy({
                deployPhase: params.deployGoal,
                endpointPhase: params.endpointGoal,
                id, githubToken: params.githubToken,
                targetUrl: image.imageName,
                artifactStore: this.artifactStore,
                deployer: params.deployer,
                targeter: params.targeter,
                ac: addressChannelsFor(commit.repo, ctx),
                team: ctx.teamId,
                retryButton,
                logFactory: createEphemeralProgressLog,
            }));

        return Success;
    }
}

const running = {};

async function dedup<T>(key: string, f: () => Promise<T>): Promise<T | void> {
    if (running[key]) {
        logger.warn("deploy was called twice for " + key);
        return Promise.resolve();
    }
    running[key] = true;
    const promise = f().then(t => {
        running[key] = undefined;
        return t;
    });
    return promise;
}
