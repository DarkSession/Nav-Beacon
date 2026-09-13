using System.Globalization;
using System.Text.Json;
using Microsoft.Extensions.Options;
using NavBeacon.Server.Contracts;
using NavBeacon.Server.Validation;

namespace NavBeacon.Server.Fleet;

public enum ProjectionOutcome
{
  Projected,

  /// <summary>The package refused one candidate. The batch stops before it.</summary>
  Refused,

  /// <summary>The command timed out, crashed or wrote too much.</summary>
  Unavailable,
}

public sealed record ProjectionCandidate(long ShipId, DateOnly Date, int Line, string Text);

public sealed record ProjectedShip(long ShipId, DateOnly Date, int Line, string ModelJson);

public sealed record ProjectionResult(
  ProjectionOutcome Outcome,
  IReadOnlyList<ProjectedShip> Ships,
  int RefusedIndex,
  PackageRefusal? Refusal
);

public sealed class FleetProjectionOptions
{
  public const string SectionName = "FleetProjection";

  /// <summary>The Node command that runs the bounded projection.</summary>
  public string Command { get; set; } = "node";

  /// <summary>
  /// The one command bundle, read relative to the content root unless an
  /// absolute path is configured.
  /// </summary>
  public string ScriptPath { get; set; } =
    Path.Combine("..", "..", "validator", "dist", "commander-validator.mjs");

  public int TimeoutSeconds { get; set; } = 30;

  public int MaximumOutputBytes { get; set; } = FleetLimits.MaximumProjectionOutputBytes;
}

/// <summary>
/// Hands one bounded batch of candidate Live `Loadout` lines to the journal mode
/// of the server's one Node command, which passes each line unchanged to
/// `inspectSlef` and answers with package-produced ship models (020/FR-013,
/// design decision 8).
/// </summary>
public sealed class FleetProjector
{
  private static readonly JsonWriterOptions WriterOptions = new() { Indented = false };

  private readonly BoundedNodeProcess process;

  public FleetProjector(IOptions<FleetProjectionOptions> options, IHostEnvironment environment)
  {
    var settings = options.Value;
    var script = Path.IsPathRooted(settings.ScriptPath)
      ? settings.ScriptPath
      : Path.GetFullPath(Path.Combine(environment.ContentRootPath, settings.ScriptPath));
    process = new BoundedNodeProcess(
      new BoundedNodeProcessOptions(
        settings.Command,
        script,
        TimeSpan.FromSeconds(settings.TimeoutSeconds),
        settings.MaximumOutputBytes,
        ["journal"]
      )
    );
  }

  public async Task<ProjectionResult> ProjectAsync(
    IReadOnlyList<ProjectionCandidate> candidates,
    string locale,
    CancellationToken cancellationToken
  )
  {
    var run = await process.RunAsync(Request(candidates, locale), cancellationToken);
    if (run.Failure != BoundedProcessFailure.None)
    {
      return Unavailable;
    }

    try
    {
      using var document = JsonDocument.Parse(run.Output);
      var root = document.RootElement;
      if (
        root.ValueKind != JsonValueKind.Object
        || !root.TryGetProperty("ok", out var ok)
        || ok.ValueKind is not (JsonValueKind.True or JsonValueKind.False)
      )
      {
        return Unavailable;
      }

      return ok.GetBoolean() ? Accepted(root, candidates) : Refused(root, candidates);
    }
    catch (JsonException)
    {
      return Unavailable;
    }
  }

  private static ProjectionResult Accepted(
    JsonElement root,
    IReadOnlyList<ProjectionCandidate> candidates
  )
  {
    var projected = Ships(root, candidates, candidates.Count);
    return projected is null
      ? Unavailable
      : new ProjectionResult(ProjectionOutcome.Projected, projected, -1, null);
  }

  /// <summary>
  /// The models the command answered with, paired back to the candidates that
  /// asked for them. The command answers in request order and states how many,
  /// so a batch that comes back any other shape is no answer at all.
  /// </summary>
  private static IReadOnlyList<ProjectedShip>? Ships(
    JsonElement root,
    IReadOnlyList<ProjectionCandidate> candidates,
    int expected
  )
  {
    if (
      !root.TryGetProperty("ships", out var ships)
      || ships.ValueKind != JsonValueKind.Array
      || ships.GetArrayLength() != expected
    )
    {
      return null;
    }

    var projected = new List<ProjectedShip>(expected);
    var position = 0;
    foreach (var ship in ships.EnumerateArray())
    {
      if (!ship.TryGetProperty("model", out var model) || model.ValueKind != JsonValueKind.Object)
      {
        return null;
      }
      // The exact stored contract, read once more before PostgreSQL sees it, so
      // a field 020/FR-015 excludes cannot reach the fleet through the command.
      try
      {
        RemoteContractJson.ParseOwnedShip(model);
      }
      catch (JsonException)
      {
        return null;
      }
      var candidate = candidates[position++];
      projected.Add(
        new ProjectedShip(candidate.ShipId, candidate.Date, candidate.Line, model.GetRawText())
      );
    }

    return projected;
  }

  private static ProjectionResult Refused(
    JsonElement root,
    IReadOnlyList<ProjectionCandidate> candidates
  )
  {
    var index =
      root.TryGetProperty("index", out var value)
      && value.ValueKind == JsonValueKind.Number
      && value.TryGetInt32(out var number)
        ? number
        : -1;
    if (index < 0 || index >= candidates.Count)
    {
      return Unavailable;
    }

    PackageRefusal? refusal = null;
    if (
      root.TryGetProperty("refusal", out var stated)
      && stated.ValueKind == JsonValueKind.Object
      && stated.TryGetProperty("code", out var code)
      && code.ValueKind == JsonValueKind.String
    )
    {
      refusal = new PackageRefusal(
        code.GetString()!,
        Text(stated, "constraint"),
        Text(stated, "path"),
        Text(stated, "message")
      );
    }

    // Every candidate before the refused one is projected, and the service
    // commits that prefix before it stops on the refused line (020/FR-013).
    var accepted = Ships(root, candidates, index);
    return accepted is null
      ? Unavailable
      : new ProjectionResult(ProjectionOutcome.Refused, accepted, index, refusal);
  }

  private static string? Text(JsonElement element, string name) =>
    element.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String
      ? value.GetString()
      : null;

  private static string Request(IReadOnlyList<ProjectionCandidate> candidates, string locale)
  {
    using var buffer = new MemoryStream();
    using (var writer = new Utf8JsonWriter(buffer, WriterOptions))
    {
      writer.WriteStartObject();
      writer.WriteString("locale", locale);
      writer.WriteStartArray("lines");
      foreach (var candidate in candidates)
      {
        writer.WriteStartObject();
        writer.WriteNumber("shipId", candidate.ShipId);
        writer.WriteString("sourceDate", candidate.Date.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture));
        writer.WriteNumber("sourceLine", candidate.Line);
        writer.WriteString("text", candidate.Text);
        writer.WriteEndObject();
      }
      writer.WriteEndArray();
      writer.WriteEndObject();
    }
    return System.Text.Encoding.UTF8.GetString(buffer.ToArray());
  }

  private static ProjectionResult Unavailable =>
    new(ProjectionOutcome.Unavailable, [], -1, null);
}
