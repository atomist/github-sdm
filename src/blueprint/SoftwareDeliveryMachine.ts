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

import { HandleCommand, HandleEvent, logger } from "@atomist/automation-client";
import { Maker } from "@atomist/automation-client/util/constructionUtils";
import {
    ArtifactGoal,
    AutofixGoal,
    BuildGoal,
    CodeReactionGoal,
    FingerprintGoal,
    JustBuildGoal,
    NoGoal,
    ReviewGoal,
    StagingEndpointGoal,
    StagingVerifiedGoal,
} from "../common/delivery/goals/common/commonGoals";
import { ProjectListener } from "../common/listener/Listener";
import { NewIssueListener } from "../common/listener/NewIssueListener";
import { FindArtifactOnImageLinked } from "../handlers/events/delivery/build/FindArtifactOnImageLinked";
import { SetGoalOnBuildComplete } from "../handlers/events/delivery/build/SetStatusOnBuildComplete";
import { ReactToSemanticDiffsOnPushImpact } from "../handlers/events/delivery/code/ReactToSemanticDiffsOnPushImpact";
import { OnDeployStatus } from "../handlers/events/delivery/deploy/OnDeployStatus";
import { FailDownstreamGoalsOnGoalFailure } from "../handlers/events/delivery/FailDownstreamGoalsOnGoalFailure";
import { EndpointVerificationListener, executeVerifyEndpoint, SdmVerification } from "../handlers/events/delivery/verify/executeVerifyEndpoint";
import { OnVerifiedDeploymentStatus } from "../handlers/events/delivery/verify/OnVerifiedDeploymentStatus";
import { OnFirstPushToRepo } from "../handlers/events/repo/OnFirstPushToRepo";
import { OnRepoCreation } from "../handlers/events/repo/OnRepoCreation";
import { FunctionalUnit } from "./FunctionalUnit";
import { ReferenceDeliveryBlueprint } from "./ReferenceDeliveryBlueprint";

import * as _ from "lodash";
import { executeBuild } from "../common/delivery/build/executeBuild";
import { executeAutofixes } from "../common/delivery/code/autofix/executeAutofixes";
import { AutofixRegistration, ReviewerRegistration } from "../common/delivery/code/codeActionRegistrations";
import { executeCodeReactions } from "../common/delivery/code/executeCodeReactions";
import { executeFingerprinting } from "../common/delivery/code/fingerprint/executeFingerprinting";
import { executeReview } from "../common/delivery/code/review/executeReview";
import { Target } from "../common/delivery/deploy/deploy";
import { executeDeploy } from "../common/delivery/deploy/executeDeploy";
import { ExecuteGoalWithLog, lastTenLinesLogInterpreter } from "../common/delivery/deploy/runWithLog";
import { CopyGoalToGitHubStatus } from "../common/delivery/goals/CopyGoalToGitHubStatus";
import { Goal } from "../common/delivery/goals/Goal";
import { SdmGoalImplementationMapper } from "../common/delivery/goals/SdmGoalImplementationMapper";
import { ArtifactListener } from "../common/listener/ArtifactListener";
import { ClosedIssueListener } from "../common/listener/ClosedIssueListener";
import { CodeReactionRegistration } from "../common/listener/CodeReactionListener";
import { DeploymentListener } from "../common/listener/DeploymentListener";
import { FingerprintDifferenceListener } from "../common/listener/FingerprintDifferenceListener";
import { Fingerprinter } from "../common/listener/Fingerprinter";
import { GoalSetter } from "../common/listener/GoalSetter";
import { GoalsSetListener } from "../common/listener/GoalsSetListener";
import { PushTest } from "../common/listener/PushTest";
import { RepoCreationListener } from "../common/listener/RepoCreationListener";
import { SupersededListener } from "../common/listener/SupersededListener";
import { AnyPush } from "../common/listener/support/pushtest/commonPushTests";
import { StaticPushMapping } from "../common/listener/support/StaticPushMapping";
import { UpdatedIssueListener } from "../common/listener/UpdatedIssueListener";
import { VerifiedDeploymentListener } from "../common/listener/VerifiedDeploymentListener";
import { ProjectLoader } from "../common/repo/ProjectLoader";
import { selfDescribeHandler } from "../handlers/commands/SelfDescribe";
import { displayBuildLogHandler } from "../handlers/commands/ShowBuildLog";

