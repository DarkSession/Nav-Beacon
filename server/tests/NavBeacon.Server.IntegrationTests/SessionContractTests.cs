using System.Net;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using NavBeacon.Server.Accounts;
using NavBeacon.Server.Persistence;
using NavBeacon.Server.Security;

namespace NavBeacon.Server.IntegrationTests;

public sealed class SessionContractTests(PostgreSqlDatabaseFixture database)
  : IClassFixture<PostgreSqlDatabaseFixture>
{
  // The manual clock runs ahead of the real clock, so cookies the server dates
  // by that clock are still live in the test browser's cookie store.
  private static readonly DateTimeOffset InitialTime = new(
    DateTimeOffset.UtcNow.Date.AddDays(1),
    TimeSpan.Zero
  );

  [Fact]
  public async Task AnAnonymousBrowserHasNoSession()
  {
    using var server = NewServer(60_001, out _);
    using var client = server.CreateClient();

    using var response = await client.GetAsync("api/session");

    Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    var state = await ReadStateAsync(response);
    Assert.False(state.SignedIn);
    Assert.Null(state.AntiForgeryToken);
  }

  [Fact]
  public async Task AStartedSignInHasNoSessionUntilTheCallbackArrives()
  {
    using var server = NewServer(60_002, out _);
    using var client = server.CreateClient();
    await StartSignInAsync(client);

    using var response = await client.GetAsync("api/session");

    Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    var state = await ReadStateAsync(response);
    Assert.False(state.SignedIn);
  }

  // The browser refuses a session body whose property set is not exactly the one
  // it accepts, and the two halves of this exchange are built and tested apart.
  // Both read `session-response.contract.json`, so a property either side adds
  // alone fails here rather than leaving every Commander unable to sign in
  // (020/FR-001, 020/FR-003).
  [Fact]
  public async Task TheSessionAnswerCarriesExactlyThePropertiesTheBrowserAccepts()
  {
    using var server = NewServer(60_010, out _);
    using var client = server.CreateClient();

    using var anonymous = await client.GetAsync("api/session");
    Assert.Equal(ContractProperties("anonymous"), await PropertiesOfAsync(anonymous));

    await SignInAsync(client);
    using var signedIn = await client.GetAsync("api/session");
    Assert.Equal(ContractProperties("signedIn"), await PropertiesOfAsync(signedIn));
  }

  [Fact]
  public async Task ASignedInBrowserReadsItsCommanderAndReturnsToTheApplicationBase()
  {
    using var server = NewServer(60_003, out _, pathBase: "/nav-beacon");
    using var client = server.CreateClient();

    var signIn = await SignInAsync(client, "nav-beacon/");

    Assert.Equal("/nav-beacon/?account=signed-in", signIn.ReturnAddress);
    using var response = await client.GetAsync("nav-beacon/api/session");
    Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    var body = await response.Content.ReadAsStringAsync();
    var state = await ReadStateAsync(response);
    Assert.True(state.SignedIn);
    Assert.False(string.IsNullOrEmpty(state.AntiForgeryToken));
    Assert.DoesNotContain("access-token", body, StringComparison.Ordinal);
    Assert.DoesNotContain("refresh-token", body, StringComparison.Ordinal);
  }

  [Fact]
  public async Task ACallbackWithoutTheStartingBrowsersCookieIsRefusedForBothBrowsers()
  {
    var frontier = new FakeFrontierClient
    {
      Authentication = FakeFrontierClient.Identity(60_009, "Test Commander", InitialTime),
    };
    using var server = new CommanderTestServer(
      database,
      frontier,
      new ManualTimeProvider(InitialTime)
    );
    using var startingBrowser = server.CreateClient();
    var state = await StartSignInAsync(startingBrowser);
    var callbackAddress =
      $"api/auth/frontier/callback?code=authorisation-code&state={Uri.EscapeDataString(state)}";

    using var otherBrowser = server.CreateClient();
    using var refused = await otherBrowser.GetAsync(callbackAddress);

    Assert.Equal("/?account=fresh-sign-in-required", refused.Headers.Location?.ToString());
    Assert.DoesNotContain(
      refused.Headers.TryGetValues("Set-Cookie", out var refusedCookies)
        ? refusedCookies
        : [],
      value => value.StartsWith("__Host-NavBeacon-Session=", StringComparison.Ordinal)
    );

    using var replay = await startingBrowser.GetAsync(callbackAddress);

    Assert.Equal("/?account=fresh-sign-in-required", replay.Headers.Location?.ToString());
    Assert.Equal(0, frontier.AuthenticationCalls);
    Assert.Equal(
      HttpStatusCode.Unauthorized,
      (await startingBrowser.GetAsync("api/session")).StatusCode
    );
    await using var context = database.CreateContext();
    Assert.Empty(await context.Sessions.Where(item => item.CustomerId == 60_009).ToListAsync());
    Assert.Empty(
      await context.SynchronisedRecords.Where(item => item.CustomerId == 60_009).ToListAsync()
    );
    var stateHash = SecretHash.Compute(state);
    Assert.Empty(
      await context.OAuthAttempts.Where(item => item.StateHash == stateHash).ToListAsync()
    );
  }

  [Fact]
  public async Task ARevokedSessionIsRefusedAndItsRowIsRemoved()
  {
    using var server = NewServer(60_004, out _);
    using var client = server.CreateClient();
    var signIn = await SignInAsync(client);
    using var signedIn = await client.GetAsync("api/session");
    var antiForgeryToken = (await ReadStateAsync(signedIn)).AntiForgeryToken;
    using var signOut = new HttpRequestMessage(HttpMethod.Post, "api/session/sign-out");
    signOut.Headers.Add("X-CSRF-TOKEN", antiForgeryToken);
    using var signedOut = await client.SendAsync(signOut);
    Assert.Equal(HttpStatusCode.NoContent, signedOut.StatusCode);

    using var replayClient = server.CreateClient(handleCookies: false);
    using var replay = new HttpRequestMessage(HttpMethod.Get, "api/session");
    replay.Headers.Add("Cookie", signIn.SessionCookie);
    using var response = await replayClient.SendAsync(replay);

    Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    Assert.False((await ReadStateAsync(response)).SignedIn);
    await using var context = database.CreateContext();
    Assert.Empty(await context.Sessions.Where(item => item.CustomerId == 60_004).ToListAsync());
  }

  [Fact]
  public async Task TheThirtyDayRenewableLimitEndsTheSessionAndRemovesItsRow()
  {
    using var server = NewServer(60_005, out var clock);
    using var client = server.CreateClient();
    await SignInAsync(client);
    // The last moment of the renewable lifetime still works, and renews.
    clock.Advance(CommanderSessionService.RenewableLifetime - TimeSpan.FromTicks(1));
    Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("api/session")).StatusCode);
    var renewed = await ReadSessionRowAsync(60_005);
    Assert.Equal(
      renewed.LastRenewedAt.Add(CommanderSessionService.RenewableLifetime),
      renewed.RenewableExpiresAt
    );
    clock.Advance(CommanderSessionService.RenewableLifetime);

    using var response = await client.GetAsync("api/session");

    Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    Assert.False((await ReadStateAsync(response)).SignedIn);
    await using var context = database.CreateContext();
    Assert.Empty(await context.Sessions.Where(item => item.CustomerId == 60_005).ToListAsync());
  }

  [Fact]
  public async Task TheAbsoluteLimitEndsTheSessionDespiteRepeatedRenewal()
  {
    using var server = NewServer(60_006, out var clock);
    using var client = server.CreateClient();
    await SignInAsync(client);
    for (var renewal = 0; renewal < 6; renewal++)
    {
      clock.Advance(TimeSpan.FromDays(29));
      Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("api/session")).StatusCode);
    }

    var renewed = await ReadSessionRowAsync(60_006);
    Assert.Equal(InitialTime.AddDays(174), renewed.LastRenewedAt);
    Assert.Equal(
      InitialTime.Add(CommanderSessionService.AbsoluteLifetime),
      renewed.AbsoluteExpiresAt
    );
    Assert.Equal(renewed.AbsoluteExpiresAt, renewed.RenewableExpiresAt);
    clock.Advance(TimeSpan.FromDays(6));

    using var response = await client.GetAsync("api/session");

    Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    Assert.False((await ReadStateAsync(response)).SignedIn);
    await using var context = database.CreateContext();
    Assert.Empty(await context.Sessions.Where(item => item.CustomerId == 60_006).ToListAsync());
  }

  [Fact]
  public async Task RenewalWaitsForTwentyFourHoursAndExpiryFollowsTheRenewalNotTheRequest()
  {
    using var server = NewServer(60_007, out var clock);
    using var client = server.CreateClient();
    await SignInAsync(client);

    clock.Advance(TimeSpan.FromHours(23));
    Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("api/session")).StatusCode);
    var afterEarlyRequest = await ReadSessionRowAsync(60_007);
    Assert.Equal(InitialTime, afterEarlyRequest.LastRenewedAt);
    Assert.Equal(
      InitialTime.Add(CommanderSessionService.RenewableLifetime),
      afterEarlyRequest.RenewableExpiresAt
    );

    clock.Advance(TimeSpan.FromHours(1));
    Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("api/session")).StatusCode);
    var afterRenewal = await ReadSessionRowAsync(60_007);
    Assert.Equal(InitialTime.AddHours(24), afterRenewal.LastRenewedAt);
    Assert.Equal(
      InitialTime.AddHours(24).Add(CommanderSessionService.RenewableLifetime),
      afterRenewal.RenewableExpiresAt
    );

    clock.Advance(TimeSpan.FromHours(23));
    Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("api/session")).StatusCode);
    var afterSecondRequestThatDay = await ReadSessionRowAsync(60_007);
    Assert.Equal(afterRenewal.LastRenewedAt, afterSecondRequestThatDay.LastRenewedAt);
    Assert.Equal(
      afterRenewal.RenewableExpiresAt,
      afterSecondRequestThatDay.RenewableExpiresAt
    );
  }

  [Fact]
  public async Task ASignInStartRemovesExpiredSessionAndStateRows()
  {
    using var server = NewServer(60_008, out var clock);
    using var client = server.CreateClient();
    await SignInAsync(client);
    var abandonedStateHash = SecretHash.Compute(await StartSignInAsync(client));
    await using (var beforeContext = database.CreateContext())
    {
      Assert.Single(
        await beforeContext.Sessions.Where(item => item.CustomerId == 60_008).ToListAsync()
      );
      Assert.Single(
        await beforeContext.OAuthAttempts.Where(item =>
          item.StateHash == abandonedStateHash
        ).ToListAsync()
      );
    }

    clock.Advance(CommanderSessionService.RenewableLifetime);
    using var fresh = server.CreateClient();
    await StartSignInAsync(fresh);

    await using var context = database.CreateContext();
    Assert.Empty(await context.Sessions.Where(item => item.CustomerId == 60_008).ToListAsync());
    Assert.Empty(
      await context.OAuthAttempts.Where(item => item.StateHash == abandonedStateHash).ToListAsync()
    );
  }

  private CommanderTestServer NewServer(
    long customerId,
    out ManualTimeProvider clock,
    string? pathBase = null
  )
  {
    var manualClock = new ManualTimeProvider(InitialTime);
    clock = manualClock;
    return new CommanderTestServer(
      database,
      new FakeFrontierClient
      {
        Authentication = FakeFrontierClient.Identity(customerId, "Test Commander", InitialTime),
      },
      manualClock,
      pathBase: pathBase
    );
  }

  private async Task<CommanderSession> ReadSessionRowAsync(long customerId)
  {
    await using var context = database.CreateContext();
    return await context.Sessions.AsNoTracking().SingleAsync(item => item.CustomerId == customerId);
  }

  private static async Task<string> StartSignInAsync(HttpClient client, string prefix = "")
  {
    using var start = await client.PostAsync($"{prefix}api/auth/frontier", content: null);
    Assert.Equal(HttpStatusCode.OK, start.StatusCode);
    using var startJson = JsonDocument.Parse(await start.Content.ReadAsStringAsync());
    var location = new Uri(startJson.RootElement.GetProperty("authorisationUri").GetString()!);
    return CommanderTestServer.QueryValue(location, "state");
  }

  private static async Task<SignInResult> SignInAsync(HttpClient client, string prefix = "")
  {
    var state = await StartSignInAsync(client, prefix);
    using var callback = await client.GetAsync(
      $"{prefix}api/auth/frontier/callback?code=authorisation-code&state={Uri.EscapeDataString(state)}"
    );
    Assert.Equal(HttpStatusCode.Redirect, callback.StatusCode);
    var sessionCookie = callback
      .Headers.GetValues("Set-Cookie")
      .Single(value => value.StartsWith("__Host-NavBeacon-Session=", StringComparison.Ordinal))
      .Split(';')[0];
    return new SignInResult(callback.Headers.Location!.ToString(), sessionCookie);
  }

  private static async Task<SessionState> ReadStateAsync(HttpResponseMessage response)
  {
    Assert.Equal("application/json", response.Content.Headers.ContentType?.MediaType);
    using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
    return new SessionState(
      json.RootElement.GetProperty("signedIn").GetBoolean(),
      json.RootElement.TryGetProperty("antiForgeryToken", out var token) ? token.GetString() : null
    );
  }

  private static async Task<IReadOnlyList<string>> PropertiesOfAsync(HttpResponseMessage response)
  {
    Assert.Equal("application/json", response.Content.Headers.ContentType?.MediaType);
    using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
    return [.. json.RootElement.EnumerateObject().Select(property => property.Name).Order(StringComparer.Ordinal)];
  }

  /// <summary>The property set the browser accepts for one of the two answers.</summary>
  private static IReadOnlyList<string> ContractProperties(string answer)
  {
    using var contract = JsonDocument.Parse(
      File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "session-response.contract.json"))
    );
    return
    [
      .. contract
        .RootElement.GetProperty(answer)
        .EnumerateArray()
        .Select(property => property.GetString()!)
        .Order(StringComparer.Ordinal),
    ];
  }

  private sealed record SignInResult(string ReturnAddress, string SessionCookie);

  private sealed record SessionState(bool SignedIn, string? AntiForgeryToken);
}
