import {
    HandleCommand,
    HandleEvent,
    HandlerContext,
    MappedParameter,
    MappedParameters,
    Parameter,
    Secret,
    Secrets,
} from "@atomist/automation-client";
import { Parameters } from "@atomist/automation-client/decorators";
import { commandHandlerFrom } from "@atomist/automation-client/onCommand";
import { GitHubRepoRef } from "@atomist/automation-client/operations/common/GitHubRepoRef";
import { RemoteRepoRef } from "@atomist/automation-client/operations/common/RepoId";
import { addressSlackChannels, buttonForCommand } from "@atomist/automation-client/spi/message/MessageClient";
import { Maker } from "@atomist/automation-client/util/constructionUtils";
import * as slack from "@atomist/slack-messages/SlackMessages";
import { runningAttachment } from "../../../handlers/commands/reportRunning";
import { ProductionMauve } from "../../../handlers/events/delivery/phases/productionDeployPhases";
import { OnVerifiedStatus, StatusInfo } from "../../../handlers/events/delivery/verify/OnVerifiedStatus";
import {tipOfDefaultBranch} from "../../../handlers/commands/editors/toclient/ghub";

/**
 * Display a button suggesting promotion to production
 * @type {OnVerifiedStatus}
 */
export const OfferPromotion = () => new OnVerifiedStatus(presentPromotionButton);

async function presentPromotionButton(id: RemoteRepoRef, s: StatusInfo, sendMessagesHere, ctx, token: string) {
    const shaLink = slack.url(id.url + "/tree/" + id.sha, id.repo);
    const endpointLink = slack.url(s.targetUrl);
    const messageId = `httpService:promote:prod/${id.repo}/${id.owner}/${id.sha}`;
    const currentlyRunning = await runningAttachment(ctx, token, id as GitHubRepoRef,
        {domain: "ri-production", color: ProductionMauve}, id.sha);

    const attachment: slack.Attachment = {
        color: ProductionMauve,
        text: `Staging endpoint verified at ${endpointLink}\nPromote ${shaLink} to production?`,
        fallback: "offer to promote",
        actions: [buttonForCommand({text: "Promote to Prod"},
            "DeployToProd",
            {
                repo: id.repo, owner: id.owner, sha: id.sha,
                messageId,
                destinationsJson: JSON.stringify(sendMessagesHere),
            })],
    };
    const message: slack.SlackMessage = {
        attachments: currentlyRunning.concat([attachment]),
    };
    return ctx.messageClient.send(message, sendMessagesHere, {id: messageId});
}

@Parameters()
export class OfferPromotionParameters {
    @Secret(Secrets.UserToken)
    public githubToken;

    @MappedParameter(MappedParameters.GitHubOwner)
    public owner;

    @MappedParameter(MappedParameters.GitHubRepository)
    public repo;

    @Parameter({required: false})
    public sha;

    @MappedParameter(MappedParameters.SlackChannel)
    public channel;
}

export const offerPromotionCommand: Maker<HandleCommand<OfferPromotionParameters>> = () =>
    commandHandlerFrom(async (ctx: HandlerContext, params: OfferPromotionParameters) => {
            return presentPromotionButton(new GitHubRepoRef(params.owner, params.repo, params.sha || await
            tipOfDefaultBranch(params.githubToken, new GitHubRepoRef(params.owner, params.repo))),
                {targetUrl: undefined}, addressSlackChannels(params.channel), ctx, params.githubToken);
        }, OfferPromotionParameters, "OfferPromotionButton", "test: suggest promoting a ref to prod",
        "please offer to promote");
