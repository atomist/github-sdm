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

import { Success } from "@atomist/automation-client";
import { SlackMessage } from "@atomist/slack-messages";
import { nodeTagger } from "@atomist/spring-automation/commands/tag/nodeTagger";
import { springBootTagger } from "@atomist/spring-automation/commands/tag/springTagger";
import { whenPushSatisfies } from "../../blueprint/dsl/goalDsl";
import { SoftwareDeliveryMachine, SoftwareDeliveryMachineOptions } from "../../blueprint/SoftwareDeliveryMachine";
import { ExecuteGoalWithLog, RunWithLogContext } from "../../common/delivery/deploy/runWithLog";
import { MessageGoal } from "../../common/delivery/goals/common/MessageGoal";
import { ExecuteGoalResult } from "../../common/delivery/goals/goalExecution";
import { ToDefaultBranch } from "../../common/listener/support/pushtest/commonPushTests";
import { IsMaven } from "../../common/listener/support/pushtest/jvm/jvmPushTests";
import { MaterialChangeToJavaRepo } from "../../common/listener/support/pushtest/jvm/materialChangeToJavaRepo";
import { HasSpringBootApplicationClass } from "../../common/listener/support/pushtest/jvm/springPushTests";
import { not } from "../../common/listener/support/pushtest/pushTestUtils";
import { tagRepo } from "../../common/listener/support/tagRepo";
import { disableDeploy, enableDeploy } from "../../handlers/commands/SetDeployEnablement";
import { EnableDeployOnCloudFoundryManifestAddition } from "../blueprint/deploy/cloudFoundryDeploy";
import { suggestAddingCloudFoundryManifest } from "../blueprint/repo/suggestAddingCloudFoundryManifest";
import { addCloudFoundryManifest } from "../commands/editors/pcf/addCloudFoundryManifest";
import { addDemoEditors } from "../parts/demo/demoEditors";

export type EvangelicalMachineOptions = SoftwareDeliveryMachineOptions;

export const ImmaterialChangeToJava = new MessageGoal("immaterialChangeToJava");
export const EnableSpringBoot = new MessageGoal("enableSpringBoot");

/**
 * Assemble a machine that suggests greater use of Atomist
 */
export function evangelicalMachine(options: EvangelicalMachineOptions): SoftwareDeliveryMachine {
    const sdm = new SoftwareDeliveryMachine(
        "Helpful software delivery machine. You need to be saved.",
        options,
        whenPushSatisfies(IsMaven, HasSpringBootApplicationClass, not(MaterialChangeToJavaRepo))
            .itMeans("No material change to Java")
            .setGoals(ImmaterialChangeToJava),
        whenPushSatisfies(ToDefaultBranch, IsMaven, HasSpringBootApplicationClass)
            .itMeans("Spring Boot service to deploy")
            .setGoals(EnableSpringBoot),
        // whenPushSatisfies(IsMaven)
        //     .itMeans("Build Java")
        //     .setGoals(LibraryGoals),
        // whenPushSatisfies(IsNode)
        //     .itMeans("Build with npm")
        //     .setGoals(NpmBuildGoals),
    );

    sdm.implementGoal("ImmaterialChangeToJava",
        ImmaterialChangeToJava,
        sendMessageToSlack("Looks like you didn't change Java in a material way. " +
            "Atomist could prevent you needing to build! :atomist_build_started:"))
        .implementGoal("EnableSpringBoot",
            EnableSpringBoot,
            sendMessageToSlack("Congratulations. You're using Spring Boot. It's cool :sunglasses: and so is Atomist. " +
                "Atomist knows lots about Spring Boot and would love to help"))
        .addNewRepoWithCodeActions(
            suggestAddingCloudFoundryManifest,
            // TODO suggest creating with Spring
            tagRepo(springBootTagger),
            tagRepo(nodeTagger),
        )
        .addSupportingCommands(
            () => addCloudFoundryManifest,
            () => enableDeploy(),
            () => disableDeploy(),
        )
        .addCodeReactions(EnableDeployOnCloudFoundryManifestAddition);

    // addTeamPolicies(sdm);
    addDemoEditors(sdm);
    return sdm;
}

// TODO check if we've sent the message before
export function sendMessageToSlack(msg: string | SlackMessage): ExecuteGoalWithLog {
    return async (rwlc: RunWithLogContext): Promise<ExecuteGoalResult> => {
        await rwlc.addressChannels(msg);
        return Success;
    };
}
