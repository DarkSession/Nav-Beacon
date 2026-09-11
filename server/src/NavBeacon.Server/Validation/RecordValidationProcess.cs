using System.Diagnostics;
using System.Text;
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
  public async Task<RecordValidationResult> ValidateAsync(
    string requestJson,
    CancellationToken cancellationToken = default
  )
  {
    using var process = new Process
    {
      StartInfo = new ProcessStartInfo
      {
        FileName = options.FileName,
        RedirectStandardInput = true,
        RedirectStandardOutput = true,
        RedirectStandardError = true,
        UseShellExecute = false,
      },
    };
    process.StartInfo.ArgumentList.Add(options.ScriptPath);
    foreach (var argument in options.Arguments ?? [])
    {
      process.StartInfo.ArgumentList.Add(argument);
    }

    try
    {
      if (!process.Start())
      {
        return Failed(RecordValidationFailure.ProcessFailed);
      }
    }
    catch
    {
      return Failed(RecordValidationFailure.ProcessFailed);
    }

    using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
    timeout.CancelAfter(options.Timeout);

    try
    {
      var outputTask = ReadBoundedAsync(
        process.StandardOutput.BaseStream,
        options.MaximumOutputBytes,
        timeout.Token
      );
      var errorTask = process.StandardError.BaseStream.CopyToAsync(Stream.Null, timeout.Token);
      await process.StandardInput.WriteAsync(requestJson.AsMemory(), timeout.Token);
      process.StandardInput.Close();

      // Drain both pipes to their end before waiting for exit. A command that
      // writes past its bound stops being read, so waiting first would block on
      // a full pipe until the deadline and report a timeout instead of the
      // output bound that actually refused it.
      var output = await outputTask;
      await errorTask;
      await process.WaitForExitAsync(timeout.Token);

      if (process.ExitCode != 0)
      {
        return Failed(RecordValidationFailure.ProcessFailed);
      }

      using var document = JsonDocument.Parse(output);
      var root = document.RootElement;
      if (!root.TryGetProperty("ok", out var ok) || ok.ValueKind is not (JsonValueKind.True or JsonValueKind.False))
      {
        return Failed(RecordValidationFailure.ProcessFailed);
      }
      if (ok.GetBoolean())
      {
        return new RecordValidationResult(true, RecordValidationFailure.None, null, null);
      }

      var code = root.TryGetProperty("code", out var codeValue) ? codeValue.GetString() : null;
      var index = root.TryGetProperty("index", out var indexValue) && indexValue.ValueKind == JsonValueKind.Number
        ? (int?)indexValue.GetInt32()
        : null;
      return new RecordValidationResult(false, RecordValidationFailure.Refused, code, index);
    }
    catch (OutputLimitException)
    {
      Kill(process);
      return Failed(RecordValidationFailure.OutputTooLarge);
    }
    catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
    {
      Kill(process);
      return Failed(RecordValidationFailure.TimedOut);
    }
    catch (JsonException)
    {
      return Failed(RecordValidationFailure.ProcessFailed);
    }
    finally
    {
      if (!process.HasExited)
      {
        Kill(process);
      }
    }
  }

  private static async Task<byte[]> ReadBoundedAsync(
    Stream stream,
    int maximumBytes,
    CancellationToken cancellationToken
  )
  {
    using var output = new MemoryStream();
    var buffer = new byte[8192];
    while (true)
    {
      var read = await stream.ReadAsync(buffer, cancellationToken);
      if (read == 0) break;
      if (output.Length + read > maximumBytes) throw new OutputLimitException();
      output.Write(buffer, 0, read);
    }
    return output.ToArray();
  }

  private static void Kill(Process process)
  {
    try
    {
      if (!process.HasExited) process.Kill(true);
    }
    catch (InvalidOperationException) { }
  }

  private static RecordValidationResult Failed(RecordValidationFailure failure) =>
    new(false, failure, null, null);

  private sealed class OutputLimitException : Exception;
}
