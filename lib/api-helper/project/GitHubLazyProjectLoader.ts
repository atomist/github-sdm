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

import { configurationValue } from "@atomist/automation-client/lib/configuration";
import { decode } from "@atomist/automation-client/lib/internal/util/base64";
import {
    GitHubRepoRef,
    isGitHubRepoRef,
} from "@atomist/automation-client/lib/operations/common/GitHubRepoRef";
import { TokenCredentials } from "@atomist/automation-client/lib/operations/common/ProjectOperationCredentials";
import { RemoteRepoRef } from "@atomist/automation-client/lib/operations/common/RepoId";
import { File } from "@atomist/automation-client/lib/project/File";
import {
    GitProject,
    GitPushOptions,
} from "@atomist/automation-client/lib/project/git/GitProject";
import { GitStatus } from "@atomist/automation-client/lib/project/git/gitStatus";
import { ReleaseFunction } from "@atomist/automation-client/lib/project/local/LocalProject";
import { NodeFsLocalFile } from "@atomist/automation-client/lib/project/local/NodeFsLocalFile";
import { InMemoryFile } from "@atomist/automation-client/lib/project/mem/InMemoryFile";
import { FileStream } from "@atomist/automation-client/lib/project/Project";
import { AbstractProject } from "@atomist/automation-client/lib/project/support/AbstractProject";
import {
    defaultHttpClientFactory,
    HttpClientFactory,
    HttpMethod,
    HttpResponse,
} from "@atomist/automation-client/lib/spi/http/httpClient";
import { logger } from "@atomist/automation-client/lib/util/logger";
import * as fg from "fast-glob";
import * as stream from "stream";
import {
    LazyProject,
    LazyProjectLoader,
    WithLoadedLazyProject,
} from "../../spi/project/LazyProjectLoader";
import {
    ProjectLoader,
    ProjectLoadingParameters,
} from "../../spi/project/ProjectLoader";
import { save } from "./CachingProjectLoader";

/**
 * Create a lazy view of the given project GitHub, which will materialize
 * the remote project (usually by cloning) only if needed.
 */
export class GitHubLazyProjectLoader implements LazyProjectLoader {

    constructor(private readonly delegate: ProjectLoader) {
    }

    public doWithProject<T>(params: ProjectLoadingParameters, action: WithLoadedLazyProject<T>): Promise<T> {
        const lazyProject = new GitHubLazyProject(params.id, this.delegate, params);
        return action(lazyProject);
    }

    get isLazy(): true {
        return true;
    }
}

/**
 * Lazy project that loads remote GitHub project and forwards to it only if necessary.
 */
class GitHubLazyProject extends AbstractProject implements GitProject, LazyProject {

    private projectPromise: QueryablePromise<GitProject>;

    constructor(id: RemoteRepoRef, private readonly delegate: ProjectLoader, private readonly params: ProjectLoadingParameters) {
        super(id);
    }

    public materializing(): boolean {
        return !!this.projectPromise;
    }

    public materialized(): boolean {
        return !!this.projectPromise && !!this.projectPromise.result();
    }

    public materialize(): Promise<GitProject> {
        this.materializeIfNecessary("materialize");
        return this.projectPromise.then(mp => mp.gitStatus()) as any;
    }

    get provenance(): string {
        return this.materialized() ? this.projectPromise.result().provenance : "unavailable";
    }

    public release: ReleaseFunction = () => Promise.resolve();

    get baseDir(): string {
        if (!this.materialized()) {
            throw new Error("baseDir not supported until materialized");
        }
        return this.projectPromise.result().baseDir;
    }

    public branch: string = this.id.branch;
    public newRepo: boolean = false;
    public remote: string = (this.id as RemoteRepoRef).url;

    public addDirectory(path: string): Promise<this> {
        this.materializeIfNecessary(`addDirectory${path}`);
        return this.projectPromise.then(mp => mp.addDirectory(path)) as any;
    }

    public hasDirectory(path: string): Promise<boolean> {
        this.materializeIfNecessary(`hasDirectory${path}`);
        return this.projectPromise.then(mp => mp.hasDirectory(path));
    }

    public addFile(path: string, content: string): Promise<this> {
        this.materializeIfNecessary(`addFile(${path})`);
        return this.projectPromise.then(mp => mp.addFile(path, content)) as any;
    }

