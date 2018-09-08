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

import { HandleCommand, HandleEvent } from "@atomist/automation-client";
import { Maker } from "@atomist/automation-client/util/constructionUtils";
import { AbstractSoftwareDeliveryMachine } from "../../src/api-helper/machine/AbstractSoftwareDeliveryMachine";
import { GoalSetter } from "../../src/api/mapping/GoalSetter";

/**
 * SDM implementation for use in tests
 */
export class TestSoftwareDeliveryMachine extends AbstractSoftwareDeliveryMachine {

    public readonly commandHandlers: Array<Maker<HandleCommand>>;
    public readonly eventHandlers: Array<Maker<HandleEvent<any>>>;
    public readonly goalFulfillmentMapper;
    public readonly ingesters: string[];

    constructor(name: string, ...goalSetters: Array<GoalSetter | GoalSetter[]>) {
        super("name", {
            // Pass in just enough config for adding listeners not to blow up
            sdm: {
            } as any,
            listeners: undefined,
        }, goalSetters);
    }

}
