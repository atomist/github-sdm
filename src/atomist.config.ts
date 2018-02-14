import { Configuration } from "@atomist/automation-client/configuration";
import * as appRoot from "app-root-path";
import { touchEditor } from "./handlers/commands/editors/user/touchEditor";
import { HelloWorld } from "./handlers/commands/HelloWorld";
import { ActOnRepoCreation } from "./handlers/events/repo/ActOnRepoCreation";
import {
    CloudFoundryStagingDeployOnArtifactStatus,
} from "./software-delivery-machine/blueprint/cloudFoundryDeployOnArtifactStatus";
import { DeployToProd } from "./software-delivery-machine/blueprint/DeployToProd";
import { LocalMavenBuildOnSucessStatus } from "./software-delivery-machine/blueprint/LocalMavenBuildOnScanSuccessStatus";
import { NotifyOnDeploy } from "./software-delivery-machine/blueprint/notifyOnDeploy";
import { OfferPromotion } from "./software-delivery-machine/blueprint/offerPromotion";
import { onNewRepoWithCode } from "./software-delivery-machine/blueprint/onFirstPush";
import { PhaseCleanup, PhaseSetup } from "./software-delivery-machine/blueprint/phaseManagement";
import { Scan } from "./software-delivery-machine/blueprint/scanOnPush";
import { VerifyEndpoint } from "./software-delivery-machine/blueprint/verifyEndpoint";
import { addCloudFoundryManifest } from "./software-delivery-machine/commands/editors/addCloudFoundryManifest";
import {affirmationEditor} from "./handlers/commands/editors/user/affirmationEditor";

// tslint:disable-next-line:no-var-requires
const pj = require(`${appRoot.path}/package.json`);

const token = process.env.GITHUB_TOKEN;

export const configuration: Configuration = {
    name: pj.name,
    version: pj.version,
    teamIds: ["T5964N9B7"], // <-- run @atomist pwd in your slack team to obtain the team id
    commands: [
        HelloWorld,
        DeployToProd,
        () => touchEditor,
        () => affirmationEditor,
        () => addCloudFoundryManifest,
    ],
    events: [
        ActOnRepoCreation,
        () => onNewRepoWithCode,
        () => PhaseSetup,
        () => PhaseCleanup,
        () => Scan,
        () => LocalMavenBuildOnSucessStatus,
        () => CloudFoundryStagingDeployOnArtifactStatus,
        () => NotifyOnDeploy,
        () => VerifyEndpoint,
        () => OfferPromotion,
    ],
    token,
    http: {
        enabled: true,
        auth: {
            basic: {
                enabled: false,
            },
            bearer: {
                enabled: false,
            },
        },
    },
};