    public addFileSync(path: string, content: string): void {
        throw new Error("sync methods not supported");
    }

    public deleteDirectory(path: string): Promise<this> {
        this.materializeIfNecessary(`deleteDirectory(${path})`);
        return this.projectPromise.then(mp => mp.deleteDirectory(path)) as any;
    }

    public deleteDirectorySync(path: string): void {
        throw new Error("sync methods not supported");
    }

    public deleteFile(path: string): Promise<this> {
        this.materializeIfNecessary(`deleteFile(${path})`);
        return this.projectPromise.then(mp => mp.deleteFile(path)) as any;
    }

    public deleteFileSync(path: string): void {
        throw new Error("sync methods not supported");
    }

    public directoryExistsSync(path: string): boolean {
        throw new Error("sync methods not supported");
    }

    public fileExistsSync(path: string): boolean {
        throw new Error("sync methods not supported");
    }

    public async findFile(path: string): Promise<File> {
        const file = await this.getFile(path);
        if (!file) {
            throw new Error(`No file found: '${path}'`);
        }
        return file;
    }

    public findFileSync(path: string): File {
        throw new Error("sync methods not supported");
    }

    public async getFile(path: string): Promise<File | undefined> {
        if (this.materializing()) {
            return this.projectPromise.then(mp => mp.getFile(path)) as any;
        }
        if (isGitHubRepoRef(this.id)) {
            const content = await fileContent(
                (this.params.credentials as TokenCredentials).token,
                this.id,
                path);
            return !!content ? new InMemoryFile(path, content) : undefined;
        }
        this.materializeIfNecessary(`getFile(${path})`);
        return this.projectPromise.then(mp => mp.getFile(path)) as any;
    }

    public makeExecutable(path: string): Promise<this> {
        this.materializeIfNecessary(`makeExecutable(${path})`);
        return this.projectPromise.then(mp => mp.makeExecutable(path)) as any;
    }

    public makeExecutableSync(path: string): void {
        throw new Error("sync methods not supported");
    }

    public streamFilesRaw(globPatterns: string[], opts: {}): FileStream {
        const resultStream = new stream.Transform({ objectMode: true });
        resultStream._transform = function(this: stream.Transform, chunk: any, encoding: string, done: stream.TransformCallback): void {
            this.push(chunk);
            done();
        };
        this.materializeIfNecessary(`streamFilesRaw`)
            .then(async () => {
                const underlyingStream = await this.projectPromise.then(mp => mp.streamFilesRaw(globPatterns, opts)) as any;
                // tslint:disable-next-line:no-floating-promises
                underlyingStream.pipe(resultStream);
            });
        return resultStream;
    }

    public checkout(sha: string): Promise<this> {
        this.materializeIfNecessary(`checkout(${sha})`);
        return this.projectPromise.then(mp => mp.checkout(sha)) as any;
    }

    public commit(message: string): Promise<this> {
        this.materializeIfNecessary(`commit(${message})`);
        return this.projectPromise.then(mp => mp.commit(message)) as any;
    }

    public configureFromRemote(): Promise<this> {
        this.materializeIfNecessary("configureFromRemote");
        return this.projectPromise.then(mp => mp.configureFromRemote()) as any;
    }

    public createAndSetRemote(gid: RemoteRepoRef, description: string, visibility: "private" | "public"): Promise<this> {
        this.materializeIfNecessary("createAndSetRemote");
        return this.projectPromise.then(mp => mp.createAndSetRemote(gid, description, visibility)) as any;
    }

    public createBranch(name: string): Promise<this> {
        this.materializeIfNecessary(`createBranch(${name})`);
        return this.projectPromise.then(mp => mp.createBranch(name)) as any;
    }

    public gitStatus(): Promise<GitStatus> {
        this.materializeIfNecessary("gitStatus");
        return this.projectPromise.then(mp => mp.gitStatus());
    }

    public hasBranch(name: string): Promise<boolean> {
        this.materializeIfNecessary(`hasBranch(${name})`);
        return this.projectPromise.then(mp => mp.hasBranch(name));
    }

    public init(): Promise<this> {
        this.materializeIfNecessary("init");
        return this.projectPromise.then(mp => mp.init()) as any;
    }

