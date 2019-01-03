/*
 * Copyright © 2018 Atomist, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {
    editModes,
    GitHubRepoRef,
    GitProject,
    HandlerContext,
    logger,
    Maker,
    NoParameters,
    OnCommand,
    Project,
    RemoteRepoRef,
    RepoFinder,
    RepoLoader,
    Success,
} from "@atomist/automation-client";
import { HandleCommand } from "@atomist/automation-client/lib/HandleCommand";
import { HandleEvent } from "@atomist/automation-client/lib/HandleEvent";
import {
    declareMappedParameter,
    declareParameter,
    declareSecret,
} from "@atomist/automation-client/lib/internal/metadata/decoratorSupport";
import { eventHandlerFrom } from "@atomist/automation-client/lib/onEvent";
import { CommandDetails } from "@atomist/automation-client/lib/operations/CommandDetails";
import { andFilter } from "@atomist/automation-client/lib/operations/common/repoFilter";
import { doWithAllRepos } from "@atomist/automation-client/lib/operations/common/repoUtils";
import { editAll } from "@atomist/automation-client/lib/operations/edit/editAll";
import {
    EditResult,
    failedEdit,
    ProjectEditor,
    successfulEdit,
} from "@atomist/automation-client/lib/operations/edit/projectEditor";
import { chainEditors } from "@atomist/automation-client/lib/operations/edit/projectEditorOps";
import { GitHubRepoCreationParameters } from "@atomist/automation-client/lib/operations/generate/GitHubRepoCreationParameters";
import { isProject } from "@atomist/automation-client/lib/project/Project";
import { toFactory } from "@atomist/automation-client/lib/util/constructionUtils";
import {
    codeBlock,
    italic,
} from "@atomist/slack-messages";
import { GitHubRepoTargets } from "../../api/command/target/GitHubRepoTargets";
import { isTransformModeSuggestion } from "../../api/command/target/TransformModeSuggestion";
import { SdmContext } from "../../api/context/SdmContext";
import { CommandListenerInvocation } from "../../api/listener/CommandListener";
import {
    isValidationError,
    RepoTargets,
} from "../../api/machine/RepoTargets";
import { ProjectPredicate } from "../../api/mapping/PushTest";
import {
    CodeInspectionRegistration,
    CodeInspectionResult,
} from "../../api/registration/CodeInspectionRegistration";
import {
    CodeTransform,
    CodeTransformOrTransforms,
} from "../../api/registration/CodeTransform";
import { CodeTransformRegistration } from "../../api/registration/CodeTransformRegistration";
import { CommandHandlerRegistration } from "../../api/registration/CommandHandlerRegistration";
import { CommandRegistration } from "../../api/registration/CommandRegistration";
import { EventHandlerRegistration } from "../../api/registration/EventHandlerRegistration";
import { GeneratorRegistration } from "../../api/registration/GeneratorRegistration";
import { ParametersBuilder } from "../../api/registration/ParametersBuilder";
import {
    DeclarationType,
    MappedParameterOrSecretDeclaration,
    NamedParameter,
    ParametersDefinition,
    ParametersListing,
} from "../../api/registration/ParametersDefinition";
import { createCommand } from "../command/createCommand";
import {
    generatorCommand,
    isSeedDrivenGeneratorParameters,
} from "../command/generator/generatorCommand";
import { chattyDryRunAwareEditor } from "../command/transform/chattyDryRunAwareEditor";
import { formatDate } from "../misc/dateFormat";
import { slackErrorMessage } from "../misc/slack/messages";
import { projectLoaderRepoLoader } from "./projectLoaderRepoLoader";
import {
    isRepoTargetingParameters,
    RepoTargetingParameters,
} from "./RepoTargetingParameters";
import {
    MachineOrMachineOptions,
    toMachineOptions,
} from "./toMachineOptions";

// tslint:disable:max-file-line-count

export const GeneratorTag = "generator";
export const InspectionTag = "inspection";
export const TransformTag = "transform";

export function codeTransformRegistrationToCommand(sdm: MachineOrMachineOptions, ctr: CodeTransformRegistration<any>): Maker<HandleCommand> {
    tagWith(ctr, TransformTag);
    const mo = toMachineOptions(sdm);
    addDryRunParameters(ctr);
    addParametersDefinedInBuilder(ctr);
    ctr.paramsMaker = toRepoTargetingParametersMaker(
        ctr.paramsMaker || NoParameters,
        ctr.targets || mo.targets || GitHubRepoTargets);
    const description = ctr.description || ctr.name;
    const asCommand: CommandHandlerRegistration = {
        description,
        ...ctr as CommandRegistration<any>,
        listener: async ci => {
            const targets = (ci.parameters as RepoTargetingParameters).targets;
            const vr = targets.bindAndValidate();
            if (isValidationError(vr)) {
                return ci.addressChannels(
                    slackErrorMessage(
                        `Code Transform`,
                        `Invalid parameters to code transform ${italic(ci.commandName)}:
${codeBlock(vr.message)}`,
                        ci.context));
            }
            const repoFinder: RepoFinder = !!(ci.parameters as RepoTargetingParameters).targets.repoRef ?
                () => Promise.resolve([(ci.parameters as RepoTargetingParameters).targets.repoRef]) :
                ctr.repoFinder || toMachineOptions(sdm).repoFinder;
            const repoLoader: RepoLoader = !!ctr.repoLoader ?
                ctr.repoLoader(ci.parameters) :
                projectLoaderRepoLoader(
                    mo.projectLoader,
                    (ci.parameters as RepoTargetingParameters).targets.credentials,
                    false,
                    ci.context);

            const editMode = toEditModeOrFactory(ctr, ci);
            const results = await editAll<any, any>(
                ci.context,
                ci.credentials,
                chattyDryRunAwareEditor(ctr.name, toScalarProjectEditor(ctr.transform, ctr.projectTest)),
                editMode,
                ci.parameters,
                repoFinder,
                andFilter(targets.test, ctr.repoFilter),
                repoLoader);
            if (!!ctr.onTransformResults) {
                await ctr.onTransformResults(results, ci);
            } else {
                logger.info("No react function to react to results of code transformation '%s'", ctr.name);
            }
        },
    };
    return commandHandlerRegistrationToCommand(sdm, asCommand);
}

export function codeInspectionRegistrationToCommand<R>(sdm: MachineOrMachineOptions, cir: CodeInspectionRegistration<R, any>): Maker<HandleCommand> {
    tagWith(cir, InspectionTag);
    const mo = toMachineOptions(sdm);
    addParametersDefinedInBuilder(cir);
    cir.paramsMaker = toRepoTargetingParametersMaker(
        cir.paramsMaker || NoParameters,
        cir.targets || mo.targets || GitHubRepoTargets);
    const description = cir.description || cir.name;
    const asCommand: CommandHandlerRegistration = {
        description,
        ...cir as CommandRegistration<any>,
        listener: async ci => {
            const targets = (ci.parameters as RepoTargetingParameters).targets;
            const vr = targets.bindAndValidate();
            if (isValidationError(vr)) {
                return ci.addressChannels(
                    slackErrorMessage(
                        `Code Inspection`,
                        `Invalid parameters to code inspection ${italic(ci.commandName)}:
${codeBlock(vr.message)}`,
                        ci.context));
            }
            const action: (p: Project, params: any) => Promise<CodeInspectionResult<R>> = async p => {
                if (!!cir.projectTest && !(await cir.projectTest(p))) {
                    return { repoId: p.id, result: undefined };
                }
                return { repoId: p.id, result: await cir.inspection(p, ci) };
            };
            const repoFinder: RepoFinder = !!(ci.parameters as RepoTargetingParameters).targets.repoRef ?
                () => Promise.resolve([(ci.parameters as RepoTargetingParameters).targets.repoRef]) :
                cir.repoFinder || toMachineOptions(sdm).repoFinder;
            const repoLoader: RepoLoader = !!cir.repoLoader ?
                cir.repoLoader(ci.parameters) :
                projectLoaderRepoLoader(
                    mo.projectLoader,
                    (ci.parameters as RepoTargetingParameters).targets.credentials,
                    true,
                    ci.context);
            const results = await doWithAllRepos<CodeInspectionResult<R>, any>(
                ci.context,
                ci.credentials,
                action,
                ci.parameters,
                repoFinder,
                andFilter(targets.test, cir.repoFilter),
                repoLoader);
            if (!!cir.onInspectionResults) {
                await cir.onInspectionResults(results, ci);
            } else {
                logger.info("No react function to react to results of code inspection '%s'", cir.name);
            }
        },
    };
    return commandHandlerRegistrationToCommand(sdm, asCommand);
}

/**
 * Tag the command details with the given tag if it isn't already
 * @param {Partial<CommandDetails>} e
 * @param {string} tag
 */
