import {
    BaseContext, GitHubStatusContext, IndependentOfEnvironment, ProductionEnvironment,
    splitContext, StagingEnvironment,
} from "../../../../common/phases/gitHubContext";
import { Phases, PlannedPhase } from "../../../../common/phases/Phases";


export const ScanPhase = new PlannedPhase({environment: IndependentOfEnvironment, orderedName: "1-scan"});
export const BuildPhase = new PlannedPhase({environment: IndependentOfEnvironment, orderedName: "2-build"});
export const ArtifactPhase = new PlannedPhase({
    environment: IndependentOfEnvironment,
    orderedName: "2.5-artifact",
    displayName: "find artifact"
});
export const StagingDeploymentPhase = new PlannedPhase({
    environment: StagingEnvironment,
    orderedName: "3-deploy", displayName: "deploy to Test"
});
export const StagingEndpointPhase = new PlannedPhase({
    environment: StagingEnvironment,
    orderedName: "4-endpoint", displayName: "locate service endpoint in Test"
});
export const StagingVerifiedPhase = new PlannedPhase({
    environment: StagingEnvironment,
    orderedName: "5-verifyEndpoint", displayName: "verify Test deployment"
});
export const ProductionDeploymentPhase = new PlannedPhase({
    environment: ProductionEnvironment,
    orderedName: "3-prod-deploy",
    displayName: "deploy to Prod"
});
export const ProductionEndpointPhase = new PlannedPhase({
    environment: ProductionEnvironment,
    orderedName: "4-endpoint",
    displayName: "locate service endpoint in Prod"
});

const AllKnownPhases = [
    ScanPhase,
    BuildPhase,
    ArtifactPhase,
    StagingDeploymentPhase,
    StagingEndpointPhase,
    StagingVerifiedPhase,
    ProductionDeploymentPhase,
    ProductionEndpointPhase,
];

export const StagingDeploymentContext = StagingDeploymentPhase.context;
export const StagingEndpointContext = StagingEndpointPhase.context;
export const StagingVerifiedContext = StagingVerifiedPhase.context;
export const ProductionDeploymentContext = ProductionDeploymentPhase.context;
export const ProductionEndpointContext = ProductionEndpointPhase.context;
export const ScanContext = ScanPhase.context;
export const BuildContext = BuildPhase.context;
export const ArtifactContext = ArtifactPhase.context;

export const ProductionMauve = "#cf5097";

export const ContextToPlannedPhase: { [key: string]: PlannedPhase } = {};
AllKnownPhases.forEach(p => ContextToPlannedPhase[p.context] = p);
ContextToPlannedPhase[StagingDeploymentContext] = {
    context: StagingDeploymentContext,
    name: "deploy to Test space",
};

export function contextToPlannedPhase(ghsc: GitHubStatusContext): PlannedPhase {
    return ContextToPlannedPhase[ghsc] ||
        defaultPhaseDefinition(ghsc);
}

function defaultPhaseDefinition(ghsc: GitHubStatusContext): PlannedPhase {
    const interpreted = splitContext(ghsc);
    return {
        context: ghsc,
        name: interpreted.name,
    };
}

/**
 * Phases for an Http service
 * @type {Phases}
 */
export const HttpServicePhases = new Phases([
    ScanContext,
    BuildContext,
    ArtifactContext,
    StagingDeploymentContext,
    StagingEndpointContext,
    StagingVerifiedContext,
    ProductionDeploymentContext,
    ProductionEndpointContext]);
