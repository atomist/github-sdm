import { logger } from "@atomist/automation-client";
import { PushTest } from "../../../../../common/listener/PhaseCreator";
import { filesChangedSince } from "../../../../../util/git/filesChangedSince";
/**
 * Veto if change to deployment unit doesn't seem important enough to
 * build and deploy
 * @param {PhaseCreationInvocation} pci
 * @return {Promise<void>}
 * @constructor
 */
export const SpringBootRestServiceGuard: PushTest = async pci => {
    const changedFiles = await filesChangedSince(pci.project, pci.push.before.sha);
    console.log(`Changed files are [${changedFiles.join(",")}]`);
    if (changedFiles.some(f => f.endsWith(".java")) ||
        changedFiles.some(f => f.endsWith(".html")) ||
        changedFiles.some(f => f.endsWith(".json")) ||
        changedFiles.some(f => f.endsWith(".yml")) ||
        changedFiles.some(f => f.endsWith(".xml"))
    ) {
        logger.info("Change is material: changed files=[%s]", changedFiles.join(","));
        return true;
    }
    logger.info("Change is immaterial: changed files=[%s]", changedFiles.join(","));
    // await pci.addressChannels(`Sorry. I'm not going to waste electricity on changes to [${changedFiles.join(",")}]`);
    return false;
};
