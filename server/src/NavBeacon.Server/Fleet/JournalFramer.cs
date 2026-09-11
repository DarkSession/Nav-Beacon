using System.Text;
using System.Text.Json;

namespace NavBeacon.Server.Fleet;

/// <summary>What one framed line is to the fleet projection.</summary>
public enum JournalLineKind
{
  /// <summary>A line the fleet does not read. Its only effect is on the cursor.</summary>
  Ignored,

  /// <summary>A candidate Live `Loadout` line, for `inspectSlef` unchanged.</summary>
  Loadout,

  /// <summary>A sale that removes one projection.</summary>
  ShipSale,

  /// <summary>Frontier's own statement of the ships it holds.</summary>
  StoredShips,
}

public enum JournalLineStatus
{
  Framed,

  /// <summary>A non-empty line that is not one complete event.</summary>
  Malformed,

  /// <summary>A non-empty line past the 1 MiB bound.</summary>
  TooLarge,
}

public sealed record FramedJournalLine(
  int Index,
  JournalLineStatus Status,
  JournalLineKind Kind,
  string Text,
  long ShipId,
  IReadOnlyList<long> StoredShipIds
);

/// <summary>
/// Frames one dated journal response line by line and reads only what the
/// fleet needs from each: its event name, the ship identity it names and, for
/// `StoredShips`, the identities it lists. The line itself travels on unchanged
/// for `inspectSlef` (020/FR-013).
///
/// A journal is read in order and stops where it cannot go on, so this streams:
/// one line is materialised at a time and a caller that stops reading leaves the
/// rest of the response unparsed.
///
/// A `Fileheader` states which game wrote the lines that follow it. Only lines
/// under a Live header are candidates; anything else is framed, ignored and
/// passed over, because the fleet is the Live fleet.
/// </summary>
public sealed class JournalFramer(TextReader reader)
{
  private int index;
  private bool live = true;

  /// <summary>The next line, or `null` at the end of the response.</summary>
  public FramedJournalLine? Read()
  {
    var line = ReadLine(out var tooLarge);
    if (line is null)
    {
      return null;
    }

    var position = index++;
    if (tooLarge)
    {
      return new FramedJournalLine(
        position,
        JournalLineStatus.TooLarge,
        JournalLineKind.Ignored,
        string.Empty,
        0,
        []
      );
    }
    if (line.Trim().Length == 0)
    {
      return Framed(position, JournalLineKind.Ignored, line, 0, []);
    }

    JsonDocument document;
    try
    {
      document = JsonDocument.Parse(line);
    }
    catch (JsonException)
    {
      return Malformed(position);
    }

    using (document)
    {
      var root = document.RootElement;
      if (
        root.ValueKind != JsonValueKind.Object
        || !root.TryGetProperty("event", out var name)
        || name.ValueKind != JsonValueKind.String
        || !root.TryGetProperty("timestamp", out var timestamp)
        || timestamp.ValueKind != JsonValueKind.String
      )
      {
        return Malformed(position);
      }

      switch (name.GetString())
      {
        case "Fileheader":
          live = IsLive(root);
          return Framed(position, JournalLineKind.Ignored, line, 0, []);
        case "Loadout" when live && Identity(root, "ShipID") is long ship:
          return Framed(position, JournalLineKind.Loadout, line, ship, []);
        case "ShipyardSell" when live:
          var sold = Identity(root, "SellShipID") ?? Identity(root, "ShipID");
          return sold is long identity
            ? Framed(position, JournalLineKind.ShipSale, line, identity, [])
            : Framed(position, JournalLineKind.Ignored, line, 0, []);
        case "StoredShips" when live:
          return Framed(position, JournalLineKind.StoredShips, line, 0, StoredShips(root));
        default:
          return Framed(position, JournalLineKind.Ignored, line, 0, []);
      }
    }
  }

  /// <summary>
  /// Whether a file header states the Live game. Frontier serves Live journals
  /// here, so a header that states nothing is taken at its word; a header that
  /// states an earlier game is not.
  /// </summary>
  private static bool IsLive(JsonElement root)
  {
    if (
      root.TryGetProperty("gameversion", out var version)
      && version.ValueKind == JsonValueKind.String
      && int.TryParse(
        version.GetString()?.Split('.')[0],
        System.Globalization.NumberStyles.None,
        System.Globalization.CultureInfo.InvariantCulture,
        out var major
      )
    )
    {
      return major >= 4;
    }
    return !root.TryGetProperty("Odyssey", out var odyssey)
      || odyssey.ValueKind != JsonValueKind.False;
  }

  private static long? Identity(JsonElement root, string name) =>
    root.TryGetProperty(name, out var value)
    && value.ValueKind == JsonValueKind.Number
    && value.TryGetInt64(out var identity)
    && identity >= 0
      ? identity
      : null;

  private static IReadOnlyList<long> StoredShips(JsonElement root)
  {
    var ships = new List<long>();
    foreach (var set in (string[])["ShipsHere", "ShipsRemote"])
    {
      if (!root.TryGetProperty(set, out var entries) || entries.ValueKind != JsonValueKind.Array)
      {
        continue;
      }
      foreach (var entry in entries.EnumerateArray())
      {
        if (entry.ValueKind == JsonValueKind.Object && Identity(entry, "ShipID") is long identity)
        {
          ships.Add(identity);
        }
      }
    }
    return ships;
  }

  private static FramedJournalLine Framed(
    int position,
    JournalLineKind kind,
    string text,
    long shipId,
    IReadOnlyList<long> storedShipIds
  ) => new(position, JournalLineStatus.Framed, kind, text, shipId, storedShipIds);

  private static FramedJournalLine Malformed(int position) =>
    new(position, JournalLineStatus.Malformed, JournalLineKind.Ignored, string.Empty, 0, []);

  /// <summary>
  /// One line, up to the inclusive 1 MiB bound. A line past the bound is
  /// consumed to its end and reported rather than kept, so the caller can state
  /// the bound without the response staying in memory.
  /// </summary>
  private string? ReadLine(out bool tooLarge)
  {
    tooLarge = false;
    var builder = new StringBuilder();
    var read = reader.Read();
    if (read < 0)
    {
      return null;
    }

    while (read >= 0 && read != '\n')
    {
      if (!tooLarge)
      {
        builder.Append((char)read);
        if (builder.Length > FleetLimits.MaximumLineBytes)
        {
          tooLarge = true;
          builder.Clear();
        }
      }
      read = reader.Read();
    }

    if (tooLarge)
    {
      return string.Empty;
    }

    var line = builder.ToString().TrimEnd('\r');
    if (Encoding.UTF8.GetByteCount(line) > FleetLimits.MaximumLineBytes)
    {
      tooLarge = true;
      return string.Empty;
    }
    return line;
  }
}
