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

## 5. Metadata & Customization Options

LLMs and human designers can customize track properties in the JSON specification:

| Field | Type | Options / Format | Effect in Game |
| :--- | :--- | :--- | :--- |
| `mood` | `string` | `"Sunrise"`, `"Day"`, `"Sunset"`, `"Night"` | Sets stadium skybox, shadows, car headlights, and stadium floodlights. |
| `authorTime` | `number` | Seconds (e.g. `36.5`) or Milliseconds | Exact Target Author Medal time displayed in-game. |
| `goldTime` | `number` | Seconds or Milliseconds | Gold medal threshold. |
| `silverTime` | `number` | Seconds or Milliseconds | Silver medal threshold. |
| `bronzeTime` | `number` | Seconds or Milliseconds | Bronze medal threshold. |
| `laps` | `number` | `1` (Sprint) or `> 1` (Circuit / Laps) | Enables multi-lap race mode with active lap counters. |
| `comments` | `string` | Free text | Author description shown in TM track info screen. |
| `mod` | `string` | Texture Pack name (e.g. `"DesertMod"`) | Loads custom texture pack from `Skins\Stadium\Mod\`. |
| `modUrl` | `string` | Download Locator URL | Auto-downloads mod for multiplayer clients. |

---

## 6. Extended Block Catalog: Dirt, Tilt, Acrobatic & Scenery

### Dirt / Offroad Blocks (Transitions & Drift)
| Block Name | Purpose | Notes |
| :--- | :--- | :--- |
| `StadiumRoadDirtToRoad` | Dirt-to-Road Transition | Connects asphalt road directly to dirt trail |
| `StadiumRoadDirt` | Dirt Straight | Low-grip offroad surface |
| `StadiumRoadDirtCheckpoint` | Dirt Checkpoint | Offroad checkpoint gate |
| `StadiumRoadDirtGTCurve2` | 2x2 Dirt Curve | Wide banked dirt drift turn |

### Tilted Road Blocks (Banked Oval & Speedway)
| Block Name | Purpose | Notes |
| :--- | :--- | :--- |
| `StadiumRoadTiltStraight` | Tilted Straight | 45-degree banked asphalt speedway |
| `StadiumRoadTiltGTCurve2` | 2x2 Banked Curve | High-speed tilted turn |
| `StadiumRoadTiltTransition2Left` / `Right` | Tilt Entry/Exit | Smooth transition between flat road and tilt |

### Acrobatic & Looping Blocks
| Block Name | Dimensions | Purpose |
| :--- | :--- | :--- |
| `StadiumLoopLeft` / `Right` | Compound Loop | Full 360-degree vertical loop |
| `StadiumPlatformLoopStart` | Platform Incline | Enters high-altitude wallride |
| `StadiumPlatformWall4` / `Wall2` | Wallride Vertical Wall | 90-degree vertical driving surface |

### Scenery & Stadium Design Blocks
| Block Name | Placement Elevation | Visual Effect |
| :--- | :--- | :--- |
| `StadiumControlLight` | $Y \ge 2$ | Massive stadium floodlight tower (blazing in Night mood) |
| `StadiumInflatablePalmTree` | $Y \ge 2$ | Inflatable palm tree on stadium grass |
| `StadiumInflatableSnowTree` | $Y \ge 2$ | Inflatable winter snow tree |
| `StadiumFabricCross3x3Screen`| $Y \ge 2$ | Giant stadium LED video jumbotron |
| `StadiumControlRoadCamera` | $Y_{road} + 1$ | Overhead TV broadcast camera booth spanning over the road |
| `StadiumControlRoadGlass` | $Y_{road} + 1$ | Glass skybridge spanning across the race track |

---

## 7. Author Time (AT) Mechanics Explained

### In TrackMania Engine (Vanilla Editor):
When creating tracks manually in the TMNF editor, the Author Time is recorded when the author clicks **"Validate Track"** and drives the car across the finish line.
- The game saves the exact elapsed time down to the millisecond (`AuthorScore` / `AuthorTime`).
- The game embeds the physical driving inputs / replay replay ghost (`ReplayRecordInfo`).
- When another player beats the author's time, they earn the green Nadeo Author Medal.

### In the AI / GBX Generator:
Since the LLM designs the layout algorithmically without running a physics simulation in real-time:
1. **Manual / Custom Times:** The LLM can specify `"authorTime": 36.5` (and gold/silver/bronze). The GBX generator converts this to integer milliseconds (e.g. `36500ms`) and patches both the binary header chunks and the XML manifest.
2. **Automatic Estimation:** If no times are provided, the CLI computes an estimated target time based on track length and boosters (`blocks.Count * 1.5s`).
3. **Optional Replay Validation:** If you open an AI-generated map in the TMNF Editor and click "Validate", you can drive a real ghost run to embed your personal replay ghost into the map!

---

## 8. Ready-to-use LLM System Prompt Template

When instructing an LLM (via MCP or directly) to generate TrackMania tracks, use this system prompt:

```markdown
You are an expert TrackMania Nations Forever track designer.
Output ONLY valid JSON adhering to the TrackMania Turtle Specification:

Rules:
1. Start at Y >= 2 (terrain grass is at Y=1, never build at Y=1).
2. Stadium boundaries are 0 <= X <= 31 and 0 <= Z <= 31.
3. Use 'turn_right' and 'turn_left' for 90-degree 2x2 curves.
4. Use 'slope_up' and 'slope_down' for elevation changes (advances 4 blocks, climbs/drops 2 Y levels).
5. Ensure start runway has at least 2 straights or turbo before the first curve.
6. Checkpoint spacing should be 4-8 blocks apart.
7. Available moods: "Sunrise", "Day", "Sunset", "Night".
8. Include realistic authorTime, goldTime, silverTime, bronzeTime in seconds.
```