import { PushRule } from "../common/listener/support/PushRule";
import { triggerGoal } from "../handlers/commands/triggerGoal";
import { CopyStatusApprovalToGoal } from "../handlers/events/delivery/CopyStatusApprovalToGoal";
import { FulfillGoalOnRequested } from "../handlers/events/delivery/FulfillGoalOnRequested";
import { executeImmaterial, SetGoalsOnPush } from "../handlers/events/delivery/goals/SetGoalsOnPush";
import { RequestDownstreamGoalsOnGoalSuccess } from "../handlers/events/delivery/RequestDownstreamGoalsOnGoalSuccess";
import { OnSupersededStatus } from "../handlers/events/delivery/superseded/OnSuperseded";
import { SetSupersededStatus } from "../handlers/events/delivery/superseded/SetSupersededStatus";
import { ClosedIssueHandler } from "../handlers/events/issue/ClosedIssueHandler";
import { NewIssueHandler } from "../handlers/events/issue/NewIssueHandler";
import { UpdatedIssueHandler } from "../handlers/events/issue/UpdatedIssueHandler";
import { resetGoalsCommand } from "../software-delivery-machine/blueprint/goal/resetGoals";
import { ArtifactStore } from "../spi/artifact/ArtifactStore";
import { Builder } from "../spi/build/Builder";
import { LogInterpreter } from "../spi/log/InterpretedLog";
import { IssueHandling } from "./IssueHandling";
import { NewRepoHandling } from "./NewRepoHandling";

/**
 * Infrastructure options for a SoftwareDeliveryMachine
 */
export interface SoftwareDeliveryMachineOptions {

    artifactStore: ArtifactStore;
    projectLoader: ProjectLoader;
}

// NEXT: store the implementation with the goal

/**
 * Core entry point for constructing a Software Delivery Machine.
 * Represents a possible delivery process spanning
 * goals of fingerprinting, reacting to fingerprint diffs,
 * code review, build, deployment, endpoint verification and
 * promotion to a production environment.
 * Driven by Goals
 * Uses the builder pattern.
 */
export class SoftwareDeliveryMachine implements NewRepoHandling, ReferenceDeliveryBlueprint, IssueHandling {

    public generators: Array<Maker<HandleCommand>> = [];

    public editors: Array<Maker<HandleCommand>> = [];

    public supportingCommands: Array<Maker<HandleCommand>> = [];

    public supportingEvents: Array<Maker<HandleEvent<any>>> = [];

    public functionalUnits: FunctionalUnit[] = [];

    /*
     * Store all the implementations we know
     */
    public readonly goalFulfillmentMapper = new SdmGoalImplementationMapper(); // public for testing

    public readonly newIssueListeners: NewIssueListener[] = [];

    public readonly updatedIssueListeners: UpdatedIssueListener[] = [];

    public readonly closedIssueListeners: ClosedIssueListener[] = [];

    public readonly repoCreationListeners: RepoCreationListener[] = [];

    public readonly newRepoWithCodeActions: ProjectListener[] = [];

    public readonly goalSetters: GoalSetter[] = []; // public for tests

    private readonly goalsSetListeners: GoalsSetListener[] = [];

    private readonly reviewerRegistrations: ReviewerRegistration[] = [];

    private readonly codeReactionRegistrations: CodeReactionRegistration[] = [];

    private readonly autofixRegistrations: AutofixRegistration[] = [];

    private readonly artifactListeners: ArtifactListener[] = [];

    private readonly fingerprinters: Fingerprinter[] = [];

    private readonly supersededListeners: SupersededListener[] = [];

    private readonly fingerprintDifferenceListeners: FingerprintDifferenceListener[] = [];

