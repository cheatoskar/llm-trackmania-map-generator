# TrackMania Nations Forever – LLM Track Design Guide & Architecture Reference

This guide documents the technical rules, 3D coordinate system, block dimensions, and best practices for creating valid, playable, and competitive TrackMania Nations Forever (TMNF) tracks using the `trackmania-gbx-mcp` server or the standalone CLI.

---

## 1. World Coordinate System & Boundaries

The Stadium environment in TrackMania is a 3D discrete grid of cells:

| Axis | Range | Orientation in Game | Notes |
| :--- | :--- | :--- | :--- |
| **X** | 0 to 31 | West = +X, East = -X | 32 stadium blocks wide |
| **Z** | 0 to 31 | North = +Z, South = -Z | 32 stadium blocks deep |
| **Y** | 1 to 31 | Altitude / Height Level | Y=1 is terrain grass; Y >= 2 is buildable track level |

### Directions & Heading Vectors
When moving forward in direction D:
- **North:** dx = 0, dz = +1
- **East:** dx = -1, dz = 0
- **South:** dx = 0, dz = -1
- **West:** dx = +1, dz = 0

---

## 2. Fundamental Engineering Rules

### Rule 1: Minimum Elevation Y >= 2 (Terrain Integrity)
The Stadium grass terrain is located at Y = 1. Placing roads, curves, or platform blocks at Y = 1 cuts into the terrain mesh and exposes the underground void (skybox fall-through).

**Always build all ground-level tracks at Y >= 2.**

### Rule 2: Road Bitmask (Variant = 3)
In TrackMania Stadium, straight road blocks (`StadiumRoadMain`) contain a 2-bit connection bitmask controlling end-caps:
- `variant = 0`: Places guardrail barriers across both ends. Cars cannot pass through, and consecutive blocks appear disconnected with gaps.
- `variant = 3`: Removes barriers on both ends, creating an open, smooth through-road.

The MCP server and CLI automatically enforce `variant = 3` for all `StadiumRoadMain` blocks.

### Rule 3: Slopes & BiSlope Mechanics (Strides & 180° Inversion)
Climbing and descending elevation transitions use pairs of 2x1 slope blocks: `StadiumRoadMainBiSlopeStart` and `StadiumRoadMainBiSlopeEnd`. Each block has a physical length of 2 grid cells along its axis.

#### Incline (Slope Up – Going from Y to Y+2):
1. Place `StadiumRoadMainBiSlopeStart` at current Y, facing the **current travel direction**.
2. Advance cursor +2 cells forward, +1 in Y.
3. Place `StadiumRoadMainBiSlopeEnd` at Y+1, facing the **current travel direction**.
4. Advance cursor +2 cells forward. Flat road resumes at Y+2.

#### Decline (Slope Down – Going from Y to Y-2):
Downhill ramp blocks must be rotated **180 degrees** (`oppDir`) relative to the direction of motion, so the ramp slopes downwards towards the driving car.
1. Place `StadiumRoadMainBiSlopeEnd` at Y-1, facing **OPPOSITE direction** (180° rotated).
2. Advance cursor +2 cells forward, -1 in Y.
3. Place `StadiumRoadMainBiSlopeStart` at Y-2, facing **OPPOSITE direction** (180° rotated).
4. Advance cursor +2 cells forward. Flat road resumes at Y-2.

---

## 3. Block Catalog & Dimensions

### 1x1 Blocks (Single Cell)
| Block Name | Purpose | Description |
| :--- | :--- | :--- |
| `StadiumRoadMain` | Straight Road | Standard asphalt racing road |
| `StadiumRoadMainTurbo` | Boost Strip | High-speed yellow accelerator stripes |
| `StadiumRoadMainStartLine` | Start Grid | Green spawn archway with start lights |
| `StadiumRoadMainFinishLine` | Finish Line | Checkered race finish banner |
| `StadiumRoadMainCheckpoint` | Checkpoint | Ring checkpoint gate on road |

### 2x1 Blocks (Stride 2)
| Block Name | Footprint | Purpose |
| :--- | :--- | :--- |
| `StadiumRoadMainBiSlopeStart` | 2x1 | Lower transition between flat road and incline |
| `StadiumRoadMainBiSlopeEnd` | 2x1 | Upper transition between incline and elevated flat road |

### 2x2 Blocks (Banked Curves)
| Block Name | Footprint | Purpose |
| :--- | :--- | :--- |
| `StadiumRoadMainGTCurve2` | 2x2 | Banked 90-degree asphalt curve |
| `StadiumRoadMainGTDiag2x2` | 2x2 | Diagonal road transition |

#### Curve Math for `StadiumRoadMainGTCurve2`:
A 2x2 curve occupies [min(X), min(X)+1] x [min(Z), min(Z)+1]. Its block `dir` is set to the **new heading (exit direction)**:
- **Heading North -> Turn Right (East):** Anchor: (X-1, Z+1), Dir: East, New cursor: (X-1, Z+2)
- **Heading North -> Turn Left (West):** Anchor: (X, Z+1), Dir: West, New cursor: (X+1, Z+2)
- **Heading East -> Turn Right (South):** Anchor: (X-2, Z-1), Dir: South, New cursor: (X-2, Z-1)
- **Heading East -> Turn Left (North):** Anchor: (X-2, Z), Dir: North, New cursor: (X-2, Z+1)
- **Heading South -> Turn Right (West):** Anchor: (X, Z-2), Dir: West, New cursor: (X+1, Z-2)
- **Heading South -> Turn Left (East):** Anchor: (X-1, Z-2), Dir: East, New cursor: (X-1, Z-2)
- **Heading West -> Turn Right (North):** Anchor: (X+1, Z), Dir: North, New cursor: (X+2, Z+1)
- **Heading West -> Turn Left (South):** Anchor: (X+1, Z-1), Dir: South, New cursor: (X+2, Z-1)

---

## 4. Turtle Builder vs. Raw Blocks

### When to use Turtle Builder (`build_track_turtle`):
**Recommended for 95% of LLM track designs.** Turtle builder automatically takes care of:
- Step-by-step cursor arithmetic
- Correct 2x1 BiSlope strides and automatic 180° downhill flipping
- Proper 2x2 banked curve anchor positioning
- Road connectivity defaults (`variant = 3`)

#### Supported Turtle Actions:
```json
{
  "mapName": "My Circuit",
  "startX": 16,
  "startY": 2,
  "startZ": 10,
  "initialDirection": "North",
  "steps": [
    { "action": "start" },
    { "action": "forward", "count": 3 },
    { "action": "turbo", "count": 1 },
    { "action": "turn_right" },
    { "action": "forward", "count": 2 },
    { "action": "slope_up" },
    { "action": "checkpoint" },
    { "action": "forward", "count": 2 },
    { "action": "slope_down" },
    { "action": "turn_right" },
    { "action": "forward", "count": 2 },
    { "action": "finish" }
  ]
}
```

---

## 5. Track Flow & Pacing Recommendations

1. **Launch Runway:** Place 2-4 straight road blocks or a `turbo` right after `start` so the car gains forward momentum before the first curve.
2. **Transition Buffer:** Do not place a sharp 90-degree curve immediately adjacent to a slope. Provide at least 1-2 straight road blocks at the top and bottom of ramps for car suspension to settle.
3. **Checkpoint Spacing:** Place a checkpoint every 10-15 seconds of driving time, especially before risky features (bridges, jumps, chicanes).
4. **Finish Runway:** Provide 1-3 straight road blocks ahead of the finish line for high-speed crossings.
