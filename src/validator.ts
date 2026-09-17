import { TrackJsonModel, ValidationResult, ValidationIssue } from './types.js';

export class TrackValidator {
  public static validate(track: TrackJsonModel): ValidationResult {
    const issues: ValidationIssue[] = [];
    const coordMap = new Map<string, number>();

    let hasStart = false;
    let hasFinish = false;
    let checkpointCount = 0;

    if (!track.blocks || track.blocks.length === 0) {
      issues.push({
        type: 'error',
        message: 'Track contains no blocks.'
      });
      return {
        valid: false,
        issues,
        stats: { totalBlocks: 0, hasStart: false, hasFinish: false, checkpointCount: 0 }
      };
    }

    track.blocks.forEach((block, index) => {
      const name = block.name.toLowerCase();

      if (name.includes('start')) {
        hasStart = true;
      }
      if (name.includes('finish')) {
        hasFinish = true;
      }
      if (name.includes('checkpoint')) {
        checkpointCount++;
      }

      const key = `${block.x},${block.y},${block.z}`;
      if (coordMap.has(key)) {
        const prevIndex = coordMap.get(key)!;
        issues.push({
          type: 'warning',
          message: `Coordinate collision at (${block.x}, ${block.y}, ${block.z}): Block #${index} ('${block.name}') overlaps with Block #${prevIndex} ('${track.blocks[prevIndex].name}').`,
          blockIndex: index,
          coordinate: [block.x, block.y, block.z]
        });
      } else {
        coordMap.set(key, index);
      }

      if (block.y < 2 && !name.includes('water') && !name.includes('pool') && !name.includes('dirt')) {
        issues.push({
          type: 'warning',
          message: `Block #${index} ('${block.name}') is at height Y=${block.y}. In TrackMania Stadium, ground level is Y=2. Blocks placed at Y=1 cut into the grass terrain and create void underneath unless placed over a pool/dirt foundation.`,
          blockIndex: index,
          coordinate: [block.x, block.y, block.z]
        });
      }
    });

    if (!hasStart) {
      issues.push({
        type: 'error',
        message: 'Missing Start block! Track must contain a start line (e.g. StadiumRoadMainStartLine).'
      });
    }

    if (!hasFinish) {
      issues.push({
        type: 'error',
        message: 'Missing Finish block! Track must contain a finish line (e.g. StadiumRoadMainFinishLine).'
      });
    }

    if (checkpointCount === 0 && track.blocks.length > 10) {
      issues.push({
        type: 'warning',
        message: 'Track has no checkpoints. For tracks with more than 10 blocks, consider adding at least one checkpoint.'
      });
    }

    const hasErrors = issues.some(i => i.type === 'error');

    return {
      valid: !hasErrors,
      issues,
      stats: {
        totalBlocks: track.blocks.length,
        hasStart,
        hasFinish,
        checkpointCount
      }
    };
  }
}
