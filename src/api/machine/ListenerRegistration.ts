import { AutofixRegistration } from "../registration/AutofixRegistration";
import { FingerprinterRegistration } from "../registration/FingerprinterRegistration";
import { PushReactionRegisterable } from "../registration/PushReactionRegistration";
import { ReviewerRegistration } from "../registration/ReviewerRegistration";
import { ArtifactListenerRegisterable } from "../listener/ArtifactListener";
import { BuildListener } from "../listener/BuildListener";
import { ChannelLinkListener } from "../listener/ChannelLinkListenerInvocation";
import { ClosedIssueListener } from "../listener/ClosedIssueListener";
import { DeploymentListener } from "../listener/DeploymentListener";
import { FingerprintDifferenceListener } from "../listener/FingerprintDifferenceListener";
import { FingerprintListener } from "../listener/FingerprintListener";
import { GoalCompletionListener, GoalsSetListener } from "../listener/GoalsSetListener";
import { NewIssueListener } from "../listener/NewIssueListener";
import { ProjectListener } from "../listener/ProjectListener";
import { PullRequestListener } from "../listener/PullRequestListener";
import { PushListener } from "../listener/PushListener";
import { RepoCreationListener } from "../listener/RepoCreationListener";
import { ReviewListener } from "../listener/ReviewListener";
import { TagListener } from "../listener/TagListener";
import { UpdatedIssueListener } from "../listener/UpdatedIssueListener";
import { UserJoiningChannelListener } from "../listener/UserJoiningChannelListener";
import { VerifiedDeploymentListener } from "../listener/VerifiedDeploymentListener";
import { EndpointVerificationListener } from "../listener/EndpointVerificationListener";

/**
 * Listener management offering a fluent builder pattern for registrations.
 */
export interface ListenerRegistration {

    addNewIssueListeners(...e: NewIssueListener[]): this;

    addUpdatedIssueListeners(...e: UpdatedIssueListener[]);

    /**
     * These are invoked when a goal reaches status "failure" or "success"
     * @param {GoalCompletionListener} e
     * @returns {this}
     */
    addGoalCompletionListeners(...e: GoalCompletionListener[]);

    addClosedIssueListeners(...e: ClosedIssueListener[]): this;

    addTagListeners(...e: TagListener[]): this;

    addChannelLinkListeners(...e: ChannelLinkListener[]);

    addBuildListeners(...e: BuildListener[]);

    /**
     * You probably mean to use addNewRepoWithCodeActions!
     * This responds to a repo creation, but there may be no
     * code in it.
     * @param {RepoCreationListener} rcls
     * @return {this}
     */
    addRepoCreationListeners(...rcls: RepoCreationListener[]): this;

    addRepoOnboardingListeners(...rols: ProjectListener[]): this;

    addNewRepoWithCodeActions(...pls: PushListener[]): this;

    addPullRequestListeners(...pls: PullRequestListener[]): this;

    addGoalsSetListeners(...listeners: GoalsSetListener[]): this;

    addReviewerRegistrations(...reviewers: ReviewerRegistration[]): this;

    /**
     * Add review listeners. Will be invoked during a ReviewGoal
     * @param {ReviewListener} listeners
     * @return {this}
     */
    addReviewListeners(...listeners: ReviewListener[]): this;

    /**
     * Add reactions to a push: That is, functions that run during execution of a
     * PushReaction goal.
     * @param {PushReactionRegistration} prrs
     * @return {this}
     */
    addPushReactions(...prrs: PushReactionRegisterable[]): this;

    addArtifactListeners(...alrs: ArtifactListenerRegisterable[]): this;

    /**
     * Editors automatically invoked on eligible commits.
     * Note: be sure that these editors check and don't cause
     * infinite recursion!!
     */
    addAutofixes(...ars: AutofixRegistration[]): this;

    addFingerprinterRegistrations(...f: FingerprinterRegistration[]): this;

    addFingerprintListeners(...l: FingerprintListener[]): this;

    addFingerprintDifferenceListeners(...fh: FingerprintDifferenceListener[]): this;

    addDeploymentListeners(...l: DeploymentListener[]): this;

    addVerifiedDeploymentListeners(...l: VerifiedDeploymentListener[]): this;

    addEndpointVerificationListeners(...l: EndpointVerificationListener[]): this;

    addUserJoiningChannelListeners(...l: UserJoiningChannelListener[]): this;

}