function tagWith(e: Partial<CommandDetails>, tag: string) {
    if (!e.tags) {
        e.tags = [];
    }
    if (typeof e.tags === "string") {
        e.tags = [e.tags];
    }
    if (!e.tags.includes(tag)) {
        e.tags.push(tag);
    }
}

export function generatorRegistrationToCommand<P = any>(sdm: MachineOrMachineOptions, e: GeneratorRegistration<P>): Maker<HandleCommand<P>> {
    tagWith(e, GeneratorTag);
    if (!e.paramsMaker) {
        e.paramsMaker = NoParameters as any as Maker<P>;
    }
    if (e.startingPoint && isProject(e.startingPoint) && !e.startingPoint.id) {
        // TODO should probably be handled in automation-client
        e.startingPoint.id = new GitHubRepoRef("ignore", "this");
    }
    addParametersDefinedInBuilder(e);
    return () => generatorCommand(
        sdm,
        () => toScalarProjectEditor(e.transform),
        e.name,
        e.paramsMaker,
        e.fallbackTarget || GitHubRepoCreationParameters,
        e.startingPoint,
        e,
    );
}

export function commandHandlerRegistrationToCommand<P = NoParameters>(sdm: MachineOrMachineOptions,
                                                                      c: CommandHandlerRegistration<P>): Maker<HandleCommand<P>> {
    return () => createCommand(
        sdm,
        toOnCommand(c),
        c.name,
        c.paramsMaker,
        c,
    );
}

