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
    // Ground level in Trackmania Stadium is Y = 1!
    let currentX = spec.startX ?? 16;
    let currentY = spec.startY ?? 1;
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
          // In Trackmania Stadium, ascending smoothly requires BiSlopeStart -> BiSlopeEnd
          const vec = DIR_VECTORS[currentDir];
          // 1. Transition from flat to slope
          currentX += vec.dx;
          currentZ += vec.dz;
          blocks.push({
            name: 'StadiumRoadMainBiSlopeStart',
            x: currentX,
            y: currentY,
            z: currentZ,
            dir: currentDir
          });
          // 2. Transition from slope to flat at height Y + 1
          currentX += vec.dx;
          currentZ += vec.dz;
          currentY += 1;
          blocks.push({
            name: 'StadiumRoadMainBiSlopeEnd',
            x: currentX,
            y: currentY,
            z: currentZ,
            dir: currentDir
          });
          break;
        }

        case 'slope_down': {
          // Descending smoothly
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
          currentX += vec.dx;
          currentZ += vec.dz;
          currentY -= 1;
          blocks.push({
            name: 'StadiumRoadMainBiSlopeEnd',
            x: currentX,
            y: currentY,
            z: currentZ,
            dir: currentDir
          });
          break;
        }

        case 'turn_right': {
          const newDir = getTurnDir(currentDir, 'right');
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
          break;
        }

        case 'turn_left': {
          const newDir = getTurnDir(currentDir, 'left');
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
