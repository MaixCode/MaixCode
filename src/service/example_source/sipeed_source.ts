import axios from "axios";
import * as fs from "fs";
import * as path from "path";
import * as yaml from "yamljs";
import JSZip from "jszip";
import { ExampleSource } from "./types";
import { log, warn } from "../../logger";
import { extractZipTo, emptyDir } from "./fs_util";

const DEFAULT_BASE = "https://cdn.sipeed.com/maixvision/examples";

export class SipeedCdnExampleSource implements ExampleSource {
  readonly type = "sipeed" as const;

  constructor(
    public readonly id: string,
    public readonly label: string,
    public readonly rootDir: string,
    private readonly baseUrl: string = DEFAULT_BASE
  ) {}

  async refresh(progress?: (msg: string) => void): Promise<void> {
    progress?.(`Fetching ${this.label} index...`);
    log(`[ExampleSource:${this.id}] refresh from ${this.baseUrl}`);
    const response = await axios.get(`${this.baseUrl}/latest.yml`, {
      timeout: 30000,
    });
    const parsedYaml = yaml.parse(response.data);
    const version = parsedYaml.version;
    if (!version) {
      throw new Error("sipeed latest.yml missing version");
    }
    const zipUrl = `${this.baseUrl}/${version}.zip`;
    progress?.(`Downloading ${this.label} ${version}...`);
    log(`[ExampleSource:${this.id}] download ${zipUrl}`);
    const zipResponse = await axios.get(zipUrl, {
      responseType: "arraybuffer",
      timeout: 120000,
    });
    const zip = await new JSZip().loadAsync(zipResponse.data);
    await emptyDir(this.rootDir);
    fs.mkdirSync(this.rootDir, { recursive: true });
    progress?.(`Extracting ${this.label}...`);
    await extractZipTo(zip, this.rootDir);
    // If zip has a single top-level folder, flatten optional? keep as-is for fidelity
    log(`[ExampleSource:${this.id}] refresh done -> ${this.rootDir}`);
  }
}
