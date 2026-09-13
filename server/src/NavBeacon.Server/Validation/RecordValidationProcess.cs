using System.Text.Json;

namespace NavBeacon.Server.Validation;

public enum RecordValidationFailure
{
  None,
  Refused,
  TimedOut,
  OutputTooLarge,
  ProcessFailed,
}

public sealed record RecordValidationResult(
  bool IsValid,
  RecordValidationFailure Failure,
  string? Code,
  int? Index
);

public sealed record RecordValidationProcessOptions(
  string FileName,
  string ScriptPath,
  TimeSpan Timeout,
  int MaximumOutputBytes,
  IReadOnlyList<string>? Arguments = null
)
{
  public static readonly TimeSpan DefaultTimeout = TimeSpan.FromSeconds(30);
  public const int DefaultMaximumOutputBytes = 64 * 1024;
}

public sealed class RecordValidationProcess(RecordValidationProcessOptions options)
{
  private readonly BoundedNodeProcess process = new(
    new BoundedNodeProcessOptions(
      options.FileName,
      options.ScriptPath,
      options.Timeout,
      options.MaximumOutputBytes,
      options.Arguments
    )
  );

  public async Task<RecordValidationResult> ValidateAsync(
    string requestJson,
    CancellationToken cancellationToken = default
  )
  {
    var run = await process.RunAsync(requestJson, cancellationToken);
    if (run.Failure != BoundedProcessFailure.None)
    {
      return Failed(
        run.Failure switch
        {
          BoundedProcessFailure.TimedOut => RecordValidationFailure.TimedOut,
          BoundedProcessFailure.OutputTooLarge => RecordValidationFailure.OutputTooLarge,
          _ => RecordValidationFailure.ProcessFailed,
        }
      );
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
        return Failed(RecordValidationFailure.ProcessFailed);
      }
      if (ok.GetBoolean())
      {
        return new RecordValidationResult(true, RecordValidationFailure.None, null, null);
      }

      // Read under its kind, as `ok` and `index` are, and the index under a
      // number it fits in. A command that answers either of another kind is a
      // command this server cannot read, and reading it regardless throws past
      // the batch refusal below (020/FR-012).
      var code =
        root.TryGetProperty("code", out var codeValue)
        && codeValue.ValueKind == JsonValueKind.String
          ? codeValue.GetString()
          : null;
      var index =
        root.TryGetProperty("index", out var indexValue)
        && indexValue.ValueKind == JsonValueKind.Number
        && indexValue.TryGetInt32(out var indexNumber)
          ? indexNumber
          : (int?)null;
      return new RecordValidationResult(false, RecordValidationFailure.Refused, code, index);
    }
    catch (JsonException)
    {
      return Failed(RecordValidationFailure.ProcessFailed);
    }
  }

  private static RecordValidationResult Failed(RecordValidationFailure failure) =>
    new(false, failure, null, null);
}
