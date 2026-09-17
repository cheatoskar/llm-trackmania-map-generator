import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class GbxBridge {
  private projectRoot: string;
  private cliDir: string;
  private dotnetPath: string;

  constructor(projectRoot?: string) {
    this.projectRoot = projectRoot || path.resolve(__dirname, '..');
    this.cliDir = path.join(this.projectRoot, 'tm-gbx-cli');
    
    // Check if localappdata dotnet exists, otherwise fallback to 'dotnet' in PATH
    const localDotnet = path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'dotnet', 'dotnet.exe');
    this.dotnetPath = fs.existsSync(localDotnet) ? localDotnet : 'dotnet';
  }

  private async runCli(args: string[]): Promise<string> {
    const fullArgs = ['run', '--project', this.cliDir, '--', ...args];
    try {
      const { stdout, stderr } = await execFileAsync(this.dotnetPath, fullArgs, {
        cwd: this.cliDir
      });
      return stdout + (stderr ? '\n' + stderr : '');
    } catch (err: any) {
      throw new Error(`GBX CLI failed: ${err.message}\n${err.stdout || ''}\n${err.stderr || ''}`);
    }
  }

  public async jsonToGbx(jsonPath: string, templatePath: string, outputPath: string): Promise<string> {
    const absJson = path.resolve(jsonPath);
    const absTemplate = path.resolve(templatePath);
    const absOutput = path.resolve(outputPath);

    if (!fs.existsSync(absJson)) throw new Error(`JSON file not found: ${absJson}`);
    if (!fs.existsSync(absTemplate)) throw new Error(`Template file not found: ${absTemplate}`);

    return await this.runCli(['json2gbx', absJson, absTemplate, absOutput]);
  }

  public async gbxToJson(gbxPath: string, outputPath: string): Promise<string> {
    const absGbx = path.resolve(gbxPath);
    const absOutput = path.resolve(outputPath);

    if (!fs.existsSync(absGbx)) throw new Error(`GBX file not found: ${absGbx}`);
    return await this.runCli(['gbx2json', absGbx, absOutput]);
  }

  public async generateCatalog(mapsFolder: string, outputCatalogPath: string): Promise<string> {
    const absMaps = path.resolve(mapsFolder);
    const absOutput = path.resolve(outputCatalogPath);
    return await this.runCli(['catalog', absMaps, absOutput]);
  }

  public getTemplatesDir(): string {
    return path.join(this.projectRoot, 'data', 'templates');
  }

  public getReferenceMapsDir(): string {
    return path.join(this.projectRoot, 'data', 'reference_maps');
  }

  public getDefaultTemplatePath(): string {
    return path.join(this.getTemplatesDir(), 'blank_stadium.Challenge.Gbx');
  }

  public getBlockCatalogPath(): string {
    return path.join(this.projectRoot, 'data', 'block_catalog.json');
  }
}
