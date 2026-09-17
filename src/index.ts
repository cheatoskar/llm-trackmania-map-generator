import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
  Tool,
  Prompt
} from '@modelcontextprotocol/sdk/types.js';
import fs from 'node:fs';
import path from 'node:path';
import { GbxBridge } from './gbx-bridge.js';
import { TrackValidator } from './validator.js';
import { TurtleBuilder } from './turtle-builder.js';
import { 
  TrackJsonModel, 
  TurtleTrackSpec, 
  CatalogEntry 
} from './types.js';

function getGameMyChallengesDir(): string {
  const home = process.env.USERPROFILE || process.env.HOME || '';
  const dir = path.join(home, 'Documents', 'TmForever', 'Tracks', 'Challenges', 'My Challenges', 'AI_Generated');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

const bridge = new GbxBridge();

const server = new Server(
  {
    name: 'trackmania-gbx-mcp',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
      prompts: {},
    },
  }
);

const TOOLS: Tool[] = [
  {
    name: 'search_blocks',
    description: 'Search available Trackmania Stadium blocks from the catalog extracted from official Nadeo maps. Returns block names, categories, and usage frequency.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Keyword to search (e.g. "Road", "Slope", "Checkpoint", "Turn", "Curve", "Platform", "Water")'
        },
        category: {
          type: 'string',
          description: 'Filter by category: "Road", "Platform", "Start", "Finish", "Checkpoint", "Elevation/Transition", "Acrobatic", "Decoration", "General"'
        },
        limit: {
          type: 'number',
          description: 'Maximum number of results to return (default: 20)'
        }
      }
    }
  },
  {
    name: 'build_track_turtle',
    description: 'Builds a complete Trackmania track using relative sequential movements (Turtle mode). Solves 3D spatial alignment by calculating block coordinates and directions automatically.',
    inputSchema: {
      type: 'object',
      required: ['mapName', 'steps'],
      properties: {
        mapName: {
          type: 'string',
          description: 'Name of the track (e.g. "Claude Stadium Drift 01")'
        },
        author: {
          type: 'string',
          description: 'Author name (default: "Claude AI")'
        },
        style: {
          type: 'string',
          enum: ['Road', 'Circuit'],
          description: 'Track style. Road uses StadiumRoadMain and slopes. Circuit uses flat platform blocks.'
        },
        startX: { type: 'number', description: 'Starting X coordinate on stadium grid (default: 16)' },
        startY: { type: 'number', description: 'Starting height Y (default: 9)' },
        startZ: { type: 'number', description: 'Starting Z coordinate on stadium grid (default: 10)' },
        initialDirection: {
          type: 'string',
          enum: ['North', 'East', 'South', 'West'],
          description: 'Initial driving direction (default: North)'
        },
        steps: {
          type: 'array',
          description: 'Ordered sequence of track actions (must start with "start" and end with "finish")',
          items: {
            type: 'object',
            required: ['action'],
            properties: {
              action: {
                type: 'string',
                enum: ['start', 'forward', 'turbo', 'turn_left', 'turn_right', 'slope_up', 'slope_down', 'checkpoint', 'finish']
              },
              count: {
                type: 'number',
                description: 'Number of blocks for "forward" or "turbo" (default 1)'
              },
              customBlock: {
                type: 'string',
                description: 'Optional override for the exact block name'
              }
            }
          }
        },
        exportToGame: {
          type: 'boolean',
          description: 'If true, automatically saves the .Challenge.Gbx directly into Trackmania My Challenges folder so it can be played immediately'
        }
      }
    }
  },
  {
    name: 'build_track_raw',
    description: 'Builds a Trackmania track from an explicit list of blocks with exact coordinates (x, y, z) and direction.',
    inputSchema: {
      type: 'object',
      required: ['mapName', 'blocks'],
      properties: {
        mapName: { type: 'string' },
        author: { type: 'string' },
        blocks: {
          type: 'array',
          items: {
            type: 'object',
            required: ['name', 'x', 'y', 'z', 'dir'],
            properties: {
              name: { type: 'string' },
              x: { type: 'number' },
              y: { type: 'number' },
              z: { type: 'number' },
              dir: { type: 'string', enum: ['North', 'East', 'South', 'West'] }
            }
          }
        },
        exportToGame: { type: 'boolean' }
      }
    }
  },
  {
    name: 'inspect_map',
    description: 'Inspects an existing .Challenge.Gbx or .Map.Gbx file (e.g. from data/reference_maps) and returns metadata and block statistics.',
    inputSchema: {
      type: 'object',
      required: ['filePath'],
      properties: {
        filePath: {
          type: 'string',
          description: 'Path to .Gbx map file (relative to project root or absolute)'
        }
      }
    }
  },
  {
    name: 'list_reference_maps',
    description: 'Lists all available reference maps in the data/reference_maps folder that can be inspected or used as patterns.',
    inputSchema: {
      type: 'object',
      properties: {}
    }
  },
  {
    name: 'export_to_game',
    description: 'Copies any generated .Gbx file directly to the game directory (Documents/TmForever/Tracks/Challenges/My Challenges/AI_Generated).',
    inputSchema: {
      type: 'object',
      required: ['sourceGbxPath'],
      properties: {
        sourceGbxPath: { type: 'string' },
        customName: { type: 'string', description: 'Optional custom file name for the exported track' }
      }
    }
  }
];

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools: TOOLS };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    if (name === 'search_blocks') {
      const catalogPath = bridge.getBlockCatalogPath();
      if (!fs.existsSync(catalogPath)) {
        return { content: [{ type: 'text', text: 'Block catalog not found. Run catalog update first.' }] };
      }

      const catalog: CatalogEntry[] = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
      const query = (args?.query as string | undefined)?.toLowerCase();
      const category = args?.category as string | undefined;
      const limit = (args?.limit as number) || 20;

      let filtered = catalog;
      if (category) {
        filtered = filtered.filter(b => b.category.toLowerCase() === category.toLowerCase());
      }
      if (query) {
        filtered = filtered.filter(b => b.name.toLowerCase().includes(query) || b.category.toLowerCase().includes(query));
      }

      const results = filtered.slice(0, limit);
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            totalFound: filtered.length,
            showing: results.length,
            blocks: results
          }, null, 2)
        }]
      };
    }

    if (name === 'build_track_turtle') {
      const spec = args as unknown as TurtleTrackSpec & { style?: 'Road' | 'Circuit'; exportToGame?: boolean };
      const trackData = TurtleBuilder.build(spec, spec.style ?? 'Road');

      const validation = TrackValidator.validate(trackData);
      if (!validation.valid) {
        return {
          isError: true,
          content: [{
            type: 'text',
            text: `Track validation failed:\n` + validation.issues.map(i => `- [${i.type.toUpperCase()}] ${i.message}`).join('\n')
          }]
        };
      }

      const safeName = spec.mapName.replace(/[^a-zA-Z0-9_-]/g, '_');
      const tempJson = path.join(bridge.getTemplatesDir(), `${safeName}.json`);
      const outputGbx = path.join(bridge.getTemplatesDir(), `${safeName}.Challenge.Gbx`);

      fs.writeFileSync(tempJson, JSON.stringify(trackData, null, 2), 'utf8');
      const templatePath = bridge.getDefaultTemplatePath();
      await bridge.jsonToGbx(tempJson, templatePath, outputGbx);

      let exportPath: string | undefined;
      if (spec.exportToGame !== false) {
        const gameDir = getGameMyChallengesDir();
        exportPath = path.join(gameDir, `${safeName}.Challenge.Gbx`);
        fs.copyFileSync(outputGbx, exportPath);
      }

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            mapName: spec.mapName,
            totalBlocks: trackData.blocks.length,
            generatedGbxPath: outputGbx,
            exportedToGamePath: exportPath,
            validationStats: validation.stats,
            message: exportPath 
              ? `Track successfully created and exported to Trackmania! You can now load '${spec.mapName}' in the editor or play it directly.`
              : `Track successfully created at ${outputGbx}.`
          }, null, 2)
        }]
      };
    }

    if (name === 'build_track_raw') {
      const trackData = args as unknown as TrackJsonModel & { exportToGame?: boolean };
      const validation = TrackValidator.validate(trackData);
      if (!validation.valid) {
        return {
          isError: true,
          content: [{
            type: 'text',
            text: `Track validation failed:\n` + validation.issues.map(i => `- [${i.type.toUpperCase()}] ${i.message}`).join('\n')
          }]
        };
      }

      const safeName = trackData.mapName.replace(/[^a-zA-Z0-9_-]/g, '_');
      const tempJson = path.join(bridge.getTemplatesDir(), `${safeName}.json`);
      const outputGbx = path.join(bridge.getTemplatesDir(), `${safeName}.Challenge.Gbx`);

      fs.writeFileSync(tempJson, JSON.stringify(trackData, null, 2), 'utf8');
      const templatePath = bridge.getDefaultTemplatePath();
      await bridge.jsonToGbx(tempJson, templatePath, outputGbx);

      let exportPath: string | undefined;
      if (trackData.exportToGame) {
        const gameDir = getGameMyChallengesDir();
        exportPath = path.join(gameDir, `${safeName}.Challenge.Gbx`);
        fs.copyFileSync(outputGbx, exportPath);
      }

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            mapName: trackData.mapName,
            totalBlocks: trackData.blocks.length,
            generatedGbxPath: outputGbx,
            exportedToGamePath: exportPath,
            validationStats: validation.stats
          }, null, 2)
        }]
      };
    }

    if (name === 'inspect_map') {
      const filePath = args?.filePath as string;
      const absPath = path.isAbsolute(filePath) ? filePath : path.resolve(bridge.getReferenceMapsDir(), '..', '..', filePath);
      const outJson = path.join(bridge.getTemplatesDir(), `inspect_temp_${Date.now()}.json`);

      await bridge.gbxToJson(absPath, outJson);
      const data: TrackJsonModel = JSON.parse(fs.readFileSync(outJson, 'utf8'));
      fs.unlinkSync(outJson);

      const blockCounts: Record<string, number> = {};
      for (const b of data.blocks) {
        blockCounts[b.name] = (blockCounts[b.name] || 0) + 1;
      }

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            mapName: data.mapName,
            author: data.author,
            totalBlocks: data.blocks.length,
            uniqueBlockTypes: Object.keys(blockCounts).length,
            blockFrequency: Object.entries(blockCounts)
              .sort((a, b) => b[1] - a[1])
              .slice(0, 25)
              .map(([name, count]) => ({ name, count }))
          }, null, 2)
        }]
      };
    }

    if (name === 'list_reference_maps') {
      const refDir = bridge.getReferenceMapsDir();
      if (!fs.existsSync(refDir)) {
        return { content: [{ type: 'text', text: 'No reference maps folder found.' }] };
      }

      const files = fs.readdirSync(refDir)
        .filter((f: string) => f.endsWith('.Challenge.Gbx') || f.endsWith('.Map.Gbx'))
        .map((f: string) => {
          const stat = fs.statSync(path.join(refDir, f));
          return {
            filename: f,
            sizeKb: Math.round(stat.size / 1024),
            path: path.join('data', 'reference_maps', f)
          };
        });

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            totalReferenceMaps: files.length,
            maps: files
          }, null, 2)
        }]
      };
    }

    if (name === 'export_to_game') {
      const src = args?.sourceGbxPath as string;
      const customName = args?.customName as string | undefined;

      const absSrc = path.isAbsolute(src) ? src : path.resolve(src);
      if (!fs.existsSync(absSrc)) {
        return { isError: true, content: [{ type: 'text', text: `Source file not found: ${absSrc}` }] };
      }

      const gameDir = getGameMyChallengesDir();
      const targetName = customName ? (customName.endsWith('.Gbx') ? customName : `${customName}.Challenge.Gbx`) : path.basename(absSrc);
      const targetPath = path.join(gameDir, targetName);
      fs.copyFileSync(absSrc, targetPath);

      return {
        content: [{
          type: 'text',
          text: `Successfully exported map to Trackmania:\n${targetPath}`
        }]
      };
    }

    return {
      isError: true,
      content: [{ type: 'text', text: `Unknown tool: ${name}` }]
    };
  } catch (err: any) {
    return {
      isError: true,
      content: [{ type: 'text', text: `Error executing ${name}: ${err.message}` }]
    };
  }
});

