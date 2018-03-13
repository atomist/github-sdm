import { GitHubReleaseArtifactStore } from "../../common/artifact/github/GitHubReleaseArtifactStore";
import { EphemeralLocalArtifactStore } from "../../common/artifact/local/EphemeralLocalArtifactStore";

export const DefaultArtifactStore = process.env.USE_LOCAL_ARTIFACT_STORE === "true" ?
    new EphemeralLocalArtifactStore() :
    new GitHubReleaseArtifactStore();
