/*
 * Copyright © 2020 Atomist, Inc.
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

import { Configuration } from "@atomist/automation-client/lib/configuration";
import { ProjectOperationCredentials } from "@atomist/automation-client/lib/operations/common/ProjectOperationCredentials";
import {
    isRemoteRepoRef,
    RemoteRepoRef,
} from "@atomist/automation-client/lib/operations/common/RepoId";
import { GitCommandGitProject } from "@atomist/automation-client/lib/project/git/GitCommandGitProject";
import { QueryNoCacheOptions } from "@atomist/automation-client/lib/spi/graph/GraphClient";
import { logger } from "@atomist/automation-client/lib/util/logger";
import * as stringify from "json-stringify-safe";
import * as _ from "lodash";
import {
    GitHubAppInstallationByOwner,
    ProviderType,
    RepoScmProvider,
    ScmProviders,
} from "../../../typings/types";
import {
    KubernetesSyncOptions,
    SyncRepoRef,
} from "../config";
import { defaultCloneOptions } from "./clone";

export interface RepoCredentials {
    credentials: ProjectOperationCredentials;
    repo: RemoteRepoRef;
}

const defaultDefaultBranch = "master";

/**
 * If called and no sync repo is provided in the SDM configuration, a
 * warning is emitted and `undefined` is returned.
 *
 * If the SDM configuration contains a RemoteRepoRef as the value of
 * the `sdm.configuration.sdm.k8s.options.sync.repo` option and truthy
 * credentials, those are returned.
 *
 * Otherwise, the code cycles through all workspaces, querying cortex
 * for the information it needs.  If the value of the `sync.repo`
 * option is a [[SyncRepoRef]], each workspace is queried for a repo
 * matching the provided sync repo.  If none is found, it cycles
 * through all the workspaces again querying for all SCM providers and
 * try to clone the repo with the provided credentials or, if no
 * credentials are provided, the SCM provider credentials from cortex.
 * Once a repo is found using either method, an object is returned
 * with its remote repo ref and the credentials able to clone it.  In
 * addition, the `sdm` passed in will have its
 * `sdm.configuration.sdm.k8s.options.sync.repo`
 * and`sdm.configuration.sdm.k8s.options.sync.credentials` updated
 * with the objects appropriate objects.
 *
 * @param sdm this SDM object (modified if repo credentials found)
 * @param repoRef repository to look for
 * @return true if sync options set and repo found or false and sync options deleted
 */
export async function queryForScmProvider(configuration: Configuration): Promise<boolean> {
    const syncOptions: KubernetesSyncOptions = configuration.sdm?.k8s?.options?.sync;
    if (!syncOptions) {
        logger.debug(`SDM configuration contains no sync repo`);
        return false;
    }
    const repoRef = syncOptions.repo;
    if (!repoRef || !repoRef.owner || !repoRef.repo) {
        logger.error(`Provided sync repo does not contain all required properties: ${stringify(repoRef)}`);
        return false;
    }

    const repoProvided = isRemoteRepo(repoRef);
    const credsProvided = !!syncOptions.credentials;
    if (repoProvided && credsProvided) {
        logger.info(`Using provided remote repo ref and credentials for sync repo`);
        return true;
    }

    const repoCreds = await queryRepo(configuration) || await queryScm(configuration);
    if (repoCreds) {
        if (!repoProvided) {
            configuration.sdm.k8s.options.sync.repo = repoCreds.repo;
        }
        if (!credsProvided) {
            configuration.sdm.k8s.options.sync.credentials = repoCreds.credentials;
        }
        return true;
    }
    logger.warn(`Failed to find sync repo: ${stringify(repoRef)}`);
    return false;
}

/**
 * See if provided sync repo is a RemoteRepoRef.
 */
export function isRemoteRepo(repo: SyncRepoRef | RemoteRepoRef): repo is RemoteRepoRef {
    return !!repo && isRemoteRepoRef(repo as RemoteRepoRef);
}

/**
 * Query cortex across all available workspaces for repo.
 */
async function queryRepo(configuration: Configuration): Promise<RepoCredentials | undefined> {
    const repoRef = syncRepoRef(configuration);
    const slug = repoSlug(repoRef);
    const repoProviderId = (repoRef as SyncRepoRef).providerId;
    for (const workspaceId of configuration.workspaceIds) {
        const graphClient = configuration.graphql.client.factory.create(workspaceId, configuration);
        logger.debug(`Querying workspace ${workspaceId} for repo ${slug}`);
        const repos = await graphClient.query<RepoScmProvider.Query, RepoScmProvider.Variables>({
            name: "RepoScmProvider",
            variables: { repo: repoRef.repo, owner: repoRef.owner },
            options: QueryNoCacheOptions,
        });
        if (!repos || !repos.Repo || repos.Repo.length < 1) {
            logger.debug(`Repo ${slug} not found in workspace ${workspaceId}`);
            continue;
        }
        let searchRepos = repos.Repo;
        if (repoProviderId) {
            logger.debug(`Filtering repos from workspace ${workspaceId} on providerId '${repoProviderId}'`);
            searchRepos = searchRepos.filter(r => r.org.scmProvider.providerId === repoProviderId);
        }
        if (searchRepos.length > 1) {
            logger.warn(`More than one repo found in workspace ${workspaceId} with owner/repo ${slug}`);
        }
        for (const repo of searchRepos) {
            const rc = await repoCredentials(configuration, repo, workspaceId);
            if (rc) {
                rc.repo.branch = rc.repo.branch || repo.defaultBranch || defaultDefaultBranch;
                logger.info(`Returning first ${slug} repo with valid SCM provider`);
                return rc;
            }
        }
    }
    return undefined;
}

