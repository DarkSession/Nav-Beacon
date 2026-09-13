using System.Net;
using NavBeacon.Server.Fleet;
using NavBeacon.Server.Frontier;

namespace NavBeacon.Server.IntegrationTests;

/// <summary>
/// The authenticated fleet read and refresh endpoints: every result the
/// application states, the last accepted fleet after a failure, package
/// feedback in the requested locale and one account's separation from another
/// (020/FR-016 and 020/FR-018).
/// </summary>
public sealed class FleetEndpointTests(PostgreSqlDatabaseFixture database)
  : IClassFixture<PostgreSqlDatabaseFixture>
{
  // A clock the cookie container still accepts: the sign-in correlation cookie
  // expires ten minutes after this, on the machine's own clock.
  private static readonly DateTimeOffset Now = new(
    DateTimeOffset.UtcNow.Date.AddDays(1),
    TimeSpan.Zero
  );
  private static readonly DateOnly Today = DateOnly.FromDateTime(Now.UtcDateTime);
  private static readonly DateOnly Yesterday = Today.AddDays(-1);

  [Fact]
  public async Task AReadWithoutASessionIsUnauthorised()
  {
    var frontier = new FakeFrontierClient();
    using var server = new CommanderTestServer(
      database,
      frontier,
      new ManualTimeProvider(Now),
      journal: new FakeJournalClient()
    );
    using var client = server.CreateClient();

    using var response = await client.GetAsync("api/fleet");

    Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    Assert.Equal("application/problem+json", response.Content.Headers.ContentType!.MediaType);
    Assert.Contains("\"code\":\"unauthorised\"", await response.Content.ReadAsStringAsync());
  }

  [Fact]
  public async Task ARefreshWithoutAnAntiForgeryTokenIsRefused()
  {
    using var server = NewServer(new FakeJournalClient(), out var frontier);
    using var commander = await SignIn(server, frontier, 82_001);

    var refused = await commander.RefreshFleetAsync(withToken: false);

    Assert.Equal(HttpStatusCode.BadRequest, refused.Status);
    Assert.Equal("invalid-anti-forgery", refused.Code);
  }

  [Fact]
  public async Task AnExpiredSessionCannotRefresh()
  {
    var clock = new ManualTimeProvider(Now);
    var frontier = new FakeFrontierClient();
    using var server = new CommanderTestServer(
      database,
      frontier,
      clock,
      journal: new FakeJournalClient()
    );
    using var commander = await SignedInCommander.SignInAsync(server, frontier, 82_002, Now);
    clock.Advance(TimeSpan.FromDays(31));

    var refused = await commander.RefreshFleetAsync();
    var read = await commander.ReadFleetAsync();

    Assert.Equal(HttpStatusCode.Unauthorized, refused.Status);
    Assert.Equal("unauthorised", refused.Code);
    Assert.Equal(HttpStatusCode.Unauthorized, read.Status);
    Assert.Equal("unauthorised", read.Code);
  }

  [Fact]
  public async Task AnAccountWithNoAcceptedLoadoutIsEmpty()
  {
    using var server = NewServer(new FakeJournalClient(), out var frontier);
    using var commander = await SignIn(server, frontier, 82_003);

    var refreshed = await commander.RefreshFleetAsync();
    var read = await commander.ReadFleetAsync();

    Assert.Equal(HttpStatusCode.OK, refreshed.Status);
    Assert.Equal(FleetResults.Empty, refreshed.Result);
    Assert.Empty(refreshed.Ships);
    Assert.False(refreshed.Pending);
    Assert.Null(refreshed.Failure);
    Assert.Null(refreshed.Refusal);
    Assert.Equal(FleetResults.Empty, read.Result);
  }

  [Fact]
  public async Task AFleetReadToTheAcceptedCursorIsCurrent()
  {
    var journal = new FakeJournalClient();
    journal.Complete(
      Yesterday,
      JournalFixtures.Loadout(12),
      JournalFixtures.StoredShips(shipIds: [12])
    );
    journal.Complete(Today);
    using var server = NewServer(journal, out var frontier);
    using var commander = await SignIn(server, frontier, 82_004);
    await database.SeedCursorAsync(82_004, Yesterday, 0);

    var refreshed = await commander.RefreshFleetAsync();
    var read = await commander.ReadFleetAsync();

    Assert.Equal(FleetResults.Current, refreshed.Result);
    Assert.False(refreshed.Pending);
    // Yesterday is read and left behind; today is read and kept, because the
    // day has not ended and the cursor never returns to a date it leaves
    // (020/FR-013).
    Assert.Equal(Today.ToString("yyyy-MM-dd"), refreshed.CursorDate);
    Assert.True(refreshed.StoredShips!["complete"]!.GetValue<bool>());
    Assert.Equal(FleetResults.Current, read.Result);
    Assert.Equal(12, Assert.Single(read.Ships)!["shipId"]!.GetValue<long>());
  }

  [Fact]
  public async Task AFleetTheJournalCannotConfirmIsIncomplete()
  {
    var journal = new FakeJournalClient();
    journal.Complete(
      Yesterday,
      JournalFixtures.Loadout(12),
      JournalFixtures.StoredShips(shipIds: [12, 99])
    );
    journal.Complete(Today);
    using var server = NewServer(journal, out var frontier);
    using var commander = await SignIn(server, frontier, 82_005);
    await database.SeedCursorAsync(82_005, Yesterday, 0);

    var refreshed = await commander.RefreshFleetAsync();

    Assert.Equal(FleetResults.Incomplete, refreshed.Result);
    Assert.False(refreshed.StoredShips!["complete"]!.GetValue<bool>());
    Assert.Single(refreshed.Ships);
  }

  [Fact]
  public async Task AFrontierDelayIsWaitingWithItsNextPermittedTime()
  {
    var permitted = Now.AddSeconds(60);
    var journal = new FakeJournalClient();
    journal.Queue(Today, new JournalRead(JournalReadOutcome.Retryable, string.Empty, permitted));
    using var server = NewServer(journal, out var frontier);
    using var commander = await SignIn(server, frontier, 82_006);
    await database.SeedCursorAsync(82_006, Today, 0);

    var waiting = await commander.RefreshFleetAsync();
    var again = await commander.RefreshFleetAsync();

    Assert.Equal(FleetResults.Waiting, waiting.Result);
    Assert.True(waiting.Pending);
    Assert.Equal(
      permitted.ToString("yyyy-MM-ddTHH:mm:ss.fffZ"),
      waiting.Coverage!["nextPermittedRefreshAt"]!.GetValue<string>()
    );
    // The stored next-permitted time holds the second attempt back rather than
    // asking Frontier again.
    Assert.Equal(FleetResults.Waiting, again.Result);
    Assert.Single(journal.Requested);
  }

  [Fact]
  public async Task AFailedRefreshKeepsTheLastAcceptedFleetAvailable()
  {
    var journal = new FakeJournalClient();
    journal.Complete(Yesterday, JournalFixtures.Loadout(12, name: "Night Watch"));
    journal.Queue(Today, new JournalRead(JournalReadOutcome.Failed, string.Empty, null));
    using var server = NewServer(journal, out var frontier);
    using var commander = await SignIn(server, frontier, 82_007);
    await database.SeedCursorAsync(82_007, Yesterday, 0);

    var failed = await commander.RefreshFleetAsync();
    var read = await commander.ReadFleetAsync();

    Assert.Equal(HttpStatusCode.OK, failed.Status);
    Assert.Equal(FleetResults.Failed, failed.Result);
    Assert.Equal(FleetFailures.Frontier, failed.Failure);
    Assert.True(failed.Pending);
    Assert.Equal(
      "Night Watch",
      failed.Ship(12)["model"]!["shipName"]!.GetValue<string>()
    );
    Assert.Equal(Today.ToString("yyyy-MM-dd"), failed.CursorDate);
    Assert.Equal("Night Watch", read.Ship(12)["model"]!["shipName"]!.GetValue<string>());
  }

  [Fact]
  public async Task AReadAfterARefreshThatLeftADayUnreadIsNotCurrent()
  {
    var accepted = Yesterday.AddDays(-1);
    var journal = new FakeJournalClient();
    journal.Complete(
      accepted,
      JournalFixtures.Loadout(12),
      JournalFixtures.StoredShips(shipIds: [12])
    );
    journal.Queue(Yesterday, new JournalRead(JournalReadOutcome.Failed, string.Empty, null));
    using var server = NewServer(journal, out var frontier);
    using var commander = await SignIn(server, frontier, 82_018);
    await database.SeedCursorAsync(82_018, accepted, 0);

    var failed = await commander.RefreshFleetAsync();
    var read = await commander.ReadFleetAsync();

    Assert.Equal(FleetResults.Failed, failed.Result);
    Assert.True(failed.Pending);
    // Yesterday has ended and nothing in it was read. Answering the reload
    // from the stored fleet alone would state a fleet the journal confirms
    // whole, with the refresh that was to confirm it having failed
    // (020/FR-016).
    Assert.True(read.Pending);
    Assert.Equal(FleetResults.Incomplete, read.Result);
    Assert.Equal(Yesterday.ToString("yyyy-MM-dd"), read.CursorDate);
  }

  /// <summary>
  /// A journal response too large to read is its own failure, and not the one a
  /// Commander reads as Frontier being unreachable. What stopped the refresh is
  /// different, so the sentence it produces is different (020/FR-018).
  /// </summary>
  [Fact]
  public async Task AJournalResponseTooLargeToReadIsStatedAsItsOwnFailure()
  {
    var journal = new FakeJournalClient();
    journal.Complete(Yesterday, JournalFixtures.Loadout(12, name: "Night Watch"));
    journal.Queue(Today, new JournalRead(JournalReadOutcome.ResponseTooLarge, string.Empty, null));
    using var server = NewServer(journal, out var frontier);
    using var commander = await SignIn(server, frontier, 82_016);
    await database.SeedCursorAsync(82_016, Yesterday, 0);

    var failed = await commander.RefreshFleetAsync();

    Assert.Equal(FleetResults.Failed, failed.Result);
    Assert.Equal(FleetFailures.ResponseTooLarge, failed.Failure);
    Assert.True(failed.Pending);
    Assert.Equal(
      "Night Watch",
      failed.Ship(12)["model"]!["shipName"]!.GetValue<string>()
    );
  }

  [Fact]
  public async Task ExpiredFrontierAuthorisationIsStatedOnItsOwn()
  {
    var journal = new FakeJournalClient();
    journal.Complete(Yesterday, JournalFixtures.Loadout(12));
    journal.Queue(
      Today,
      new JournalRead(JournalReadOutcome.AuthorisationExpired, string.Empty, null)
    );
    using var server = NewServer(journal, out var frontier);
    using var commander = await SignIn(server, frontier, 82_008);
    await database.SeedCursorAsync(82_008, Yesterday, 0);

    var expired = await commander.RefreshFleetAsync();

    Assert.Equal(FleetResults.AuthorisationExpired, expired.Result);
    Assert.True(expired.Pending);
    Assert.Null(expired.Failure);
    Assert.Single(expired.Ships);
  }

  [Fact]
  public async Task PackageFeedbackUsesTheRequestedLocale()
  {
    var refused = JournalFixtures.Loadout(12).Replace(
      "\"Ship\":\"sidewinder\",",
      string.Empty,
      StringComparison.Ordinal
    );
    var journal = new FakeJournalClient();
    journal.Incomplete(Today, refused);
    journal.Incomplete(Today, refused);
    journal.Incomplete(Today, refused);
    using var server = NewServer(journal, out var frontier);
    using var commander = await SignIn(server, frontier, 82_009);
    await database.SeedCursorAsync(82_009, Today, 0);

    var english = await commander.RefreshFleetAsync();
    var german = await commander.RefreshFleetAsync("de-DE");
    var unsupported = await commander.RefreshFleetAsync("fr-FR");

    Assert.Equal(FleetFailures.PackageRefused, english.Failure);
    Assert.Equal("invalidLoadout", english.Refusal!["code"]!.GetValue<string>());
    Assert.Equal("entries[0].Ship", english.Refusal["path"]!.GetValue<string>());
    Assert.False(string.IsNullOrWhiteSpace(english.Refusal["message"]!.GetValue<string>()));
    // German is a locale this application ships and the package publishes no
    // text for, so the refusal travels without one rather than in English.
    Assert.Equal("invalidLoadout", german.Refusal!["code"]!.GetValue<string>());
    Assert.Null(german.Refusal["message"]);
    // An unsupported request locale falls back to English rather than asking
    // the package for a locale this application does not ship.
    Assert.False(string.IsNullOrWhiteSpace(unsupported.Refusal!["message"]!.GetValue<string>()));
  }

  [Fact]
  public async Task NoRefusalDiagnosticIsStored()
  {
    var refused = JournalFixtures.Loadout(12).Replace(
      "\"Ship\":\"sidewinder\",",
      string.Empty,
      StringComparison.Ordinal
    );
    var journal = new FakeJournalClient();
    journal.Incomplete(Today, JournalFixtures.Loadout(13), refused);
    using var server = NewServer(journal, out var frontier);
    using var commander = await SignIn(server, frontier, 82_010);
    await database.SeedCursorAsync(82_010, Today, 0);

    var stopped = await commander.RefreshFleetAsync();
    var read = await commander.ReadFleetAsync();

    Assert.NotNull(stopped.Refusal);
    Assert.Null(read.Refusal);
    Assert.DoesNotContain("must be a string", read.Body.ToJsonString(), StringComparison.Ordinal);
  }

  [Fact]
  public async Task OneCommanderCannotReadRefreshOrChangeAnotherCommandersFleet()
  {
    var journal = new FakeJournalClient();
    journal.Incomplete(Today, JournalFixtures.Loadout(12, name: "Mine"));
    journal.Incomplete(Today, JournalFixtures.Loadout(77, name: "Theirs"));
    journal.Incomplete(Today, JournalFixtures.Sale(12));
    using var server = NewServer(journal, out var frontier);
    using var first = await SignIn(server, frontier, 82_011);
    using var second = await SignIn(server, frontier, 82_012);
    await database.SeedCursorAsync(82_011, Today, 0);
    await database.SeedCursorAsync(82_012, Today, 0);

    var mine = await first.RefreshFleetAsync();
    var theirs = await second.RefreshFleetAsync();
    // The third queued day sells ship 12, and only the second account reads it.
    await database.SeedCursorAsync(82_012, Today, 0);
    await second.RefreshFleetAsync();
    var unchanged = await first.ReadFleetAsync();

    Assert.Equal(12, Assert.Single(mine.Ships)!["shipId"]!.GetValue<long>());
    Assert.Equal(77, Assert.Single(theirs.Ships)!["shipId"]!.GetValue<long>());
    Assert.Equal("Mine", Assert.Single(unchanged.Ships)!["model"]!["shipName"]!.GetValue<string>());
  }

  /// <summary>
  /// The two token questions a read asks are two different things, and the
  /// account answers each with the one it names.
  /// </summary>
  /// <remarks>
  /// A read asks for the stored token first and asks again, forcing a refresh,
  /// only where Frontier refused that token. Answering the first question with
  /// a refresh would spend the account's refresh token on every dated read, and
  /// answering the second with the stored token would hand back the very token
  /// Frontier had just refused and end the read there (020/FR-013).
  /// </remarks>
  [Fact]
  public async Task AStoredTokenAnswersTheFirstQuestionAndOnlyAForcedOneAsksFrontierAgain()
  {
    var journal = new FakeJournalClient();
    journal.AuthorisationQuestions.AddRange([false, true]);
    using var server = NewServer(journal, out var frontier);
    using var commander = await SignIn(server, frontier, 82_017);
    frontier.RefreshedTokens = new FrontierTokens(
      "second-access-token",
      "second-refresh-token",
      Now.AddHours(1)
    );
    await database.SeedCursorAsync(82_017, Today, 0);

    await commander.RefreshFleetAsync();

    Assert.Equal(["access-token", "second-access-token"], journal.AuthorisationAnswers);
    Assert.Equal(1, frontier.RefreshCalls);
  }

  private CommanderTestServer NewServer(
    FakeJournalClient journal,
    out FakeFrontierClient frontier
  )
  {
    frontier = new FakeFrontierClient();
    return new CommanderTestServer(
      database,
      frontier,
      new ManualTimeProvider(Now),
      journal: journal
    );
  }

  private static Task<SignedInCommander> SignIn(
    CommanderTestServer server,
    FakeFrontierClient frontier,
    long customerId
  ) => SignedInCommander.SignInAsync(server, frontier, customerId, Now);
}
