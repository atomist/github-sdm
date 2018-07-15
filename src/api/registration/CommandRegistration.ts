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

import { RepoFinder } from "@atomist/automation-client/operations/common/repoFinder";
import { RepoLoader } from "@atomist/automation-client/operations/common/repoLoader";
import { Maker } from "@atomist/automation-client/util/constructionUtils";
import { ParametersDefinition } from "./ParametersDefinition";

/**
 * Type for registering a project transform, which can make changes
 * to projects
 */
export interface CommandRegistration<PARAMS> {

    name: string;

    description?: string;

    /**
     * Function to create a parameters object used by this command.
     * Empty parameters will be returned by default.
     */
    paramsMaker?: Maker<PARAMS>;

    /**
     * Define parameters used by this command. Alternative to using
     * paramsMaker: Do not supply both.
     */
    parameters?: ParametersDefinition;

    intent?: string | string[];
    tags?: string | string[];

    repoFinder?: RepoFinder;

    repoLoader?: (p: PARAMS) => RepoLoader;

}