    private readonly deploymentListeners?: DeploymentListener[] = [];

    private readonly verifiedDeploymentListeners: VerifiedDeploymentListener[] = [];

    private readonly endpointVerificationListeners: EndpointVerificationListener[] = [];

    private readonly goalsThatCanBeRetried: Goal[] = [];

    public implementGoal(implementationName: string,
                         goal: Goal,
                         goalExecutor: ExecuteGoalWithLog,
                         pushTest?: PushTest,
                         logInterpreter?: LogInterpreter): this {
        this.goalsThatCanBeRetried.push(goal);
        this.goalFulfillmentMapper.addImplementation({
            implementationName, goal, goalExecutor,
            pushTest: pushTest || AnyPush,
            logInterpreter: logInterpreter || lastTenLinesLogInterpreter(implementationName),
        });
        return this;
    }

    public knownSideEffect(goal: Goal, sideEffectName: string, pushTest: PushTest = AnyPush) {
        this.goalFulfillmentMapper.addSideEffect({
            goal,
            sideEffectName, pushTest,
        });
    }

    private get goalTriggerCommands() {
        const goals = _.uniqBy(this.goalsThatCanBeRetried,
            g => g.uniqueCamelCaseName);
        return goals.map(g => () => triggerGoal(g.uniqueCamelCaseName, g));
    }

    private get onRepoCreation(): Maker<OnRepoCreation> {
        return this.repoCreationListeners.length > 0 ?
            () => new OnRepoCreation(...this.repoCreationListeners) :
            undefined;
    }

    private get onNewRepoWithCode(): Maker<OnFirstPushToRepo> {
        return () => new OnFirstPushToRepo(this.newRepoWithCodeActions);
    }

    private get semanticDiffReactor(): Maker<ReactToSemanticDiffsOnPushImpact> {
        return this.fingerprintDifferenceListeners.length > 0 ?
            () => new ReactToSemanticDiffsOnPushImpact(this.fingerprintDifferenceListeners) :
            undefined;
    }

    private get goalSetting(): FunctionalUnit {
        if (this.goalSetters.length === 0) {
            logger.warn("No goal setters");
            return undefined;
        }
        return {
            eventHandlers: [() => new SetGoalsOnPush(this.opts.projectLoader, this.goalSetters, this.goalsSetListeners,
                this.goalFulfillmentMapper)],
            commandHandlers: [() => resetGoalsCommand({
                projectLoader: this.opts.projectLoader,
                goalsListeners: this.goalsSetListeners,
                goalSetters: this.goalSetters,
                implementationMapping: this.goalFulfillmentMapper,
            })],
        };
    }

    private readonly oldPushSuperseder: Maker<SetSupersededStatus> = SetSupersededStatus;

    get onSuperseded(): Maker<OnSupersededStatus> {
        return this.supersededListeners.length > 0 ?
            () => new OnSupersededStatus(...this.supersededListeners) :
            undefined;
    }

    private get goalConsequences(): FunctionalUnit {
        return {
            eventHandlers: [
                () => new FailDownstreamGoalsOnGoalFailure(),
                () => new RequestDownstreamGoalsOnGoalSuccess(),
                () => new CopyStatusApprovalToGoal(),
            ],
            commandHandlers: [],
        };
    }

    private readonly artifactFinder = () => new FindArtifactOnImageLinked(ArtifactGoal,
        this.opts.artifactStore,
        ...this.artifactListeners)

    private get notifyOnDeploy(): Maker<OnDeployStatus> {
        return this.deploymentListeners.length > 0 ?
            () => new OnDeployStatus(...this.deploymentListeners) :
            undefined;
    }

    private addVerifyImplementation(): void {
        const stagingVerification: SdmVerification = {
            verifiers: this.endpointVerificationListeners,
            endpointGoal: StagingEndpointGoal,
            requestApproval: true,
        };
        this.implementGoal("VerifyInStaging",
            StagingVerifiedGoal,
            executeVerifyEndpoint(stagingVerification));
    }

