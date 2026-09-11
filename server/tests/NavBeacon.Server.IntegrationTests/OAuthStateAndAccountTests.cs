using Microsoft.AspNetCore.DataProtection;
using Microsoft.EntityFrameworkCore;
using NavBeacon.Server.Frontier;
using NavBeacon.Server.Persistence;

namespace NavBeacon.Server.IntegrationTests;

public sealed class OAuthStateAndAccountTests(PostgreSqlDatabaseFixture database)
  : IClassFixture<PostgreSqlDatabaseFixture>
{
  private static readonly DateTimeOffset InitialTime = new(2026, 9, 11, 12, 0, 0, TimeSpan.Zero);

  [Fact]
  public async Task StateIsValidBeforeTenMinutesAndInvalidAtTheBoundary()
  {
    var clock = new ManualTimeProvider(InitialTime);
    await using var context = database.CreateContext();
    var states = new OAuthStateService(context, clock);
    var valid = await states.StartAsync(CancellationToken.None);
    clock.Advance(TimeSpan.FromMinutes(10) - TimeSpan.FromTicks(1));

    Assert.True(
      await states.ConsumeAsync(
        valid.State,
        valid.BrowserCorrelation,
        CancellationToken.None
      )
    );

    var expired = await states.StartAsync(CancellationToken.None);
    clock.Advance(TimeSpan.FromMinutes(10));

    Assert.False(
      await states.ConsumeAsync(
        expired.State,
        expired.BrowserCorrelation,
        CancellationToken.None
      )
    );
    Assert.Empty(await context.OAuthAttempts.ToListAsync(CancellationToken.None));
  }

  [Fact]
  public async Task TwoInstancesConsumeOneAttemptOnce()
  {
    var clock = new ManualTimeProvider(InitialTime);
    await using var startContext = database.CreateContext();
    var start = await new OAuthStateService(startContext, clock).StartAsync(
      CancellationToken.None
    );
    await using var firstContext = database.CreateContext();
    await using var secondContext = database.CreateContext();
    var first = new OAuthStateService(firstContext, clock);
    var second = new OAuthStateService(secondContext, clock);

    var results = await Task.WhenAll(
      first.ConsumeAsync(
        start.State,
        start.BrowserCorrelation,
        CancellationToken.None
      ),
      second.ConsumeAsync(
        start.State,
        start.BrowserCorrelation,
        CancellationToken.None
      )
    );

    Assert.Single(results, result => result);
    Assert.Single(results, result => !result);
  }

  [Fact]
  public async Task CorrelationFailureConsumesAttemptAndStartsNoAccountOrSession()
  {
    var clock = new ManualTimeProvider(InitialTime);
    await using var context = database.CreateContext();
    var states = new OAuthStateService(context, clock);
    var start = await states.StartAsync(CancellationToken.None);
    var frontier = new FakeFrontierClient();
    var callback = new OAuthCallbackService(
      states,
      frontier,
      context,
      new EphemeralDataProtectionProvider()
    );

    var refused = await callback.CompleteAsync(
      start.State,
      null,
      "code",
      CancellationToken.None
    );
    var replay = await callback.CompleteAsync(
      start.State,
      start.BrowserCorrelation,
      "code",
      CancellationToken.None
    );

    Assert.Equal(OAuthCallbackResult.FreshSignInRequired, refused.Result);
    Assert.Equal(OAuthCallbackResult.FreshSignInRequired, replay.Result);
    Assert.Equal(0, frontier.AuthenticationCalls);
    Assert.Empty(await context.CommanderAccounts.ToListAsync(CancellationToken.None));
    Assert.Empty(await context.Sessions.ToListAsync(CancellationToken.None));
  }

  [Fact]
  public async Task CallbackStoresProtectedTokensAndUpdatesTheNameForTheSameCustomer()
  {
    var clock = new ManualTimeProvider(InitialTime);
    var protection = new EphemeralDataProtectionProvider();
    await using var context = database.CreateContext();
    var states = new OAuthStateService(context, clock);
    var frontier = new FakeFrontierClient
    {
      Authentication = Authentication(20_001, "First name", clock.GetUtcNow()),
    };
    var callback = new OAuthCallbackService(states, frontier, context, protection);
    var first = await states.StartAsync(CancellationToken.None);

    Assert.Equal(
      OAuthCallbackResult.SignedIn,
      (await callback.CompleteAsync(
        first.State,
        first.BrowserCorrelation,
        "first-code",
        CancellationToken.None
      )).Result
    );

    var account = await context.CommanderAccounts.SingleAsync(
      item => item.CustomerId == 20_001,
      CancellationToken.None
    );
    account.RecordRevision = 12;
    await context.SaveChangesAsync(CancellationToken.None);
    frontier.Authentication = Authentication(20_001, "Changed name", clock.GetUtcNow());
    var second = await states.StartAsync(CancellationToken.None);

    Assert.Equal(
      OAuthCallbackResult.SignedIn,
      (await callback.CompleteAsync(
        second.State,
        second.BrowserCorrelation,
        "second-code",
        CancellationToken.None
      )).Result
    );

    context.ChangeTracker.Clear();
    account = await context.CommanderAccounts.SingleAsync(
      item => item.CustomerId == 20_001,
      CancellationToken.None
    );
    var protector = protection.CreateProtector("Frontier tokens v1");
    Assert.Equal("Changed name", account.CommanderName);
    Assert.Equal(12, account.RecordRevision);
    Assert.NotEqual("access-token", account.ProtectedAccessToken);
    Assert.NotEqual("refresh-token", account.ProtectedRefreshToken);
    Assert.Equal("access-token", protector.Unprotect(account.ProtectedAccessToken));
    Assert.Equal("refresh-token", protector.Unprotect(account.ProtectedRefreshToken));
  }

  [Fact]
  public async Task ExpiredAccessTokenRefreshesAndRefreshFailureReturnsNoToken()
  {
    var clock = new ManualTimeProvider(InitialTime);
    var protection = new EphemeralDataProtectionProvider();
    var protector = protection.CreateProtector("Frontier tokens v1");
    await using var context = database.CreateContext();
    context.CommanderAccounts.AddRange(
      Account(20_002, protector, clock.GetUtcNow().AddSeconds(-1)),
      Account(20_003, protector, clock.GetUtcNow().AddSeconds(-1))
    );
    await context.SaveChangesAsync(CancellationToken.None);
    var frontier = new FakeFrontierClient
    {
      RefreshedTokens = new FrontierTokens(
        "new-access",
        "new-refresh",
        clock.GetUtcNow().AddHours(1)
      ),
    };
    var credentials = new FrontierCredentialService(context, frontier, protection, clock);

    Assert.Equal(
      "new-access",
      await credentials.GetAccessTokenAsync(20_002, CancellationToken.None)
    );
    frontier.RefreshedTokens = null;
    Assert.Null(
      await credentials.GetAccessTokenAsync(20_003, CancellationToken.None)
    );
    Assert.Equal(2, frontier.RefreshCalls);
  }

  [Fact]
  public async Task CurrentAccessTokenNeedsNoRefreshAndAnUnknownAccountHasNoToken()
  {
    var clock = new ManualTimeProvider(InitialTime);
    var protection = new EphemeralDataProtectionProvider();
    var protector = protection.CreateProtector("Frontier tokens v1");
    await using var context = database.CreateContext();
    context.CommanderAccounts.Add(Account(20_004, protector, clock.GetUtcNow().AddMinutes(1)));
    await context.SaveChangesAsync(CancellationToken.None);
    var frontier = new FakeFrontierClient();
    var credentials = new FrontierCredentialService(context, frontier, protection, clock);

    Assert.Equal(
      "access-token",
      await credentials.GetAccessTokenAsync(20_004, CancellationToken.None)
    );
    Assert.Null(
      await credentials.GetAccessTokenAsync(99_999, CancellationToken.None)
    );
    Assert.Equal(0, frontier.RefreshCalls);
  }

  private static FrontierAuthentication Authentication(
    long customerId,
    string name,
    DateTimeOffset now
  ) =>
    new(
      new FrontierTokens("access-token", "refresh-token", now.AddHours(1)),
      new FrontierIdentity(customerId, name)
    );

  private static CommanderAccount Account(
    long customerId,
    IDataProtector protector,
    DateTimeOffset accessTokenExpiresAt
  ) =>
    new()
    {
      CustomerId = customerId,
      CommanderName = "Test Commander",
      ProtectedAccessToken = protector.Protect("access-token"),
      ProtectedRefreshToken = protector.Protect("refresh-token"),
      AccessTokenExpiresAt = accessTokenExpiresAt,
    };

  private sealed class ManualTimeProvider(DateTimeOffset current) : TimeProvider
  {
    public override DateTimeOffset GetUtcNow() => current;

    public void Advance(TimeSpan duration) => current += duration;
  }

  private sealed class FakeFrontierClient : IFrontierClient
  {
    public FrontierAuthentication? Authentication { get; set; }

    public FrontierTokens? RefreshedTokens { get; set; }

    public int AuthenticationCalls { get; private set; }

    public int RefreshCalls { get; private set; }

    public Uri CreateAuthorisationUri(string state) => new("https://auth.frontierstore.net/auth");

    public Task<FrontierAuthentication?> AuthenticateAsync(
      string authorisationCode,
      CancellationToken cancellationToken
    )
    {
      AuthenticationCalls++;
      return Task.FromResult(Authentication);
    }

    public Task<FrontierTokens?> RefreshAsync(
      string refreshToken,
      CancellationToken cancellationToken
    )
    {
      RefreshCalls++;
      return Task.FromResult(RefreshedTokens);
    }
  }
}
