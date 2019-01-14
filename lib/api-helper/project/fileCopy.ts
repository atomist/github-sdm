/*
 * Copyright © 2018 Atomist, Inc.
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

import {
    GitCommandGitProject,
    logger,
    Project,
    ProjectOperationCredentials,
    RemoteRepoRef,
    SimpleProjectEditor,
} from "@atomist/automation-client";
import axios from "axios";
import {CodeTransform} from "../../api/registration/CodeTransform";

/**
 * Add the downloaded content to the given project
 * @param {string} url url of the content. Must be publicly accessible
 * @param {string} path
 * @return {SimpleProjectEditor}
 */
export function copyFileFromUrl(url: string, path: string): CodeTransform {
    return async p => {
        const response = await axios.get(url);
        return p.addFile(path, response.data);
    };
}

export interface FileMapping {
    donorPath: string;
    recipientPath: string;
}

export interface FileGlobMapping {
    /**
     * See https://github.com/gulpjs/glob-stream for implementation details
     */
    globPatterns: string[];

    /**
     * This recipientPath will only be prefixed verbatim to any path returned from the globs.
     */
    recipientPath?: string;
}

/**
 * Take the specified files from the donor project
 * @param {RemoteRepoRef} donorProjectId
 * @param {FileMapping[]} fileMappings
 * @param {ProjectOperationCredentials} credentials
 * @return {SimpleProjectEditor}
 */
export function copyFilesFrom(donorProjectId: RemoteRepoRef,
                              fileMappings: Array<FileMapping | string>,
                              credentials: ProjectOperationCredentials): CodeTransform {
    return async (p, i) => {
        const donorProject = await GitCommandGitProject.cloned(credentials, donorProjectId);
        return copyFiles(donorProject, fileMappings)(p, i);
    };
}

export function copyFiles(donorProject: Project,
                          fileMappings: Array<FileMapping | string>): CodeTransform {
    return async p => {
        for (const m of fileMappings) {
            const fm = typeof m === "string" ? {donorPath: m, recipientPath: m} : m;
            const found = await donorProject.getFile(fm.donorPath);
            if (found) {
                await p.addFile(fm.recipientPath, await found.getContent());
            } else {
                logger.warn("Path '%s' not found in donor project %s:%s", fm.donorPath, donorProject.id.owner, donorProject.id.repo);
            }
        }
        return p;
    };
}

/**
 * Take the specified files from the donor project
 * @param {RemoteRepoRef} donorProjectId
 * @param {FileGlobMapping} fileGlobMapping - treated as globs as defined in Project.streamFiles
 * @return {SimpleProjectEditor}
 */
export function streamFilesFrom(donorProjectId: RemoteRepoRef,
                                fileGlobMapping: FileGlobMapping): CodeTransform {
    return async (p, i) => {
        const donorProject = await GitCommandGitProject.cloned(i.credentials, donorProjectId);
        return streamFiles(donorProject, fileGlobMapping)(p, i);
    };
}

export function streamFiles(donorProject: Project,
                            fileGlobMapping: FileGlobMapping): CodeTransform {
    return async p => {
        const fileStream = donorProject.streamFiles(...fileGlobMapping.globPatterns);

        await new Promise((resolve, reject) => {
            fileStream
                .on("end", () => {
                    logger.debug("end of file stream reached, using glob: ", fileGlobMapping);
                    resolve();
                })
                .on("data", donorFile => {
                    const newPath = (fileGlobMapping.recipientPath || "") + donorFile.path;
                    p.addFileSync(newPath, donorFile.getContentSync());
                    logger.log("silly", "file added: ", donorFile.path);
                })
                .on("error", e => {
                    logger.warn("Error copying file: ", e);
                    reject(e);
                });
        });
    };
}
