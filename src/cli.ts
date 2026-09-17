import fs from 'node:fs';
import path from 'node:path';
import { GbxBridge } from './gbx-bridge.js';
import { TrackValidator } from './validator.js';
import { TurtleBuilder } from './turtle-builder.js';
import { TrackJsonModel, TurtleTrackSpec } from './types.js';

function getGameMyChallengesDir(): string {
  const home = process.env.USERPROFILE || process.env.HOME || '';
  const dir = path.join(home, 'Documents', 'TmForever', 'Tracks', 'Challenges', 'My Challenges', 'AI_Generated');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.log(`
Trackmania GBX Map Builder CLI
Usage:
  node dist/cli.js build <track.json> [--export]
  node dist/cli.js turtle <turtle_spec.json> [--export]
  node dist/cli.js inspect <map.gbx>
  node dist/cli.js catalog
    `);
    process.exit(0);
  }

  const command = args[0];
  const bridge = new GbxBridge();

  try {
    if (command === 'build') {
      const jsonFile = args[1];
      if (!jsonFile || !fs.existsSync(jsonFile)) {
        console.error(`Error: File not found: ${jsonFile}`);
        process.exit(1);
      }

      const trackData: TrackJsonModel = JSON.parse(fs.readFileSync(jsonFile, 'utf8'));
      console.log(`Validating track '${trackData.mapName}'...`);
      const validation = TrackValidator.validate(trackData);

      if (!validation.valid) {
        console.error('Validation failed:');
        validation.issues.forEach(i => console.error(`  - [${i.type.toUpperCase()}] ${i.message}`));
        process.exit(1);
      }

      const templatePath = bridge.getDefaultTemplatePath();
      const outputGbx = path.join(path.dirname(jsonFile), `${trackData.mapName.replace(/[^a-zA-Z0-9_-]/g, '_')}.Challenge.Gbx`);

      console.log(`Generating GBX map using template: ${templatePath}...`);
      await bridge.jsonToGbx(jsonFile, templatePath, outputGbx);
      console.log(`Map successfully generated at: ${outputGbx}`);

      if (args.includes('--export')) {
        const gameDir = getGameMyChallengesDir();
        const targetFile = path.join(gameDir, path.basename(outputGbx));
        fs.copyFileSync(outputGbx, targetFile);
        console.log(`Exported directly to Trackmania: ${targetFile}`);
      }
    } else if (command === 'turtle') {
      const turtleFile = args[1];
      if (!turtleFile || !fs.existsSync(turtleFile)) {
        console.error(`Error: File not found: ${turtleFile}`);
        process.exit(1);
      }

      const spec: TurtleTrackSpec = JSON.parse(fs.readFileSync(turtleFile, 'utf8'));
      console.log(`Building track '${spec.mapName}' from turtle spec...`);
      const trackData = TurtleBuilder.build(spec);

      const generatedJsonPath = path.join(path.dirname(turtleFile), `${spec.mapName.replace(/[^a-zA-Z0-9_-]/g, '_')}_compiled.json`);
      fs.writeFileSync(generatedJsonPath, JSON.stringify(trackData, null, 2), 'utf8');
      console.log(`Compiled JSON saved to: ${generatedJsonPath}`);

      const validation = TrackValidator.validate(trackData);
      console.log(`Validation: ${validation.valid ? 'PASSED' : 'FAILED'}`);
      if (validation.issues.length > 0) {
        validation.issues.forEach(i => console.log(`  - [${i.type.toUpperCase()}] ${i.message}`));
      }

      const templatePath = bridge.getDefaultTemplatePath();
      const outputGbx = path.join(path.dirname(turtleFile), `${spec.mapName.replace(/[^a-zA-Z0-9_-]/g, '_')}.Challenge.Gbx`);
      await bridge.jsonToGbx(generatedJsonPath, templatePath, outputGbx);
      console.log(`Map successfully generated at: ${outputGbx}`);

      if (args.includes('--export')) {
        const gameDir = getGameMyChallengesDir();
        const targetFile = path.join(gameDir, path.basename(outputGbx));
        fs.copyFileSync(outputGbx, targetFile);
        console.log(`Exported directly to Trackmania: ${targetFile}`);
      }
    } else if (command === 'inspect') {
      const gbxFile = args[1];
      if (!gbxFile || !fs.existsSync(gbxFile)) {
        console.error(`Error: File not found: ${gbxFile}`);
        process.exit(1);
      }

      const outJson = path.join(path.dirname(gbxFile), `${path.basename(gbxFile, path.extname(gbxFile))}_inspected.json`);
      await bridge.gbxToJson(gbxFile, outJson);
      const parsed = JSON.parse(fs.readFileSync(outJson, 'utf8'));
      console.log(`Inspected map: Name='${parsed.mapName}', Author='${parsed.author}', Total Blocks=${parsed.blocks.length}`);
    } else if (command === 'catalog') {
      const refDir = bridge.getReferenceMapsDir();
      const catPath = bridge.getBlockCatalogPath();
      console.log(`Scanning reference maps in ${refDir}...`);
      await bridge.generateCatalog(refDir, catPath);
      console.log(`Catalog updated at ${catPath}`);
    } else {
      console.error(`Unknown command: ${command}`);
    }
  } catch (err: any) {
    console.error(`Fatal error: ${err.message}`);
    process.exit(1);
  }
}

main();
