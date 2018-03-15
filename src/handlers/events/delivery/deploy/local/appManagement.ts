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

import { logger } from "@atomist/automation-client";
import { RemoteRepoRef } from "@atomist/automation-client/operations/common/RepoId";
import { ChildProcess } from "child_process";
import { TargetInfo } from "../../../../../spi/deploy/Deployment";
import { Targeter } from "../deploy";

export interface BranchRepoRef extends RemoteRepoRef {
    branch?: string;
}

export function isBranchRepoRef(rr: RemoteRepoRef): rr is BranchRepoRef {
    return !!(rr as BranchRepoRef).branch;
}

export interface ManagedDeploymentTargetInfo extends TargetInfo {
    managedDeploymentKey: BranchRepoRef;
}

export const ManagedDeploymentTargeter: Targeter<ManagedDeploymentTargetInfo> = (id: RemoteRepoRef, branch: string) => {
    const branchId = {...id, branch};
    return {
        name: "Run alongside this automation",
        description: `Locally run ${id.sha} from branch ${branch}`,
        managedDeploymentKey: branchId,
    };
};

// this is currently used in shutdown
// because Superseded should be per-branch, but isn't yet.
// At least this makes it explicit we don't have it quite right yet
export function targetInfoForAllBranches(id: RemoteRepoRef): ManagedDeploymentTargetInfo {
    return {
        managedDeploymentKey: {...id, branch: undefined},
        name: "Run alongside this automation",
        description: `Locally run ${id.sha} from an unknown branch`,
    };
}

/**
 * Ports will be reused for the same app
 */
export interface DeployedApp {

    id: BranchRepoRef;

    port: number;

    /** Will be undefined if the app is not currently deployed */
    childProcess: ChildProcess;
}

/**
 * Manages deployments
 * This is not intended for production use
 * @type {Array}
 */
export class ManagedDeployments {

    private deployments: DeployedApp[] = [];

    constructor(public initialPort: number) {
    }

    /**
     * Find a new port for this app
     * @param {RemoteRepoRef} id
     * @return {number}
     */
    public findPort(id: RemoteRepoRef): number {
        const running = isBranchRepoRef(id) ?
            this.deployments
                .find(d => d.id.owner === id.owner && d.id.repo === id.repo && d.id.branch === id.branch) :
            this.deployments
                .find(d => d.id.owner === id.owner && d.id.repo === id.repo);
        return !!running ? running.port : this.nextFreePort();
    }

    public async recordDeployment(da: DeployedApp) {
        logger.info("Recording app [%j] on port [%d]", da.port);
        this.deployments.push(da);
    }

    /**
     * Terminate any process we're managing on behalf of this id
     * @param {BranchRepoRef} id
     * @return {Promise<any>}
     */
    public async terminateIfRunning(id: BranchRepoRef): Promise<any> {
        const victim = this.deployments.find(d => d.id.sha === id.sha ||
            (d.id.owner === id.owner && d.id.repo === id.repo && !!id.branch && d.id.branch === id.branch));
        if (!!victim && !!victim.childProcess) {
            victim.childProcess.kill();
            // Keep the port but deallocate the process
            logger.info("Killed app [%j] with pid %d, but continuing to reserve port [%d]",
                id, victim.childProcess.pid, victim.port);
            victim.childProcess = undefined;
        } else {
            logger.info("Was asked to kill app [%j], but no eligible process found", id);
        }
    }

    private nextFreePort(): number {
        let port = this.initialPort;
        while (this.deployments.some(d => d.port === port)) {
            port++;
        }
        return port;
    }

}
