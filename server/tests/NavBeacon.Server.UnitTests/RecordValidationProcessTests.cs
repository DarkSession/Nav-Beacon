using NavBeacon.Server.Validation;

namespace NavBeacon.Server.UnitTests;

public sealed class RecordValidationProcessTests
{
  [Fact]
  public void Published_process_bounds_are_exact()
  {
    Assert.Equal(TimeSpan.FromSeconds(30), RecordValidationProcessOptions.DefaultTimeout);
    Assert.Equal(65_536, RecordValidationProcessOptions.DefaultMaximumOutputBytes);
  }

  [Fact]
  public async Task Output_at_64_KiB_is_accepted()
  {
    var result = await Process("exact").ValidateAsync("{}");

    Assert.True(result.IsValid);
  }

  [Fact]
  public async Task Output_one_byte_over_64_KiB_is_refused()
  {
    var result = await Process("over").ValidateAsync("{}");

    Assert.Equal(RecordValidationFailure.OutputTooLarge, result.Failure);
  }

  [Fact]
  public async Task Output_far_over_the_bound_is_refused_before_the_deadline()
  {
    var result = await Process("flood", TimeSpan.FromSeconds(30)).ValidateAsync("{}");

    Assert.Equal(RecordValidationFailure.OutputTooLarge, result.Failure);
  }

  [Fact]
  public async Task Timeout_is_refused()
  {
    var result = await Process("timeout", TimeSpan.FromMilliseconds(50)).ValidateAsync("{}");

    Assert.Equal(RecordValidationFailure.TimedOut, result.Failure);
  }

  [Fact]
  public async Task Non_zero_exit_is_refused()
  {
    var result = await Process("crash").ValidateAsync("{}");

    Assert.Equal(RecordValidationFailure.ProcessFailed, result.Failure);
  }

  [Fact]
  public async Task Missing_command_is_refused()
  {
    var process = new RecordValidationProcess(
      new RecordValidationProcessOptions(
        "a-command-that-does-not-exist",
        "unused",
        RecordValidationProcessOptions.DefaultTimeout,
        RecordValidationProcessOptions.DefaultMaximumOutputBytes
      )
    );

    var result = await process.ValidateAsync("{}");

    Assert.Equal(RecordValidationFailure.ProcessFailed, result.Failure);
  }

  [Fact]
  public async Task Empty_output_is_refused()
  {
    var result = await Process("empty").ValidateAsync("{}");

    Assert.Equal(RecordValidationFailure.ProcessFailed, result.Failure);
  }

  [Fact]
  public async Task Command_refusal_keeps_its_index()
  {
    var result = await Process("refuse").ValidateAsync("{}");

    Assert.Equal(RecordValidationFailure.Refused, result.Failure);
    Assert.Equal("invalid-record", result.Code);
    Assert.Equal(2, result.Index);
  }

  [Fact]
  public async Task A_request_larger_than_the_pipe_is_refused_when_the_command_is_gone()
  {
    // A missing bundle exits while the request is still being written. Anything
    // that fits the operating system's pipe buffer lands in it and the command
    // is answered by its exit code; anything larger blocks on a pipe with no
    // reader. Both callers can send far more than that buffer — a
    // synchronisation batch carries up to 100 changes and 1 MiB, and a journal
    // batch up to 100 `Loadout` lines and 4 MiB — so the larger request needs
    // an answer of its own.
    var process = new RecordValidationProcess(
      new RecordValidationProcessOptions(
        "node",
        Path.Combine(AppContext.BaseDirectory, "Fixtures", "no-such-validator.mjs"),
        RecordValidationProcessOptions.DefaultTimeout,
        RecordValidationProcessOptions.DefaultMaximumOutputBytes
      )
    );

    var result = await process.ValidateAsync(new string('x', 1_048_576));

    Assert.Equal(RecordValidationFailure.ProcessFailed, result.Failure);
  }

  private static RecordValidationProcess Process(
    string mode,
    TimeSpan? timeout = null
  )
  {
    var fixture = Path.Combine(AppContext.BaseDirectory, "Fixtures", "validator-process.mjs");
    return new RecordValidationProcess(
      new RecordValidationProcessOptions(
        "node",
        fixture,
        timeout ?? RecordValidationProcessOptions.DefaultTimeout,
        RecordValidationProcessOptions.DefaultMaximumOutputBytes,
        [mode]
      )
    );
  }
}
