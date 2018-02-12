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

import { GraphQL, Secret, Secrets, Success } from "@atomist/automation-client";
import { EventFired, EventHandler, HandleEvent, HandlerContext } from "@atomist/automation-client/Handlers";
import { GitHubRepoRef } from "@atomist/automation-client/operations/common/GitHubRepoRef";
import { OnBuiltStatus, StatusState } from "../../../typings/types";
import { createGist, createStatus } from "../../commands/editors/toclient/ghub";
import { CloudFoundryDeployer } from "./CloudFoundryDeployer";
import { parseCloudFoundryLog } from "./cloudFoundryLogParser";
import { AppInfo, CloudFoundryInfo, PivotalWebServices } from "./Deployment";
import { SavingProgressLog } from "./ProgressLog";

export interface DeployableArtifact extends AppInfo {

    cwd: string;

    filename: string;
}

export type ArtifactCheckout = (targetUrl: string) => Promise<DeployableArtifact>;

export const CloudFoundryTarget: CloudFoundryInfo = {
    ...PivotalWebServices,
    api: process.env.PCF_API,
    username: process.env.PIVOTAL_USER,
    password: process.env.PIVOTAL_PASSWORD,
    space: process.env.PCF_SPACE,
    org: process.env.PCF_ORG,
};

@EventHandler("Deploy published artifact",
    GraphQL.subscriptionFromFile("graphql/subscription/OnBuiltStatus.graphql"))
export class DeployOnBuildSuccessStatus implements HandleEvent<OnBuiltStatus.Subscription> {

    @Secret(Secrets.OrgToken)
    private githubToken: string;

    constructor(private artifactCheckout: ArtifactCheckout = localCheckout,
                private cfDeployer: CloudFoundryDeployer = new CloudFoundryDeployer()) {
    }

    public handle(event: EventFired<OnBuiltStatus.Subscription>, ctx: HandlerContext, params: this): Promise<any> {

        // TODO this is horrid
        const commit = event.data.Status[0].commit;

        const id = new GitHubRepoRef(commit.repo.owner, commit.repo.name, commit.sha);

        const persistentLog = new SavingProgressLog();
        const progressLog = persistentLog;

        const targetUrl = event.data.Status[0].targetUrl;
        return setDeployStatus(params.githubToken, id, "pending", "http://test.com")
            .then(() => {
                return this.artifactCheckout(targetUrl)
                    .then(ac => {
                        console.log("Do PCF deployment of " + JSON.stringify(ac));
                        return this.cfDeployer.deploy(ac, CloudFoundryTarget, progressLog)
                            .then(deployment => {
                                deployment.childProcess.stdout.on("data", what => progressLog.write(what.toString()));
                                deployment.childProcess.addListener("exit", (code, signal) => {
                                    const di = parseCloudFoundryLog(persistentLog.log);
                                    return createGist(params.githubToken, {
                                        description: `Deployment log for ${id.owner}/${id.repo}`,
                                        public: false,
                                        files: [{
                                            path: `${id.owner}_${id.repo}-${id.sha}.log`,
                                            content: persistentLog.log,
                                        }],
                                    })
                                        .then(gist => setDeployStatus(params.githubToken, id, "success", gist))
                                        .then(() => {
                                            return !!di ?
                                                setEndpointStatus(params.githubToken, id, di.endpoint) :
                                                true;
                                        });

                                });
                                deployment.childProcess.addListener("error", (code, signal) => {
                                    return createGist(params.githubToken, {
                                        description: `Failed deployment log for ${id.owner}/${id.repo}`,
                                        public: false,
                                        files: [{
                                            path: `${id.owner}_${id.repo}-${id.sha}.log`,
                                            content: persistentLog.log,
                                        }],
                                    })
                                        .then(gist => setDeployStatus(params.githubToken, id, "failure", gist));
                                });
                                return Success;
                            });
                    });
            });
    }

}

function setDeployStatus(token: string, id: GitHubRepoRef, state: StatusState, target_url: string): Promise<any> {
    return createStatus(token, id, {
        state,
        target_url,
        context: "deployment",
    });
}

function setEndpointStatus(token: string, id: GitHubRepoRef, endpoint: string): Promise<any> {
    return createStatus(token, id, {
        state: "success",
        target_url: endpoint,
        context: "endpoint",
    });
}

/**
 *
 * @param {string} targetUrl
 * @return {string} the directory
 */
const localCheckout: ArtifactCheckout = targetUrl => {
    //Form is http:///var/folders/86/p817yp991bdddrqr_bdf20gh0000gp/T/tmp-20964EBUrRVIZ077a/target/losgatos1-0.1.0-SNAPSHOT.jar
    const lastSlash = targetUrl.lastIndexOf("/");
    const filename = targetUrl.substr(lastSlash + 1);
    const name = filename.substr(0, filename.indexOf("-"));
    const version = filename.substr(name.length + 1);
    const cwd = targetUrl.substring(7, lastSlash);
    const local: DeployableArtifact = {
        name,
        version,
        cwd,
        filename,
    };
    return Promise.resolve(local);
};
