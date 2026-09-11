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
        !root.TryGetProperty("ok", out var ok)
        || ok.ValueKind is not (JsonValueKind.True or JsonValueKind.False)
      )
      {
        return Failed(RecordValidationFailure.ProcessFailed);
      }
      if (ok.GetBoolean())
      {
        return new RecordValidationResult(true, RecordValidationFailure.None, null, null);
      }

      var code = root.TryGetProperty("code", out var codeValue) ? codeValue.GetString() : null;
      var index =
        root.TryGetProperty("index", out var indexValue)
        && indexValue.ValueKind == JsonValueKind.Number
          ? (int?)indexValue.GetInt32()
          : null;
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
