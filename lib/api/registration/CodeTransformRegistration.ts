/*
 * Copyright © 2019 Atomist, Inc.
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
    EditMode,
    NoParameters,
    Project,
} from "@atomist/automation-client";
import { CommandListenerInvocation } from "../listener/CommandListener";
import { TransformResult } from "./CodeTransform";
import { ProjectOperationRegistration } from "./ProjectOperationRegistration";
import { ProjectsOperationRegistration } from "./ProjectsOperationRegistration";

/**
 * Type for registering a project transform, which can make changes
 * across projects
 */
export interface CodeTransformRegistration<PARAMS = NoParameters>
    extends ProjectOperationRegistration<PARAMS>, ProjectsOperationRegistration<PARAMS> {

    /**
     * How to present the transformation - would you like a Pull Request or a branch commit?
     * What would you like in the commit message, or the title of the pull request?
     * All these and more can be specified in the EditMode, which this function can
     * choose based on the invocation of this command and the code itself.
     *
     * This defaults to a pull request with branch name derived from the transform name.
     * @param {CommandListenerInvocation<PARAMS>} ci
     * @param {p: Project} p
     * @return {EditMode}
     */
    transformPresentation?: (ci: CommandListenerInvocation<PARAMS>, p: Project) => EditMode;

    /**
     * React to results from running transform across one or more projects
     * @param results
     * @param ci context
     * @return {Promise<void>}
     */
    onTransformResults?(results: TransformResult[], ci: CommandListenerInvocation<PARAMS>): Promise<void>;

}

/**
 * Signature of a decorator function that can add additional behavior
 * to a CodeTransformRegistration.
 */
export type CodeTransformRegistrationDecorator<PARAMS> =
    (ctr: CodeTransformRegistration<PARAMS>) => CodeTransformRegistration<PARAMS>;
