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

import { HandlerContext, logger } from "@atomist/automation-client";
import { GitHubRepoRef } from "@atomist/automation-client/operations/common/GitHubRepoRef";
import { SdmGoalsForCommit } from "../../../typings/types";

import * as _ from "lodash";

export async function fetchGoalsForCommit(ctx: HandlerContext, id: GitHubRepoRef, providerId: string): Promise<SdmGoalsForCommit.SdmGoal[]> {
    const result = await ctx.graphClient.query<SdmGoalsForCommit.Query, SdmGoalsForCommit.Variables>({
        name: "SdmGoalsForCommit", variables: {
            owner: id.owner,
            repo: id.repo,
            branch: id.branch,
            sha: id.sha,
            providerId,
            qty: 20,
        },
    });
    if (!result || !result.SdmGoal) {
        throw new Error(`No result finding goals for commit ${providerId}/${id.owner}/${id.repo}#${id.sha} on ${id.branch}`);
    }
    if (result.SdmGoal.length === 0) {
        logger.warn("0 goals found for commit %j, provider %s", id, providerId);
    }
    if (result.SdmGoal.some(g => !g)) {
        logger.warn("Internal error: Null or undefined goal found for commit %j, provider %s", id, providerId);
    }
    if (result.SdmGoal.length === 20) {
        logger.warn("Watch out! There may be more goals than this. We only retrieve 20.");
        // automation-api#399 paging is not well-supported yet
    }

    return _.flatten(result.SdmGoal);
}
