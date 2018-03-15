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

import { onAnyPush, whenPushSatisfies } from "../blueprint/ruleDsl";
import { SoftwareDeliveryMachine } from "../blueprint/SoftwareDeliveryMachine";
import { HasCloudFoundryManifest } from "../common/listener/support/cloudFoundryManifestPushTest";
import { HasSpringBootApplicationClass, IsMaven } from "../common/listener/support/jvmPushTests";
import { MaterialChangeToJavaRepo } from "../common/listener/support/materialChangeToJavaRepo";
import { NamedSeedRepo } from "../common/listener/support/NamedSeedRepo";
import { IsNode } from "../common/listener/support/nodeGuards";
import { PushFromAtomist, ToDefaultBranch, ToPublicRepo } from "../common/listener/support/pushTests";
import { not } from "../common/listener/support/pushTestUtils";
import { createEphemeralProgressLog } from "../common/log/EphemeralProgressLog";
import { MavenBuilder } from "../handlers/events/delivery/build/local/maven/MavenBuilder";
import { NpmBuilder } from "../handlers/events/delivery/build/local/npm/NpmBuilder";
import { NoGoals } from "../handlers/events/delivery/goals/commonGoals";
import { HttpServiceGoals, LocalDeploymentGoals } from "../handlers/events/delivery/goals/httpServiceGoals";
import { LibraryGoals } from "../handlers/events/delivery/goals/libraryGoals";
import { NpmGoals } from "../handlers/events/delivery/goals/npmGoals";
import { lookFor200OnEndpointRootGet } from "../handlers/events/delivery/verify/common/lookFor200OnEndpointRootGet";
import { DefaultArtifactStore } from "./blueprint/artifactStore";
import { CloudFoundryProductionDeployOnSuccessStatus } from "./blueprint/deploy/cloudFoundryDeploy";
import { LocalExecutableJarDeploy } from "./blueprint/deploy/localSpringBootDeployOnSuccessStatus";
import { suggestAddingCloudFoundryManifest } from "./blueprint/repo/suggestAddingCloudFoundryManifest";
import { addCloudFoundryManifest } from "./commands/editors/pcf/addCloudFoundryManifest";
import { configureSpringSdm } from "./springSdmConfig";

export function cloudFoundrySoftwareDeliveryMachine(opts: { useCheckstyle: boolean }): SoftwareDeliveryMachine {
    const sdm = new SoftwareDeliveryMachine(
        {
            deployers: [
                LocalExecutableJarDeploy,
                CloudFoundryProductionDeployOnSuccessStatus,
            ],
            artifactStore: DefaultArtifactStore,
        },
        whenPushSatisfies(IsMaven, HasSpringBootApplicationClass,
            not(PushFromAtomist), not(MaterialChangeToJavaRepo))
            .setGoals(NoGoals),
        whenPushSatisfies(ToDefaultBranch, IsMaven, HasSpringBootApplicationClass, HasCloudFoundryManifest,
            ToPublicRepo, not(NamedSeedRepo))
            .setGoals(HttpServiceGoals),
        whenPushSatisfies(IsMaven, HasSpringBootApplicationClass, not(PushFromAtomist))
            .setGoals(LocalDeploymentGoals),
        whenPushSatisfies(IsMaven, MaterialChangeToJavaRepo)
            .setGoals(LibraryGoals),
        whenPushSatisfies(IsNode)
            .setGoals(NpmGoals)
            .buildWith(new NpmBuilder(DefaultArtifactStore, createEphemeralProgressLog)),
        onAnyPush.buildWith(new MavenBuilder(DefaultArtifactStore, createEphemeralProgressLog)),
    );

    sdm.addNewRepoWithCodeActions(suggestAddingCloudFoundryManifest)
        .addSupportingCommands(
            () => addCloudFoundryManifest,
        )
        .addEndpointVerificationListeners(lookFor200OnEndpointRootGet());

    configureSpringSdm(sdm, opts);
    return sdm;
}
