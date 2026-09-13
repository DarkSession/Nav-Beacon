using System.Diagnostics;

namespace NavBeacon.Server.Validation;

public enum BoundedProcessFailure
{
  None,
  TimedOut,
  OutputTooLarge,
  ProcessFailed,
}

public sealed record BoundedProcessResult(byte[] Output, BoundedProcessFailure Failure);

public sealed record BoundedNodeProcessOptions(
  string FileName,
  string ScriptPath,
  TimeSpan Timeout,
  int MaximumOutputBytes,
  IReadOnlyList<string>? Arguments = null
);

/// <summary>
/// Runs the one bounded Node command the server owns and reads its answer
/// (design, decision 8). The deadline and the output bound belong here, so both
/// modes of that command are held to them the same way.
/// </summary>
public sealed class BoundedNodeProcess(BoundedNodeProcessOptions options)
{
  public async Task<BoundedProcessResult> RunAsync(
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
        return Failed(BoundedProcessFailure.ProcessFailed);
      }
    }
    catch
    {
      return Failed(BoundedProcessFailure.ProcessFailed);
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

      return process.ExitCode != 0
        ? Failed(BoundedProcessFailure.ProcessFailed)
        : new BoundedProcessResult(output, BoundedProcessFailure.None);
    }
    catch (OutputLimitException)
    {
      Kill(process);
      return Failed(BoundedProcessFailure.OutputTooLarge);
    }
    catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
    {
      Kill(process);
      return Failed(BoundedProcessFailure.TimedOut);
    }
    catch (IOException)
    {
      // The command went away while the request was being written to it. A
      // request small enough to sit in the operating system's pipe buffer is
      // answered by the exit code below; a larger one blocks on a pipe nothing
      // is reading and ends here. Both are the command failing, and both
      // callers send batches far over that buffer, so this is the ordinary
      // shape of a missing or broken command rather than the edge of it.
      Kill(process);
      return Failed(BoundedProcessFailure.ProcessFailed);
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

  private static BoundedProcessResult Failed(BoundedProcessFailure failure) => new([], failure);

  private sealed class OutputLimitException : Exception;
}
