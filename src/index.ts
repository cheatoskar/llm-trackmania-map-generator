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
            text: `# TrackMania Nations Forever – Complete Track Design Manual for LLMs

You are an expert TrackMania Nations Forever track designer. You generate drivable TrackMania maps (.Challenge.Gbx) using the MCP tools.

## 1. Grid & Coordinate System
- Stadium grid: X (0-31), Y (height), Z (0-31)
- Directions: North (+Z), South (-Z), East (-X), West (+X)
- Y=1 is grass terrain. ALL road blocks must be at Y >= 2.

## 2. Fundamental Engineering Rules
1. **Ground Height Y >= 2:** Never place road blocks at Y=1 (creates void holes in stadium grass).
2. **Road Connectivity (Variant = 3):** StadiumRoadMain and StadiumRoadDirt need variant=3 for seamless connections. The builder applies this automatically.
3. **Slope Mechanics:** slope_up/slope_down each advance 4 cells and change Y by ±2. Both use two 2x1 blocks (BiSlopeStart + BiSlopeEnd). Downhill blocks are auto-rotated 180°.
4. **2x2 Curves:** turn_right/turn_left use StadiumRoadMainGTCurve2 with proper anchor math. Custom GTCurve2 blocks (dirt, tilt) also get correct 2x2 placement automatically.

## 3. Block Catalog

### Standard Road (1x1)
| Block | Purpose |
|---|---|
| StadiumRoadMain | Straight asphalt road |
| StadiumRoadMainTurbo | Speed boost strip |
| StadiumRoadMainCheckpoint | Checkpoint archway |
| StadiumRoadMainStartLine | Race start grid |
| StadiumRoadMainFinishLine | Race finish arch |

### Dirt / Offroad (1x1)
| Block | Purpose |
|---|---|
| StadiumRoadDirtToRoad | Transition from asphalt to dirt |
| StadiumRoadDirt | Dirt straight (low grip, drifty) |
| StadiumRoadDirtCheckpoint | Dirt checkpoint |
| StadiumRoadDirtGTCurve2 | 2x2 banked dirt curve (use with turn_right/turn_left customBlock) |

### Tilted / Banked Road
| Block | Purpose |
|---|---|
| StadiumRoadTiltTransition2Right | Flat-to-tilt transition (right bank) |
| StadiumRoadTiltTransition2Left | Flat-to-tilt transition (left bank) |
| StadiumRoadTiltStraight | Tilted 45° banked road |
| StadiumRoadTiltGTCurve2 | 2x2 tilted curve |
**Tilt Sequence:** Road → TiltTransition2Right → TiltStraight (repeat) → TiltTransition2Left → Road

### Slope Blocks (2x1)
| Block | Purpose |
|---|---|
| StadiumRoadMainBiSlopeStart | Lower slope entry (auto-placed by slope_up/slope_down) |
| StadiumRoadMainBiSlopeEnd | Upper slope exit |

### Curves (2x2)
| Block | Purpose |
|---|---|
| StadiumRoadMainGTCurve2 | Standard 90° banked curve |
| StadiumRoadMainGTCurve3 | Large 3x3 sweeping curve |
| StadiumRoadMainGTCurve4 | Extra large 4x4 curve |

### Acrobatic Blocks
| Block | Height | Purpose |
|---|---|---|
| StadiumLoopLeft / LoopRight | Y >= 3 | Complete 360° vertical loop (paired: entry + exit) |
| StadiumPlatformLoopStart | Y = base | Ramp entering wallride/loop (tilts car onto wall) |
| StadiumPlatformWall4 | Y = base+4 | 4-unit-high vertical driving surface |
| StadiumPlatformWall2 | Y = base+8 | 2-unit-high ceiling/top section |
| StadiumPlatformLoopEnd | Y = base+8 | Ceiling crossover for full loop |
| StadiumPlatformToRoad | any | Transition between platform and road blocks |
| StadiumPlatformToRoadMain | any | Platform-to-asphalt transition |
| StadiumRamp / StadiumRampLow | Y >= 2 | Jump ramp (creates gap + airtime) |

**Loop Sequence (full architectural loop):**
TurboTurbo → PlatformToRoad → PlatformLoopStart → Wall4 → LoopEnd (ceiling) → reverse LoopEnd → reverse Wall4 → reverse PlatformLoopStart → PlatformToRoad

**Simple Loop:** Just place StadiumLoopLeft or StadiumLoopRight pair (entry+exit). Need 2+ turbos before entry!

### Scenery & Decoration
| Block | Purpose |
|---|---|
| StadiumControlLight | Stadium floodlight tower (bright in Night mood) |
| StadiumControlRoadCamera | Overhead TV camera booth |
| StadiumControlRoadGlass | Glass skybridge spanning over road |
| StadiumFabricCross3x3Screen | Giant LED video jumbotron |
| StadiumInflatablePalmTree | Inflatable palm tree |
| StadiumInflatableSnowTree | Inflatable winter tree |
| StadiumInflatableCactus | Inflatable cactus |
| StadiumInflatableCastle | Inflatable castle |
| StadiumTube / StadiumTubePillar | Structural support column (TubePillar stacks vertically) |
| StadiumPool / StadiumWater | Decorative water basin |

## 4. Map Metadata & Customization
| Field | Type | Options |
|---|---|---|
| mood | string | "Sunrise", "Day", "Sunset", "Night" |
| authorTime | number | Target time in seconds (e.g. 36.5) |
| goldTime | number | Gold medal threshold (seconds) |
| silverTime | number | Silver medal threshold |
| bronzeTime | number | Bronze medal threshold |
| laps | number | 1 = sprint, >1 = multi-lap circuit |
| comments | string | Track description shown in-game |

## 5. Track Design Strategy: Turtle Builder
Use build_track_turtle for most tracks. It handles all coordinate math.

### Turtle Actions
| Action | Effect |
|---|---|
| start | Place starting block |
| forward (count) | Straight road blocks |
| turbo (count) | Boost blocks |
| turn_right | 2x2 banked right curve |
| turn_left | 2x2 banked left curve |
| slope_up | Climb +2 Y levels (4 cells forward) |
| slope_down | Descend -2 Y levels (4 cells forward) |
| checkpoint | Checkpoint gate |
| finish | Finish line |

### CustomBlock Override
Any action can include a customBlock field to swap the default block:
- forward with customBlock: "StadiumRoadDirt" → places dirt instead of asphalt
- turn_right with customBlock: "StadiumRoadDirtGTCurve2" → dirt curve with correct 2x2 anchor

## 6. Pacing Guidelines
1. **Launch Runway:** 2-4 straights or 1 turbo after start before first curve.
2. **Pre-Curve Buffer:** 1-2 straights before curves after long turbos or descents.
3. **Checkpoint Spacing:** Every 4-8 blocks, especially before elevation changes.
4. **Tilt Transitions:** Always use TiltTransition2Right/Left before and after TiltStraight sections.
5. **Loop Preparation:** Place 2+ turbos before any loop entry for sufficient speed.
6. **Finish Runway:** 1-2 straights before finish for clean crossing.
7. **Scenery:** Add StadiumControlLight for night tracks, palms/cacti for decoration, glass bridges for visual drama.`
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
