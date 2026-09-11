using System.Collections.Concurrent;
using System.Net;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Logging;
using NavBeacon.Server.Frontier;

namespace NavBeacon.Server.IntegrationTests;

public sealed class AccountEndpointTests(PostgreSqlDatabaseFixture database)
  : IClassFixture<PostgreSqlDatabaseFixture>
{
  [Fact]
  public async Task SignInSessionAntiforgeryAndSignOutUseOnlyBrowserSafeValues()
  {
    var frontier = new FakeFrontierClient();
    var logs = new CapturingLoggerProvider();
    using var factory = CreateFactory(frontier, logs);
    using var client = factory.CreateClient(
      new WebApplicationFactoryClientOptions
      {
        AllowAutoRedirect = false,
        BaseAddress = new Uri("https://localhost"),
        HandleCookies = true,
      }
    );

    using var start = await client.PostAsync("api/auth/frontier", content: null);
    Assert.Equal(HttpStatusCode.OK, start.StatusCode);
    using var startJson = JsonDocument.Parse(await start.Content.ReadAsStringAsync());
    var location = new Uri(startJson.RootElement.GetProperty("authorisationUri").GetString()!);
    Assert.Equal("auth.frontierstore.net", location.Host);
    var state = QueryValue(location, "state");
    var correlationCookie = start.Headers
      .GetValues("Set-Cookie")
      .Single(value => value.StartsWith("__Host-NavBeacon-OAuth=", StringComparison.Ordinal));
    Assert.Contains("secure", correlationCookie, StringComparison.OrdinalIgnoreCase);
    Assert.Contains("httponly", correlationCookie, StringComparison.OrdinalIgnoreCase);
    Assert.Contains("samesite=lax", correlationCookie, StringComparison.OrdinalIgnoreCase);

    using var callback = await client.GetAsync(
      $"api/auth/frontier/callback?code=private-authorisation-code&state={Uri.EscapeDataString(state)}"
    );
    Assert.Equal(HttpStatusCode.Redirect, callback.StatusCode);
    Assert.Equal("/?account=signed-in", callback.Headers.Location?.ToString());
    var sessionCookie = callback.Headers
      .GetValues("Set-Cookie")
      .Single(value => value.StartsWith("__Host-NavBeacon-Session=", StringComparison.Ordinal));
    Assert.Contains("secure", sessionCookie, StringComparison.OrdinalIgnoreCase);
    Assert.Contains("httponly", sessionCookie, StringComparison.OrdinalIgnoreCase);
    Assert.Contains("samesite=lax", sessionCookie, StringComparison.OrdinalIgnoreCase);

    using var session = await client.GetAsync("api/session");
    Assert.Equal(HttpStatusCode.OK, session.StatusCode);
    var sessionText = await session.Content.ReadAsStringAsync();
    using var sessionJson = JsonDocument.Parse(sessionText);
    Assert.True(sessionJson.RootElement.GetProperty("signedIn").GetBoolean());
    Assert.Equal("40001", sessionJson.RootElement.GetProperty("customerId").GetString());
    Assert.Equal(
      "Test Commander",
      sessionJson.RootElement.GetProperty("commanderName").GetString()
    );
    var antiForgeryToken = sessionJson.RootElement.GetProperty("antiForgeryToken").GetString();
    Assert.False(string.IsNullOrWhiteSpace(antiForgeryToken));
    Assert.DoesNotContain("access-token", sessionText, StringComparison.Ordinal);
    Assert.DoesNotContain("refresh-token", sessionText, StringComparison.Ordinal);

    using var crossSiteSignOut = new HttpRequestMessage(HttpMethod.Post, "api/session/sign-out");
    crossSiteSignOut.Headers.Add("Origin", "https://attacker.example");
    using var refused = await client.SendAsync(crossSiteSignOut);
    Assert.Equal(HttpStatusCode.BadRequest, refused.StatusCode);
    Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("api/session")).StatusCode);

    using var signOut = new HttpRequestMessage(HttpMethod.Post, "api/session/sign-out");
    signOut.Headers.Add("X-CSRF-TOKEN", antiForgeryToken);
    using var signedOut = await client.SendAsync(signOut);
    Assert.Equal(HttpStatusCode.NoContent, signedOut.StatusCode);
    Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("api/session")).StatusCode);

    using var replay = await client.GetAsync(
      $"api/auth/frontier/callback?code=private-authorisation-code&state={Uri.EscapeDataString(state)}"
    );
    Assert.Equal("/?account=fresh-sign-in-required", replay.Headers.Location?.ToString());
    Assert.Equal(1, frontier.AuthenticationCalls);

    var logText = string.Join('\n', logs.Entries);
    Assert.Contains(
      "EventCategory=oauth-callback ResultCode=sign-in-complete RouteTemplate=api/auth/frontier/callback",
      logText,
      StringComparison.Ordinal
    );
    Assert.Contains(
      "EventCategory=oauth-callback ResultCode=fresh-sign-in-required RouteTemplate=api/auth/frontier/callback",
      logText,
      StringComparison.Ordinal
    );
    foreach (
      var protectedValue in new[]
      {
        "private-authorisation-code",
        state,
        correlationCookie.Split(';')[0],
        "40001",
        "Test Commander",
        "access-token",
        "refresh-token",
        antiForgeryToken,
      }
    )
    {
      Assert.DoesNotContain(protectedValue, logText, StringComparison.Ordinal);
    }
  }

  private WebApplicationFactory<Program> CreateFactory(
    IFrontierClient frontier,
    ILoggerProvider loggerProvider
  ) =>
    new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
    {
      builder.UseSetting("ConnectionStrings:NavBeacon", database.ConnectionString);
      builder.UseSetting("Frontier:ClientId", "client-id");
      builder.UseSetting("Frontier:ClientSecret", "client-secret");
      builder.UseSetting(
        "Frontier:RedirectUri",
        "https://localhost/api/auth/frontier/callback"
      );
      builder.ConfigureTestServices(services =>
      {
        services.RemoveAll<IFrontierClient>();
        services.AddSingleton(frontier);
        services.AddLogging(logging => logging.AddProvider(loggerProvider));
      });
    });

  private static string QueryValue(Uri address, string name) =>
    address
      .Query.TrimStart('?')
      .Split('&', StringSplitOptions.RemoveEmptyEntries)
      .Select(part => part.Split('=', 2))
      .Where(part => Uri.UnescapeDataString(part[0]) == name)
      .Select(part => Uri.UnescapeDataString(part[1]))
      .Single();

  private sealed class FakeFrontierClient : IFrontierClient
  {
    public int AuthenticationCalls { get; private set; }

    public Uri CreateAuthorisationUri(string state) =>
      new($"https://auth.frontierstore.net/auth?state={Uri.EscapeDataString(state)}");

    public Task<FrontierAuthentication?> AuthenticateAsync(
      string authorisationCode,
      CancellationToken cancellationToken
    )
    {
      AuthenticationCalls++;
      return Task.FromResult<FrontierAuthentication?>(
        new FrontierAuthentication(
          new FrontierTokens(
            "access-token",
            "refresh-token",
            DateTimeOffset.UtcNow.AddHours(1)
          ),
          new FrontierIdentity(40_001, "Test Commander")
        )
      );
    }

    public Task<FrontierTokens?> RefreshAsync(
      string refreshToken,
      CancellationToken cancellationToken
    ) => Task.FromResult<FrontierTokens?>(null);
  }

  private sealed class CapturingLoggerProvider : ILoggerProvider
  {
    public ConcurrentBag<string> Entries { get; } = [];

    public ILogger CreateLogger(string categoryName) => new CapturingLogger(Entries);

    public void Dispose() { }

    private sealed class CapturingLogger(ConcurrentBag<string> entries) : ILogger
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
      ) => entries.Add(formatter(state, exception));
    }
  }
}
