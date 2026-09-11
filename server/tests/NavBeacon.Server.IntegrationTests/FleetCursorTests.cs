using Microsoft.EntityFrameworkCore;
using NavBeacon.Server.Fleet;
using Npgsql;

namespace NavBeacon.Server.IntegrationTests;

/// <summary>
/// The 14-day initial cursor and the transactional date-and-line continuation
/// of 020/FR-013, and the four metadata items 020/FR-015 allows beside it.
/// </summary>
public sealed class FleetCursorTests(PostgreSqlDatabaseFixture database)
  : IClassFixture<PostgreSqlDatabaseFixture>
{
  // A clock the cookie container still accepts: the sign-in correlation cookie
  // expires ten minutes after this, on the machine's own clock.
  private static readonly DateTimeOffset Now = new(
    DateTimeOffset.UtcNow.Date.AddDays(1),
    TimeSpan.Zero
  );
  private static readonly DateOnly Today = DateOnly.FromDateTime(Now.UtcDateTime);

  [Fact]
  public async Task TheFirstCursorIsFourteenDaysBeforeTheRequestDate()
  {
    var journal = new FakeJournalClient();
    using var server = NewServer(journal, out var frontier);
    using var commander = await SignIn(server, frontier, 80_001);

    var refreshed = await commander.RefreshFleetAsync();

    Assert.Equal(Today.AddDays(-14).ToString("yyyy-MM-dd"), Start(refreshed));
    Assert.Equal(Today.AddDays(-14), journal.Requested[0]);
    await using var context = database.CreateContext();
    var cursor = await context.JournalCursors.SingleAsync(entry => entry.CustomerId == 80_001);
    Assert.Equal(Today.AddDays(-14), cursor.CoverageStartDate);
  }

  [Fact]
  public async Task AnAcceptedLineAdvancesTheCursorToTheNextLine()
  {
    var journal = new FakeJournalClient();
    journal.Incomplete(Today, JournalFixtures.Loadout(12));
    using var server = NewServer(journal, out var frontier);
    using var commander = await SignIn(server, frontier, 80_002);
    await database.SeedCursorAsync(80_002, Today, 0);

    var refreshed = await commander.RefreshFleetAsync();

    Assert.Equal(Today.ToString("yyyy-MM-dd"), refreshed.CursorDate);
    Assert.Equal(1, refreshed.CursorLine);
    Assert.Single(refreshed.Ships);
  }

  [Fact]
  public async Task ACompleteEmptyDayAdvancesToTheNextDateAtLineZero()
  {
    var journal = new FakeJournalClient();
    journal.Queue(Today.AddDays(-1), new JournalRead(JournalReadOutcome.Empty, "", null));
    journal.Incomplete(Today);
    using var server = NewServer(journal, out var frontier);
    using var commander = await SignIn(server, frontier, 80_003);
    await database.SeedCursorAsync(80_003, Today.AddDays(-1), 0);

    var refreshed = await commander.RefreshFleetAsync();

    Assert.Equal(Today.ToString("yyyy-MM-dd"), refreshed.CursorDate);
    Assert.Equal(0, refreshed.CursorLine);
    Assert.Null(refreshed.StoredShips);
  }

  [Fact]
  public async Task AnIncompleteDayDoesNotAdvanceToTheNextDate()
  {
    var journal = new FakeJournalClient();
    journal.Incomplete(
      Today.AddDays(-1),
      JournalFixtures.Other(),
      JournalFixtures.Loadout(12)
    );
    using var server = NewServer(journal, out var frontier);
    using var commander = await SignIn(server, frontier, 80_004);
    await database.SeedCursorAsync(80_004, Today.AddDays(-1), 0);

    var refreshed = await commander.RefreshFleetAsync();

    Assert.Equal(Today.AddDays(-1).ToString("yyyy-MM-dd"), refreshed.CursorDate);
    Assert.Equal(2, refreshed.CursorLine);
  }

  [Fact]
  public async Task ARepeatedLineIsIdempotent()
  {
    var journal = new FakeJournalClient();
    journal.Incomplete(Today, JournalFixtures.Loadout(12, name: "Night Watch"));
    journal.Incomplete(Today, JournalFixtures.Loadout(12, name: "Night Watch"));
    using var server = NewServer(journal, out var frontier);
    using var commander = await SignIn(server, frontier, 80_005);
    await database.SeedCursorAsync(80_005, Today, 0);

    var first = await commander.RefreshFleetAsync();
    await database.SeedCursorAsync(80_005, Today, 0);
    var second = await commander.RefreshFleetAsync();

    Assert.Single(first.Ships);
    Assert.Single(second.Ships);
    Assert.Equal(
      first.Ship(12).ToJsonString(),
      second.Ship(12).ToJsonString()
    );
    Assert.Equal(1, second.CursorLine);
  }

  [Fact]
  public async Task TwoInstancesCannotRefreshOneAccountTogether()
  {
    var journal = new FakeJournalClient();
    journal.Incomplete(Today, JournalFixtures.Loadout(12));
    using var server = NewServer(journal, out var frontier);
    using var commander = await SignIn(server, frontier, 80_006);
    await database.SeedCursorAsync(80_006, Today, 0);

    await using var holder = new NpgsqlConnection(database.ConnectionString);
    await holder.OpenAsync();
    await using (var command = holder.CreateCommand())
    {
      command.CommandText = "SELECT pg_advisory_lock(@key)";
      command.Parameters.AddWithValue("key", LockKey(80_006));
      await command.ExecuteScalarAsync();
    }

    var refreshed = await commander.RefreshFleetAsync();

    Assert.Equal("waiting", refreshed.Result);
    Assert.Empty(refreshed.Ships);
    Assert.Empty(journal.Requested);
  }

  [Fact]
  public async Task ARefreshBeforeItsNextPermittedTimeWaits()
  {
    var journal = new FakeJournalClient();
    journal.Queue(
      Today,
      new JournalRead(JournalReadOutcome.Retryable, "", Now.AddMinutes(5))
    );
    using var server = NewServer(journal, out var frontier);
    using var commander = await SignIn(server, frontier, 80_007);
    await database.SeedCursorAsync(80_007, Today, 0);

    var first = await commander.RefreshFleetAsync();
    var second = await commander.RefreshFleetAsync();

    Assert.Equal("waiting", first.Result);
    Assert.Equal("waiting", second.Result);
    Assert.Single(journal.Requested);
    Assert.Equal(
      Now.AddMinutes(5).ToString("yyyy-MM-ddTHH:mm:ss.fffZ"),
      second.Coverage!["nextPermittedRefreshAt"]!.GetValue<string>()
    );
  }

  [Fact]
  public async Task ACompleteResponseClearsTheWaitingTime()
  {
    var journal = new FakeJournalClient();
    journal.Queue(
      Today.AddDays(-1),
      new JournalRead(JournalReadOutcome.Retryable, "", Now.AddMinutes(5))
    );
    journal.Complete(Today.AddDays(-1), JournalFixtures.Other());
    journal.Incomplete(Today);
    using var server = NewServer(journal, out var frontier);
    using var commander = await SignIn(server, frontier, 80_008);
    await database.SeedCursorAsync(80_008, Today.AddDays(-1), 0);

    var waiting = await commander.RefreshFleetAsync();
    await using (var context = database.CreateContext())
    {
      var cursor = await context.JournalCursors.SingleAsync(entry => entry.CustomerId == 80_008);
      cursor.NextPermittedRefreshAt = Now.AddMinutes(-1);
      await context.SaveChangesAsync();
    }
    var accepted = await commander.RefreshFleetAsync();

    Assert.Equal("waiting", waiting.Result);
    Assert.Null(accepted.Coverage!["nextPermittedRefreshAt"]);
  }

  [Fact]
  public async Task StoredImportMetadataHoldsOnlyTheFourAllowedItems()
  {
    var journal = new FakeJournalClient();
    journal.Incomplete(
      Today,
      JournalFixtures.Loadout(12),
      JournalFixtures.StoredShips(shipIds: [12, 13])
    );
    using var server = NewServer(journal, out var frontier);
    using var commander = await SignIn(server, frontier, 80_009);
    await database.SeedCursorAsync(80_009, Today, 0);

    var refreshed = await commander.RefreshFleetAsync();

    Assert.Equal(Today.ToString("yyyy-MM-dd"), refreshed.StoredShips!["date"]!.GetValue<string>());
    Assert.Equal(1, refreshed.StoredShips!["line"]!.GetValue<int>());
    Assert.False(refreshed.StoredShips!["complete"]!.GetValue<bool>());
    Assert.Equal(
      [
        "coverage_start_date",
        "customer_id",
        "last_stored_ships_complete",
        "last_stored_ships_date",
        "last_stored_ships_line",
        "next_permitted_refresh_at",
        "next_unread_date",
        "next_unread_line",
      ],
      await ColumnsAsync("journal_cursors")
    );
  }

  private async Task<List<string>> ColumnsAsync(string table)
  {
    await using var connection = new NpgsqlConnection(database.ConnectionString);
    await connection.OpenAsync();
    await using var command = connection.CreateCommand();
    command.CommandText =
      "SELECT column_name FROM information_schema.columns WHERE table_name = @table ORDER BY column_name";
    command.Parameters.AddWithValue("table", table);
    var columns = new List<string>();
    await using var reader = await command.ExecuteReaderAsync();
    while (await reader.ReadAsync())
    {
      columns.Add(reader.GetString(0));
    }
    return columns;
  }

  private static string Start(FleetResponse response) =>
    response.Coverage!["startDate"]!.GetValue<string>();

  private static long LockKey(long customerId) =>
    unchecked(0x4E42_0000_0000_0000 | (customerId & 0x0000_FFFF_FFFF_FFFF));

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
