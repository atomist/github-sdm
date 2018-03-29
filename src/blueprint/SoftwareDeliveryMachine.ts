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
    LocalDeploymentGoal,
    LocalEndpointGoal,
    ProductionDeploymentGoal,
    ProductionEndpointGoal,
    ReviewGoal,
    StagingDeploymentGoal,
    StagingEndpointGoal,
    StagingVerifiedGoal,
} from "../common/delivery/goals/common/commonGoals";
import { ProjectListener } from "../common/listener/Listener";
import { NewIssueListener } from "../common/listener/NewIssueListener";
import { FindArtifactOnImageLinked } from "../handlers/events/delivery/build/FindArtifactOnImageLinked";
import { SetStatusOnBuildComplete } from "../handlers/events/delivery/build/SetStatusOnBuildComplete";
import { ReactToSemanticDiffsOnPushImpact } from "../handlers/events/delivery/code/ReactToSemanticDiffsOnPushImpact";
import { OnDeployStatus } from "../handlers/events/delivery/deploy/OnDeployStatus";
import { FailDownstreamGoalsOnGoalFailure } from "../handlers/events/delivery/FailDownstreamGoalsOnGoalFailure";
import {
    EndpointVerificationListener,
    executeVerifyEndpoint,
    SdmVerification,
} from "../handlers/events/delivery/verify/executeVerifyEndpoint";
import { OnVerifiedDeploymentStatus } from "../handlers/events/delivery/verify/OnVerifiedDeploymentStatus";
import { OnFirstPushToRepo } from "../handlers/events/repo/OnFirstPushToRepo";
import { OnRepoCreation } from "../handlers/events/repo/OnRepoCreation";
import { EmptyFunctionalUnit, FunctionalUnit } from "./FunctionalUnit";
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
import { CopyGoalToGitHubStatus } from "../common/delivery/goals/CopyGoalToGitHubStatus";
import { Goal } from "../common/delivery/goals/Goal";
import { ArtifactListener } from "../common/listener/ArtifactListener";
import { ClosedIssueListener } from "../common/listener/ClosedIssueListener";
import { CodeReactionRegistration } from "../common/listener/CodeReactionListener";
import { DeploymentListener } from "../common/listener/DeploymentListener";
import { FingerprintDifferenceListener } from "../common/listener/FingerprintDifferenceListener";
import { Fingerprinter } from "../common/listener/Fingerprinter";
import { GoalSetter } from "../common/listener/GoalSetter";
import { GoalsSetListener } from "../common/listener/GoalsSetListener";
import { PushMapping } from "../common/listener/PushMapping";
import { RepoCreationListener } from "../common/listener/RepoCreationListener";
import { SupersededListener } from "../common/listener/SupersededListener";
import { PushRules } from "../common/listener/support/PushRules";
import { StaticPushMapping } from "../common/listener/support/StaticPushMapping";
import { UpdatedIssueListener } from "../common/listener/UpdatedIssueListener";
import { VerifiedDeploymentListener } from "../common/listener/VerifiedDeploymentListener";
import { ProjectLoader } from "../common/repo/ProjectLoader";
import { selfDescribeHandler } from "../handlers/commands/SelfDescribe";
import { displayBuildLogHandler } from "../handlers/commands/ShowBuildLog";
import { ExecuteGoalOnRequested } from "../handlers/events/delivery/ExecuteGoalOnRequested";
import { ExecuteGoalOnSuccessStatus } from "../handlers/events/delivery/ExecuteGoalOnSuccessStatus";
import { SetGoalsOnPush } from "../handlers/events/delivery/goals/SetGoalsOnPush";
import { OnSupersededStatus } from "../handlers/events/delivery/superseded/OnSuperseded";
import { SetSupersededStatus } from "../handlers/events/delivery/superseded/SetSupersededStatus";
import { ClosedIssueHandler } from "../handlers/events/issue/ClosedIssueHandler";
import { NewIssueHandler } from "../handlers/events/issue/NewIssueHandler";
import { UpdatedIssueHandler } from "../handlers/events/issue/UpdatedIssueHandler";
import { ArtifactStore } from "../spi/artifact/ArtifactStore";
import { Builder } from "../spi/build/Builder";
import { composeFunctionalUnits } from "./ComposedFunctionalUnit";
import { functionalUnitForGoal } from "./dsl/functionalUnitForGoal";
import { IssueHandling } from "./IssueHandling";
import { NewRepoHandling } from "./NewRepoHandling";

