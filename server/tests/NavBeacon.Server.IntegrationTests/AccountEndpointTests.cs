using System.Net;
using System.Text.Json;

namespace NavBeacon.Server.IntegrationTests;

public sealed class AccountEndpointTests(PostgreSqlDatabaseFixture database)
  : IClassFixture<PostgreSqlDatabaseFixture>
{
  [Fact]
  public async Task SignInSessionAntiforgeryAndSignOutUseOnlyBrowserSafeValues()
  {
    var frontier = new FakeFrontierClient
    {
      Authentication = FakeFrontierClient.Identity(
        40_001,
        "Test Commander",
        DateTimeOffset.UtcNow
      ),
    };
    var logs = new CapturingLoggerProvider();
    using var server = new CommanderTestServer(database, frontier, logs: logs);
    using var client = server.CreateClient();

    using var start = await client.PostAsync("api/auth/frontier", content: null);
    Assert.Equal(HttpStatusCode.OK, start.StatusCode);
    using var startJson = JsonDocument.Parse(await start.Content.ReadAsStringAsync());
    var location = new Uri(startJson.RootElement.GetProperty("authorisationUri").GetString()!);
    Assert.Equal("auth.frontierstore.net", location.Host);
    var state = CommanderTestServer.QueryValue(location, "state");
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

    var logText = logs.Text;
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

  /// <summary>
  /// The three ways a callback can arrive without a Commander signed in: with
  /// no authorisation code, which is what a Commander who declined at Frontier
  /// comes back with; with a state this browser did not start; and with a code
  /// Frontier itself would not exchange. All three send the browser back to the
  /// application with the same outcome and none of them opens a session.
  /// </summary>
  [Theory]
  [InlineData("declined")]
  [InlineData("unknown-state")]
  [InlineData("refused-code")]
  public async Task ACallbackThatSignsNobodyInOpensNoSession(string cause)
  {
    var frontier = new FakeFrontierClient
    {
      Authentication =
        cause == "refused-code"
          ? null
          : FakeFrontierClient.Identity(40_010, "Test Commander", DateTimeOffset.UtcNow),
    };
    using var server = new CommanderTestServer(database, frontier);
    using var client = server.CreateClient();

    using var start = await client.PostAsync("api/auth/frontier", content: null);
    using var startJson = JsonDocument.Parse(await start.Content.ReadAsStringAsync());
    var location = new Uri(startJson.RootElement.GetProperty("authorisationUri").GetString()!);
    var state = CommanderTestServer.QueryValue(location, "state");
    var address = cause switch
    {
      // Frontier sends a Commander who declined back with no code at all.
      "declined" => $"api/auth/frontier/callback?state={Uri.EscapeDataString(state)}",
      "unknown-state" => "api/auth/frontier/callback?code=authorisation-code&state=never-started",
      _ => $"api/auth/frontier/callback?code=authorisation-code&state={Uri.EscapeDataString(state)}",
    };

    using var callback = await client.GetAsync(address);

    Assert.Equal(HttpStatusCode.Redirect, callback.StatusCode);
    Assert.Equal("/?account=fresh-sign-in-required", callback.Headers.Location?.ToString());
    Assert.DoesNotContain(
      callback.Headers.TryGetValues("Set-Cookie", out var cookies) ? cookies : [],
      value => value.StartsWith("__Host-NavBeacon-Session=", StringComparison.Ordinal)
    );
    Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("api/session")).StatusCode);
  }
}