export function eventHandlerRegistrationToEvent(sdm: MachineOrMachineOptions, e: EventHandlerRegistration<any, any>): Maker<HandleEvent> {
    return () => eventHandlerFrom(
        e.listener,
        e.paramsMaker || NoParameters,
        e.subscription,
        e.name,
        e.description,
        e.tags,
    );
}

function toOnCommand<PARAMS>(c: CommandHandlerRegistration<any>): (sdm: MachineOrMachineOptions) => OnCommand<PARAMS> {
    addParametersDefinedInBuilder(c);
    return () => async (context, parameters) => {
        const cli = toCommandListenerInvocation(c, context, parameters);
        try {
            await c.listener(cli);
            return Success;
        } catch (err) {
            logger.error("Error executing command '%s': %s", cli.commandName, err.message);
            logger.error(err.stack);
            return {
                code: 1,
                message: err.message,
            };
        }
    };
}

function toCommandListenerInvocation<P>(c: CommandRegistration<P>, context: HandlerContext, parameters: P): CommandListenerInvocation {
    // It may already be there
    let credentials = !!context ? (context as any as SdmContext).credentials : undefined;
    let ids: RemoteRepoRef[];
    if (isSeedDrivenGeneratorParameters(parameters)) {
        credentials = parameters.target.credentials;
        ids = [parameters.target.repoRef];
    } else if (isRepoTargetingParameters(parameters)) {
        credentials = parameters.targets.credentials;
        ids = !!parameters.targets.repoRef ? [parameters.targets.repoRef] : undefined;
    }
    // TODO do a look up for associated channels
    const addressChannels = (msg, opts) => context.messageClient.respond(msg, opts);
    return {
        commandName: c.name,
        context,
        parameters,
        addressChannels,
        credentials,
        ids,
    };
}

export const DryRunParameter = {
    name: "dry-run",
    description: "Run Code Transform in dry run mode so that changes aren't committed to the repository",
    required: false,
    defaultValue: false,
    type: "boolean",
} as NamedParameter;
export const DryRunMsgIdParameter = {
    name: "dry-run.msgId",
    description: "Run Code Transform in dry run mode so that changes aren't committed to the repository",
    required: false,
    type: "string",
    displayable: false,
} as NamedParameter;

/**
 * Add the dryRun parameter into the list of parameters
 */
function addDryRunParameters<PARAMS>(c: CommandRegistration<PARAMS>): void {
    const params = toParametersListing(c.parameters || {});
    params.parameters.push(DryRunParameter, DryRunMsgIdParameter);
    c.parameters = params;
}

/**
 * Add to the existing ParametersMaker any parameters defined in the builder itself
 * @param {CommandHandlerRegistration<PARAMS>} c
 */
function addParametersDefinedInBuilder<PARAMS>(c: CommandRegistration<PARAMS>) {
    const oldMaker = c.paramsMaker || NoParameters;
    if (!!c.parameters) {
        c.paramsMaker = () => {
            let paramsInstance;
            if (!!oldMaker) {
                paramsInstance = toFactory(oldMaker)();
            } else {
                paramsInstance = {};
                paramsInstance.__kind = "command-handler";
            }
            const paramListing = toParametersListing(c.parameters);
            paramListing.parameters.forEach(p => {
                paramsInstance[p.name] = p.defaultValue;
                declareParameter(paramsInstance, p.name, p);
            });
            paramListing.mappedParameters.forEach(p =>
                declareMappedParameter(paramsInstance, p.name, p.uri, p.required));
            paramListing.secrets.forEach(p =>
                declareSecret(paramsInstance, p.name, p.uri));
            return paramsInstance;
        };
    }
}

function isMappedParameterOrSecretDeclaration(x: any): x is MappedParameterOrSecretDeclaration {
    const maybe = x as MappedParameterOrSecretDeclaration;
    return !!maybe && !!maybe.declarationType;
}

