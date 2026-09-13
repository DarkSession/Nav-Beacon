namespace NavBeacon.Server.Logging;

public enum CommanderEventCategory
{
  OAuthCallback,
  FleetRead,
  FleetRefresh,
}

public enum CommanderResultCode
{
  SignInComplete,
  FreshSignInRequired,
  FleetAccepted,
  FleetWaiting,
  FleetFailed,
  FleetUnavailable,
}

public sealed class CommanderEventLog(ILogger<CommanderEventLog> logger)
{
  private static readonly Action<ILogger, string, string, string, Exception?> WriteEvent =
    LoggerMessage.Define<string, string, string>(
      LogLevel.Information,
      new EventId(2, "CommanderEvent"),
      "EventCategory={EventCategory} ResultCode={ResultCode} RouteTemplate={RouteTemplate}"
    );

  public void Write(
    CommanderEventCategory category,
    CommanderResultCode resultCode,
    string routeTemplate
  ) =>
    WriteEvent(
      logger,
      category switch
      {
        CommanderEventCategory.OAuthCallback => "oauth-callback",
        CommanderEventCategory.FleetRead => "fleet-read",
        CommanderEventCategory.FleetRefresh => "fleet-refresh",
        _ => throw new ArgumentOutOfRangeException(nameof(category)),
      },
      resultCode switch
      {
        CommanderResultCode.SignInComplete => "sign-in-complete",
        CommanderResultCode.FreshSignInRequired => "fresh-sign-in-required",
        CommanderResultCode.FleetAccepted => "fleet-accepted",
        CommanderResultCode.FleetWaiting => "fleet-waiting",
        CommanderResultCode.FleetFailed => "fleet-failed",
        CommanderResultCode.FleetUnavailable => "fleet-unavailable",
        _ => throw new ArgumentOutOfRangeException(nameof(resultCode)),
      },
      routeTemplate,
      null
    );
}
