import { Configuration } from "@atomist/automation-client/configuration";
import * as appRoot from "app-root-path";
import { ComposedFunctionalUnit } from "./blueprint/ComposedFunctionalUnit";
import { HelloWorld } from "./handlers/commands/HelloWorld";
import { applyHttpServiceGoals } from "./software-delivery-machine/blueprint/goal/jvmGoalManagement";
import { cloudFoundrySoftwareDeliveryMachine } from "./software-delivery-machine/cloudFoundrySoftwareDeliveryMachine";
import { affirmationEditor } from "./software-delivery-machine/commands/editors/affirmationEditor";
import { breakBuildEditor, unbreakBuildEditor } from "./software-delivery-machine/commands/editors/breakBuild";
import {
    javaAffirmationEditor,
    javaBranchAffirmationEditor,
} from "./software-delivery-machine/commands/editors/javaAffirmationEditor";
import { k8sSoftwareDeliveryMachine } from "./software-delivery-machine/k8sSoftwareDeliveryMachine";

// tslint:disable-next-line:no-var-requires
const pj = require(`${appRoot.path}/package.json`);

const token = process.env.GITHUB_TOKEN;

const assembled = new ComposedFunctionalUnit(
       cloudFoundrySoftwareDeliveryMachine({useCheckstyle: process.env.USE_CHECKSTYLE === "true"}),
      // k8sSoftwareDeliveryMachine({useCheckstyle: process.env.USE_CHECKSTYLE === "true"}),
);

export const configuration: Configuration = {
    name: pj.name,
    version: pj.version,
    teamIds: [
         process.env.ATOMIST_WORKSPACE,
    ], // <-- run @atomist pwd in your slack team to obtain the team id, then set your env variable
    commands: assembled.commandHandlers.concat([
        HelloWorld,
        () => affirmationEditor,
        () => applyHttpServiceGoals,
        () => breakBuildEditor,
        () => unbreakBuildEditor,
        () => javaAffirmationEditor,
        () => javaBranchAffirmationEditor,
    ]),
    events: assembled.eventHandlers.concat([]),
    token,
    http: {
        enabled: false,
    },
    applicationEvents: {
        enabled: true,
    },
};
