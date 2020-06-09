/*
 * Copyright © 2020 Atomist, Inc.
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

import { HandlerContext } from "@atomist/automation-client/lib/HandlerContext";
import { MessageClient } from "@atomist/automation-client/lib/spi/message/MessageClient";
import * as assert from "assert";
import { CommandListenerExecutionInterruptError } from "../../../lib/api-helper/machine/handlerRegistrations";
import { commandRequestParameterPromptFactory } from "../../../lib/api/context/parameterPrompt";

describe("parameterPrompt", () => {

    describe("commandRequestParameterPromptFactory", () => {

        it("should correctly find already existing parameters", async () => {
            const ctx = {
                trigger: {
                    parameters: [
                        { name: "foo", value: "bar" },
                        { name: "some", value: "other" },
                    ],
                },
            };

            const params = await commandRequestParameterPromptFactory(ctx as any)({ foo: { required: true } }) as any;
            assert.strictEqual(params.foo, ctx.trigger.parameters[0].value);
        });

        it("should ask for missing parameters", async () => {
            const wsMock: MessageClient = {
                respond: msg => {
                    assert(msg.parameter_specs.length === 2);
                    assert.strictEqual(msg.parameter_specs[0].name, "bar");
                    assert.strictEqual(msg.parameter_specs[1].name, "test");
                },
            } as any;

            const ctx = {
                trigger: {
                    parameters: [
                        { name: "foo", value: "bar" },
                        { name: "some", value: "other" },
                    ],
                },
                messageClient: wsMock,
            };

            try {
                const params = await commandRequestParameterPromptFactory(ctx as any)({
                    bar: { required: true },
                    test: { required: true },
                    foo: { required: true },
                }) as any;
                assert.fail();
                assert.strictEqual(params, {});
            } catch (e) {
                assert(e instanceof CommandListenerExecutionInterruptError);
            }
        });

        it("should not ask for missing optional parameters if there no required missing", async () => {
            const wsMock: HandlerContext = {
                respond: () => {
                    assert.fail();
                },
            } as any;

            const ctx = {
                trigger: {
                    parameters: [
                        { name: "some", value: "other" },
                    ],
                },
                messageClient: wsMock,
            };

            const params = await commandRequestParameterPromptFactory(ctx as any)({
                test: { required: false },
                foo: { required: false },
            }) as any;
            assert.deepStrictEqual(params, {});
        });

        it("should ask for missing optional parameters only when there's at least one required", async () => {
            const wsMock: MessageClient = {
                respond: msg => {
                    assert(msg.parameter_specs.length === 3);
                    assert.strictEqual(msg.parameter_specs[0].name, "bar");
                    assert.strictEqual(msg.parameter_specs[1].name, "test");
                    assert.strictEqual(msg.parameter_specs[2].name, "foo");
                },
            } as any;

            const ctx = {
                trigger: {
                    parameters: [
                        { name: "some", value: "other" },
                        { name: "superfoo", value: "other" },
                    ],
                },
                messageClient: wsMock,
            };

            try {
                const params = await commandRequestParameterPromptFactory(ctx as any)({
                    bar: {},
                    test: { required: false },
                    foo: { required: false },
                    superfoo: { required: true },
                }) as any;
                assert.fail();
                assert.strictEqual(params, {});
            } catch (e) {
                assert(e instanceof CommandListenerExecutionInterruptError);
            }
        });

        it("should not ask for parameters if minLength isn't satisfied", async () => {
            const wsMock: HandlerContext = {
                respond: msg => {
                    assert(msg.parameter_specs.length === 1);
                    assert.strictEqual(msg.parameter_specs[0].name, "some");
                },
            } as any;

            const ctx = {
                trigger: {
                    parameters: [
                        { name: "some", value: "o" },
                    ],
                },
                messageClient: wsMock,
            };

            try {
                await commandRequestParameterPromptFactory(ctx as any)({
                    some: { required: false, minLength: 10 },
                }) as any;
            } catch (e) {
                assert(e instanceof CommandListenerExecutionInterruptError);
            }
        });

    });

});
