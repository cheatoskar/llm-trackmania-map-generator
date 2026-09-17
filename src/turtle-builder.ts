import { 
  DirectionName, 
  BlockData, 
  TrackJsonModel, 
  TurtleTrackSpec, 
  TurtleStep 
} from './types.js';

interface HeadingVector {
  dx: number;
  dz: number;
}

const DIRECTIONS: DirectionName[] = ['North', 'East', 'South', 'West'];

// In Trackmania Stadium coordinates:
// North = +Z (dz: 1)
// South = -Z (dz: -1)
// East = -X (dx: -1)
// West = +X (dx: 1)
const DIR_VECTORS: Record<DirectionName, HeadingVector> = {
  North: { dx: 0, dz: 1 },
  East:  { dx: -1, dz: 0 },
  South: { dx: 0, dz: -1 },
  West:  { dx: 1, dz: 0 }
};

export class TurtleBuilder {
  public static build(spec: TurtleTrackSpec, style: 'Road' | 'Circuit' = 'Road'): TrackJsonModel {
    // In Trackmania Stadium, the stadium ground (grass) is at Y = 1.
    // Road and Circuit tracks MUST be built at Y >= 2 so they sit on/above the ground
    // and do not cut holes into the grass terrain or reveal the void underneath!
    let currentX = spec.startX ?? 16;
    let currentY = spec.startY ?? 2;
    let currentZ = spec.startZ ?? 10;
    let currentDir: DirectionName = spec.initialDirection ?? 'North';

    const blocks: BlockData[] = [];

    const getTurnDir = (current: DirectionName, turn: 'left' | 'right'): DirectionName => {
      const idx = DIRECTIONS.indexOf(current);
      if (turn === 'right') {
        return DIRECTIONS[(idx + 1) % 4];
      } else {
        return DIRECTIONS[(idx + 3) % 4];
      }
    };

    const getRoadBlockName = (action: string, custom?: string): string => {
      if (custom) return custom;
      if (style === 'Circuit') {
        switch (action) {
          case 'start': return 'StadiumRoadMainStartLine';
          case 'finish': return 'StadiumRoadMainFinishLine';
          case 'checkpoint': return 'StadiumPlatformCheckpoint';
          default: return 'StadiumCircuitBase';
        }
      } else {
        switch (action) {
          case 'start': return 'StadiumRoadMainStartLine';
          case 'finish': return 'StadiumRoadMainFinishLine';
          case 'checkpoint': return 'StadiumRoadMainCheckpoint'; // Solid road checkpoint with asphalt surface!
          default: return 'StadiumRoadMain';
        }
      }
    };

    for (let i = 0; i < spec.steps.length; i++) {
      const step: TurtleStep = spec.steps[i];

      switch (step.action) {
        case 'start': {
          blocks.push({
            name: getRoadBlockName('start', step.customBlock),
            x: currentX,
            y: currentY,
            z: currentZ,
            dir: currentDir
          });
          break;
        }

        case 'forward': {
          const count = step.count ?? 1;
          const vec = DIR_VECTORS[currentDir];
          for (let c = 0; c < count; c++) {
            currentX += vec.dx;
            currentZ += vec.dz;
            blocks.push({
              name: getRoadBlockName('forward', step.customBlock),
              x: currentX,
              y: currentY,
              z: currentZ,
              dir: currentDir
            });
          }
          break;
        }

        case 'turbo': {
          const count = step.count ?? 1;
          const vec = DIR_VECTORS[currentDir];
          for (let c = 0; c < count; c++) {
            currentX += vec.dx;
            currentZ += vec.dz;
            blocks.push({
              name: step.customBlock ?? (style === 'Circuit' ? 'StadiumPlatformTurboUp' : 'StadiumRoadMainTurbo'),
              x: currentX,
              y: currentY,
              z: currentZ,
              dir: currentDir
            });
          }
          break;
        }

        case 'checkpoint': {
          const vec = DIR_VECTORS[currentDir];
          currentX += vec.dx;
          currentZ += vec.dz;
          blocks.push({
            name: getRoadBlockName('checkpoint', step.customBlock),
            x: currentX,
            y: currentY,
            z: currentZ,
            dir: currentDir
          });
          break;
        }

        case 'finish': {
          const vec = DIR_VECTORS[currentDir];
          currentX += vec.dx;
          currentZ += vec.dz;
          blocks.push({
            name: getRoadBlockName('finish', step.customBlock),
            x: currentX,
            y: currentY,
            z: currentZ,
            dir: currentDir
          });
          break;
        }

        case 'slope_up': {
          // Trackmania Stadium BiSlope (Ascending):
          // Each BiSlope block spans 2 cells along the travel axis.
          // Because GBX coordinates are always minimum grid cell (minX, minZ):
          // In positive direction (+Z North, +X West):
          //   Block 1 (BiSlopeStart): offset +1
          //   Block 2 (BiSlopeEnd):   offset +3
          //   Exit cursor:            offset +4
          // In negative direction (-Z South, -X East):
          //   Block 1 (BiSlopeStart): offset -2
          //   Block 2 (BiSlopeEnd):   offset -4
          //   Exit cursor:            offset -4
          const vec = DIR_VECTORS[currentDir];
          const isNegative = (vec.dx < 0 || vec.dz < 0);
          const startOffset = isNegative ? 2 : 1;
          const endOffset = isNegative ? 4 : 3;
          const exitOffset = 4;

          blocks.push({
            name: 'StadiumRoadMainBiSlopeStart',
            x: currentX + (vec.dx !== 0 ? vec.dx * startOffset : 0),
            y: currentY,
            z: currentZ + (vec.dz !== 0 ? vec.dz * startOffset : 0),
            dir: currentDir
          });

          blocks.push({
            name: 'StadiumRoadMainBiSlopeEnd',
            x: currentX + (vec.dx !== 0 ? vec.dx * endOffset : 0),
            y: currentY + 1,
            z: currentZ + (vec.dz !== 0 ? vec.dz * endOffset : 0),
            dir: currentDir
          });

          currentX += vec.dx * exitOffset;
          currentZ += vec.dz * exitOffset;
          currentY += 2; // Flat road resumes 2 levels higher
          break;
        }

        case 'slope_down': {
          // Trackmania Stadium BiSlope (Descending):
          // When descending, both ramp blocks are rotated 180 degrees (oppDir)
          // so the ramp slopes downwards in the direction of driving.
          const vec = DIR_VECTORS[currentDir];
          const oppDir = DIRECTIONS[(DIRECTIONS.indexOf(currentDir) + 2) % 4];
          const isNegative = (vec.dx < 0 || vec.dz < 0);
          const endOffset = isNegative ? 2 : 1;
          const startOffset = isNegative ? 4 : 3;
          const exitOffset = 4;

          blocks.push({
            name: 'StadiumRoadMainBiSlopeEnd',
            x: currentX + (vec.dx !== 0 ? vec.dx * endOffset : 0),
            y: currentY - 1,
            z: currentZ + (vec.dz !== 0 ? vec.dz * endOffset : 0),
            dir: oppDir
          });

          blocks.push({
            name: 'StadiumRoadMainBiSlopeStart',
            x: currentX + (vec.dx !== 0 ? vec.dx * startOffset : 0),
            y: currentY - 2,
            z: currentZ + (vec.dz !== 0 ? vec.dz * startOffset : 0),
            dir: oppDir
          });

          currentX += vec.dx * exitOffset;
          currentZ += vec.dz * exitOffset;
          currentY -= 2; // Flat road resumes 2 levels lower
          break;
        }

        case 'turn_right': {
          const newDir = getTurnDir(currentDir, 'right');
          // Check if the customBlock is a 2x2 GTCurve2 variant (dirt, tilt, etc.)
          // These blocks have the same 2x2 footprint and anchor math as StadiumRoadMainGTCurve2
          const isGTCurve2 = !step.customBlock || step.customBlock.includes('GTCurve2') || step.customBlock.includes('GTCurve3');
          if (step.customBlock && !isGTCurve2) {
            // 1x1 custom block (e.g. a simple platform block)
            const vec = DIR_VECTORS[currentDir];
            currentX += vec.dx;
            currentZ += vec.dz;
            blocks.push({
              name: getRoadBlockName('turn_right', step.customBlock),
              x: currentX,
              y: currentY,
              z: currentZ,
              dir: currentDir
            });
            currentDir = newDir;
          } else {
            // 2x2 curve block – use proper anchor math
            const curveName = step.customBlock ?? 'StadiumRoadMainGTCurve2';
            let anchorX = currentX;
            let anchorZ = currentZ;
            let nextCursorX = currentX;
            let nextCursorZ = currentZ;

            if (currentDir === 'North') {
              anchorX = currentX - 1;
              anchorZ = currentZ + 1;
              nextCursorX = currentX - 1;
              nextCursorZ = currentZ + 2;
            } else if (currentDir === 'East') {
              anchorX = currentX - 2;
              anchorZ = currentZ - 1;
              nextCursorX = currentX - 2;
              nextCursorZ = currentZ - 1;
            } else if (currentDir === 'South') {
              anchorX = currentX;
              anchorZ = currentZ - 2;
              nextCursorX = currentX + 1;
              nextCursorZ = currentZ - 2;
            } else if (currentDir === 'West') {
              anchorX = currentX + 1;
              anchorZ = currentZ;
              nextCursorX = currentX + 2;
              nextCursorZ = currentZ + 1;
            }

            blocks.push({
              name: curveName,
              x: anchorX,
              y: currentY,
              z: anchorZ,
              dir: newDir
            });

            currentX = nextCursorX;
            currentZ = nextCursorZ;
            currentDir = newDir;
          }
          break;
        }

        case 'turn_left': {
          const newDir = getTurnDir(currentDir, 'left');
          // Check if the customBlock is a 2x2 GTCurve2 variant (dirt, tilt, etc.)
          const isGTCurve2L = !step.customBlock || step.customBlock.includes('GTCurve2') || step.customBlock.includes('GTCurve3');
          if (step.customBlock && !isGTCurve2L) {
            // 1x1 custom block
            const vec = DIR_VECTORS[currentDir];
            currentX += vec.dx;
            currentZ += vec.dz;
            blocks.push({
              name: getRoadBlockName('turn_left', step.customBlock),
              x: currentX,
              y: currentY,
              z: currentZ,
              dir: currentDir
            });
            currentDir = newDir;
          } else {
            // 2x2 curve block – use proper anchor math
            const curveName = step.customBlock ?? 'StadiumRoadMainGTCurve2';
            let anchorX = currentX;
            let anchorZ = currentZ;
            let nextCursorX = currentX;
            let nextCursorZ = currentZ;
            let curveDir: DirectionName = 'North';

            if (currentDir === 'North') {
              anchorX = currentX;
              anchorZ = currentZ + 1;
              nextCursorX = currentX + 1;
              nextCursorZ = currentZ + 2;
              curveDir = 'South';
            } else if (currentDir === 'East') {
              anchorX = currentX - 2;
              anchorZ = currentZ;
              nextCursorX = currentX - 2;
              nextCursorZ = currentZ + 1;
              curveDir = 'West';
            } else if (currentDir === 'South') {
              anchorX = currentX - 1;
              anchorZ = currentZ - 2;
              nextCursorX = currentX - 1;
              nextCursorZ = currentZ - 2;
              curveDir = 'North';
            } else if (currentDir === 'West') {
              anchorX = currentX + 1;
              anchorZ = currentZ - 1;
              nextCursorX = currentX + 2;
              nextCursorZ = currentZ - 1;
              curveDir = 'East';
            }

            blocks.push({
              name: curveName,
              x: anchorX,
              y: currentY,
              z: anchorZ,
              dir: curveDir
            });

            currentX = nextCursorX;
            currentZ = nextCursorZ;
            currentDir = newDir;
          }
          break;
        }
      }
    }

    return {
      mapName: spec.mapName,
      author: spec.author ?? 'Claude AI',
      mood: spec.mood,
      mod: spec.mod,
      modUrl: spec.modUrl,
      authorTime: spec.authorTime,
      goldTime: spec.goldTime,
      silverTime: spec.silverTime,
      bronzeTime: spec.bronzeTime,
      laps: spec.laps,
      comments: spec.comments,
      blocks
    };
  }
}
