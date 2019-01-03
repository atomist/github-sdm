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

import {
    GitHubRepoRef,
    InMemoryProject,
    InMemoryProjectFile,
} from "@atomist/automation-client";
import { isGitHubRepoRef } from "@atomist/automation-client/lib/operations/common/GitHubRepoRef";
import * as assert from "power-assert";
import { fakePush } from "../../../lib/api-helper/testsupport/fakePush";
import {
    attachFacts,
    enrichGoalSetters,
    goalContributors,
    StatefulPushListenerInvocation,
} from "../../../lib/api/dsl/goalContribution";
import {
    onAnyPush,
    whenPushSatisfies,
} from "../../../lib/api/dsl/goalDsl";
import { AutoCodeInspection } from "../../../lib/api/goal/common/AutoCodeInspection";
import { Autofix } from "../../../lib/api/goal/common/Autofix";
import { Fingerprint } from "../../../lib/api/goal/common/Fingerprint";
import { Locking } from "../../../lib/api/goal/common/Locking";
import { PushImpact } from "../../../lib/api/goal/common/PushImpact";
import { suggestAction } from "../../../lib/api/goal/common/suggestAction";
import { Goal } from "../../../lib/api/goal/Goal";
import { Goals } from "../../../lib/api/goal/Goals";
import { GoalWithFulfillment } from "../../../lib/api/goal/GoalWithFulfillment";
import { resetRegistrableManager } from "../../../lib/api/machine/Registerable";
import { predicatePushTest } from "../../../lib/api/mapping/PushTest";
import { anySatisfied } from "../../../lib/api/mapping/support/pushTestUtils";
import { TestSoftwareDeliveryMachine } from "../../api-helper/TestSoftwareDeliveryMachine";

const SomeGoalSet = new Goals("SomeGoalSet", new Goal({
    uniqueName: "Fred",
    environment: "0-code/", orderedName: "0-Fred",
}));

const AutofixGoal = new Autofix();
const BuildGoal = new GoalWithFulfillment({
    uniqueName: "build",
});
const CodeInspectionGoal = new AutoCodeInspection();
const FingerprintGoal = new Fingerprint();
const LockingGoal = Locking;
const JustBuildGoal = new GoalWithFulfillment({
    uniqueName: "just-build",
});
const PushReactionGoal = new PushImpact();

