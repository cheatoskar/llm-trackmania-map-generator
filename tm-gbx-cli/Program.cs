using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Text.Json.Serialization;
using GBX.NET;
using GBX.NET.Engines.Game;
using GBX.NET.LZO;

namespace TmGbxCli;

public class BlockData
{
    [JsonPropertyName("name")]
    public string Name { get; set; } = string.Empty;

    [JsonPropertyName("x")]
    public int X { get; set; }

    [JsonPropertyName("y")]
    public int Y { get; set; }

    [JsonPropertyName("z")]
    public int Z { get; set; }

    [JsonPropertyName("dir")]
    public string Dir { get; set; } = "North";
}

public class TrackJsonModel
{
    [JsonPropertyName("mapName")]
    public string MapName { get; set; } = "AI Generated Track";

    [JsonPropertyName("author")]
    public string Author { get; set; } = "Claude AI";

    [JsonPropertyName("template")]
    public string? Template { get; set; }

    [JsonPropertyName("blocks")]
    public List<BlockData> Blocks { get; set; } = new();
}

public class CatalogEntry
{
    [JsonPropertyName("name")]
    public string Name { get; set; } = string.Empty;

    [JsonPropertyName("category")]
    public string Category { get; set; } = "General";

    [JsonPropertyName("count")]
    public int Frequency { get; set; }

    [JsonPropertyName("sampleCoordinates")]
    public List<string> SampleCoordinates { get; set; } = new();
}

