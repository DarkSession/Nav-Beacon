using Microsoft.Extensions.Options;

namespace NavBeacon.Server.Validation;

public sealed class RecordValidationOptions
{
  public const string SectionName = "RecordValidation";

  /// <summary>The Node command that runs the bounded record validator.</summary>
  public string Command { get; set; } = "node";

  /// <summary>
  /// The validator bundle, read relative to the content root unless an absolute
  /// path is configured.
  /// </summary>
  public string ScriptPath { get; set; } =
    Path.Combine("..", "..", "validator", "dist", "commander-validator.mjs");

  public int TimeoutSeconds { get; set; } = 30;

  public int MaximumOutputBytes { get; set; } =
    RecordValidationProcessOptions.DefaultMaximumOutputBytes;
}

/// <summary>
/// Hands every live record in one bounded synchronisation request to the Node
/// command that carries the browser's own parsers and the pinned Almanac
/// packages (020/FR-012).
/// </summary>
public sealed class RecordValidator
{
  private readonly RecordValidationProcess process;

  public RecordValidator(IOptions<RecordValidationOptions> options, IHostEnvironment environment)
  {
    var settings = options.Value;
    var script = Path.IsPathRooted(settings.ScriptPath)
      ? settings.ScriptPath
      : Path.GetFullPath(Path.Combine(environment.ContentRootPath, settings.ScriptPath));
    process = new RecordValidationProcess(
      new RecordValidationProcessOptions(
        settings.Command,
        script,
        TimeSpan.FromSeconds(settings.TimeoutSeconds),
        settings.MaximumOutputBytes
      )
    );
  }

  public Task<RecordValidationResult> ValidateAsync(
    IReadOnlyList<string> records,
    CancellationToken cancellationToken
  ) => process.ValidateAsync($"{{\"records\":[{string.Join(',', records)}]}}", cancellationToken);
}
