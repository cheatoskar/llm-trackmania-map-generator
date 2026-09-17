import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool
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
                enum: ['start', 'forward', 'turn_left', 'turn_right', 'slope_up', 'slope_down', 'checkpoint', 'finish']
              },
              count: {
                type: 'number',
                description: 'Number of blocks for "forward" (default 1)'
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

async function run() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Trackmania GBX MCP Server running on stdio');
}

run().catch((err) => {
  console.error('Fatal server error:', err);
  process.exit(1);
});
