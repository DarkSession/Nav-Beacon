namespace NavBeacon.Server.Logging;

public enum CommanderEventCategory
{
  OAuthCallback,
}

public enum CommanderResultCode
{
  SignInComplete,
  FreshSignInRequired,
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
        _ => throw new ArgumentOutOfRangeException(nameof(category)),
      },
      resultCode switch
      {
        CommanderResultCode.SignInComplete => "sign-in-complete",
        CommanderResultCode.FreshSignInRequired => "fresh-sign-in-required",
        _ => throw new ArgumentOutOfRangeException(nameof(resultCode)),
      },
      routeTemplate,
      null
    );
}
