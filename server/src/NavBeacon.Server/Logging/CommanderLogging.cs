namespace NavBeacon.Server.Logging;

public static class CommanderLogging
{
  /// <summary>
  /// Silences the framework's own logging, whatever the configuration says.
  ///
  /// The framework's request log carries the whole URL, and one of this
  /// application's URLs is the OAuth callback: its query holds the
  /// authorisation code, the OAuth state and the Frontier Customer ID. Server
  /// logs may not contain any of those, so this is not a level a deployment
  /// chooses — which is why the rules are not merely added alongside the
  /// configured ones (020/FR-003).
  ///
  /// A rule is selected by the length of the category it names, so a configured
  /// `Microsoft.AspNetCore` beats a `Microsoft` added here and a file or an
  /// environment variable could turn the request log back on. The framework's
  /// own rules are therefore taken out and these two put in their place, after
  /// configuration has contributed its own: `PostConfigure` runs last, and runs
  /// again on every reload.
  /// </summary>
  public static ILoggingBuilder AddCommanderLogging(this ILoggingBuilder logging)
  {
    logging.Services.PostConfigure<LoggerFilterOptions>(options =>
    {
      for (var index = options.Rules.Count - 1; index >= 0; index--)
      {
        if (IsFramework(options.Rules[index].CategoryName))
        {
          options.Rules.RemoveAt(index);
        }
      }

      options.Rules.Add(new LoggerFilterRule(null, "Microsoft", LogLevel.None, null));
      options.Rules.Add(new LoggerFilterRule(null, "System", LogLevel.None, null));
    });
    return logging;
  }

  public static IApplicationBuilder UseCommanderAccessLogging(this IApplicationBuilder app) =>
    app.UseMiddleware<SafeAccessLoggingMiddleware>();

  /// <summary>Whether a category names the framework rather than this application.</summary>
  private static bool IsFramework(string? categoryName) =>
    categoryName is not null
    && (
      categoryName.StartsWith("Microsoft", StringComparison.Ordinal)
      || categoryName.StartsWith("System", StringComparison.Ordinal)
    );
}