/**
 * For each SDM provider in cortex in each workspace, try to clone the
 * sync repo.  Return the information for the first successful clone.
 */
async function queryScm(configuration: Configuration): Promise<RepoCredentials | undefined> {
    const repoRef = syncRepoRef(configuration);
    const slug = repoSlug(repoRef);
    const repoProviderId = (repoRef as SyncRepoRef).providerId;
    for (const workspaceId of configuration.workspaceIds) {
        const graphClient = configuration.graphql.client.factory.create(workspaceId, configuration);
        logger.debug(`Querying workspace ${workspaceId} for SCM providers`);
        const providers = await graphClient.query<ScmProviders.Query, ScmProviders.Variables>({
            name: "ScmProviders",
            options: QueryNoCacheOptions,
        });
        if (!providers || !providers.SCMProvider || providers.SCMProvider.length < 1) {
            logger.debug(`Found no SCM providers in workspace ${workspaceId}`);
            continue;
        }
        for (const provider of providers.SCMProvider) {
            if (repoProviderId && provider.providerId !== repoProviderId) {
                logger.debug(`SCM provider '${provider.providerId}' does not match '${repoProviderId}'`);
                continue;
            }
            const rc = await scmCredentials(configuration, provider, workspaceId);
            if (rc) {
                logger.debug(`Attempting to clone ${slug} using ${rc.repo.cloneUrl}`);
                try {
                    const p = await GitCommandGitProject.cloned(rc.credentials, rc.repo, defaultCloneOptions);
                    if (p) {
                        rc.repo.branch = rc.repo.branch || p.branch || defaultDefaultBranch;
                        return rc;
                    }
                } catch (e) {
                    logger.debug(`Failed to clone ${slug} from ${rc.repo.cloneUrl}: ${e.message}`);
                }
            }
        }
    }
    return undefined;
}

/**
 * Create RemoteRepoRef and Credentials object from SDM and repo from
 * cortex.  If the provided repo does not contain an org with a
 * provider, it returns `undefined`.  Otherwise it uses the SCM
 * provider to call [[scmCredentials]] and return its value.
 */
export async function repoCredentials(configuration: Configuration,
                                      repo: RepoScmProvider.Repo,
                                      workspaceId: string): Promise<RepoCredentials | undefined> {
    if (repo.org && repo.org.scmProvider) {
        return scmCredentials(configuration, repo.org.scmProvider, workspaceId);
    }
    return undefined;
}

/**
 * Given the SDM and an SCM, use the configured repo ref resolver to
 * create a RemoteRepoRef.  Use the SDM Kubernetes option sync
 * credentials or SCM `credential.secret` to create the credentials,
 * giving the SDM sync credentials preference.  Return `undefined` if
 * there is not enough information to created the repo credential
 * object.
 */
export async function scmCredentials(configuration: Configuration,
                                     scm: ScmProviders.ScmProvider,
                                     workspaceId: string): Promise<RepoCredentials | undefined> {
    const repoRef = syncRepoRef(configuration);
    const credentials = configuration.sdm?.k8s?.options?.sync?.credentials;
    let secret = scm?.credential?.secret;
    if (!credentials && !secret && scm.providerType === ProviderType.github_com) {
        const graphClient = configuration.graphql.client.factory.create(workspaceId, configuration);
        const app = await graphClient.query<GitHubAppInstallationByOwner.Query, GitHubAppInstallationByOwner.Variables>({
            name: "GitHubAppInstallationByOwner",
            variables: {
                name: repoRef.owner,
            },
        });
        secret = _.get(app, "GitHubAppInstallation[0].token.secret");
    }
    if (repoRef && repoRef.owner && repoRef.repo && scm.apiUrl && (credentials || secret)) {
        const repoResolver = configuration.sdm.repoRefResolver;
        const repoFrag = {
            owner: repoRef.owner,
            name: repoRef.repo,
            org: {
                owner: repoRef.owner,
                provider: {
                    providerId: scm.providerId,
                    providerType: scm.providerType,
                    apiUrl: scm.apiUrl,
                    url: scm.url,
                },
            },
        };
        const options = {
            branch: repoRef.branch,
        };
        try {
            const repo = repoResolver.toRemoteRepoRef(repoFrag, options);
            return {
                credentials: credentials || { token: secret },
                repo,
            };
        } catch (e) {
            logger.warn(`Failed to resolve remote repo ref for ${repoFrag.owner}/${repoFrag.name}: ${e.message}`);
        }
    }
    return undefined;
}

/** Create repo slug string. */
export function repoSlug(repo: SyncRepoRef | RemoteRepoRef): string {
    return `${repo.owner}/${repo.repo}`;
}

/**
 * Extract the Kubernetes option sync repo from the SDM configuration.
 * This function should only be called if the sync repo object is
 * defined.
 */
function syncRepoRef(configuration: Configuration): SyncRepoRef | RemoteRepoRef {
    const repo: SyncRepoRef | RemoteRepoRef = configuration.sdm?.k8s?.options?.sync?.repo;
    if (!repo) {
        throw new Error(`Failed to get sync repo from SDM configuration`);
    }
    return repo;
}