class Program
{
    static int Main(string[] args)
    {
        Gbx.LZO = new Lzo();

        if (args.Length == 0)
        {
            PrintUsage();
            return 1;
        }

        string command = args[0].ToLowerInvariant();
        try
        {
            switch (command)
            {
                case "gbx2json":
                    return HandleGbx2Json(args);
                case "json2gbx":
                    return HandleJson2Gbx(args);
                case "extract-replays":
                    return HandleExtractReplays(args);
                case "create-template":
                    return HandleCreateTemplate(args);
                case "catalog":
                    return HandleCatalog(args);
                case "debug":
                    return HandleDebug(args);
                default:
                    Console.Error.WriteLine($"Unknown command: {command}");
                    PrintUsage();
                    return 1;
            }
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"Error: {ex.Message}\n{ex.StackTrace}");
            return 1;
        }
    }

    static void PrintUsage()
    {
        Console.WriteLine("Trackmania GBX CLI Bridge (GBX.NET)");
        Console.WriteLine("Usage:");
        Console.WriteLine("  tm-gbx-cli gbx2json <input.gbx> <output.json>");
        Console.WriteLine("  tm-gbx-cli json2gbx <input.json> <template.gbx> <output.gbx>");
        Console.WriteLine("  tm-gbx-cli extract-replays <replaysFolder> <outputFolder>");
        Console.WriteLine("  tm-gbx-cli create-template <source.gbx> <blankTemplate.gbx>");
        Console.WriteLine("  tm-gbx-cli catalog <mapsFolder> <outputCatalog.json>");
    }

    static int HandleGbx2Json(string[] args)
    {
        if (args.Length < 3)
        {
            Console.Error.WriteLine("Usage: tm-gbx-cli gbx2json <input.gbx> <output.json>");
            return 1;
        }

        string inputPath = args[1];
        string outputPath = args[2];

        if (!File.Exists(inputPath))
        {
            Console.Error.WriteLine($"Input file does not exist: {inputPath}");
            return 1;
        }

        var gbx = Gbx.Parse<CGameCtnChallenge>(inputPath);
        if (gbx.Node == null)
        {
            Console.Error.WriteLine("Failed to parse map node.");
            return 1;
        }

        var map = gbx.Node;
        var model = new TrackJsonModel
        {
            MapName = map.MapName ?? "Unknown",
            Author = map.AuthorLogin ?? "Unknown",
            Blocks = new List<BlockData>()
        };

        if (map.Blocks != null)
        {
            foreach (var b in map.Blocks)
            {
                model.Blocks.Add(new BlockData
                {
                    Name = b.Name,
                    X = b.Coord.X,
                    Y = b.Coord.Y,
                    Z = b.Coord.Z,
                    Dir = b.Direction.ToString()
                });
            }
        }

        var options = new JsonSerializerOptions { WriteIndented = true };
        string json = JsonSerializer.Serialize(model, options);
        File.WriteAllText(outputPath, json);
        Console.WriteLine($"Successfully exported {model.Blocks.Count} blocks to {outputPath}");
        return 0;
    }

    static int HandleJson2Gbx(string[] args)
    {
        if (args.Length < 4)
        {
            Console.Error.WriteLine("Usage: tm-gbx-cli json2gbx <input.json> <template.gbx> <output.gbx>");
            return 1;
        }

        string jsonPath = args[1];
        string templatePath = args[2];
        string outputPath = args[3];

        if (!File.Exists(jsonPath))
        {
            Console.Error.WriteLine($"JSON file not found: {jsonPath}");
            return 1;
        }
        if (!File.Exists(templatePath))
        {
            Console.Error.WriteLine($"Template file not found: {templatePath}");
            return 1;
        }

        string jsonContent = File.ReadAllText(jsonPath);
        var model = JsonSerializer.Deserialize<TrackJsonModel>(jsonContent);
        if (model == null)
        {
            Console.Error.WriteLine("Invalid JSON format.");
            return 1;
        }

        var gbx = Gbx.Parse<CGameCtnChallenge>(templatePath);
        if (gbx.Node == null)
        {
            Console.Error.WriteLine("Failed to parse template map node.");
            return 1;
        }

        var map = gbx.Node;
        if (!string.IsNullOrEmpty(model.MapName))
            map.MapName = model.MapName;
        if (!string.IsNullOrEmpty(model.Author))
            map.AuthorLogin = model.Author;

        // Clear any custom texture mod and embedded thumbnail
        map.ModPackDesc = null;
        map.CustomMusicPackDesc = null;
        map.Thumbnail = null;
        map.HasCustomCamThumbnail = false;

        map.Blocks.Clear();

        foreach (var b in model.Blocks)
        {
            Direction dir = Direction.North;
            if (Enum.TryParse<Direction>(b.Dir, true, out var parsedDir))
            {
                dir = parsedDir;
            }

            map.Blocks.Add(new CGameCtnBlock
            {
                Name = b.Name,
                Coord = new Int3(b.X, b.Y, b.Z),
                Direction = dir
            });
        }

        string? outDir = Path.GetDirectoryName(outputPath);
        if (!string.IsNullOrEmpty(outDir) && !Directory.Exists(outDir))
        {
            Directory.CreateDirectory(outDir);
        }

        gbx.Save(outputPath);
        Console.WriteLine($"Successfully generated map '{map.MapName}' with {map.Blocks.Count} blocks at {outputPath}");
        return 0;
    }

    static int HandleExtractReplays(string[] args)
    {
        if (args.Length < 3)
        {
            Console.Error.WriteLine("Usage: tm-gbx-cli extract-replays <replaysFolder> <outputFolder>");
            return 1;
        }

        string replayFolder = args[1];
        string outputFolder = args[2];

        if (!Directory.Exists(replayFolder))
        {
            Console.Error.WriteLine($"Replay folder not found: {replayFolder}");
            return 1;
        }

        Directory.CreateDirectory(outputFolder);
        int extracted = 0;

        foreach (var file in Directory.GetFiles(replayFolder, "*.Replay.gbx", SearchOption.AllDirectories))
        {
            try
            {
                var gbx = Gbx.Parse<CGameCtnReplayRecord>(file);
                if (gbx.Node?.Challenge != null)
                {
                    string safeName = Path.GetFileNameWithoutExtension(file).Replace(".Replay", "") + ".Challenge.Gbx";
                    string targetFile = Path.Combine(outputFolder, safeName);
                    
                    var challengeGbx = new Gbx<CGameCtnChallenge>(gbx.Node.Challenge);
                    challengeGbx.Save(targetFile);
                    Console.WriteLine($"Extracted map from replay: {safeName}");
                    extracted++;
                }
            }
            catch (Exception ex)
            {
                Console.WriteLine($"Skipping {Path.GetFileName(file)}: {ex.Message}");
            }
        }

        Console.WriteLine($"Extracted {extracted} reference maps to {outputFolder}");
        return 0;
    }

    static int HandleCreateTemplate(string[] args)
    {
        if (args.Length < 3)
        {
            Console.Error.WriteLine("Usage: tm-gbx-cli create-template <source.gbx> <blankTemplate.gbx>");
            return 1;
        }

        string sourcePath = args[1];
        string templatePath = args[2];

        var gbx = Gbx.Parse<CGameCtnChallenge>(sourcePath);
        if (gbx.Node == null)
        {
            Console.Error.WriteLine("Failed to load source challenge.");
            return 1;
        }

        gbx.Node.MapName = "Blank Stadium Template";
        gbx.Node.AuthorLogin = "System";
        gbx.Node.Blocks.Clear();
        gbx.Node.ModPackDesc = null;
        gbx.Node.CustomMusicPackDesc = null;
        gbx.Node.Thumbnail = null;
        gbx.Node.HasCustomCamThumbnail = false;

        string? dir = Path.GetDirectoryName(templatePath);
        if (!string.IsNullOrEmpty(dir) && !Directory.Exists(dir))
            Directory.CreateDirectory(dir);

        gbx.Save(templatePath);
        Console.WriteLine($"Created clean blank template map at {templatePath}");
        return 0;
    }

    static int HandleCatalog(string[] args)
    {
        if (args.Length < 3)
        {
            Console.Error.WriteLine("Usage: tm-gbx-cli catalog <mapsFolder> <outputCatalog.json>");
            return 1;
        }

        string mapsFolder = args[1];
        string outputCatalog = args[2];

        if (!Directory.Exists(mapsFolder))
        {
            Console.Error.WriteLine($"Folder does not exist: {mapsFolder}");
            return 1;
        }

        var blockStats = new Dictionary<string, (int Count, HashSet<string> Coords)>();

        foreach (var file in Directory.GetFiles(mapsFolder, "*.Challenge.Gbx", SearchOption.AllDirectories))
        {
            try
            {
                var gbx = Gbx.Parse<CGameCtnChallenge>(file);
                if (gbx.Node?.Blocks != null)
                {
                    foreach (var b in gbx.Node.Blocks)
                    {
                        if (!blockStats.TryGetValue(b.Name, out var stat))
                        {
                            stat = (0, new HashSet<string>());
                            blockStats[b.Name] = stat;
                        }
                        blockStats[b.Name] = (stat.Count + 1, stat.Coords);
                        if (stat.Coords.Count < 3)
                        {
                            stat.Coords.Add($"Coord=({b.Coord.X},{b.Coord.Y},{b.Coord.Z}), Dir={b.Direction}");
                        }
                    }
                }
            }
            catch (Exception ex)
            {
                Console.WriteLine($"Skipped {Path.GetFileName(file)}: {ex.Message}");
            }
        }

        var catalog = new List<CatalogEntry>();
        foreach (var kvp in blockStats.OrderByDescending(x => x.Value.Count))
        {
            string category = CategorizeBlock(kvp.Key);
            catalog.Add(new CatalogEntry
            {
                Name = kvp.Key,
                Category = category,
                Frequency = kvp.Value.Count,
                SampleCoordinates = kvp.Value.Coords.ToList()
            });
        }

        var options = new JsonSerializerOptions { WriteIndented = true };
        File.WriteAllText(outputCatalog, JsonSerializer.Serialize(catalog, options));
        Console.WriteLine($"Catalog generated with {catalog.Count} unique block types saved to {outputCatalog}");
        return 0;
    }

    static string CategorizeBlock(string name)
    {
        if (name.Contains("Start")) return "Start";
        if (name.Contains("Finish")) return "Finish";
        if (name.Contains("Checkpoint") || name.Contains("CheckPoint")) return "Checkpoint";
        if (name.Contains("Slope") || name.Contains("Ramp") || name.Contains("Tilt")) return "Elevation/Transition";
        if (name.Contains("Loop") || name.Contains("Tube")) return "Acrobatic";
        if (name.Contains("Corner") || name.Contains("Curve") || name.Contains("Turn") || name.Contains("Diag")) return "Turn/Curve";
        if (name.Contains("Road")) return "Road";
        if (name.Contains("Platform")) return "Platform";
        if (name.Contains("Water")) return "Scenery/Obstacle";
        if (name.Contains("Inflatable") || name.Contains("Sculpt") || name.Contains("Pillar") || name.Contains("Control")) return "Decoration";
        return "General";
    }

    static int HandleDebug(string[] args)
    {
        string sample = @"..\data\templates\blank_stadium.Challenge.Gbx";
        var gbx = Gbx.Parse<CGameCtnChallenge>(sample);
        var map = gbx.Node;

        Console.WriteLine("=== Template Inspection ===");
        Console.WriteLine($"MapName: {map.MapName}");
        Console.WriteLine($"AuthorLogin: {map.AuthorLogin}");
        Console.WriteLine($"ModPackDesc: '{map.ModPackDesc}'");
        Console.WriteLine($"Thumbnail bytes: {map.Thumbnail?.Length ?? 0}");

        Console.WriteLine("\n=== FinishLine in all reference maps ===");
        var files = Directory.GetFiles(@"..\data\reference_maps", "*.Challenge.Gbx");
        foreach (var f in files)
        {
            var g = Gbx.Parse<CGameCtnChallenge>(f);
            var finish = g.Node?.Blocks?.FirstOrDefault(b => b.Name.Contains("FinishLine"));
            if (finish != null)
            {
                var roadIn = g.Node.Blocks.FirstOrDefault(b => b != finish && Math.Abs(b.Coord.Y - finish.Coord.Y) <= 1 && Math.Abs(b.Coord.X - finish.Coord.X) + Math.Abs(b.Coord.Z - finish.Coord.Z) == 1);
                if (roadIn != null)
                {
                    int dx = finish.Coord.X - roadIn.Coord.X;
                    int dz = finish.Coord.Z - roadIn.Coord.Z;
                    Console.WriteLine($"Map: {Path.GetFileNameWithoutExtension(f)}: Road {roadIn.Name} ({roadIn.Coord.X},{roadIn.Coord.Y},{roadIn.Coord.Z}) Dir={roadIn.Direction} --> Finish ({finish.Coord.X},{finish.Coord.Y},{finish.Coord.Z}) Dir={finish.Direction} [Offset to Finish: dx={dx}, dz={dz}]");
                }
            }
        }

        return 0;
    }
}