/**
 * Infrastructure options for a SoftwareDeliveryMachine
 */
export interface SoftwareDeliveryMachineOptions {

    artifactStore: ArtifactStore;
    projectLoader: ProjectLoader;
}

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

    public newIssueListeners: NewIssueListener[] = [];

    public updatedIssueListeners: UpdatedIssueListener[] = [];

    public closedIssueListeners: ClosedIssueListener[] = [];

    public repoCreationListeners: RepoCreationListener[] = [];

    public newRepoWithCodeActions: ProjectListener[] = [];

    private readonly goalSetters: GoalSetter[] = [];

    private goalsSetListeners: GoalsSetListener[] = [];

    private readonly builderMapping = new PushRules<Builder>("Builder rules");

    private readonly deployTargetMapping = new PushRules<Target>("Deploy targets");

    private reviewerRegistrations: ReviewerRegistration[] = [];

    private codeReactionRegistrations: CodeReactionRegistration[] = [];

    private autofixRegistrations: AutofixRegistration[] = [];

    private artifactListeners: ArtifactListener[] = [];

    private fingerprinters: Fingerprinter[] = [];

    private supersededListeners: SupersededListener[] = [];

    private fingerprintDifferenceListeners: FingerprintDifferenceListener[] = [];

    private deploymentListeners?: DeploymentListener[] = [];

    private verifiedDeploymentListeners: VerifiedDeploymentListener[] = [];

    private endpointVerificationListeners: EndpointVerificationListener[] = [];

    private get onRepoCreation(): Maker<OnRepoCreation> {
        return this.repoCreationListeners.length > 0 ?
            () => new OnRepoCreation(...this.repoCreationListeners) :
            undefined;
    }

    private get onNewRepoWithCode(): Maker<OnFirstPushToRepo> {
        return () => new OnFirstPushToRepo(this.newRepoWithCodeActions);
    }

    private get fingerprinter(): FunctionalUnit {
        return this.fingerprinters.length === 0 ? EmptyFunctionalUnit :
            functionalUnitForGoal("Fingerprinter",
                FingerprintGoal,
                executeFingerprinting(this.opts.projectLoader, ...this.fingerprinters));
    }

    private get semanticDiffReactor(): Maker<ReactToSemanticDiffsOnPushImpact> {
        return this.fingerprintDifferenceListeners.length > 0 ?
            () => new ReactToSemanticDiffsOnPushImpact(this.fingerprintDifferenceListeners) :
            undefined;
    }

    private get reviewHandling(): FunctionalUnit {
        // Can't short circuit this if review goal is set or goal will never be satisfied
        return functionalUnitForGoal("Reviews",
            ReviewGoal,
            executeReview(this.opts.projectLoader, this.reviewerRegistrations));
    }

    private get codeReactionHandling(): FunctionalUnit {
        return functionalUnitForGoal("CodeReactions",
            CodeReactionGoal,
            executeCodeReactions(this.opts.projectLoader, this.codeReactionRegistrations));
    }

    private get autofix(): FunctionalUnit {
        return this.autofixRegistrations.length === 0 ? EmptyFunctionalUnit :
            functionalUnitForGoal("Autofix", AutofixGoal,
                executeAutofixes(this.opts.projectLoader, this.autofixRegistrations));
    }

    private get goalSetting(): Maker<SetGoalsOnPush> {
        if (this.goalSetters.length === 0) {
            logger.warn("No goal setters");
            return undefined;
        }
        return () => new SetGoalsOnPush(this.opts.projectLoader, this.goalSetters, this.goalsSetListeners);
    }

    private readonly oldPushSuperseder: Maker<SetSupersededStatus> = SetSupersededStatus;

    private get builder(): FunctionalUnit {
        const name = this.builderMapping.name.replace(" ", "_");
        const executor = executeBuild(this.opts.projectLoader, this.builderMapping);
        // currently these handle their own statuses. Need not to. #264 in progress
        return {
            eventHandlers: [
                () => new ExecuteGoalOnRequested(name, BuildGoal, executor),
                () => new ExecuteGoalOnRequested(name + "_jb", JustBuildGoal, executor),
                () => new ExecuteGoalOnSuccessStatus(name, BuildGoal, executor),
                () => new ExecuteGoalOnSuccessStatus(name + "_jb", JustBuildGoal, executor),
            ],
            commandHandlers: [],
        };
    }

    private get deployer(): FunctionalUnit {
        const outer = this;

        function executor(deploymentGoal: Goal, endpointGoal: Goal) {
            return executeDeploy(outer.opts.artifactStore, outer.opts.projectLoader,
                deploymentGoal, endpointGoal,
                outer.deployTargetMapping.filter(r => (r as StaticPushMapping<Target>).value.deployGoal === deploymentGoal));
        }

        const deployGoalPairs: Array<{ deployGoal: Goal, endpointGoal: Goal, name: string }> = [
            {deployGoal: LocalDeploymentGoal, endpointGoal: LocalEndpointGoal, name: "LocalDeploy"},
            {deployGoal: StagingDeploymentGoal, endpointGoal: StagingEndpointGoal, name: "StagingDeploy"},
            {deployGoal: ProductionDeploymentGoal, endpointGoal: ProductionEndpointGoal, name: "ProductionDeploy"},
        ];

        return composeFunctionalUnits(...deployGoalPairs.map(dep =>
            functionalUnitForGoal(dep.name, dep.deployGoal, executor(dep.deployGoal, dep.endpointGoal))));
    }

    get onSuperseded(): Maker<OnSupersededStatus> {
        return this.supersededListeners.length > 0 ?
            () => new OnSupersededStatus(...this.supersededListeners) :
            undefined;
    }

    private get goalCleanup(): Array<Maker<FailDownstreamGoalsOnGoalFailure>> {
        return [() => new FailDownstreamGoalsOnGoalFailure()];
    }

    private readonly artifactFinder = () => new FindArtifactOnImageLinked(ArtifactGoal,
        this.opts.artifactStore,
        ...this.artifactListeners)

    private get notifyOnDeploy(): Maker<OnDeployStatus> {
        return this.deploymentListeners.length > 0 ?
            () => new OnDeployStatus(...this.deploymentListeners) :
            undefined;
    }

    private get verifyEndpoint(): FunctionalUnit {
        if (this.endpointVerificationListeners.length === 0) {
            return {eventHandlers: [], commandHandlers: []};
        }
        const stagingVerification: SdmVerification = {
            verifiers: this.endpointVerificationListeners,
            endpointGoal: StagingEndpointGoal,
            requestApproval: true,
        };
        return functionalUnitForGoal("VerifyInStaging",
            StagingVerifiedGoal,
            executeVerifyEndpoint(stagingVerification));
    }

    private get onVerifiedStatus(): Maker<OnVerifiedDeploymentStatus> {
        return this.verifiedDeploymentListeners.length > 0 ?
            () => new OnVerifiedDeploymentStatus(...this.verifiedDeploymentListeners) :
            undefined;
    }

    private readonly onBuildComplete: Maker<SetStatusOnBuildComplete> =
        () => new SetStatusOnBuildComplete([BuildGoal, JustBuildGoal])

    get showBuildLog(): Maker<HandleCommand> {
        return () => {
            return displayBuildLogHandler();
        };
    }

    private get allFunctionalUnits(): FunctionalUnit[] {
        return this.functionalUnits
            .concat([
                this.builder,
                this.fingerprinter,
                this.verifyEndpoint,
                this.autofix,
                this.codeReactionHandling,
                this.reviewHandling,
                this.deployer,
            ]);
    }

    get eventHandlers(): Array<Maker<HandleEvent<any>>> {
        return (this.goalCleanup as Array<Maker<HandleEvent<any>>>)
            .concat(this.supportingEvents)
            .concat(_.flatten(this.allFunctionalUnits.map(fu => fu.eventHandlers)))
            .concat([
                this.newIssueListeners.length > 0 ? () => new NewIssueHandler(...this.newIssueListeners) : undefined,
                this.updatedIssueListeners.length > 0 ? () => new UpdatedIssueHandler(...this.updatedIssueListeners) : undefined,
                this.closedIssueListeners.length > 0 ? () => new ClosedIssueHandler(...this.closedIssueListeners) : undefined,
                this.onRepoCreation,
                this.onNewRepoWithCode,
                this.semanticDiffReactor,
                this.goalSetting,
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
        this.newIssueListeners = this.newIssueListeners.concat(e);
        return this;
    }

    public addUpdatedIssueListeners(...e: UpdatedIssueListener[]): this {
        this.updatedIssueListeners = this.updatedIssueListeners.concat(e);
        return this;
    }

    public addClosedIssueListeners(...e: ClosedIssueListener[]): this {
        this.closedIssueListeners = this.closedIssueListeners.concat(e);
        return this;
    }

    public addSupportingCommands(...e: Array<Maker<HandleCommand>>): this {
        this.supportingCommands = this.supportingCommands.concat(e);
        return this;
    }

    public addSupportingEvents(...e: Array<Maker<HandleEvent<any>>>): this {
        this.supportingEvents = this.supportingEvents.concat(e);
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
        this.repoCreationListeners = this.repoCreationListeners.concat(rcls);
        return this;
    }

    public addNewRepoWithCodeActions(...pls: ProjectListener[]): this {
        this.newRepoWithCodeActions = this.newRepoWithCodeActions.concat(pls);
        return this;
    }

    public addGoalsSetListeners(...listeners: GoalsSetListener[]): this {
        this.goalsSetListeners = this.goalsSetListeners.concat(listeners);
        return this;
    }

    public addReviewerRegistrations(...reviewers: ReviewerRegistration[]): this {
        this.reviewerRegistrations = this.reviewerRegistrations.concat(reviewers);
        return this;
    }

    public addCodeReactions(...crrs: CodeReactionRegistration[]): this {
        this.codeReactionRegistrations = this.codeReactionRegistrations.concat(crrs);
        return this;
    }

    public addArtifactListeners(...pls: ArtifactListener[]): this {
        this.artifactListeners = this.artifactListeners.concat(pls);
        return this;
    }

    /**
     * Editors automatically invoked on eligible commits.
     * Note: be sure that these editors check and don't cause
     * infinite recursion!!
     */
    public addAutofixes(...ars: AutofixRegistration[]): this {
        this.autofixRegistrations = this.autofixRegistrations.concat(ars);
        return this;
    }

    public addFingerprinters(...f: Fingerprinter[]): this {
        this.fingerprinters = this.fingerprinters.concat(f);
        return this;
    }

    public addSupersededListeners(...l: SupersededListener[]): this {
        this.supersededListeners = this.supersededListeners.concat(l);
        return this;
    }

    public addFingerprintDifferenceListeners(...fh: FingerprintDifferenceListener[]): this {
        this.fingerprintDifferenceListeners = this.fingerprintDifferenceListeners.concat(fh);
        return this;
    }

    public addDeploymentListeners(...l: DeploymentListener[]): this {
        this.deploymentListeners = this.deploymentListeners.concat(l);
        return this;
    }

    public addVerifiedDeploymentListeners(...l: VerifiedDeploymentListener[]): this {
        this.verifiedDeploymentListeners = this.verifiedDeploymentListeners.concat(l);
        return this;
    }

    public addEndpointVerificationListeners(...l: EndpointVerificationListener[]): this {
        this.endpointVerificationListeners = this.endpointVerificationListeners.concat(l);
        return this;
    }

    public addFunctionalUnits(...fus: FunctionalUnit[]): this {
        this.functionalUnits = this.functionalUnits.concat(fus);
        return this;
    }

    public addBuildRules(...rules: Array<PushMapping<Builder>>): this {
        this.builderMapping.add(rules);
        return this;
    }

    public addDeployRules(...rules: Array<StaticPushMapping<Target>>): this {
        this.deployTargetMapping.add(rules);
        return this;
    }

    constructor(public readonly name: string,
                public readonly opts: SoftwareDeliveryMachineOptions,
                ...goalSetters: GoalSetter[]) {
        this.goalSetters = goalSetters;
        addGitHubSupport(this);
        this.addSupportingCommands(selfDescribeHandler(this));
    }

}

function addGitHubSupport(sdm: SoftwareDeliveryMachine) {
    sdm.addSupportingEvents(CopyGoalToGitHubStatus);
}