describe("goalContribution", () => {

    describe("goalContributors", () => {

        it("should set no goals", async () => {
            const gs = goalContributors(whenPushSatisfies(() => false).itMeans("thing").setGoals(SomeGoalSet));
            const p = fakePush();
            const goals: Goals = await gs.mapping(p);
            assert.equal(goals, undefined);
        });

        it("should set goals from one goal", async () => {
            const gs = goalContributors(whenPushSatisfies(() => true).itMeans("thing").setGoals(BuildGoal));
            const p = fakePush();
            const goals: Goals = await gs.mapping(p);
            assert.deepEqual(goals.goals, [BuildGoal]);
            assert.equal(goals.name, "build");
        });

        it("should set goals from one goals", async () => {
            const r = whenPushSatisfies(() => true).setGoals(SomeGoalSet);
            const gs = goalContributors(r);
            const p = fakePush();
            assert.equal(await r.mapping(p), SomeGoalSet);
            const goals: Goals = await gs.mapping(p);
            assert.deepEqual(goals.goals, SomeGoalSet.goals);
            assert.equal(goals.name, "SomeGoalSet");
        });

    });

    describe("enrichGoalSetters", () => {

        it("should set no goals", async () => {
            const gs = enrichGoalSetters(whenPushSatisfies(() => false).itMeans("thing").setGoals(SomeGoalSet),
                whenPushSatisfies(() => false).setGoals(SomeGoalSet));
            const p = fakePush();
            const goals: Goals = await gs.mapping(p);
            assert.equal(goals, undefined);
        });

        it("should add goal to none", async () => {
            const gs = enrichGoalSetters(whenPushSatisfies(() => false).itMeans("thing").setGoals(SomeGoalSet),
                whenPushSatisfies(() => true).setGoals(SomeGoalSet));
            const p = fakePush();
            const goals: Goals = await gs.mapping(p);
            assert.deepEqual(goals.goals, SomeGoalSet.goals);
            assert.equal(goals.name, "SomeGoalSet");
        });

        it("should add goal to some", async () => {
            const mg = suggestAction({ message: "sendSomeMessage", displayName: "Sending message" });
            const old = whenPushSatisfies(() => true).itMeans("thing").setGoals(SomeGoalSet);
            const gs = enrichGoalSetters(old,
                onAnyPush().setGoals(mg));
            const p = fakePush();
            const goals: Goals = await gs.mapping(p);
            assert.deepEqual(goals.goals, SomeGoalSet.goals.concat(mg));
            assert.equal(goals.name, "SomeGoalSet, Sending message");
        });

        it("should add two goals to some", async () => {
            const mg = suggestAction({ message: "sendSomeMessage", displayName: "Sending message" });
            const old = whenPushSatisfies(() => true).itMeans("thing").setGoals(SomeGoalSet);
            let gs = enrichGoalSetters(old,
                onAnyPush().setGoals(mg));
            gs = enrichGoalSetters(gs,
                onAnyPush().setGoals(FingerprintGoal));
            const p = fakePush();
            const goals: Goals = await gs.mapping(p);
            assert.equal(goals.goals.length, 3);
            assert.deepEqual(goals.goals, SomeGoalSet.goals.concat([mg, FingerprintGoal] as any));
            assert.equal(goals.name, "SomeGoalSet, Sending message, fingerprint");
        });

        it("should respect sealed goals", async () => {
            const mg = suggestAction({ message: "sendSomeMessage", displayName: "Sending message" });
            const old = whenPushSatisfies(() => true)
                .itMeans("thing")
                .setGoals(SomeGoalSet.andLock());
            const gs = enrichGoalSetters(old,
                onAnyPush().setGoals(mg));
            const p = fakePush();
            const goals: Goals = await gs.mapping(p);
            assert.deepEqual(goals.goals, SomeGoalSet.goals);
            assert.equal(goals.name, "SomeGoalSet, lock");
        });

        it("should respect sealed goals after adding additional goal", async () => {
            // we create a goal setter that always sets a Fred goal
            const old = whenPushSatisfies(() => true)
                .itMeans("thing")
                .setGoals(SomeGoalSet);

            // the we create a different goal setter that always sets the MessageGoal + Locks it
            const mg1 = suggestAction({ message: "sendSomeMessage1", displayName: "Sending message1" });
            const mg2 = suggestAction({ message: "sendSomeMessage2", displayName: "Sending message2" });

            const gs = enrichGoalSetters(old,
                onAnyPush().setGoals([mg1, LockingGoal]));
            const gs1 = enrichGoalSetters(gs,
                whenPushSatisfies(async pu => pu.id.owner !== "bar").setGoals(mg2));

            const p = fakePush(); // this does not have an owner of "bar" so it does qualify for the MessageGoal above
            const goals: Goals = await gs1.mapping(p); // we match it against the second value of `gs`

            assert.deepEqual(goals.goals, SomeGoalSet.goals.concat([mg1] as any),
                "Goals found were " + goals.goals.map(g => g.name)); // and now it has accepted the addition of the MessageGoal

            const barPush = fakePush(InMemoryProject.from(new GitHubRepoRef("bar", "what"))); // but if the owner IS bar
            const barGoals: Goals = await gs1.mapping(barPush); // then it does not get the Message Goal because it doesn't pass the push test.
            assert.deepEqual(barGoals.goals, SomeGoalSet.goals.concat(mg1));
        });

        it("should uniquely name attachFacts", async () => {
            const af = attachFacts<{ name: string}>(async pu => ({ name: pu.push.id }));
            assert(af.name.startsWith("attachFacts-"));
            assert(af.name.length > "attachFacts-".length);
        });

        it("should attach facts", async () => {
            interface Named { name: string; }
            const mg = suggestAction({ message: "sendSomeMessage", displayName: "Sending message" });
            let gs = goalContributors(
                attachFacts<Named>(async pu => ({ name: "tony" })),
                whenPushSatisfies<StatefulPushListenerInvocation<Named>>(async pu => pu.facts.name === "tony").setGoals(mg));
            gs = enrichGoalSetters(gs,
                onAnyPush().setGoals(FingerprintGoal));
            const p = fakePush();
            const goals: Goals = await gs.mapping(p);
            assert.equal(goals.goals.length, 2);
            assert.deepEqual(goals.goals, [mg, FingerprintGoal]);
            assert.equal(goals.name, "Sending message, fingerprint");
        });

    });

    describe("using SDM", () => {

        beforeEach(() => {
            resetRegistrableManager();
        });

        it("should accept and add with () => true", async () => {
            const sdm = new TestSoftwareDeliveryMachine("test");
            sdm.addGoalContributions(goalContributors(
                onAnyPush().setGoals(new Goals("Checks", CodeInspectionGoal, PushReactionGoal, AutofixGoal))));
            const p = fakePush();
            const goals: Goals = await sdm.pushMapping.mapping(p);
            assert.deepEqual(goals.goals.sort(), [CodeInspectionGoal, PushReactionGoal, AutofixGoal].sort());
            sdm.addGoalContributions(whenPushSatisfies(() => true).setGoals(FingerprintGoal));
            const goals2: Goals = await sdm.pushMapping.mapping(p);
            assert.deepEqual(goals2.goals.sort(), [CodeInspectionGoal, PushReactionGoal, AutofixGoal, FingerprintGoal].sort());
        });

        it("should accept and add with onAnyPush", async () => {
            const sdm = new TestSoftwareDeliveryMachine("test");
            sdm.withPushRules(
                onAnyPush().setGoals(new Goals("Checks", CodeInspectionGoal, PushReactionGoal, AutofixGoal)));
            const p = fakePush();
            const goals: Goals = await sdm.pushMapping.mapping(p);
            assert.deepEqual(goals.goals.sort(), [CodeInspectionGoal, PushReactionGoal, AutofixGoal].sort());
            sdm.addGoalContributions(onAnyPush().setGoals(FingerprintGoal));
            const goals2: Goals = await sdm.pushMapping.mapping(p);
            assert.deepEqual(goals2.goals.sort(), [CodeInspectionGoal, PushReactionGoal, AutofixGoal, FingerprintGoal].sort());
        });

        it("should respect sealed goals after adding additional goal", async () => {
            // we create a goal setter that always sets a Fred goal
            const sdm = new TestSoftwareDeliveryMachine("test");
            const old = whenPushSatisfies(() => true)
                .itMeans("thing")
                .setGoals(SomeGoalSet);

            sdm.addGoalContributions(old);

            // the we create a different goal setter that always sets the MessageGoal + Locks it
            const mg1 = suggestAction({ message: "sendSomeMessage1", displayName: "Sending message1" });
            const mg2 = suggestAction({ message: "sendSomeMessage2", displayName: "Sending message2" });

            sdm.addGoalContributions(
                onAnyPush().setGoals([mg1, LockingGoal]));
            sdm.addGoalContributions(
                whenPushSatisfies(async pu => pu.id.owner !== "bar").setGoals(mg2));

            const p = fakePush(); // this does not have an owner of "bar" so it does qualify for the MessageGoal above
            const goals: Goals = await sdm.pushMapping.mapping(p); // we match it against the second value of `gs`

            assert.deepEqual(goals.goals, SomeGoalSet.goals.concat([mg1] as any),
                "Goals found were " + goals.goals.map(g => g.name)); // and now it has accepted the addition of the MessageGoal
            const barPush = fakePush(InMemoryProject.from(new GitHubRepoRef("bar", "what"))); // but if the owner IS bar
            const barGoals: Goals = await sdm.pushMapping.mapping(barPush);
            assert.deepEqual(barGoals.goals, SomeGoalSet.goals.concat(mg1),
                "Goals found were " + goals.goals.map(g => g.name));
        });

        const IsSdm = predicatePushTest("IsSDM",
            async p => !!(await p.getFile("src/atomist.config.ts")));

        const SdmDeliveryGoal = new Goal({ uniqueName: "sdmDelivery" });

        it("should handle real-world example", async () => {
            const sdm = new TestSoftwareDeliveryMachine("test");
            sdm.addGoalContributions(
                onAnyPush().setGoals(new Goals("Checks", CodeInspectionGoal, PushReactionGoal)));
            sdm.addGoalContributions(
                whenPushSatisfies(IsSdm, async pu => isGitHubRepoRef(pu.id)).setGoals(
                    new Goals("delivery", SdmDeliveryGoal, AutofixGoal).andLock()));
            sdm.addGoalContributions(goalContributors(
                whenPushSatisfies(anySatisfied(async pu => pu.id.owner === "bar", IsSdm))
                    .setGoals(FingerprintGoal),
                whenPushSatisfies(async () => true)
                    .setGoals(JustBuildGoal)));
            const push = fakePush(InMemoryProject.from(new GitHubRepoRef("bar", "what"),
                new InMemoryProjectFile("src/atomist.config.ts", "content")));
            const goals: Goals = await sdm.pushMapping.mapping(push);
            assert.deepEqual(goals.goals, [CodeInspectionGoal, PushReactionGoal, SdmDeliveryGoal, AutofixGoal],
                "Goals found were " + goals.goals.map(g => g.name));
        });

        it("should handle real-world example: single block", async () => {
            const sdm = new TestSoftwareDeliveryMachine("test");
            sdm.addGoalContributions(goalContributors(
                onAnyPush().setGoals(new Goals("Checks", CodeInspectionGoal, PushReactionGoal)),
                whenPushSatisfies(IsSdm, async pu => isGitHubRepoRef(pu.id))
                    .setGoals(new Goals("delivery", SdmDeliveryGoal, AutofixGoal).andLock()),
                whenPushSatisfies(anySatisfied(async pu => pu.id.owner === "bar", IsSdm))
                    .setGoals(FingerprintGoal),
                whenPushSatisfies(async () => true)
                    .setGoals(JustBuildGoal),
            ));
            const push = fakePush(InMemoryProject.from(new GitHubRepoRef("bar", "what"),
                new InMemoryProjectFile("src/atomist.config.ts", "content")));
            const goals: Goals = await sdm.pushMapping.mapping(push);
            assert.deepEqual(goals.goals, [CodeInspectionGoal, PushReactionGoal, SdmDeliveryGoal, AutofixGoal],
                "Goals found were " + goals.goals.map(g => g.name));
        });
    });
});
