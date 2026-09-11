using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.AspNetCore.Routing.Patterns;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using NavBeacon.Server.Logging;

namespace NavBeacon.Server.UnitTests;

public sealed class SafeAccessLoggingMiddlewareTests
{
  private static readonly string[] ProtectedValues =
  [
    "123456789",
    "Private Commander",
    "access-token",
    "authorisation-code",
    "oauth-state",
    "browser-correlation",
    "anti-forgery-token",
    "session-cookie",
    "journal-body",
    "build-data",
    "loadout-data",
    "Private record",
    "8abfd536-4f44-48f0-a72f-f93e85073a0c",
    "4242",
    "package-diagnostic",
  ];

  [Theory]
  [InlineData(200, "request-succeeded")]
  [InlineData(400, "request-refused")]
  [InlineData(500, "server-failure")]
  public async Task RequestLogContainsOnlySafeFields(int statusCode, string resultCode)
  {
    var logger = new CapturingLogger<SafeAccessLoggingMiddleware>();
    var context = CallbackContext();
    var middleware = new SafeAccessLoggingMiddleware(nextContext =>
    {
      nextContext.Response.StatusCode = statusCode;
      return Task.CompletedTask;
    });

    await middleware.InvokeAsync(context, logger);

    var entry = Assert.Single(logger.Entries);
    Assert.Equal(
      new Dictionary<string, string?>
      {
        ["EventCategory"] = "http-access",
        ["ResultCode"] = resultCode,
        ["RouteTemplate"] = "api/auth/frontier/callback",
      },
      entry
    );
    AssertProtectedValuesAreAbsent(entry);
  }

  [Fact]
  public async Task ExceptionLogDoesNotContainExceptionOrRequestData()
  {
    var logger = new CapturingLogger<SafeAccessLoggingMiddleware>();
    var context = CallbackContext();
    var middleware = new SafeAccessLoggingMiddleware(_ =>
      throw new InvalidOperationException("access-token package-diagnostic")
    );

    await Assert.ThrowsAsync<InvalidOperationException>(() => middleware.InvokeAsync(context, logger));

    var entry = Assert.Single(logger.Entries);
    Assert.Equal("server-failure", entry["ResultCode"]);
    AssertProtectedValuesAreAbsent(entry);
  }

  [Fact]
  public async Task UnmatchedRequestUsesAConstantRouteValue()
  {
    var logger = new CapturingLogger<SafeAccessLoggingMiddleware>();
    var context = new DefaultHttpContext();
    context.Request.Path = "/records/8abfd536-4f44-48f0-a72f-f93e85073a0c";
    var middleware = new SafeAccessLoggingMiddleware(_ => Task.CompletedTask);

    await middleware.InvokeAsync(context, logger);

    Assert.Equal("unmatched", Assert.Single(logger.Entries)["RouteTemplate"]);
  }

  [Fact]
  public void FrameworkLogsAreDisabled()
  {
    var services = new ServiceCollection();
    services.AddLogging(logging =>
    {
      logging.AddProvider(new EnabledLoggerProvider());
      logging.AddCommanderLogging();
    });
    using var provider = services.BuildServiceProvider();
    var factory = provider.GetRequiredService<ILoggerFactory>();

    Assert.False(factory.CreateLogger("Microsoft.AspNetCore.Hosting.Diagnostics").IsEnabled(LogLevel.Critical));
    Assert.False(factory.CreateLogger("System.Net.Http.HttpClient").IsEnabled(LogLevel.Critical));
    Assert.True(factory.CreateLogger("NavBeacon.Server.Logging.SafeAccessLoggingMiddleware").IsEnabled(LogLevel.Information));
  }

  private static DefaultHttpContext CallbackContext()
  {
    var context = new DefaultHttpContext();
    context.Request.Path = "/api/auth/frontier/callback";
    context.Request.QueryString = new QueryString(
      "?code=authorisation-code&state=oauth-state&customerId=123456789&shipId=4242"
    );
    context.Request.Headers.Cookie = "session=session-cookie";
    context.Request.Headers["X-CSRF-TOKEN"] = "anti-forgery-token";
    context.Request.Body = new MemoryStream(
      System.Text.Encoding.UTF8.GetBytes(
        "Private Commander access-token browser-correlation journal-body build-data "
          + "loadout-data Private record package-diagnostic "
          + "8abfd536-4f44-48f0-a72f-f93e85073a0c"
      )
    );
    context.SetEndpoint(
      new RouteEndpoint(
        _ => Task.CompletedTask,
        RoutePatternFactory.Parse("api/auth/frontier/callback"),
        0,
        EndpointMetadataCollection.Empty,
        "callback"
      )
    );
    return context;
  }

  private static void AssertProtectedValuesAreAbsent(IReadOnlyDictionary<string, string?> entry)
  {
    var text = string.Join(' ', entry.Select(field => $"{field.Key}={field.Value}"));
    foreach (var value in ProtectedValues)
    {
      Assert.DoesNotContain(value, text, StringComparison.Ordinal);
    }
  }

  private sealed class CapturingLogger<T> : ILogger<T>
  {
    public List<IReadOnlyDictionary<string, string?>> Entries { get; } = [];

    public IDisposable? BeginScope<TState>(TState state)
      where TState : notnull => null;

    public bool IsEnabled(LogLevel logLevel) => true;

    public void Log<TState>(
      LogLevel logLevel,
      EventId eventId,
      TState state,
      Exception? exception,
      Func<TState, Exception?, string> formatter
    )
    {
      var fields = Assert.IsAssignableFrom<IEnumerable<KeyValuePair<string, object?>>>(state)
        .Where(field => field.Key != "{OriginalFormat}")
        .ToDictionary(field => field.Key, field => field.Value?.ToString());
      Entries.Add(fields);
      Assert.Null(exception);
    }
  }

  private sealed class EnabledLoggerProvider : ILoggerProvider
  {
    public ILogger CreateLogger(string categoryName) => new EnabledLogger();

    public void Dispose() { }

    private sealed class EnabledLogger : ILogger
    {
      public IDisposable? BeginScope<TState>(TState state)
        where TState : notnull => null;

      public bool IsEnabled(LogLevel logLevel) => true;

      public void Log<TState>(
        LogLevel logLevel,
        EventId eventId,
        TState state,
        Exception? exception,
        Func<TState, Exception?, string> formatter
      )
      { }
    }
  }
}
