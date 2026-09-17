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
          // 1. BiSlopeStart (length 2) starts at current Y and transitions to incline (spans 2 cells)
          // 2. BiSlopeEnd (length 2) is placed 2 blocks forward and 1 level higher (Y+1), transitions to flat road at Y+2
          // 3. Flat road resumes at Y+2
          const vec = DIR_VECTORS[currentDir];
          
          currentX += vec.dx;
          currentZ += vec.dz;
          blocks.push({
            name: 'StadiumRoadMainBiSlopeStart',
            x: currentX,
            y: currentY,
            z: currentZ,
            dir: currentDir
          });

          // BiSlopeEnd is placed 2 blocks forward and 1 level higher
          currentX += 2 * vec.dx;
          currentZ += 2 * vec.dz;
          currentY += 1;
          blocks.push({
            name: 'StadiumRoadMainBiSlopeEnd',
            x: currentX,
            y: currentY,
            z: currentZ,
            dir: currentDir
          });

          // BiSlopeEnd covers 2 cells. Advance cursor by 1 cell so the next action
          // (which also advances by 1 cell) lands flush at +2 cells from BiSlopeEnd
          currentX += vec.dx;
          currentZ += vec.dz;
          currentY += 1; // Flat road height is now currentY + 2
          break;
        }

        case 'slope_down': {
          // Trackmania Stadium BiSlope (Descending):
          // When descending in direction `currentDir`:
          // 1. BiSlopeEnd (length 2) is entered from the higher level, placed at Y-1.
          //    CRITICAL: In Trackmania (e.g. A03-Race), slopes face the direction of travel (currentDir)!
          // 2. BiSlopeStart (length 2) is placed 2 blocks forward at Y-2, leveling out to flat road.
          // 3. Flat road resumes at ground level (currentY - 2).
          const vec = DIR_VECTORS[currentDir];
          const oppDir = DIRECTIONS[(DIRECTIONS.indexOf(currentDir) + 2) % 4];

          currentX += vec.dx;
          currentZ += vec.dz;
          currentY -= 1;
          blocks.push({
            name: 'StadiumRoadMainBiSlopeEnd',
            x: currentX,
            y: currentY,
            z: currentZ,
            dir: oppDir
          });

          currentX += 2 * vec.dx;
          currentZ += 2 * vec.dz;
          currentY -= 1;
          blocks.push({
            name: 'StadiumRoadMainBiSlopeStart',
            x: currentX,
            y: currentY,
            z: currentZ,
            dir: oppDir
          });

          // Advance cursor by 1 cell so the next action lands flush (+2 cells from BiSlopeStart)
          currentX += vec.dx;
          currentZ += vec.dz;
          break;
        }

        case 'turn_right': {
          const newDir = getTurnDir(currentDir, 'right');
          if (step.customBlock || style === 'Circuit') {
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
              name: 'StadiumRoadMainGTCurve2',
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
          if (step.customBlock || style === 'Circuit') {
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
            let anchorX = currentX;
            let anchorZ = currentZ;
            let nextCursorX = currentX;
            let nextCursorZ = currentZ;

            if (currentDir === 'North') {
              anchorX = currentX;
              anchorZ = currentZ + 1;
              nextCursorX = currentX + 1;
              nextCursorZ = currentZ + 2;
            } else if (currentDir === 'East') {
              anchorX = currentX - 2;
              anchorZ = currentZ;
              nextCursorX = currentX - 2;
              nextCursorZ = currentZ + 1;
            } else if (currentDir === 'South') {
              anchorX = currentX - 1;
              anchorZ = currentZ - 2;
              nextCursorX = currentX - 1;
              nextCursorZ = currentZ - 2;
            } else if (currentDir === 'West') {
              anchorX = currentX + 1;
              anchorZ = currentZ - 1;
              nextCursorX = currentX + 2;
              nextCursorZ = currentZ - 1;
            }

            blocks.push({
              name: 'StadiumRoadMainGTCurve2',
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
      }
    }

    return {
      mapName: spec.mapName,
      author: spec.author ?? 'Claude AI',
      blocks
    };
  }
}
