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

import { FingerprintData } from "@atomist/automation-client";
import { computeShaOf } from "../../misc/sha";

/**
 * Convenient superclass for fingerprints.
 */
export abstract class AbstractFingerprint implements FingerprintData {

    public readonly sha: string;

    protected constructor(public readonly name: string,
                          public readonly abbreviation: string,
                          public readonly version: string,
                          public readonly data: string) {
        if (data === undefined) {
            throw new Error("fingerprint data must not be undefined");
        }
        this.sha = computeShaOf(this.data);
    }

}
