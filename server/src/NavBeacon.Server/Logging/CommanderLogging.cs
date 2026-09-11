namespace NavBeacon.Server.Logging;

public static class CommanderLogging
{
  public static ILoggingBuilder AddCommanderLogging(this ILoggingBuilder logging)
  {
    logging.AddFilter("Microsoft", LogLevel.None);
    logging.AddFilter("System", LogLevel.None);
    return logging;
  }

  public static IApplicationBuilder UseCommanderAccessLogging(this IApplicationBuilder app) =>
    app.UseMiddleware<SafeAccessLoggingMiddleware>();
}