function isParametersListing(p: ParametersDefinition): p is ParametersListing {
    const maybe = p as ParametersListing;
    return maybe.parameters !== undefined && maybe.mappedParameters !== undefined;
}

export function toParametersListing(p: ParametersDefinition): ParametersListing {
    if (isParametersListing(p)) {
        return p;
    }
    const builder = new ParametersBuilder();
    for (const name of Object.getOwnPropertyNames(p)) {
        const value = p[name];
        if (isMappedParameterOrSecretDeclaration(value)) {
            switch (value.declarationType) {
                case DeclarationType.mapped:
                    builder.addMappedParameters({ name, uri: value.uri, required: value.required });
                    break;
                case DeclarationType.secret:
                    builder.addSecrets({ name, uri: value.uri });
                    break;
            }
        } else {
            builder.addParameters({ name, ...value });
        }
    }
    return builder;
}

/**
 * Convert to legacy automation-client "editor" signature
 * @param {CodeTransformOrTransforms<PARAMS>} ctot
 * @param {ProjectPredicate} projectPredicate
 * @return {ProjectEditor<PARAMS>}
 */
export function toScalarProjectEditor<PARAMS>(ctot: CodeTransformOrTransforms<PARAMS>, projectPredicate?: ProjectPredicate): ProjectEditor<PARAMS> {
    const unguarded = Array.isArray(ctot) ?
        chainEditors(...ctot.map(toProjectEditor)) :
        toProjectEditor(ctot);
    if (!!projectPredicate) {
        // Filter out this project if it doesn't match the predicate
        return async (p, context, params) => {
            return (await projectPredicate(p)) ?
                unguarded(p, context, params) :
                Promise.resolve({ success: true, edited: false, target: p });
        };
    }
    return unguarded;
}

// Convert to an old style, automation-client, ProjectEditor to allow
// underlying code to work for now
function toProjectEditor<P>(ct: CodeTransform<P>): ProjectEditor<P> {
    return async (p, ctx, params) => {
        const ci = toCommandListenerInvocation(p, ctx, params);
        // Mix in handler context for old style callers
        const n = await ct(p, {
                ...ctx,
                ...ci,
            } as CommandListenerInvocation<P> & HandlerContext,
            params);
        if (n === undefined) {
            // The transform returned void
            return { target: p, edited: await isDirty(p), success: true };
        }
        const r: Project | EditResult = n as any;
        try {
            return isProject(r) ? successfulEdit(r, await isDirty(r)) : r;
        } catch (e) {
            return failedEdit(p, e);
        }
    };
}

async function isDirty(p: Project): Promise<boolean> {
    if (isGitProject(p)) {
        try {
            const status = await p.gitStatus();
            return !status.isClean;
        } catch {
            // Ignore
        }
    }
    return undefined;
}

function isGitProject(p: Project): p is GitProject {
    const maybe = p as GitProject;
    return !!maybe.gitStatus;
}

/**
 * Return a parameters maker that is targeting aware
 * @param {Maker<PARAMS>} paramsMaker
 * @param targets targets parameters to set if necessary
 * @return {Maker<EditorOrReviewerParameters & PARAMS>}
 */
export function toRepoTargetingParametersMaker<PARAMS>(paramsMaker: Maker<PARAMS>,
                                                       targets: Maker<RepoTargets>): Maker<RepoTargetingParameters & PARAMS> {
    const sampleParams = toFactory(paramsMaker)();
    return isRepoTargetingParameters(sampleParams) ?
        paramsMaker as Maker<RepoTargetingParameters & PARAMS> :
        () => {
            const rawParms: PARAMS = toFactory(paramsMaker)();
            const allParms = rawParms as RepoTargetingParameters & PARAMS;
            const targetsInstance: RepoTargets = toFactory(targets)();
            allParms.targets = targetsInstance;
            return allParms;
        };
}

function toEditModeOrFactory<P>(ctr: CodeTransformRegistration<P>, ci: CommandListenerInvocation<P>) {
    const description = ctr.description || ctr.name;
    if (!!ctr.transformPresentation) {
        return (p: Project) => ctr.transformPresentation(ci, p);
    }
    // Get EditMode from parameters if possible
    if (isTransformModeSuggestion(ci.parameters)) {
        const tms = ci.parameters;
        return new editModes.PullRequest(
            tms.desiredBranchName,
            tms.desiredPullRequestTitle || description);
    }
    // Default it if not supplied
    return new editModes.PullRequest(
        `transform-${gitBranchCompatible(ctr.name)}-${formatDate()}`,
        description);
}

function gitBranchCompatible(name: string) {
    return name.replace(/\s+/g, "_"); // What else??
}
