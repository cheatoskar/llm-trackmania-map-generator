export type DirectionName = 'North' | 'East' | 'South' | 'West';

export interface BlockData {
  name: string;
  x: number;
  y: number;
  z: number;
  dir: DirectionName;
}

export interface TrackJsonModel {
  mapName: string;
  author: string;
  template?: string;
  blocks: BlockData[];
}

export interface CatalogEntry {
  name: string;
  category: string;
  count: number;
  sampleCoordinates: string[];
}

export type TurtleAction = 
  | 'start'
  | 'forward'
  | 'turn_left'
  | 'turn_right'
  | 'slope_up'
  | 'slope_down'
  | 'checkpoint'
  | 'finish';

export interface TurtleStep {
  action: TurtleAction;
  count?: number; // For 'forward', number of straight blocks (default 1)
  customBlock?: string;
}

export interface TurtleTrackSpec {
  mapName: string;
  author?: string;
  startX?: number; // default 16
  startY?: number; // default 9
  startZ?: number; // default 10
  initialDirection?: DirectionName; // default 'North'
  steps: TurtleStep[];
}

export interface ValidationIssue {
  type: 'error' | 'warning';
  message: string;
  blockIndex?: number;
  coordinate?: [number, number, number];
}

export interface ValidationResult {
  valid: boolean;
  issues: ValidationIssue[];
  stats: {
    totalBlocks: number;
    hasStart: boolean;
    hasFinish: boolean;
    checkpointCount: number;
  };
}