    public isClean(): Promise<boolean> {
        this.materializeIfNecessary("isClean");
        return this.projectPromise.then(mp => mp.isClean()) as any;
    }

    public push(options?: GitPushOptions): Promise<this> {
        this.materializeIfNecessary("push");
        return this.projectPromise.then(mp => mp.push(options)) as any;
    }

    public raisePullRequest(title: string, body: string, targetBranch?: string): Promise<this> {
        this.materializeIfNecessary("raisePullRequest");
        return this.projectPromise.then(mp => mp.raisePullRequest(title, body, targetBranch)) as any;
    }

    public revert(): Promise<this> {
        this.materializeIfNecessary("revert");
        return this.projectPromise.then(mp => mp.revert()) as any;
    }

    public setRemote(remote: string): Promise<this> {
        this.materializeIfNecessary("setRemote");
        return this.projectPromise.then(mp => mp.setRemote(remote)) as any;
    }

    public setUserConfig(user: string, email: string): Promise<this> {
        this.materializeIfNecessary("setUserConfig");
        return this.projectPromise.then(mp => mp.setUserConfig(user, email)) as any;
    }

    protected async getFilesInternal(globPatterns: string[]): Promise<File[]> {
        await this.materializeIfNecessary("getFilesInternal");

        const optsToUse = {
            cwd: this.baseDir,
            dot: true,
            onlyFiles: true,
        };
        const paths = await fg(globPatterns, optsToUse);
        const files = paths.map(path => new NodeFsLocalFile(this.baseDir, path));
        return files;
    }

    private materializeIfNecessary(why: string): QueryablePromise<GitProject> {
        if (!this.materializing()) {
            logger.debug("Materializing project %j because of %s", this.id, why);
            this.projectPromise = makeQueryablePromise(save(this.delegate, this.params));
        }
        return this.projectPromise;
    }
}

interface QueryablePromise<T> extends Promise<T> {

    isResolved(): boolean;

    isFulfilled(): boolean;

    isRejected(): boolean;

    result(): T;
}

/**
 * Based on https://ourcodeworld.com/articles/read/317/how-to-check-if-a-javascript-promise-has-been-fulfilled-rejected-or-resolved
 * This function allow you to modify a JS Promise by adding some status properties.
 * Based on: http://stackoverflow.com/questions/21485545/is-there-a-way-to-tell-if-an-es6-promise-is-fulfilled-rejected-resolved
 * But modified according to the specs of promises : https://promisesaplus.com/
 */
function makeQueryablePromise<T>(ppromise: Promise<T>): QueryablePromise<T> {
    const promise = ppromise as any;
    // Don't modify any promise that has been already modified.
    if (promise.isResolved) {
        return promise;
    }

    // Set initial state
    let isPending = true;
    let isRejected = false;
    let isFulfilled = false;
    let result: T;

    // Observe the promise, saving the fulfillment in a closure scope.
    const qp = promise.then(
        v => {
            isFulfilled = true;
            isPending = false;
            result = v;
            return v;
        },
        e => {
            isRejected = true;
            isPending = false;
            throw e;
        },
    );

    qp.isFulfilled = () => {
        return isFulfilled;
    };
    qp.isPending = () => {
        return isPending;
    };
    qp.isRejected = () => {
        return isRejected;
    };
    qp.result = () => {
        return result;
    };
    return qp;
}

export async function fileContent(token: string, rr: GitHubRepoRef, path: string): Promise<string | undefined> {
    try {
        const result = await filePromise(token, rr, path);
        return decode(result.body.content);
    } catch (e) {
        logger.debug(`File at '${path}' not available`);
        return undefined;
    }
}

async function filePromise(token: string, rr: GitHubRepoRef, path: string): Promise<HttpResponse<{ content: string }>> {
    const url = `${rr.scheme}${rr.apiBase}/repos/${rr.owner}/${rr.repo}/contents/${path}?ref=${rr.branch || "master"}`;
    logger.debug(`Requesting file from GitHub at '${url}'`);
    const httpClient = configurationValue<HttpClientFactory>("http.client.factory", defaultHttpClientFactory());
    return httpClient.create(url).exchange<{ content: string }>(url, {
        method: HttpMethod.Get,
        headers: {
            Authorization: `token ${token}`,
        },
        retry: {
            retries: 0,
        },
    });
}
