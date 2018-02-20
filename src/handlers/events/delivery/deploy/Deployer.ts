import { RemoteRepoRef } from "@atomist/automation-client/operations/common/RepoId";
import { DeployableArtifact } from "../ArtifactStore";
import { QueryableProgressLog } from "../log/ProgressLog";
import { Deployment, TargetInfo } from "./Deployment";

export interface InterpretedLog {
    relevantPart: string;
    message: string;
    includeFullLog?: boolean
}

export interface Deployer<T extends TargetInfo = TargetInfo> {

    /**
     * Implemented by deployers that don't sit on an infrastructure like Cloud Foundry
     * or Kubernetes that handles rolling update
     * @return {Promise<any>}
     */
    undeploy?(id: RemoteRepoRef): Promise<any>;

    deploy(ai: DeployableArtifact, ti: T, log: QueryableProgressLog): Promise<Deployment>;

    errorParser?: (log: string) => InterpretedLog | undefined

}
