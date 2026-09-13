using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using NavBeacon.Server.Fleet;

namespace NavBeacon.Server.IntegrationTests;

/// <summary>
/// Owned-ship upsert by `(CustomerId, ShipId)`, sale removal and `StoredShips`
/// reconciliation in date-line order (020/FR-014), and the bounded batches the
/// projection runs in (020/FR-013).
/// </summary>
public sealed class FleetProjectionTests(PostgreSqlDatabaseFixture database)
  : IClassFixture<PostgreSqlDatabaseFixture>
{
  private static readonly DateTimeOffset Now = new(
    DateTimeOffset.UtcNow.Date.AddDays(1),
    TimeSpan.Zero
  );
  private static readonly DateOnly Today = DateOnly.FromDateTime(Now.UtcDateTime);
  private static readonly DateOnly Yesterday = Today.AddDays(-1);

  [Fact]
  public async Task ALaterLoadoutReplacesOneProjection()
  {
    var journal = new FakeJournalClient();
    journal.Incomplete(
      Today,
      JournalFixtures.Loadout(12, name: "First"),
      JournalFixtures.Loadout(12, name: "Second")
    );
    using var server = NewServer(journal, out var frontier);
    using var commander = await SignIn(server, frontier, 81_001);
    await database.SeedCursorAsync(81_001, Today, 0);

    var refreshed = await commander.RefreshFleetAsync();

    var ship = Assert.Single(refreshed.Ships);
    Assert.Equal(1, ship!["sourceLine"]!.GetValue<int>());
    Assert.Equal("Second", ship["model"]!["shipName"]!.GetValue<string>());
  }

  [Fact]
  public async Task TwoLoadoutsWithOneTimestampUseLineOrder()
  {
    const string stamp = "2026-09-10T10:00:00Z";
    var journal = new FakeJournalClient();
    journal.Incomplete(
      Today,
      JournalFixtures.Loadout(12, timestamp: stamp, name: "Earlier"),
      JournalFixtures.Loadout(12, timestamp: stamp, name: "Later")
    );
    using var server = NewServer(journal, out var frontier);
    using var commander = await SignIn(server, frontier, 81_002);
    await database.SeedCursorAsync(81_002, Today, 0);

    var refreshed = await commander.RefreshFleetAsync();

    Assert.Equal("Later", refreshed.Ship(12)["model"]!["shipName"]!.GetValue<string>());
  }

  [Fact]
  public async Task ReplayingAnEarlierOrEqualLineHasNoEffect()
  {
    var journal = new FakeJournalClient();
    journal.Complete(Yesterday, JournalFixtures.Loadout(12, name: "Earlier"));
    journal.Incomplete(Today, JournalFixtures.Loadout(12, name: "Later"));
    journal.Complete(Yesterday, JournalFixtures.Loadout(12, name: "Earlier"));
    journal.Incomplete(Today, JournalFixtures.Loadout(12, name: "Later"));
    using var server = NewServer(journal, out var frontier);
    using var commander = await SignIn(server, frontier, 81_003);
    await database.SeedCursorAsync(81_003, Yesterday, 0);

    var first = await commander.RefreshFleetAsync();
    await database.SeedCursorAsync(81_003, Yesterday, 0);
    var replayed = await commander.RefreshFleetAsync();

    Assert.Equal("Later", first.Ship(12)["model"]!["shipName"]!.GetValue<string>());
    Assert.Equal("Later", replayed.Ship(12)["model"]!["shipName"]!.GetValue<string>());
    Assert.Equal(Today.ToString("yyyy-MM-dd"), replayed.Ship(12)["sourceDate"]!.GetValue<string>());
  }

  [Fact]
  public async Task AKnownSoldShipLeavesTheFleet()
  {
    var journal = new FakeJournalClient();
    journal.Incomplete(
      Today,
      JournalFixtures.Loadout(12),
      JournalFixtures.Loadout(13),
      JournalFixtures.Sale(12)
    );
    using var server = NewServer(journal, out var frontier);
    using var commander = await SignIn(server, frontier, 81_004);
    await database.SeedCursorAsync(81_004, Today, 0);

    var refreshed = await commander.RefreshFleetAsync();

    Assert.Equal(13, Assert.Single(refreshed.Ships)!["shipId"]!.GetValue<long>());
  }

  [Fact]
  public async Task ASaleBeforeAProjectionDoesNotRemoveIt()
  {
    var journal = new FakeJournalClient();
    journal.Incomplete(Today, JournalFixtures.Sale(12), JournalFixtures.Loadout(12));
    using var server = NewServer(journal, out var frontier);
    using var commander = await SignIn(server, frontier, 81_005);
    await database.SeedCursorAsync(81_005, Today, 0);

    var refreshed = await commander.RefreshFleetAsync();

    Assert.Single(refreshed.Ships);
  }

  [Fact]
  public async Task StoredShipsRemovesWhatNeitherSetNames()
  {
    var journal = new FakeJournalClient();
    journal.Incomplete(
      Today,
      JournalFixtures.Loadout(12),
      JournalFixtures.Loadout(13),
      JournalFixtures.Loadout(14),
      JournalFixtures.StoredShips(shipIds: [12])
    );
    using var server = NewServer(journal, out var frontier);
    using var commander = await SignIn(server, frontier, 81_006);
    await database.SeedCursorAsync(81_006, Today, 0);

    var refreshed = await commander.RefreshFleetAsync();

    // Ship 14 is the current ship the latest `Loadout` identifies, and ship 12
    // is stored. Ship 13 is in neither set.
    Assert.Equal([12L, 14L], refreshed.Ships.Select(ship => ship!["shipId"]!.GetValue<long>()));
    Assert.True(refreshed.StoredShips!["complete"]!.GetValue<bool>());
  }

  [Fact]
  public async Task StoredShipsCreatesNoShipWithoutAnAcceptedLoadout()
  {
    var journal = new FakeJournalClient();
    journal.Incomplete(
      Today,
      JournalFixtures.Loadout(12),
      JournalFixtures.StoredShips(shipIds: [12, 99])
    );
    using var server = NewServer(journal, out var frontier);
    using var commander = await SignIn(server, frontier, 81_007);
    await database.SeedCursorAsync(81_007, Today, 0);

    var refreshed = await commander.RefreshFleetAsync();

    Assert.Equal(12, Assert.Single(refreshed.Ships)!["shipId"]!.GetValue<long>());
    Assert.False(refreshed.StoredShips!["complete"]!.GetValue<bool>());
    Assert.Equal("incomplete", refreshed.Result);
  }

  [Fact]
  public async Task AnIncompleteComparisonKeepsNoMissingShipIdentity()
  {
    var journal = new FakeJournalClient();
    journal.Incomplete(
      Today,
      JournalFixtures.Loadout(12),
      JournalFixtures.StoredShips(shipIds: [12, 99])
    );
    using var server = NewServer(journal, out var frontier);
    using var commander = await SignIn(server, frontier, 81_008);
    await database.SeedCursorAsync(81_008, Today, 0);

    await commander.RefreshFleetAsync();

    await using var context = database.CreateContext();
    var cursor = await context.JournalCursors.SingleAsync(entry => entry.CustomerId == 81_008);
    Assert.False(cursor.LastStoredShipsComplete);
    Assert.Equal(Today, cursor.LastStoredShipsDate);
    Assert.Equal(1, cursor.LastStoredShipsLine);
    Assert.DoesNotContain(
      "99",
      await context.OwnedShips.Where(ship => ship.CustomerId == 81_008).Select(ship => ship.Payload).SingleAsync(),
      StringComparison.Ordinal
    );
  }

  [Fact]
  public async Task AnEarlierStoredShipsEventDoesNotRecomputeTheResult()
  {
    var journal = new FakeJournalClient();
    journal.Complete(
      Yesterday,
      JournalFixtures.Loadout(12),
      JournalFixtures.StoredShips(shipIds: [12])
    );
    journal.Incomplete(Today);
    using var server = NewServer(journal, out var frontier);
    using var commander = await SignIn(server, frontier, 81_009);
    await database.SeedCursorAsync(81_009, Yesterday, 0);

    var first = await commander.RefreshFleetAsync();
    await database.SeedCursorAsync(81_009, Yesterday, 0);
    journal.Complete(
      Yesterday,
      JournalFixtures.Loadout(12),
      JournalFixtures.StoredShips(shipIds: [12, 99])
    );
    journal.Incomplete(Today);
    var replayed = await commander.RefreshFleetAsync();

    Assert.True(first.StoredShips!["complete"]!.GetValue<bool>());
    Assert.True(replayed.StoredShips!["complete"]!.GetValue<bool>());
  }

  [Fact]
  public async Task NoRawEventOrExcludedFieldRemainsAfterCommit()
  {
    var journal = new FakeJournalClient();
    journal.Incomplete(
      Today,
      JournalFixtures.Other(),
      JournalFixtures.Loadout(
        12,
        ship: "anaconda",
        name: "Night Watch",
        ident: "NW-01",
        modules: """[{"Slot":"PowerPlant","Item":"Int_Powerplant_Size8_Class5","On":true,"Priority":0,"Health":0.9,"Value":57931}]"""
      )
    );
    using var server = NewServer(journal, out var frontier);
    using var commander = await SignIn(server, frontier, 81_010);
    await database.SeedCursorAsync(81_010, Today, 0);

    await commander.RefreshFleetAsync();

    await using var context = database.CreateContext();
    var ship = await context.OwnedShips.SingleAsync(entry => entry.CustomerId == 81_010);
    using var payload = JsonDocument.Parse(ship.Payload);
    Assert.Equal(
      ["hullSymbol", "modules", "shipIdent", "shipName"],
      payload.RootElement.EnumerateObject().Select(property => property.Name).Order()
    );
    foreach (var excluded in (string[])["health", "value", "timestamp", "event", "Docked", "hot"])
    {
      Assert.DoesNotContain(excluded, ship.Payload, StringComparison.OrdinalIgnoreCase);
    }
  }

  [Fact]
  public async Task APackageRefusalStopsBeforeItsLineAndKeepsTheLastAcceptedFleet()
  {
    var journal = new FakeJournalClient();
    journal.Incomplete(
      Today,
      JournalFixtures.Loadout(12),
      JournalFixtures.Loadout(
        13,
        modules: """[{"Slot":"PowerPlant","Item":"Int_Powerplant_Size8_Class99"}]"""
      ),
      JournalFixtures.Loadout(14)
    );
    using var server = NewServer(journal, out var frontier);
    using var commander = await SignIn(server, frontier, 81_011);
    await database.SeedCursorAsync(81_011, Today, 0);

    var refreshed = await commander.RefreshFleetAsync();

    Assert.Equal("failed", refreshed.Result);
    Assert.Equal("package-refused", refreshed.Failure);
    Assert.Equal("unknown-identity", refreshed.Refusal!["code"]!.GetValue<string>());
    Assert.Equal(12, Assert.Single(refreshed.Ships)!["shipId"]!.GetValue<long>());
    Assert.Equal(1, refreshed.CursorLine);
  }

  [Fact]
  public async Task ARefusedLineIsRetriedAfterThePackageResolvesIt()
  {
    var journal = new FakeJournalClient();
    journal.Incomplete(
      Today,
      JournalFixtures.Loadout(
        12,
        modules: """[{"Slot":"PowerPlant","Item":"Int_Powerplant_Size8_Class99"}]"""
      )
    );
    journal.Incomplete(Today, JournalFixtures.Loadout(12));
    using var server = NewServer(journal, out var frontier);
    using var commander = await SignIn(server, frontier, 81_012);
    await database.SeedCursorAsync(81_012, Today, 0);

    var refused = await commander.RefreshFleetAsync();
    var accepted = await commander.RefreshFleetAsync();

    Assert.Equal(0, refused.CursorLine);
    Assert.Empty(refused.Ships);
    Assert.Single(accepted.Ships);
    Assert.Equal(1, accepted.CursorLine);
  }

  [Fact]
  public async Task AMalformedLineIsRetriedRatherThanSkipped()
  {
    var journal = new FakeJournalClient();
    journal.Incomplete(Today, JournalFixtures.Loadout(12), "{\"event\":", JournalFixtures.Loadout(13));
    using var server = NewServer(journal, out var frontier);
    using var commander = await SignIn(server, frontier, 81_013);
    await database.SeedCursorAsync(81_013, Today, 0);

    var refreshed = await commander.RefreshFleetAsync();

    Assert.Equal("failed", refreshed.Result);
    Assert.Equal("line-malformed", refreshed.Failure);
    Assert.Equal(1, refreshed.CursorLine);
    Assert.Equal(12, Assert.Single(refreshed.Ships)!["shipId"]!.GetValue<long>());
  }

  [Fact]
  public async Task AnOversizedLineStopsBeforeItsLine()
  {
    var journal = new FakeJournalClient();
    journal.Incomplete(
      Today,
      JournalFixtures.Loadout(12),
      JournalFixtures.Loadout(13, padding: FleetLimits.MaximumLineBytes)
    );
    using var server = NewServer(journal, out var frontier);
    using var commander = await SignIn(server, frontier, 81_014);
    await database.SeedCursorAsync(81_014, Today, 0);

    var refreshed = await commander.RefreshFleetAsync();

    Assert.Equal("line-too-large", refreshed.Failure);
    Assert.Equal(1, refreshed.CursorLine);
    Assert.Single(refreshed.Ships);
  }

  [Fact]
  public async Task AnotherBatchStartsBeforeTheLineBound()
  {
    var lines = Enumerable
      .Range(0, FleetLimits.MaximumBatchLines + 1)
      .Select(index => JournalFixtures.Loadout(200 + index))
      .ToArray();
    var journal = new FakeJournalClient();
    journal.Incomplete(Today, lines);
    using var server = NewServer(journal, out var frontier);
    using var commander = await SignIn(server, frontier, 81_015);
    await database.SeedCursorAsync(81_015, Today, 0);

    var refreshed = await commander.RefreshFleetAsync();

    Assert.Equal(FleetLimits.MaximumBatchLines + 1, refreshed.Ships.Count);
    Assert.Equal(FleetLimits.MaximumBatchLines + 1, refreshed.CursorLine);
  }

  [Fact]
  public async Task AnotherBatchStartsBeforeTheSizeBound()
  {
    // Five lines of nine tenths of a mebibyte cross four mebibytes on the fifth.
    var lines = Enumerable
      .Range(0, 5)
      .Select(index => JournalFixtures.Loadout(300 + index, padding: 900 * 1024))
      .ToArray();
    var journal = new FakeJournalClient();
    journal.Incomplete(Today, lines);
    using var server = NewServer(journal, out var frontier);
    using var commander = await SignIn(server, frontier, 81_016);
    await database.SeedCursorAsync(81_016, Today, 0);

    var refreshed = await commander.RefreshFleetAsync();

    Assert.Equal(5, refreshed.Ships.Count);
    Assert.Equal(5, refreshed.CursorLine);
  }

  [Fact]
  public async Task ARefreshStopsAfterTenBatchesAndContinuesOnTheNextOne()
  {
    var lines = Enumerable
      .Range(0, FleetLimits.MaximumBatchLines * (FleetLimits.MaximumBatches + 1))
      .Select(index => JournalFixtures.Loadout(400 + (index % 5)))
      .ToArray();
    var journal = new FakeJournalClient();
    journal.Incomplete(Today, lines);
    journal.Incomplete(Today, lines);
    using var server = NewServer(journal, out var frontier);
    using var commander = await SignIn(server, frontier, 81_017);
    await database.SeedCursorAsync(81_017, Today, 0);

    var stopped = await commander.RefreshFleetAsync();
    var continued = await commander.RefreshFleetAsync();

    Assert.Equal(
      FleetLimits.MaximumBatchLines * FleetLimits.MaximumBatches,
      stopped.CursorLine
    );
    Assert.True(stopped.Pending);
    Assert.Equal(lines.Length, continued.CursorLine);
    Assert.Equal(5, continued.Ships.Count);
  }

  [Fact]
  public async Task AProjectionCommandThatCannotRunKeepsTheCursor()
  {
    var journal = new FakeJournalClient();
    journal.Incomplete(Today, JournalFixtures.Loadout(12));
    var frontier = new FakeFrontierClient();
    using var server = new CommanderTestServer(
      database,
      frontier,
      new ManualTimeProvider(Now),
      journal: journal,
      settings: new Dictionary<string, string>
      {
        ["FleetProjection:Command"] = "a-command-that-does-not-exist",
      }
    );
    using var commander = await SignIn(server, frontier, 81_018);
    await database.SeedCursorAsync(81_018, Today, 0);

    var refreshed = await commander.RefreshFleetAsync();

    Assert.Equal("failed", refreshed.Result);
    Assert.Equal("projection-unavailable", refreshed.Failure);
    Assert.Equal(0, refreshed.CursorLine);
    Assert.Empty(refreshed.Ships);
  }

  [Fact]
  public async Task ARefusalAtAnIndexThatIsNotAWholeNumberKeepsTheCursor()
  {
    var journal = new FakeJournalClient();
    journal.Incomplete(Today, JournalFixtures.Loadout(12));
    var frontier = new FakeFrontierClient();
    using var server = new CommanderTestServer(
      database,
      frontier,
      new ManualTimeProvider(Now),
      journal: journal,
      settings: new Dictionary<string, string>
      {
        ["FleetProjection:ScriptPath"] = Path.Combine(
          AppContext.BaseDirectory,
          "Fixtures",
          "refusal-at-a-fractional-index.mjs"
        ),
      }
    );
    using var commander = await SignIn(server, frontier, 81_019);
    await database.SeedCursorAsync(81_019, Today, 0);

    var refreshed = await commander.RefreshFleetAsync();

    // An answer this server cannot read is no projection, which is a stated
    // failure that leaves the cursor where it was (020/FR-016, 020/FR-018).
    Assert.Equal("failed", refreshed.Result);
    Assert.Equal("projection-unavailable", refreshed.Failure);
    Assert.Equal(0, refreshed.CursorLine);
    Assert.Empty(refreshed.Ships);
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
