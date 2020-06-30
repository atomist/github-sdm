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

import { ActionResult } from "@atomist/automation-client/lib/action/ActionResult";
import { GitHubRepoRef } from "@atomist/automation-client/lib/operations/common/GitHubRepoRef";
import { RemoteRepoRef } from "@atomist/automation-client/lib/operations/common/RepoId";
import { PullRequest } from "@atomist/automation-client/lib/operations/edit/editModes";
import { GitProject } from "@atomist/automation-client/lib/project/git/GitProject";
import { InMemoryFile } from "@atomist/automation-client/lib/project/mem/InMemoryFile";
import { InMemoryProject } from "@atomist/automation-client/lib/project/mem/InMemoryProject";
import { fileExists } from "@atomist/automation-client/lib/project/util/projectUtils";
import * as assert from "power-assert";
import {
    executeAutofixes,
    filterImmediateAutofixes,
    generateCommitMessageForAutofix,
    GoalInvocationParameters,
} from "../../../lib/api-helper/listener/executeAutofixes";
import { fakeGoalInvocation } from "../../../lib/api-helper/testsupport/fakeGoalInvocation";
import { SingleProjectLoader } from "../../../lib/api-helper/testsupport/SingleProjectLoader";
import { ExecuteGoalResult } from "../../../lib/api/goal/ExecuteGoalResult";
import { GoalInvocation } from "../../../lib/api/goal/GoalInvocation";
import { SdmGoalEvent } from "../../../lib/api/goal/SdmGoalEvent";
import { PushListenerInvocation } from "../../../lib/api/listener/PushListener";
import { pushTest } from "../../../lib/api/mapping/PushTest";
import { AutofixRegistration } from "../../../lib/api/registration/AutofixRegistration";
import { TransformPresentation } from "../../../lib/api/registration/CodeTransformRegistration";
import { RepoRefResolver } from "../../../lib/spi/repo-ref/RepoRefResolver";
import { CoreRepoFieldsAndChannels, OnPushToAnyBranch, ScmProvider, SdmGoalState } from "../../../lib/typings/types";

export const AddThingAutofix: AutofixRegistration = {
    name: "AddThing",
    pushTest: pushTest("Is TypeScript", async (pi: PushListenerInvocation) =>
        fileExists(pi.project, "**/*.ts", () => true),
    ),
    transform: async (project, ci) => {
        await project.addFile("thing", "1");
        assert(!!ci.context.workspaceId);
        assert(project === ci.push.project);
        assert(!!ci.credentials);
        assert(!ci.parameters);
        return { edited: true, success: true, target: project };
    },
};

interface BirdParams {
    bird: string;
}

export const AddThingWithParamAutofix: AutofixRegistration<BirdParams> = {
    name: "AddThing",
    pushTest: pushTest("Is TypeScript", async (pi: PushListenerInvocation) =>
        fileExists(pi.project, "**/*.ts", () => true),
    ),
    transform: async (project, ci) => {
        await project.addFile("bird", ci.parameters.bird);
        assert(!!ci.context.workspaceId);
        assert(!!ci.parameters);
        return { edited: true, success: true, target: project };
    },
    parametersInstance: {
        bird: "ibis",
    },
};

const FakeRepoRefResolver: RepoRefResolver = {
    repoRefFromPush(push: OnPushToAnyBranch.Push): RemoteRepoRef {
        throw new Error("Not implemented");
    },

    providerIdFromPush(push: OnPushToAnyBranch.Push): string | null {
        throw new Error("Not implemented");
    },

    repoRefFromSdmGoal(sdmGoal: SdmGoalEvent, provider: ScmProvider.ScmProvider): RemoteRepoRef {
        throw new Error("Not implemented");
    },

    toRemoteRepoRef(repo: CoreRepoFieldsAndChannels.Fragment, opts: { sha?: string; branch?: string }): RemoteRepoRef {
        return {
            remoteBase: "unreal",
            providerType: 0,
            url: "not-here",
            cloneUrl(): string {
                return "nope";
            },
            createRemote(): Promise<ActionResult<any>> {
                throw new Error("Not implemented");
            },
            setUserConfig(): Promise<ActionResult<any>> {
                throw new Error("Not implemented");
            },
            raisePullRequest(): Promise<ActionResult<any>> {
                throw new Error("Not implemented");
            },
            deleteRemote(): Promise<ActionResult<any>> {
                throw new Error("Not implemented");
            },
            owner: repo.owner,
            repo: repo.name,
            sha: opts.sha,
            branch: opts.branch,
        };
    },
};

