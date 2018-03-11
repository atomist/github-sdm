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

import * as _ from "lodash";

import { GraphQL, logger, Secret, Secrets, Success } from "@atomist/automation-client";
import {
    EventFired,
    EventHandler,
    failure,
    HandleEvent,
    HandlerContext,
    HandlerResult,
} from "@atomist/automation-client/Handlers";
import { GitHubRepoRef } from "@atomist/automation-client/operations/common/GitHubRepoRef";
import {
    ProjectOperationCredentials,
    TokenCredentials,
} from "@atomist/automation-client/operations/common/ProjectOperationCredentials";
import { ProjectReviewer } from "@atomist/automation-client/operations/review/projectReviewer";
import { ProjectReview, ReviewComment } from "@atomist/automation-client/operations/review/ReviewResult";
import { GitCommandGitProject } from "@atomist/automation-client/project/git/GitCommandGitProject";
import * as slack from "@atomist/slack-messages";
import { Attachment, SlackMessage } from "@atomist/slack-messages";
import { AddressChannels, addressChannelsFor } from "../../../../../common/slack/addressChannels";
import { OnAnyPendingStatus, StatusState } from "../../../../../typings/types";
import { createStatus } from "../../../../../util/github/ghub";

import { buttonForCommand } from "@atomist/automation-client/spi/message/MessageClient";
import { deepLink } from "@atomist/automation-client/util/gitHub";
import { formatReviewerError, ReviewerError } from "../../../../../blueprint/ReviewerError";
import { Goal } from "../../../../../common/goals/Goal";
import { forApproval } from "../../verify/approvalGate";

/**
 * Scan code on a push, invoking ProjectReviewers and arbitrary CodeReactions.
 * Result is setting GitHub status with context = "scan"
 */
@EventHandler("Scan code",
    GraphQL.subscriptionFromFile("graphql/subscription/OnAnyPendingStatus.graphql"))
export class OnPendingReviewStatus implements HandleEvent<OnAnyPendingStatus.Subscription> {

    @Secret(Secrets.OrgToken)
    private githubToken: string;

    constructor(public goal: Goal,
                private projectReviewers: ProjectReviewer[]) {
    }

    public async handle(event: EventFired<OnAnyPendingStatus.Subscription>,
                        context: HandlerContext,
                        params: this): Promise<HandlerResult> {
        const status = event.data.Status[0];
        const commit = status.commit;

        const id = new GitHubRepoRef(commit.repo.owner, commit.repo.name, commit.sha);
        const credentials = {token: params.githubToken};

        if (status.context !== params.goal.context || status.state !== "pending") {
            logger.warn(`I was looking for ${params.goal.context} being pending, but I heard about ${status.context} being ${status.state}`);
            return Success;
        }

        const addressChannels = addressChannelsFor(commit.repo, context);
        try {
            if (params.projectReviewers.length > 0) {
                const project = await GitCommandGitProject.cloned(credentials, id);
                const reviewsAndErrors: Array<{ review?: ProjectReview, error?: ReviewerError }> =
                    await Promise.all(params.projectReviewers
                        .map(reviewer =>
                            reviewer(project, context, params as any)
                                .then(rvw => ({review: rvw}),
                                    error => ({error}))));
                const reviews = reviewsAndErrors.filter(r => !!r.review).map(r => r.review);
                const reviewerErrors = reviewsAndErrors.filter(e => !!e.error).map(e => e.error);

                const review = consolidate(reviews);

                if (review.comments.length === 0 && reviewerErrors.length === 0) {
                    await markScanned(id,
                        params.goal, "success", credentials, false);
                } else {
                    // TODO might want to raise issue
                    // Fail it??
                    await sendReviewToSlack("Review comments", review, context, addressChannels);
                    await sendErrorsToSlack(reviewerErrors, addressChannels);
                    await markScanned(project.id as GitHubRepoRef,
                        params.goal, "success", credentials, true);
                }
            } else {
                // No reviewers
                await markScanned(id, params.goal, "success", credentials, false);
            }
            return Success;
        } catch (err) {
            await markScanned(id,
                params.goal, "error", credentials, false);
            return failure(err);
        }
    }
}

export const ScanBase = "https://scan.atomist.com";

// TODO this should take a URL with detailed information
function markScanned(id: GitHubRepoRef, goal: Goal, state: StatusState,
                     creds: ProjectOperationCredentials, requireApproval: boolean): Promise<any> {
    const baseUrl = `${ScanBase}/${id.owner}/${id.repo}/${id.sha}`;
    return createStatus((creds as TokenCredentials).token, id, {
        state,
        target_url: requireApproval ? forApproval(baseUrl) : baseUrl,
        context: goal.context,
        description: goal.completedDescription,
    });
}

function consolidate(reviews: ProjectReview[]): ProjectReview {
    // TODO check they are all the same id and that there's more than one
    return {
        repoId: reviews[0].repoId,
        comments: _.flatten(reviews.map(review => review.comments)),
    };
}

async function sendReviewToSlack(title: string,
                                 pr: ProjectReview,
                                 ctx: HandlerContext,
                                 addressChannels: AddressChannels) {
    const mesg: SlackMessage = {
        text: `*${title} on ${pr.repoId.owner}/${pr.repoId.repo}*`,
        attachments: pr.comments.map(c => reviewCommentToAttachment(pr.repoId as GitHubRepoRef, c)),
    };
    await addressChannels(mesg);
    return Success;
}

function sendErrorsToSlack(errors: ReviewerError[], addressChannels: AddressChannels) {
    errors.forEach(async e => {
        await addressChannels(formatReviewerError(e));
    });
}

function reviewCommentToAttachment(grr: GitHubRepoRef, rc: ReviewComment): Attachment {
    return {
        color: "#ff0000",
        author_name: rc.category,
        author_icon: "https://image.shutterstock.com/z/stock-vector-an-image-of-a-red-grunge-x-572409526.jpg",
        text: `${slack.url(deepLink(grr, rc.sourceLocation), "jump to")} ${rc.detail}`,
        mrkdwn_in: ["text"],
        fallback: "error",
        actions: !!rc.fix ? [
            buttonForCommand({text: "Fix"}, rc.fix.command, rc.fix.params),
        ] : [],
    };
}
