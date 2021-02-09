/*
 * Copyright © 2021 Atomist, Inc.
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
    GitCommandGitProject,
    GitHubRepoRef,
} from "@atomist/automation-client";
import * as assert from "power-assert";
import {
    anyFileChangedSuchThat,
    anyFileChangedWithExtension,
    filesChangedSince,
} from "../../../../lib/api-helper/misc/git/filesChangedSince";
import { PushFields } from "../../../../lib/typings/types";

describe("filesChanged", () => {

    describe("changesSince", () => {

        it("should correctly find all files within two commits", async () => {
            const p = await GitCommandGitProject.cloned(
                // tslint:disable-next-line:no-null-keyword
                { token: null },
                GitHubRepoRef.from({
                    owner: "atomist-seeds",
                    repo: "spring-rest-seed",
                    sha: "917ad5340a1c03f86633f64032226b277ab366ee",
                }),
                {
                    depth: 6, // 5 commits in the push + one extra to be able to diff
                },
            );
            const push: PushFields.Fragment = {
                after: {
                    sha: "917ad5340a1c03f86633f64032226b277ab366ee",
                },
                commits: [{
                    sha: "917ad5340a1c03f86633f64032226b277ab366ee",
                }, {
                    sha: "72cdbbe7c553fc006b5a75ac203e0678575bb314",
                }, {
                    sha: "8c55376fb2ceb5f57fbfe111073327cb0adb32c9",
                }, {
                    sha: "119820a9de1ab0840a0be2c7fd71ef8f3cd24367",
                }, {
                    sha: "50bed8bff0ae8273302d2926e924148d57bad831",
                }],
            };

            const files = await filesChangedSince(p, push);
            const expectedChanges = [".travis.yml",
                ".travis/controller.patch",
                ".travis/travis-build.bash",
                "README.md",
                "src/main/java/com/atomist/spring/SpringRestSeedController.java"];
            assert.deepStrictEqual(files, expectedChanges);
        }).timeout(20000);

        it("should correctly find all files within two commits on a branch", async () => {
            const p = await GitCommandGitProject.cloned(
                { token: undefined },
                GitHubRepoRef.from({
                    owner: "atomist",
                    repo: "sdm",
                    branch: "test-branch-do-not-delete",
                }),
                {
                    depth: 3, // 2 commits in the push + one extra to be able to diff
                },
            );
            const push: PushFields.Fragment = {
                after: {
                    sha: "28c3f487a7de64945bef599e971116d37704869d",
                },
                commits: [{
                    sha: "28c3f487a7de64945bef599e971116d37704869d",
                }, {
                    sha: "81a5d5dfa4bb44a10eeb431953c0cf08910b7131",
                }],
            };

            const files = await filesChangedSince(p, push);
            const expectedChanges = [
                "CONTRIBUTING.md",
                "DO_NOT_DELETE",
                "blaml.yaml",
                "package-lock.json",
                "package.json",
                "test.json",
            ];
            assert.deepStrictEqual(files, expectedChanges);
        }).timeout(20000);

    });

    describe("anyFileChangedSuchThat", () => {

        it("should recognize passing", () => {
            assert(anyFileChangedSuchThat(["path", "path/2"], path => path.startsWith("path")));
        });

        it("should recognize test", () => {
            assert(!anyFileChangedSuchThat(["path", "path/2"], path => path.startsWith("xpath")));
        });
    });

    describe("anyFileChangedWithExtension", () => {

        it("should recognize extension", () => {
            assert(anyFileChangedWithExtension(["path.c", "path/two.java"], ["c"]));
        });

        it("should recognize extension from list", () => {
            assert(anyFileChangedWithExtension(["path.c", "path/two.java"], ["java"]));
        });

        it("should recognize extension without dot", () => {
            assert(anyFileChangedWithExtension(["path.c", "path/two.java"], ["c"]));
        });

        it("should recognize no suc extension", () => {
            assert(!anyFileChangedWithExtension(["path.c", "path/two.java"], ["graphql"]));
        });
    });

});

/* tslint:disable */

/*
const diff = `M       .gitignore
M       README.md
M       package-lock.json
M       package.json
M       src/atomist.config.ts
M       src/blueprint/TheSoftwareDeliveryMachine.tshine.ts
R100    src/software-delivery-machine/commands/generators/java/commonPatterns.ts        src/common/command/commonPatterns.ts
R088    src/software-delivery-machine/commands/generators/java/javaPatterns.ts  src/common/command/javaPatterns.ts
M       src/common/delivery/code/codeActionRegistrations.ts
M       src/common/delivery/code/executeCodeReactions.ts
M       src/common/delivery/code/review/executeReview.ts
M       src/common/delivery/deploy/deploy.ts
M       src/common/delivery/deploy/executeDeploy.ts
M       src/common/delivery/deploy/pcf/CloudFoundryTarget.ts
A       src/common/delivery/deploy/pcf/EnvironmentCloudFoundryTarget.ts
M       src/common/delivery/deploy/runWithLog.ts
M       src/common/delivery/goals/CopyGoalToGitHubStatus.ts
M       src/common/delivery/goals/common/commonGoals.ts
M       src/common/delivery/goals/common/npmGoals.ts
M       src/common/delivery/goals/fetchGoalsOnCommit.ts
M       src/common/delivery/goals/graph/graphGoalsToSlack.ts
M       src/common/delivery/goals/storeGoals.ts
M       src/common/listener/CodeReactionListener.ts
M       src/common/listener/GoalsSetListener.ts
M       src/common/listener/PushMapping.ts
M       src/common/listener/support/PushRules.ts
M       src/common/listener/support/pushtest/jvm/materialChangeToJavaRepo.ts
M       src/common/listener/support/pushtest/jvm/springPushTests.ts
M       src/common/listener/support/pushtest/node/materialChangeToNodeRepo.ts
A       src/graphql/fragment/PushFIelds.graphql
`;
*/
