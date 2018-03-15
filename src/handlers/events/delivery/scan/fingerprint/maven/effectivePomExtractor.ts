/*
 * Copyright © 2018 Atomist, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { runCommand } from "@atomist/automation-client/action/cli/commandLine";
import { LocalProject } from "@atomist/automation-client/project/local/LocalProject";
import { promisify } from "util";
import * as xml2js from "xml2js";

const XmlFile = "effective-pom.xml";

export async function extractEffectivePom(p: LocalProject): Promise<any> {
    try {
        await runCommand(`mvn help:effective-pom -Doutput=${XmlFile}`, {cwd: p.baseDir});
        const f = await p.findFile(XmlFile);
        const xml = await f.getContent();
        const parser = new xml2js.Parser();
        const parsed = await promisify(parser.parseString)(xml);
        return parsed;
    } catch (err) {
        throw err;
    }
}
