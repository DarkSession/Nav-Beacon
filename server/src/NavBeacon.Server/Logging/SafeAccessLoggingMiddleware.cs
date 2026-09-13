using Microsoft.AspNetCore.Routing;

namespace NavBeacon.Server.Logging;

public sealed class SafeAccessLoggingMiddleware(RequestDelegate next)
{
  private static readonly Action<ILogger, string, string, string, Exception?> WriteAccess =
    LoggerMessage.Define<string, string, string>(
      LogLevel.Information,
      new EventId(1, "Access"),
      "EventCategory={EventCategory} ResultCode={ResultCode} RouteTemplate={RouteTemplate}"
    );

  public async Task InvokeAsync(HttpContext context, ILogger<SafeAccessLoggingMiddleware> logger)
  {
    var resultCode = "request-succeeded";
    try
    {
      await next(context);
      resultCode = ResultCode(context.Response.StatusCode);
    }
    catch
    {
      resultCode = "server-failure";
      throw;
    }
    finally
    {
      var routeTemplate =
        (context.GetEndpoint() as RouteEndpoint)?.RoutePattern.RawText ?? "unmatched";
      WriteAccess(logger, "http-access", resultCode, routeTemplate, null);
    }
  }

  private static string ResultCode(int statusCode) =>
    statusCode switch
    {
      < 400 => "request-succeeded",
      < 500 => "request-refused",
      _ => "server-failure",
    };
}
