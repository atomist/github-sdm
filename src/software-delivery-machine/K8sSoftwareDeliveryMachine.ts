import { PromotedEnvironment } from "../blueprint/ReferenceDeliveryBlueprint";
import { SoftwareDeliveryMachine } from "../blueprint/SoftwareDeliveryMachine";
import { K8sSpecTestPushTest } from "../common/listener/support/k8sSpecPushTest";
import { PushesToDefaultBranch, PushToPublicRepo } from "../common/listener/support/pushTests";
import { K8sBuildOnSuccessStatus } from "./blueprint/build/K8sBuildOnScanSuccess";
import { DeployToProd } from "./blueprint/deploy/deployToProd";
import { K8sStagingDeployOnSuccessStatus, K8sProductionDeployOnFingerprint, NoticeK8sStagingDeployCompletion, NoticeK8sProductionDeployCompletion } from "./blueprint/deploy/k8sDeploy";
import { offerPromotionCommand } from "./blueprint/deploy/offerPromotion";
import { JavaLibraryPhaseCreator, SpringBootDeployPhaseCreator } from "./blueprint/phase/jvmPhaseManagement";
import { NodePhaseCreator } from "./blueprint/phase/nodePhaseManagement";
import { suggestAddingK8sSpec } from "./blueprint/repo/suggestAddingK8sSpec";
import { addK8sSpec } from "./commands/editors/k8s/addK8sSpec";
import { configureSpringSdm } from "./springSdmConfig";

const promotedEnvironment: PromotedEnvironment = {

    name: "production",

    offerPromotionCommand,

    promote: DeployToProd,

    deploy: K8sProductionDeployOnFingerprint,
};

export function K8sSoftwareDeliveryMachine(opts: { useCheckstyle: boolean }): SoftwareDeliveryMachine {
    const sdm = new SoftwareDeliveryMachine(
        {
            builder: K8sBuildOnSuccessStatus,
            deploy1: K8sStagingDeployOnSuccessStatus,
        },
        new SpringBootDeployPhaseCreator(PushesToDefaultBranch, K8sSpecTestPushTest, PushToPublicRepo),
        new NodePhaseCreator(),
        new JavaLibraryPhaseCreator());
    sdm.addPromotedEnvironment(promotedEnvironment);
    sdm.addNewRepoWithCodeActions(suggestAddingK8sSpec);
    sdm.addSupportingCommands(
        () => addK8sSpec,
    );
    sdm.addSupportingEvents(() => NoticeK8sStagingDeployCompletion, () => NoticeK8sProductionDeployCompletion);
    configureSpringSdm(sdm, opts);
    return sdm;
}
