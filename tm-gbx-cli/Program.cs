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
                case "analyze-slopes":
                    return HandleAnalyzeSlopes(args);
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

        // Generate a brand new unique MapUid to avoid collisions with existing tracks
        map.MapUid = GenerateMapUid();

        // Clear any custom texture mod and embedded thumbnail
        map.ModPackDesc = null;
        map.CustomMusicPackDesc = null;
        map.Thumbnail = null;
        map.HasCustomCamThumbnail = false;

        // Reset author time and medal times so the map is recognized as an unvalidated editable challenge
        map.AuthorTime = null;
        map.GoldTime = null;
        map.SilverTime = null;
        map.BronzeTime = null;
        if (map.ChallengeParameters != null)
        {
            map.ChallengeParameters.AuthorTime = null;
            map.ChallengeParameters.GoldTime = null;
            map.ChallengeParameters.SilverTime = null;
            map.ChallengeParameters.BronzeTime = null;
        }

        // Update MapInfo Ident so the game engine and menus sync perfectly
        map.MapInfo = new Ident(map.MapUid, "Stadium", map.AuthorLogin);
        // Set game mode to Race and Kind to InProgress (unvalidated editable challenge)
        map.Mode = CGameCtnChallenge.PlayMode.Race;
        map.Kind = CGameCtnChallenge.MapKind.InProgress;
        map.KindInHeader = CGameCtnChallenge.MapKind.InProgress;

        // Synchronize the XML header chunk with the new MapUid, MapName, and Author
        map.Xml = $"<header type=\"challenge\" version=\"TMc.6\" exever=\"2.11.3\"><ident uid=\"{map.MapUid}\" name=\"{map.MapName}\" author=\"{map.AuthorLogin}\"/><desc envir=\"Stadium\" mood=\"Day\" type=\"Race\" nblaps=\"0\" price=\"1000\" /><times bronze=\"-1\" silver=\"-1\" gold=\"-1\" authortime=\"-1\" authorscore=\"-1\"/><deps></deps></header>";

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
        gbx.Node.AuthorLogin = "osaro";
        gbx.Node.Blocks.Clear();
        gbx.Node.ModPackDesc = null;
        gbx.Node.CustomMusicPackDesc = null;
        gbx.Node.Thumbnail = null;
        gbx.Node.HasCustomCamThumbnail = false;
        gbx.Node.MapUid = GenerateMapUid();

        gbx.Node.AuthorTime = null;
        gbx.Node.GoldTime = null;
        gbx.Node.SilverTime = null;
        gbx.Node.BronzeTime = null;
        if (gbx.Node.ChallengeParameters != null)
        {
            gbx.Node.ChallengeParameters.AuthorTime = null;
            gbx.Node.ChallengeParameters.GoldTime = null;
            gbx.Node.ChallengeParameters.SilverTime = null;
            gbx.Node.ChallengeParameters.BronzeTime = null;
        }

        gbx.Node.MapInfo = new Ident(gbx.Node.MapUid, "Stadium", gbx.Node.AuthorLogin);
        gbx.Node.Mode = CGameCtnChallenge.PlayMode.Race;
        gbx.Node.Kind = CGameCtnChallenge.MapKind.InProgress;
        gbx.Node.KindInHeader = CGameCtnChallenge.MapKind.InProgress;
        gbx.Node.Xml = $"<header type=\"challenge\" version=\"TMc.6\" exever=\"2.11.3\"><ident uid=\"{gbx.Node.MapUid}\" name=\"{gbx.Node.MapName}\" author=\"{gbx.Node.AuthorLogin}\"/><desc envir=\"Stadium\" mood=\"Day\" type=\"Race\" nblaps=\"0\" price=\"290\" /><times bronze=\"-1\" silver=\"-1\" gold=\"-1\" authortime=\"-1\" authorscore=\"-1\"/><deps></deps></header>";

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

    static int HandleAnalyzeSlopes(string[] args)
    {
        string dir = args.Length > 1 ? args[1] : @"C:\Program Files (x86)\TmNationsForever\GameData\Tracks\Campaigns\Nations";
        Console.WriteLine($"Analyzing curve sequences in {dir}...");

        foreach (var file in Directory.GetFiles(dir, "*.Challenge.Gbx", SearchOption.AllDirectories))
        {
            try
            {
                var gbx = Gbx.Parse<CGameCtnChallenge>(file);
                if (gbx.Node?.Blocks == null) continue;

                var curves = gbx.Node.Blocks.Where(b => b.Name.StartsWith("StadiumRoadMainGTCurve")).ToList();
                if (curves.Count == 0) continue;

                Console.WriteLine($"\nFile: {Path.GetFileName(file)}");
                foreach (var c in curves.Take(3))
                {
                    Console.WriteLine($"  CURVE: {c.Name} at ({c.Coord.X}, {c.Coord.Y}, {c.Coord.Z}) dir={c.Direction}");
                    var nearby = gbx.Node.Blocks
                        .Where(b => b.Name.StartsWith("StadiumRoadMain") && Math.Abs(b.Coord.X - c.Coord.X) <= 3 && Math.Abs(b.Coord.Z - c.Coord.Z) <= 3)
                        .OrderBy(b => b.Coord.Z).ThenBy(b => b.Coord.X);
                    foreach (var nb in nearby)
                    {
                        Console.WriteLine($"    -> {nb.Name} at ({nb.Coord.X}, {nb.Coord.Y}, {nb.Coord.Z}) dir={nb.Direction}");
                    }
                }
            }
            catch {}
        }
        return 0;
    }

    static int HandleDebug(string[] args)
    {
        string sample = args.Length > 1 ? args[1] : Path.Combine("data", "templates", "blank_stadium.Challenge.Gbx");
        if (!File.Exists(sample))
        {
            Console.Error.WriteLine($"File not found: {sample}");
            return 1;
        }

        Console.WriteLine($"\n=== Inspecting: {sample} ===");
        var gbx = Gbx.Parse<CGameCtnChallenge>(sample);
        var map = gbx.Node;

        Console.WriteLine($"MapName: {map.MapName}");
        Console.WriteLine($"AuthorLogin: {map.AuthorLogin}");
        Console.WriteLine($"AuthorTime: {map.AuthorTime}");
        Console.WriteLine($"Mode: {map.Mode} (Type: {map.Mode.GetType().FullName})");
        Console.WriteLine($"Kind: {map.Kind} (Type: {map.Kind.GetType().FullName})");
        Console.WriteLine($"Collection: {map.Collection}");
        Console.WriteLine($"MapUid: {map.MapUid}");
        Console.WriteLine($"Blocks count: {map.Blocks?.Count ?? 0}");
        Console.WriteLine($"Thumbnail bytes: {map.Thumbnail?.Length ?? 0}");
        Console.WriteLine($"ModPack: {map.ModPackDesc?.FilePath} / {map.ModPackDesc?.LocatorUrl}");
        
        Console.WriteLine("Map properties:");
        foreach (var p in map.GetType().GetProperties(System.Reflection.BindingFlags.Public | System.Reflection.BindingFlags.Instance))
        {
            if (p.PropertyType.IsPrimitive || p.PropertyType == typeof(string) || p.PropertyType.IsEnum || p.PropertyType == typeof(GBX.NET.Ident))
            {
                try
                {
                    var v = p.GetValue(map);
                    if (v != null) Console.WriteLine($"  {p.Name}: {v}");
                } catch {}
            }
        }
        
        Console.WriteLine("Node chunks details:");
        foreach (var chunk in map.Chunks)
        {
            if (chunk.Id == 0x03043003 || chunk.Id == 0x03043005)
            {
                Console.WriteLine($"  0x{chunk.Id:X8} ({chunk.GetType().Name}):");
                foreach (var prop in chunk.GetType().GetProperties(System.Reflection.BindingFlags.Public | System.Reflection.BindingFlags.Instance))
                {
                    try
                    {
                        var val = prop.GetValue(chunk);
                        Console.WriteLine($"     {prop.Name} ({prop.PropertyType.Name}) = {val}");
                    }
                    catch { }
                }
            }
        }

        return 0;
    }

    static string GenerateMapUid()
    {
        const string chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_";
        var random = new Random();
        return new string(Enumerable.Repeat(chars, 27).Select(s => s[random.Next(s.Length)]).ToArray());
    }
}
