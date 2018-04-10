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
import { Builder } from "../../../spi/build/Builder";
import { ProjectLoader } from "../../repo/ProjectLoader";
import { ExecuteGoalResult } from "../goals/goalExecution";
import { ExecuteGoalWithLog, RunWithLogContext } from "../goals/support/reportGoalError";

/**
 * Execute build with the appropriate builder
 * @param projectLoader used to load projects
 * @param builderMapping mapping to a builder
 */
export function executeBuild(projectLoader: ProjectLoader,
                             builder: Builder): ExecuteGoalWithLog {
    return async (rwlc: RunWithLogContext): Promise<ExecuteGoalResult> => {
        const {status, credentials, id, context, progressLog, addressChannels} = rwlc;
        const commit = status.commit;
        const atomistTeam = context.teamId;

        logger.info("Building project %s:%s with builder [%s]", id.owner, id.repo, builder.name);
        const allBranchesThisCommitIsOn = commit.pushes.map(p => p.branch);
        const theDefaultBranchIfThisCommitIsOnIt = allBranchesThisCommitIsOn.find(b => b === commit.repo.defaultBranch);
        const someBranchIDoNotReallyCare = allBranchesThisCommitIsOn.find(b => true);
        const branchToMarkTheBuildWith = theDefaultBranchIfThisCommitIsOnIt || someBranchIDoNotReallyCare || "master";

        // the builder is expected to result in a complete Build event (which will update the build status)
        // and an ImageLinked event (which will update the artifact status).
        return builder.initiateBuild(credentials, id, addressChannels,
            atomistTeam, {branch: branchToMarkTheBuildWith}, progressLog);
    };
}
