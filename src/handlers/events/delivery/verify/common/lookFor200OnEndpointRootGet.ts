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

import { doWithRetry, RetryOptions } from "@atomist/automation-client/util/retry";
import axios from "axios";
import * as https from "https";
import { EndpointVerificationInvocation, EndpointVerificationListener, OnEndpointStatus } from "../OnEndpointStatus";

/**
 * Make an HTTP request to the reported endpoint to check
 * @type {OnEndpointStatus}
 */
export function lookFor200OnEndpointRootGet(retryOpts: Partial<RetryOptions> = {}): EndpointVerificationListener {
    return (inv: EndpointVerificationInvocation) => {
        const agent = new https.Agent({
            rejectUnauthorized: false,
        });
        return doWithRetry(
            () => axios.get(inv.url, {httpsAgent: agent})
                .then(resp => {
                    console.log(resp.status);
                    if (resp.status !== 200) {
                        return Promise.reject(`Unexpected response: ${resp.status}`);
                    }
                    return Promise.resolve();
                }),
            `Try to connect to ${inv.url}`,
            retryOpts);
        // Let a failure go through
    };
}