const PROMPTS: Prompt[] = [
  {
    name: 'trackmania_designer',
    description: 'Master system instructions for an AI model on how to design valid, playable, and exciting TrackMania Nations Forever tracks.',
    arguments: []
  },
  {
    name: 'generate_track',
    description: 'Template prompt requesting the generation of a complete TrackMania track with custom parameters.',
    arguments: [
      {
        name: 'name',
        description: 'Name of the track (e.g. "Alpine Ridge Circuit")',
        required: true
      },
      {
        name: 'style',
        description: 'Track style: "Road" (asphalt with curves & slopes) or "Circuit" (flat platform grid)',
        required: false
      },
      {
        name: 'difficulty',
        description: 'Difficulty level: "Easy", "Medium", "Hard", or "Expert"',
        required: false
      },
      {
        name: 'features',
        description: 'Desired elements (e.g. "turbos, high-elevation flyover, multi-lap, chicanes")',
        required: false
      }
    ]
  }
];

server.setRequestHandler(ListPromptsRequestSchema, async () => {
  return {
    prompts: PROMPTS
  };
});

server.setRequestHandler(GetPromptRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  if (name === 'trackmania_designer') {
    return {
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `# TrackMania Nations Forever Track Design Manual for LLMs

You are an expert TrackMania Nations Forever track designer. You can generate and build real, drivable TrackMania maps (.Challenge.Gbx) using the available MCP tools.

## 1. Grid & Coordinate System
- TrackMania Stadium is a 3D grid with coordinates (X, Y, Z):
  - X: 0 to 31 (West = +X, East = -X)
  - Z: 0 to 31 (North = +Z, South = -Z)
  - Y: Elevation levels (0 = water/sub-ground, 1 = stadium grass ground, 2+ = above ground)
- Headings / Directions: 'North', 'East', 'South', 'West'.

## 2. Fundamental Engineering Rules
1. **CRITICAL Ground Height Rule ($Y \\ge 2$):**
   - The stadium grass floor is at $Y = 1$.
   - Never place road or platform blocks at $Y = 1$, because they carve holes into the stadium grass and expose empty void underneath!
   - All tracks sitting on the ground MUST start and stay at $Y \\ge 2$.
2. **Road Connectivity Bitmask (Variant = 3):**
   - Straight road blocks (\`StadiumRoadMain\`) use a 2-bit connection variant.
   - \`variant = 3\` produces an open, seamless through-road.
   - \`variant = 0\` creates cross-track end-barriers on both ends (blocking cars and looking disconnected).
   - The builder automatically applies \`variant = 3\` to \`StadiumRoadMain\`.
3. **Slope Strides & 180° Inversion:**
   - Slopes use two 2x1 blocks: \`StadiumRoadMainBiSlopeStart\` and \`StadiumRoadMainBiSlopeEnd\`.
   - **Ascending (slope_up):**
     - \`BiSlopeStart\` at current $Y$, facing travel direction.
     - Advance +2 cells forward, +1 $Y$.
     - \`BiSlopeEnd\` at $Y+1$, facing travel direction.
     - Advance +2 cells forward to flat road at $Y+2$.
   - **Descending (slope_down):**
     - \`BiSlopeEnd\` at $Y-1$, facing **OPPOSITE** direction (180° rotated)!
     - Advance +2 cells forward, -1 $Y$.
     - \`BiSlopeStart\` at $Y-2$, facing **OPPOSITE** direction (180° rotated)!
     - Advance +2 cells forward to flat road at $Y-2$.

## 3. Block Catalog & Footprints
- **1x1 Blocks:**
  - \`StadiumRoadMain\`: Straight asphalt road
  - \`StadiumRoadMainTurbo\`: Boost strip giving immediate acceleration
  - \`StadiumRoadMainCheckpoint\`: Checkpoint archway (road surface)
  - \`StadiumRoadMainStartLine\`: Race starting grid
  - \`StadiumRoadMainFinishLine\`: Race finish arch
- **2x1 Blocks (Stride 2):**
  - \`StadiumRoadMainBiSlopeStart\` / \`StadiumRoadMainBiSlopeEnd\`
- **2x2 Blocks:**
  - \`StadiumRoadMainGTCurve2\`: Banked asphalt road curve (90-degree turn).

## 4. Recommended Generation Strategy: Turtle Builder
Unless you need custom complex off-grid architecture, ALWAYS use \`build_track_turtle\`. It automatically calculates all 3D coordinates, applies 2x1 slope strides, handles 180° downhill rotations, and sets up 2x2 curve anchors.

### Turtle Actions:
- \`start\`: Starting block
- \`forward\` with \`count\`: Straight road blocks
- \`turbo\` with \`count\`: Boost accelerator blocks
- \`turn_right\`: Banked 2x2 right curve
- \`turn_left\`: Banked 2x2 left curve
- \`slope_up\`: Smooth 2-level climb
- \`slope_down\`: Smooth 2-level descent
- \`checkpoint\`: Mid-track respawn gate
- \`finish\`: Finish line block

## 5. Track Design & Pacing Guidelines
- **Launch:** Give the player 2-4 straight blocks (or 1 turbo) right after the start line to build up speed.
- **Corners:** After high-speed descents or long turbo straights, give at least 1-2 straight blocks before a 90-degree curve to allow braking/drifting.
- **Checkpoints:** Place a checkpoint before every major elevation climb or technical chicane so players can respawn easily.
- **Finish:** Give 1-2 straight blocks before the finish line for a clean crossing.`
          }
        }
      ]
    };
  }

  if (name === 'generate_track') {
    const trackName = (args?.name as string) || 'AI Track';
    const style = (args?.style as string) || 'Road';
    const difficulty = (args?.difficulty as string) || 'Medium';
    const features = (args?.features as string) || 'turbos, elevation changes, and technical curves';

    return {
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `Please design and build a TrackMania Nations Forever track named "${trackName}" with the following specifications:
- Style: ${style}
- Difficulty: ${difficulty}
- Key Features: ${features}

Ensure the track follows all engineering rules:
1. Minimum elevation Y >= 2 (do not punch holes into stadium grass).
2. Start with a StartLine and end with a FinishLine.
3. Include at least 1-2 checkpoints spaced throughout the layout.
4. Use the \`build_track_turtle\` tool with exportToGame=true so the player can test it immediately.`
          }
        }
      ]
    };
  }

  throw new Error(`Unknown prompt: ${name}`);
});

async function run() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Trackmania GBX MCP Server running on stdio');
}

run().catch((err) => {
  console.error('Fatal server error:', err);
  process.exit(1);
});
