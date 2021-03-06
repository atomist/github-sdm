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

import { PushTest } from "../mapping/PushTest";

/**
 * Extended by any object that can react to a subset of pushes.
 */
export interface PushSelector {

    name: string;

    pushTest?: PushTest;
}

/**
 * Superclass for registering actions or listeners associated with a push
 */
export interface PushRegistration<A> extends PushSelector {

    action: A;

}