describe("executeAutofixes", () => {
    it("should execute none", async () => {
        const id = new GitHubRepoRef("a", "b");
        const pl = new SingleProjectLoader({ id } as any);
        const r = (await executeAutofixes([])(
            fakeGoalInvocation(id, {
                projectLoader: pl,
                repoRefResolver: FakeRepoRefResolver,
            } as any),
        )) as ExecuteGoalResult;
        assert.equal(r.code, 0);
    });

    it("should execute header adder and find no match", async () => {
        const id = new GitHubRepoRef("a", "b");
        const initialContent = "public class Thing {}";
        const f = new InMemoryFile("src/main/java/Thing.java", initialContent);
        const p = InMemoryProject.from(id, f);
        ((p as any) as GitProject).revert = async () => undefined;
        ((p as any) as GitProject).gitStatus = async () =>
            ({
                isClean: false,
                sha: "ec7fe33f7ee33eee84b3953def258d4e7ccb6783",
            } as any);
        const pl = new SingleProjectLoader(p);
        const r = (await executeAutofixes([AddThingAutofix])(
            fakeGoalInvocation(id, {
                projectLoader: pl,
                repoRefResolver: FakeRepoRefResolver,
            } as any),
        )) as ExecuteGoalResult;
        assert.equal(r.code, 0);
        assert.equal(p.findFileSync(f.path).getContentSync(), initialContent);
    });

    it("should execute header adder and find a match and add a header", async () => {
        const id = GitHubRepoRef.from({ owner: "a", repo: "b", sha: "ec7fe33f7ee33eee84b3953def258d4e7ccb6783" });
        const initialContent = "public class Thing {}";
        const f = new InMemoryFile("src/Thing.ts", initialContent);
        const p = InMemoryProject.from(id, f, { path: "LICENSE", content: "Apache License" });
        ((p as any) as GitProject).revert = async () => undefined;
        ((p as any) as GitProject).commit = async () => undefined;
        ((p as any) as GitProject).push = async () => undefined;
        ((p as any) as GitProject).gitStatus = async () =>
            ({
                isClean: false,
                sha: "ec7fe33f7ee33eee84b3953def258d4e7ccb6783",
            } as any);
        const pl = new SingleProjectLoader(p);
        const gi = fakeGoalInvocation(id, {
            projectLoader: pl,
            repoRefResolver: FakeRepoRefResolver,
        } as any);
        assert(!!gi.credentials);
        const r = (await executeAutofixes([AddThingAutofix])(gi)) as ExecuteGoalResult;
        assert.equal(r.code, 0);
        assert(!!p);
        const foundFile = p.findFileSync("thing");
        assert(!!foundFile);
        assert.equal(foundFile.getContentSync(), "1");
    }).timeout(10000);

    it("should execute with parameter and find a match and add a header", async () => {
        const id = GitHubRepoRef.from({ owner: "a", repo: "b", sha: "ec7fe33f7ee33eee84b3953def258d4e7ccb6783" });
        const initialContent = "public class Thing {}";
        const f = new InMemoryFile("src/Thing.ts", initialContent);
        const p = InMemoryProject.from(id, f, { path: "LICENSE", content: "Apache License" });
        ((p as any) as GitProject).revert = async () => undefined;
        ((p as any) as GitProject).commit = async () => undefined;
        ((p as any) as GitProject).push = async () => undefined;
        ((p as any) as GitProject).gitStatus = async () =>
            ({
                isClean: false,
                sha: "ec7fe33f7ee33eee84b3953def258d4e7ccb6783",
            } as any);
        const pl = new SingleProjectLoader(p);
        const r = (await executeAutofixes([AddThingWithParamAutofix])(
            fakeGoalInvocation(id, {
                projectLoader: pl,
                repoRefResolver: FakeRepoRefResolver,
            } as any),
        )) as ExecuteGoalResult;
        assert.equal(r.code, 0, "Did not return 0");
        assert.equal(r.state, SdmGoalState.stopped);
        assert(!!p, r.description);
        const foundFile = p.findFileSync("bird");
        assert(!!foundFile, r.description);
        assert.equal(foundFile.getContentSync(), "ibis");
    }).timeout(10000);

    it("should execute with parameter and find push", async () => {
        const id = GitHubRepoRef.from({ owner: "a", repo: "b", sha: "ec7fe33f7ee33eee84b3953def258d4e7ccb6783" });
        const initialContent = "public class Thing {}";
        const f = new InMemoryFile("src/Thing.ts", initialContent);
        const p = InMemoryProject.from(id, f, { path: "LICENSE", content: "Apache License" });
        ((p as any) as GitProject).revert = async () => undefined;
        ((p as any) as GitProject).commit = async () => undefined;
        ((p as any) as GitProject).push = async () => undefined;
        ((p as any) as GitProject).gitStatus = async () =>
            ({
                isClean: false,
                sha: "ec7fe33f7ee33eee84b3953def258d4e7ccb6783",
            } as any);
        const pl = new SingleProjectLoader(p);
        const gi = fakeGoalInvocation(id, {
            projectLoader: pl,
            repoRefResolver: FakeRepoRefResolver,
        } as any);
        const errors: string[] = [];
        const testFix: AutofixRegistration = {
            name: "test",
            transform: async (project, ci) => {
                if (project !== p) {
                    errors.push("Project not the same");
                }
                if (!ci.push || ci.push.push !== gi.goalEvent.push) {
                    errors.push("push should be set");
                }
            },
        };
        await executeAutofixes([testFix])(gi);
        assert.deepEqual(errors, []);
    }).timeout(10000);

    it("should fix with transformPresentation set", async () => {
        const id = GitHubRepoRef.from({
            owner: "a",
            repo: "b",
            sha: "ec7fe33f7ee33eee84b3953def258d4e7ccb6783",
            branch: "master",
        });
        const initialContent = "public class Thing {}";
        const f = new InMemoryFile("src/Thing.ts", initialContent);
        const p = InMemoryProject.from(id, f, { path: "LICENSE", content: "Apache License" });
        ((p as any) as GitProject).revert = async () => undefined;
        ((p as any) as GitProject).hasBranch = async name => {
            if (name === "test-branch") {
                return false;
            }
            assert.fail();
            return undefined;
        };
        ((p as any) as GitProject).commit = async () => undefined;
        ((p as any) as GitProject).push = async () => undefined;
        ((p as any) as GitProject).gitStatus = async () =>
            ({
                isClean: false,
                sha: "ec7fe33f7ee33eee84b3953def258d4e7ccb6783",
            } as any);

        let createdBranch = false;
        let createdPr = false;
        ((p as any) as GitProject).createBranch = async name => {
            if (name === "test-branch") {
                createdBranch = true;
            }
            return p as any;
        };
        ((p as any) as GitProject).raisePullRequest = async (title, body, targetBranch) => {
            if (targetBranch === "master") {
                createdPr = true;
            }
            assert(body.startsWith("body"));
            assert(body.includes("AddThing"));
            return p as any;
        };

        const pl = new SingleProjectLoader(p);
        const gi = fakeGoalInvocation(id, {
            projectLoader: pl,
            repoRefResolver: FakeRepoRefResolver,
        } as any);
        let invokedTp = false;

        const tp: TransformPresentation<GoalInvocationParameters> = (ci, p1) => {
            if (invokedTp) {
                assert.fail();
            }
            invokedTp = true;
            return new PullRequest("test-branch", "title", "body");
        };

        assert(!!gi.credentials);
        const r = (await executeAutofixes([AddThingAutofix], tp)(gi)) as ExecuteGoalResult;
        assert.deepStrictEqual(r.code, 0);
        assert.deepStrictEqual(r.state, SdmGoalState.success);
        assert(!!p);
        const foundFile = p.findFileSync("thing");
        assert(!!foundFile);
        assert.deepStrictEqual(foundFile.getContentSync(), "1");
        assert(!!invokedTp);
        assert(!!createdBranch);
        assert(!!createdPr);
    }).timeout(10000);

    describe("filterImmediateAutofixes", () => {
        it("should correctly filter applied autofix", () => {
            const autofix = ({
                name: "test-autofix",
            } as any) as AutofixRegistration;

            const push = {
                commits: [
                    {
                        message: "foo",
                    },
                    {
                        message: generateCommitMessageForAutofix(autofix),
                    },
                    {
                        message: "bar",
                    },
                ],
            };

            const filterAutofixes = filterImmediateAutofixes([autofix], ({
                goalEvent: {
                    push,
                },
            } as any) as GoalInvocation);

            assert.strictEqual(filterAutofixes.length, 0);
        });

        it("should correctly filter applied autofix but leave other", () => {
            const autofix1 = ({
                name: "test-autofix1",
            } as any) as AutofixRegistration;

            const autofix2 = ({
                name: "test-autofix2",
            } as any) as AutofixRegistration;

            const push = {
                commits: [
                    {
                        message: "foo",
                    },
                    {
                        message: generateCommitMessageForAutofix(autofix1),
                    },
                    {
                        message: "bar",
                    },
                ],
            };

            const filterAutofixes = filterImmediateAutofixes([autofix1, autofix2], ({
                goalEvent: {
                    push,
                },
            } as any) as GoalInvocation);

            assert.strictEqual(filterAutofixes.length, 1);
            assert.strictEqual(filterAutofixes[0].name, autofix2.name);
        });
    });
});