    private get onVerifiedStatus(): Maker<OnVerifiedDeploymentStatus> {
        return this.verifiedDeploymentListeners.length > 0 ?
            () => new OnVerifiedDeploymentStatus(...this.verifiedDeploymentListeners) :
            undefined;
    }

    private readonly onBuildComplete: Maker<SetGoalOnBuildComplete> =
        () => new SetGoalOnBuildComplete([BuildGoal, JustBuildGoal])

    get showBuildLog(): Maker<HandleCommand> {
        return () => {
            return displayBuildLogHandler();
        };
    }

    private get allFunctionalUnits(): FunctionalUnit[] {
        return this.functionalUnits
            .concat([
                this.goalSetting,
                this.goalConsequences,
            ]);
    }

    get eventHandlers(): Array<Maker<HandleEvent<any>>> {
        return this.supportingEvents
            .concat(() => new FulfillGoalOnRequested(this.goalFulfillmentMapper))
            .concat(_.flatten(this.allFunctionalUnits.map(fu => fu.eventHandlers)))
            .concat([
                this.newIssueListeners.length > 0 ? () => new NewIssueHandler(...this.newIssueListeners) : undefined,
                this.updatedIssueListeners.length > 0 ? () => new UpdatedIssueHandler(...this.updatedIssueListeners) : undefined,
                this.closedIssueListeners.length > 0 ? () => new ClosedIssueHandler(...this.closedIssueListeners) : undefined,
                this.onRepoCreation,
                this.onNewRepoWithCode,
                this.semanticDiffReactor,
                this.oldPushSuperseder,
                this.onSuperseded,
                this.onBuildComplete,
                this.notifyOnDeploy,
                this.onVerifiedStatus,
                this.artifactFinder,
            ]).filter(m => !!m);
    }

    get commandHandlers(): Array<Maker<HandleCommand>> {
        return this.generators
            .concat(_.flatten(this.allFunctionalUnits.map(fu => fu.commandHandlers)))
            .concat(this.editors)
            .concat(this.supportingCommands)
            .concat([this.showBuildLog])
            .concat(this.goalTriggerCommands)
            .filter(m => !!m);
    }

    public addGenerators(...g: Array<Maker<HandleCommand>>): this {
        this.generators = this.generators.concat(g);
        return this;
    }

    public addEditors(...e: Array<Maker<HandleCommand>>): this {
        this.editors = this.editors.concat(e);
        return this;
    }

    public addNewIssueListeners(...e: NewIssueListener[]): this {
        this.newIssueListeners.push(...e);
        return this;
    }

    public addUpdatedIssueListeners(...e: UpdatedIssueListener[]): this {
        this.updatedIssueListeners.push(...e);
        return this;
    }

    public addClosedIssueListeners(...e: ClosedIssueListener[]): this {
        this.closedIssueListeners.push(...e);
        return this;
    }

    public addSupportingCommands(...e: Array<Maker<HandleCommand>>): this {
        this.supportingCommands.push(...e);
        return this;
    }

    public addSupportingEvents(...e: Array<Maker<HandleEvent<any>>>): this {
        this.supportingEvents.push(...e);
        return this;
    }

    /**
     * You probably mean to use addNewRepoWithCodeActions!
     * This responds to a repo creation, but there may be no
     * code in it.
     * @param {RepoCreationListener} rcls
     * @return {this}
     */
    public addRepoCreationListeners(...rcls: RepoCreationListener[]): this {
        this.repoCreationListeners.push(...rcls);
        return this;
    }

    public addNewRepoWithCodeActions(...pls: ProjectListener[]): this {
        this.newRepoWithCodeActions.push(...pls);
        return this;
    }

    public addGoalsSetListeners(...listeners: GoalsSetListener[]): this {
        this.goalsSetListeners.push(...listeners);
        return this;
    }

    public addReviewerRegistrations(...reviewers: ReviewerRegistration[]): this {
        this.reviewerRegistrations.push(...reviewers);
        return this;
    }

