import { GitHubRepoRef } from "@atomist/automation-client/operations/common/GitHubRepoRef";
import axios, { AxiosPromise, AxiosRequestConfig } from "axios";
import { logger } from "@atomist/automation-client";
import ReadStream = NodeJS.ReadStream;

export type State = "error" | "failure" | "pending" | "success";

export interface Status {
    state: State;
    target_url: string;
    description?: string;
    context?: string;
}

export function createStatus(token: string, rr: GitHubRepoRef, status: Status): AxiosPromise {
    const config = authHeaders(token);
    const url = `${rr.apiBase}/repos/${rr.owner}/${rr.repo}/statuses/${rr.sha}`;
    logger.info("Updating github status: $s to %j", url, status);
    return axios.post(url, status, config)
        .catch(err =>
            Promise.reject(new Error(`Error hitting ${url} to set status ${JSON.stringify(status)}: ${err.message}`)),
        );
}

export function listStatuses(token: string, rr: GitHubRepoRef): Promise<Status[]> {
    const config = authHeaders(token);
    const url = `${rr.apiBase}/repos/${rr.owner}/${rr.repo}/commits/${rr.sha}/statuses`;
    return axios.get(url, config)
        .then(ap => ap.data);
}

export interface Tag {
    tag: string;
    message: string;

    /** Commit sha */
    object: string;
    type: string;
    tagger: {
        name: string;
        email: string;
        date: string;
    };
}

export function createTag(token: string, rr: GitHubRepoRef, tag: Tag): AxiosPromise {
    const config = authHeaders(token);
    const url = `${rr.apiBase}/repos/${rr.owner}/${rr.repo}/git/tags`;
    logger.info("Updating github tag: %s to %j", url, tag);
    return axios.post(url, status, config)
        .catch(err =>
            Promise.reject(new Error(`Error hitting ${url} to set tag ${JSON.stringify(status)}: ${err.message}`)),
        );
}

export interface Release {
    tag_name: string;
    target_commitish?: string;
    name?: string;
    body?: string;
    draft?: boolean;
    prerelease?: boolean;
}

export function createRelease(token: string, rr: GitHubRepoRef, release: Release): AxiosPromise {
    const config = authHeaders(token);
    const url = `${rr.apiBase}/repos/${rr.owner}/${rr.repo}/releases`;
    logger.info("Updating github release: %s to %j", url, release);
    return axios.post(url, release, config)
        .catch(err =>
            Promise.reject(new Error(`Error hitting ${url} to set release ${JSON.stringify(release)}: ${err.message}`)),
        );
}

export function uploadReleaseAsset(token: string, rr: GitHubRepoRef, releaseId: string, name: string, readSteam: ReadStream): AxiosPromise {
    const config = authHeaders(token);
    const url = `${rr.apiBase}/repos/${rr.owner}/${rr.repo}/releases/${releaseId}/assets?name=${name}`;
    logger.info("Updating github release asset: %s named %s to release %s", url, name, releaseId);
    return axios.post(url, readSteam, config)
        .catch(err =>
            Promise.reject(new Error(`Error hitting ${url} to set status ${JSON.stringify(status)}: ${err.message}`)),
        );
}

export interface GitHubCommitsBetween {
    commits: Array<{
        sha: string;
        author: { login: string };
        commit: { message: string };
    }>;
}

export function listCommitsBetween(token: string, rr: GitHubRepoRef, startSha: string, end: string): Promise<GitHubCommitsBetween> {
    const config = authHeaders(token);
    const url = `${rr.apiBase}/repos/${rr.owner}/${rr.repo}/compare/${startSha}...${end}`;
    return axios.get(url, config)
        .then(ap => ap.data);
}

function authHeaders(token: string): AxiosRequestConfig {
    return token ? {
            headers: {
                Authorization: `token ${token}`,
            },
        }
        : {};
}

export function tipOfDefaultBranch(token: string, rr: GitHubRepoRef): Promise<string> {
    // TODO: use real default branch
    const defaultBranch = "master";
    const config = authHeaders(token);
    const url = `${rr.apiBase}/repos/${rr.owner}/${rr.repo}/branches/master`;
    return axios.get(url, config)
        .then(ap => ap.data.commit.sha);
}
