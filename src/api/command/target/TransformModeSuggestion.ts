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

/**
 * @deprecated use TransformModeSuggestion
 */
export type EditModeSuggestion = TransformModeSuggestion;

/**
 * Interface that can be implemented by CodeTransform parameters that can suggest the mode
 * to present changes to users.
 */
export interface TransformModeSuggestion {

    desiredBranchName: string;

    desiredPullRequestTitle?: string;

    desiredCommitMessage?: string;

}

export function isTransformModeSuggestion(p: any): p is TransformModeSuggestion {
    const maybe = p as TransformModeSuggestion;
    return !!maybe.desiredBranchName;
}