    public addCodeReactions(...crrs: CodeReactionRegistration[]): this {
        this.codeReactionRegistrations.push(...crrs);
        return this;
    }

    public addArtifactListeners(...pls: ArtifactListener[]): this {
        this.artifactListeners.push(...pls);
        return this;
    }

    /**
     * Editors automatically invoked on eligible commits.
     * Note: be sure that these editors check and don't cause
     * infinite recursion!!
     */
    public addAutofixes(...ars: AutofixRegistration[]): this {
        this.autofixRegistrations.push(...ars);
        return this;
    }

    public addFingerprinters(...f: Fingerprinter[]): this {
        this.fingerprinters.push(...f);
        return this;
    }

    public addSupersededListeners(...l: SupersededListener[]): this {
        this.supersededListeners.push(...l);
        return this;
    }

    public addFingerprintDifferenceListeners(...fh: FingerprintDifferenceListener[]): this {
        this.fingerprintDifferenceListeners.push(...fh);
        return this;
    }

    public addDeploymentListeners(...l: DeploymentListener[]): this {
        this.deploymentListeners.push(...l);
        return this;
    }

    public addVerifiedDeploymentListeners(...l: VerifiedDeploymentListener[]): this {
        this.verifiedDeploymentListeners.push(...l);
        return this;
    }

    public addEndpointVerificationListeners(...l: EndpointVerificationListener[]): this {
        this.endpointVerificationListeners.push(...l);
        return this;
    }

    public addFunctionalUnits(...fus: FunctionalUnit[]): this {
        this.functionalUnits.push(...fus);
        return this;
    }

    public addBuildRules(...rules: Array<PushRule<Builder>>): this {
        rules.forEach(r =>
            this.implementGoal(r.name, BuildGoal,
                executeBuild(this.opts.projectLoader, r.choice.value),
                r.choice.guard,
                r.choice.value.logInterpreter)
                .implementGoal(r.name, JustBuildGoal,
                    executeBuild(this.opts.projectLoader, r.choice.value),
                    r.choice.guard,
                    r.choice.value.logInterpreter));
        return this;
    }

    public addDeployRules(...rules: Array<StaticPushMapping<Target>>): this {
        rules.forEach(r => {
            this.implementGoal(r.name, r.value.deployGoal, executeDeploy(this.opts.artifactStore,
                r.value.endpointGoal, r.value), r.guard, r.value.deployer.logInterpreter);
            this.knownSideEffect(
                r.value.endpointGoal,
                r.value.deployGoal.definition.displayName);
        });
        return this;
    }

    /**
     *
     * @param {string} name
     * @param {SoftwareDeliveryMachineOptions} opts
     * @param {GoalSetter} goalSetters tell me what to do on a push. Hint: start with "whenPushSatisfies(...)"
     */
    constructor(public readonly name: string,
                public readonly opts: SoftwareDeliveryMachineOptions,
                ...goalSetters: GoalSetter[]) {
        this.goalSetters = goalSetters;
        addGitHubSupport(this);
        this.addSupportingCommands(selfDescribeHandler(this));

        this.implementGoal("Autofix", AutofixGoal,
            executeAutofixes(this.opts.projectLoader, this.autofixRegistrations));
        this.implementGoal("DoNothing", NoGoal, executeImmaterial);
        this.implementGoal("Fingerprinter", FingerprintGoal,
            executeFingerprinting(this.opts.projectLoader, ...this.fingerprinters));
        this.implementGoal("CodeReactions", CodeReactionGoal,
            executeCodeReactions(this.opts.projectLoader, this.codeReactionRegistrations));
        this.implementGoal("Reviews", ReviewGoal,
            executeReview(this.opts.projectLoader, this.reviewerRegistrations));
        this.addVerifyImplementation();

        this.knownSideEffect(ArtifactGoal, "from ImageLinked");
        this.knownSideEffect(BuildGoal, "from Build event");
    }

}

function addGitHubSupport(sdm: SoftwareDeliveryMachine) {
    sdm.addSupportingEvents(CopyGoalToGitHubStatus);
}
