using System.Data.Common;
using System.Net;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using NavBeacon.Server.Accounts;
using NavBeacon.Server.Persistence;

namespace NavBeacon.Server.IntegrationTests;

public sealed class CommanderAccountDeletionTests(PostgreSqlDatabaseFixture database)
  : IClassFixture<PostgreSqlDatabaseFixture>
{
  // The manual clock runs ahead of the real clock, so cookies the server dates
  // by that clock are still live in the test browser's cookie store.
  private static readonly DateTimeOffset InitialTime = new(
    DateTimeOffset.UtcNow.Date.AddDays(1),
    TimeSpan.Zero
  );

  [Fact]
  public async Task OneTransactionRemovesTheAccountAndEveryDependentRecord()
  {
    const long customerId = 50_001;
    await using var context = database.CreateContext();
    await SeedAsync(context, customerId, sessions: 2);
    var service = new CommanderAccountDeletionService(context);

    await service.DeleteAsync(customerId, CancellationToken.None);
    await service.DeleteAsync(customerId, CancellationToken.None);

    await AssertNothingRemainsAsync(customerId);
  }

  [Fact]
  public async Task AnUncommittedDeletionKeepsTheAccountAndAllowsAnotherAttempt()
  {
    const long customerId = 50_002;
    await using (var seedContext = database.CreateContext())
    {
      await SeedAsync(seedContext, customerId, sessions: 1);
    }

    await using (var refusingContext = database.CreateContext(new RefusingDeleteInterceptor()))
    {
      var refused = new CommanderAccountDeletionService(refusingContext);
      await Assert.ThrowsAnyAsync<Exception>(
        () => refused.DeleteAsync(customerId, CancellationToken.None)
      );
    }

    await using (var afterFailure = database.CreateContext())
    {
      Assert.True(
        await afterFailure.CommanderAccounts.AnyAsync(item => item.CustomerId == customerId)
      );
      Assert.Equal(
        1,
        await afterFailure.SynchronisedRecords.CountAsync(item =>
          item.CustomerId == customerId && item.Payload != null
        )
      );
      Assert.True(await afterFailure.OwnedShips.AnyAsync(item => item.CustomerId == customerId));
      Assert.True(await afterFailure.JournalCursors.AnyAsync(item => item.CustomerId == customerId));
    }

    await using var retryContext = database.CreateContext();
    await new CommanderAccountDeletionService(retryContext).DeleteAsync(
      customerId,
      CancellationToken.None
    );

    await AssertNothingRemainsAsync(customerId);
  }

  [Fact]
  public async Task ConfirmedDeletionEndsEverySessionAndALaterSignInStartsAnEmptyAccount()
  {
    const long customerId = 50_003;
    var clock = new ManualTimeProvider(InitialTime);
    using var server = new CommanderTestServer(
      database,
      new FakeFrontierClient
      {
        Authentication = FakeFrontierClient.Identity(customerId, "Test Commander", InitialTime),
      },
      clock
    );
    using var client = server.CreateClient();
    var sessionCookie = await SignInAsync(client);
    await using (var seedContext = database.CreateContext())
    {
      await SeedDependentsAsync(seedContext, customerId);
    }

    using var refusedWithoutToken = await client.DeleteAsync("api/account");
    Assert.Equal(HttpStatusCode.BadRequest, refusedWithoutToken.StatusCode);

    var antiForgeryToken = await ReadAntiForgeryTokenAsync(client);
    using var request = new HttpRequestMessage(HttpMethod.Delete, "api/account");
    request.Headers.Add("X-CSRF-TOKEN", antiForgeryToken);
    using var deleted = await client.SendAsync(request);

    Assert.Equal(HttpStatusCode.NoContent, deleted.StatusCode);
    await AssertNothingRemainsAsync(customerId);

    // The browser lost the response it never needed: the old cookie reads nothing.
    using var replayClient = server.CreateClient(handleCookies: false);
    using var replay = new HttpRequestMessage(HttpMethod.Get, "api/session");
    replay.Headers.Add("Cookie", sessionCookie);
    using var replayed = await replayClient.SendAsync(replay);
    Assert.Equal(HttpStatusCode.Unauthorized, replayed.StatusCode);
    using var replayedJson = JsonDocument.Parse(await replayed.Content.ReadAsStringAsync());
    Assert.Equal("expired", replayedJson.RootElement.GetProperty("state").GetString());
    Assert.True(replayedJson.RootElement.GetProperty("clearFleetCache").GetBoolean());

    using var freshClient = server.CreateClient();
    await SignInAsync(freshClient);

    await using var context = database.CreateContext();
    var account = await context.CommanderAccounts.SingleAsync(item =>
      item.CustomerId == customerId
    );
    Assert.Equal(0, account.RecordRevision);
    Assert.Empty(await context.SynchronisedRecords.Where(item => item.CustomerId == customerId).ToListAsync());
    Assert.Empty(await context.OwnedShips.Where(item => item.CustomerId == customerId).ToListAsync());
    Assert.Empty(await context.JournalCursors.Where(item => item.CustomerId == customerId).ToListAsync());
  }

  [Fact]
  public async Task SignOutKeepsTheAccountAndDeletionThenNeedsAFreshSignIn()
  {
    const long customerId = 50_004;
    using var server = new CommanderTestServer(
      database,
      new FakeFrontierClient
      {
        Authentication = FakeFrontierClient.Identity(customerId, "Test Commander", InitialTime),
      },
      new ManualTimeProvider(InitialTime)
    );
    using var client = server.CreateClient();
    await SignInAsync(client);
    await using (var seedContext = database.CreateContext())
    {
      await SeedDependentsAsync(seedContext, customerId);
    }

    var antiForgeryToken = await ReadAntiForgeryTokenAsync(client);
    using var signOut = new HttpRequestMessage(HttpMethod.Post, "api/session/sign-out");
    signOut.Headers.Add("X-CSRF-TOKEN", antiForgeryToken);
    Assert.Equal(HttpStatusCode.NoContent, (await client.SendAsync(signOut)).StatusCode);
    using var request = new HttpRequestMessage(HttpMethod.Delete, "api/account");
    request.Headers.Add("X-CSRF-TOKEN", antiForgeryToken);

    using var response = await client.SendAsync(request);

    Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    await using var context = database.CreateContext();
    Assert.True(await context.CommanderAccounts.AnyAsync(item => item.CustomerId == customerId));
    Assert.True(await context.SynchronisedRecords.AnyAsync(item => item.CustomerId == customerId));
  }

  private async Task AssertNothingRemainsAsync(long customerId)
  {
    await using var context = database.CreateContext();
    Assert.False(await context.CommanderAccounts.AnyAsync(item => item.CustomerId == customerId));
    Assert.False(await context.Sessions.AnyAsync(item => item.CustomerId == customerId));
    Assert.False(await context.SynchronisedRecords.AnyAsync(item => item.CustomerId == customerId));
    Assert.False(await context.OwnedShips.AnyAsync(item => item.CustomerId == customerId));
    Assert.False(await context.JournalCursors.AnyAsync(item => item.CustomerId == customerId));
  }

  private static async Task SeedAsync(
    NavBeaconDbContext context,
    long customerId,
    int sessions
  )
  {
    context.CommanderAccounts.Add(
      new CommanderAccount
      {
        CustomerId = customerId,
        CommanderName = "Test Commander",
        ProtectedAccessToken = "protected-access",
        ProtectedRefreshToken = "protected-refresh",
        AccessTokenExpiresAt = InitialTime.AddHours(1),
      }
    );
    for (var index = 0; index < sessions; index++)
    {
      var hash = new byte[32];
      hash[0] = (byte)index;
      context.Sessions.Add(
        new CommanderSession
        {
          SessionHash = hash,
          CustomerId = customerId,
          CreatedAt = InitialTime,
          LastRenewedAt = InitialTime,
          RenewableExpiresAt = InitialTime.AddDays(30),
          AbsoluteExpiresAt = InitialTime.AddDays(180),
        }
      );
    }

    await SeedDependentsAsync(context, customerId);
  }

  private static async Task SeedDependentsAsync(NavBeaconDbContext context, long customerId)
  {
    context.SynchronisedRecords.AddRange(
      new SynchronisedRecord
      {
        CustomerId = customerId,
        RecordId = Guid.NewGuid(),
        Revision = 1,
        RecordKind = "ship",
        Name = "Test record",
        Payload = "{}",
        CreatedAt = InitialTime,
        BrowserModifiedAt = InitialTime,
        ServerContentAt = InitialTime,
      },
      // A deletion marker for a record the Commander already removed.
      new SynchronisedRecord
      {
        CustomerId = customerId,
        RecordId = Guid.NewGuid(),
        Revision = 2,
      }
    );
    context.OwnedShips.Add(
      new OwnedShip
      {
        CustomerId = customerId,
        ShipId = 42,
        SourceDate = new DateOnly(2026, 9, 11),
        SourceLine = 1,
        Payload = "{}",
      }
    );
    context.JournalCursors.Add(
      new JournalCursor
      {
        CustomerId = customerId,
        CoverageStartDate = new DateOnly(2026, 8, 28),
        NextUnreadDate = new DateOnly(2026, 9, 11),
        NextUnreadLine = 2,
      }
    );
    await context.SaveChangesAsync();
  }

  private static async Task<string> SignInAsync(HttpClient client)
  {
    using var start = await client.PostAsync("api/auth/frontier", content: null);
    using var startJson = JsonDocument.Parse(await start.Content.ReadAsStringAsync());
    var location = new Uri(startJson.RootElement.GetProperty("authorisationUri").GetString()!);
    var state = CommanderTestServer.QueryValue(location, "state");
    using var callback = await client.GetAsync(
      $"api/auth/frontier/callback?code=authorisation-code&state={Uri.EscapeDataString(state)}"
    );
    Assert.Equal(HttpStatusCode.Redirect, callback.StatusCode);
    return callback
      .Headers.GetValues("Set-Cookie")
      .Single(value => value.StartsWith("__Host-NavBeacon-Session=", StringComparison.Ordinal))
      .Split(';')[0];
  }

  private static async Task<string> ReadAntiForgeryTokenAsync(HttpClient client)
  {
    using var response = await client.GetAsync("api/session");
    Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
    return json.RootElement.GetProperty("antiForgeryToken").GetString()!;
  }

  /// <summary>
  /// Refuses the account delete so the deletion transaction never commits.
  /// </summary>
  private sealed class RefusingDeleteInterceptor : DbCommandInterceptor
  {
    public override InterceptionResult<int> NonQueryExecuting(
      DbCommand command,
      CommandEventData eventData,
      InterceptionResult<int> result
    ) => Refuse(command, result);

    public override ValueTask<InterceptionResult<int>> NonQueryExecutingAsync(
      DbCommand command,
      CommandEventData eventData,
      InterceptionResult<int> result,
      CancellationToken cancellationToken = default
    ) => ValueTask.FromResult(Refuse(command, result));

    public override InterceptionResult<DbDataReader> ReaderExecuting(
      DbCommand command,
      CommandEventData eventData,
      InterceptionResult<DbDataReader> result
    ) => Refuse(command, result);

    public override ValueTask<InterceptionResult<DbDataReader>> ReaderExecutingAsync(
      DbCommand command,
      CommandEventData eventData,
      InterceptionResult<DbDataReader> result,
      CancellationToken cancellationToken = default
    ) => ValueTask.FromResult(Refuse(command, result));

    private static InterceptionResult<TResult> Refuse<TResult>(
      DbCommand command,
      InterceptionResult<TResult> result
    ) =>
      command.CommandText.Contains("DELETE FROM commander_accounts", StringComparison.Ordinal)
        ? throw new InvalidOperationException("The database refused the account delete.")
        : result;
  }
}
