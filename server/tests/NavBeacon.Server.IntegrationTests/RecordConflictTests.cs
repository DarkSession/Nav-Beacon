using System.Net;
using System.Text;
using System.Text.Json.Nodes;
using Microsoft.EntityFrameworkCore;
using NavBeacon.Server.Persistence;
using NavBeacon.Server.Records;

namespace NavBeacon.Server.IntegrationTests;

/// <summary>
/// Covers conditional record writes, live-contract equality and the overwrite,
/// keep-both and cancel outcomes of 020/FR-008 and 020/FR-009.
/// </summary>
public sealed class RecordConflictTests(PostgreSqlDatabaseFixture database)
  : IClassFixture<PostgreSqlDatabaseFixture>
{
  private static readonly DateTimeOffset InitialTime = new(
    DateTimeOffset.UtcNow.Date.AddDays(1),
    TimeSpan.Zero
  );

  [Fact]
  public async Task ConcurrentWritesAcceptOneAndReturnTheCurrentVersionToTheOther()
  {
    const long customerId = 71_001;
    var identity = Guid.NewGuid();
    await NewAccountAsync(customerId);
    var clock = new ManualTimeProvider(InitialTime);
    await ApplyAsync(customerId, clock, Change(RecordFixtures.Ship(identity)));

    var first = ApplyAsync(
      customerId,
      clock,
      Change(Named(RecordFixtures.Ship(identity), "First device"), 1)
    );
    var second = ApplyAsync(
      customerId,
      clock,
      Change(Named(RecordFixtures.Ship(identity), "Second device"), 1)
    );
    var outcomes = await Task.WhenAll(first, second);

    var applied = Assert.Single(outcomes, outcome => outcome.Code is null);
    var refused = Assert.Single(outcomes, outcome => outcome.Code is not null);
    Assert.Equal(RecordErrorCodes.Conflict, refused.Code);
    Assert.Equal(ChangeOutcome.Applied, applied.Results[0].Outcome);
    Assert.Equal(2, applied.Results[0].Revision);
    Assert.Equal(ChangeOutcome.Conflict, refused.Results[0].Outcome);
    Assert.Equal(2, refused.Results[0].Revision);
    Assert.Contains("device", refused.Results[0].CurrentPayload!, StringComparison.Ordinal);
    Assert.Empty(refused.Stream);

    await using var context = database.CreateContext();
    var stored = await context
      .SynchronisedRecords.AsNoTracking()
      .SingleAsync(record => record.CustomerId == customerId);
    Assert.Equal(2, stored.Revision);
  }

  [Fact]
  public async Task OverwriteReplacesTheRemoteRecordAndKeepBothMintsAnIdentity()
  {
    using var server = NewServer(out var frontier, out _);
    using var commander = await SignInAsync(server, frontier, 71_002);
    var identity = Guid.NewGuid();
    await commander.SynchroniseAsync(
      RecordFixtures.Request(0, RecordFixtures.Write(RecordFixtures.Ship(identity)))
    );
    await commander.SynchroniseAsync(
      RecordFixtures.Request(
        1,
        RecordFixtures.Write(Named(RecordFixtures.Ship(identity), "Other device"), 1)
      )
    );

    var conflict = await commander.SynchroniseAsync(
      RecordFixtures.Request(
        1,
        RecordFixtures.Write(Named(RecordFixtures.Ship(identity), "This device"), 1)
      )
    );
    Assert.Equal(HttpStatusCode.Conflict, conflict.Status);
    Assert.Equal(2, conflict.Revision(0));
    Assert.Equal(
      "Other device",
      conflict.Current(0)!["build"]!["shipName"]!.GetValue<string>()
    );

    var overwritten = await commander.SynchroniseAsync(
      RecordFixtures.Request(
        1,
        RecordFixtures.Write(Named(RecordFixtures.Ship(identity), "This device"), 2)
      )
    );

    Assert.Equal(HttpStatusCode.OK, overwritten.Status);
    Assert.Equal("applied", overwritten.Outcome(0));
    Assert.Equal(3, overwritten.Revision(0));

    var minted = Guid.NewGuid();
    var kept = await commander.SynchroniseAsync(
      RecordFixtures.Request(
        3,
        RecordFixtures.Write(Named(RecordFixtures.Ship(minted), "Kept copy"))
      )
    );

    Assert.Equal(HttpStatusCode.OK, kept.Status);
    Assert.Equal(4, kept.Revision(0));
    await using var context = database.CreateContext();
    var rows = await context
      .SynchronisedRecords.AsNoTracking()
      .Where(record => record.CustomerId == 71_002)
      .ToListAsync();
    Assert.Equal(2, rows.Count);
    Assert.Contains(rows, row => row.RecordId == identity);
    Assert.Contains(rows, row => row.RecordId == minted);
  }

  [Fact]
  public async Task CancelLeavesBothVersionsUnchanged()
  {
    using var server = NewServer(out var frontier, out _);
    using var commander = await SignInAsync(server, frontier, 71_003);
    var identity = Guid.NewGuid();
    await commander.SynchroniseAsync(
      RecordFixtures.Request(0, RecordFixtures.Write(RecordFixtures.Ship(identity)))
    );
    await commander.SynchroniseAsync(
      RecordFixtures.Request(
        1,
        RecordFixtures.Write(Named(RecordFixtures.Ship(identity), "Remote version"), 1)
      )
    );

    var conflict = await commander.SynchroniseAsync(
      RecordFixtures.Request(
        1,
        RecordFixtures.Write(Named(RecordFixtures.Ship(identity), "Local version"), 1)
      )
    );

    Assert.Equal(HttpStatusCode.Conflict, conflict.Status);
    await using var context = database.CreateContext();
    var stored = await context
      .SynchronisedRecords.AsNoTracking()
      .SingleAsync(record => record.CustomerId == 71_003);
    Assert.Equal(2, stored.Revision);
    Assert.Contains("Remote version", stored.Payload!, StringComparison.Ordinal);
    Assert.DoesNotContain("Local version", stored.Payload!, StringComparison.Ordinal);
    Assert.Equal(
      2,
      (await context.CommanderAccounts.AsNoTracking().SingleAsync(a => a.CustomerId == 71_003))
        .RecordRevision
    );
  }

  [Fact]
  public async Task IdenticalStaleContentIsANoOp()
  {
    using var server = NewServer(out var frontier, out _);
    using var commander = await SignInAsync(server, frontier, 71_004);
    var identity = Guid.NewGuid();
    await commander.SynchroniseAsync(
      RecordFixtures.Request(0, RecordFixtures.Write(RecordFixtures.Ship(identity)))
    );
    await commander.SynchroniseAsync(
      RecordFixtures.Request(
        1,
        RecordFixtures.Write(Named(RecordFixtures.Ship(identity), "Same content"), 1)
      )
    );

    var repeated = await commander.SynchroniseAsync(
      RecordFixtures.Request(
        1,
        RecordFixtures.Write(Named(RecordFixtures.Ship(identity), "Same content"), 1)
      )
    );

    Assert.Equal(HttpStatusCode.OK, repeated.Status);
    Assert.Equal("unchanged", repeated.Outcome(0));
    Assert.Equal(2, repeated.Revision(0));
    Assert.Equal(2, repeated.AccountRevision);
  }

  [Fact]
  public async Task EqualityCoversEveryLiveContractField()
  {
    using var server = NewServer(out var frontier, out _);
    using var commander = await SignInAsync(server, frontier, 71_007);
    var ship = RecordFixtures.Ship(Guid.NewGuid());
    var equipment = RecordFixtures.Equipment(Guid.NewGuid());
    await commander.SynchroniseAsync(
      RecordFixtures.Request(
        0,
        RecordFixtures.Write((JsonObject)ship.DeepClone()),
        RecordFixtures.Write((JsonObject)equipment.DeepClone())
      )
    );

    var equal = new List<string>();
    foreach (var field in LiveContractFields)
    {
      var equipmentField =
        field == "name" || field.StartsWith("loadout", StringComparison.Ordinal);
      var original = equipmentField ? equipment : ship;
      var repeated = await commander.SynchroniseAsync(
        RecordFixtures.Request(2, RecordFixtures.Write((JsonObject)original.DeepClone()))
      );
      Assert.Equal("unchanged", repeated.Outcome(0));

      var changed = await commander.SynchroniseAsync(
        RecordFixtures.Request(
          2,
          RecordFixtures.Write(Mutate((JsonObject)original.DeepClone(), field))
        )
      );
      if (changed.Outcome(0) == "unchanged")
      {
        equal.Add(field);
      }
    }

    Assert.Empty(equal);
  }

  private static readonly string[] LiveContractFields =
  [
    "format",
    "version",
    "id",
    "tool",
    "kind",
    "createdAt",
    "modifiedAt",
    "build.format",
    "build.version",
    "build.shipSymbol",
    "build.shipName",
    "build.shipIdent",
    "build.modules.count",
    "build.modules.slot",
    "build.modules.symbol",
    "build.modules.enabled",
    "build.modules.priority",
    "build.modules.preEngineered",
    "build.modules.engineering",
    "name",
    "loadout.format",
    "loadout.version",
    "loadout.suitFamily",
    "loadout.suitGrade",
    "loadout.suitModifications",
    "loadout.weapons",
  ];

  [Fact]
  public async Task AChangedNameOrNamedStateConflicts()
  {
    using var server = NewServer(out var frontier, out _);
    using var commander = await SignInAsync(server, frontier, 71_005);
    var ship = RecordFixtures.Ship(Guid.NewGuid(), "named");
    ship["build"]!["shipName"] = "Original name";
    var equipment = RecordFixtures.Equipment(Guid.NewGuid());
    await commander.SynchroniseAsync(
      RecordFixtures.Request(
        0,
        RecordFixtures.Write((JsonObject)ship.DeepClone()),
        RecordFixtures.Write((JsonObject)equipment.DeepClone())
      )
    );

    var renamed = (JsonObject)ship.DeepClone();
    renamed["build"]!["shipName"] = "Second name";
    var renamedResponse = await commander.SynchroniseAsync(
      RecordFixtures.Request(2, RecordFixtures.Write(renamed, 0))
    );

    var working = (JsonObject)equipment.DeepClone();
    working["kind"] = "working";
    var namedStateResponse = await commander.SynchroniseAsync(
      RecordFixtures.Request(2, RecordFixtures.Write(working, 0))
    );

    Assert.Equal(HttpStatusCode.Conflict, renamedResponse.Status);
    Assert.Equal("conflict", renamedResponse.Outcome(0));
    Assert.Equal(1, renamedResponse.Revision(0));
    Assert.Equal(HttpStatusCode.Conflict, namedStateResponse.Status);
    Assert.Equal("conflict", namedStateResponse.Outcome(0));
    Assert.Equal(2, namedStateResponse.Revision(0));
  }

  [Fact]
  public async Task ADeletionConflictAcceptsOverwriteKeepBothAndCancel()
  {
    using var server = NewServer(out var frontier, out _);
    using var commander = await SignInAsync(server, frontier, 71_006);
    var identity = Guid.NewGuid();
    await commander.SynchroniseAsync(
      RecordFixtures.Request(0, RecordFixtures.Write(RecordFixtures.Ship(identity)))
    );
    await commander.SynchroniseAsync(
      RecordFixtures.Request(1, RecordFixtures.Delete(identity, 1))
    );

    var conflict = await commander.SynchroniseAsync(
      RecordFixtures.Request(
        1,
        RecordFixtures.Write(Named(RecordFixtures.Ship(identity), "Kept work"), 1)
      )
    );

    Assert.Equal(HttpStatusCode.Conflict, conflict.Status);
    Assert.Equal("conflict", conflict.Outcome(0));
    Assert.Equal(2, conflict.Revision(0));
    Assert.Null(conflict.Current(0));
    await AssertDeletionMarkerAsync(71_006, identity, 2);

    var minted = Guid.NewGuid();
    var keptBoth = await commander.SynchroniseAsync(
      RecordFixtures.Request(
        1,
        RecordFixtures.Write(Named(RecordFixtures.Ship(minted), "Kept work"))
      )
    );
    Assert.Equal("applied", keptBoth.Outcome(0));
    Assert.Single(keptBoth.Tombstones);
    Assert.Equal(identity.ToString(), keptBoth.Tombstones[0]!["id"]!.GetValue<string>());

    var overwritten = await commander.SynchroniseAsync(
      RecordFixtures.Request(
        3,
        RecordFixtures.Write(Named(RecordFixtures.Ship(identity), "Resumed work"), 2)
      )
    );

    Assert.Equal(HttpStatusCode.OK, overwritten.Status);
    Assert.Equal("applied", overwritten.Outcome(0));
    Assert.Equal(4, overwritten.Revision(0));
    Assert.Empty(overwritten.Tombstones);
    await using var context = database.CreateContext();
    var restored = await context
      .SynchronisedRecords.AsNoTracking()
      .SingleAsync(record => record.CustomerId == 71_006 && record.RecordId == identity);
    Assert.Equal(4, restored.Revision);
    Assert.Contains("Resumed work", restored.Payload!, StringComparison.Ordinal);
  }

  private async Task AssertDeletionMarkerAsync(long customerId, Guid identity, long revision)
  {
    await using var context = database.CreateContext();
    var marker = await context
      .SynchronisedRecords.AsNoTracking()
      .SingleAsync(record => record.CustomerId == customerId && record.RecordId == identity);
    Assert.Null(marker.Payload);
    Assert.Equal(revision, marker.Revision);
    Assert.Equal(
      revision,
      (await context.CommanderAccounts.AsNoTracking().SingleAsync(a => a.CustomerId == customerId))
        .RecordRevision
    );
  }

  private static JsonObject Mutate(JsonObject record, string field)
  {
    switch (field)
    {
      case "format":
        record["format"] = "ednb.other-record";
        break;
      case "version":
        record["version"] = 2;
        break;
      case "id":
        record["id"] = Guid.NewGuid().ToString();
        break;
      case "tool":
        record["tool"] = record["tool"]!.GetValue<string>() == "ship" ? "equipment" : "ship";
        break;
      case "kind":
        record["kind"] = record["kind"]!.GetValue<string>() == "named" ? "working" : "named";
        break;
      case "createdAt":
        record["createdAt"] = "2025-01-02T03:04:05.000Z";
        break;
      case "modifiedAt":
        record["modifiedAt"] = "2025-01-02T03:04:05.000Z";
        break;
      case "name":
        record["name"] = "Another loadout name";
        break;
      case "build.format":
        record["build"]!["format"] = "ednb.other-build";
        break;
      case "build.version":
        record["build"]!["version"] = 2;
        break;
      case "build.shipSymbol":
        record["build"]!["shipSymbol"] = "Anaconda";
        break;
      case "build.shipName":
        record["build"]!["shipName"] = "Another ship name";
        break;
      case "build.shipIdent":
        record["build"]!["shipIdent"] = "ID-02";
        break;
      case "build.modules.count":
        ((JsonArray)record["build"]!["modules"]!).RemoveAt(0);
        break;
      case "build.modules.slot":
        record["build"]!["modules"]![0]!["slot"] = "MediumHardpoint1";
        break;
      case "build.modules.symbol":
        record["build"]!["modules"]![0]!["symbol"] = "Hpt_BeamLaser_Gimbal_Small";
        break;
      case "build.modules.enabled":
        record["build"]!["modules"]![0]!["enabled"] = false;
        break;
      case "build.modules.priority":
        record["build"]!["modules"]![0]!["priority"] = 3;
        break;
      case "build.modules.preEngineered":
        record["build"]!["modules"]![0]!["preEngineered"] = new JsonObject
        {
          ["symbol"] = "Hpt_PulseLaser_Gimbal_Small",
          ["blueprint"] = "Weapon_Sturdy",
          ["grade"] = 1,
          ["acquisition"] = "unknown",
          ["experimental"] = null,
        };
        break;
      case "build.modules.engineering":
        record["build"]!["modules"]![0]!["engineering"] = new JsonObject
        {
          ["blueprint"] = "Weapon_Sturdy",
          ["grade"] = 1,
          ["quality"] = 1,
          ["experimental"] = null,
        };
        break;
      case "loadout.format":
        record["loadout"]!["format"] = "ednb.other-loadout";
        break;
      case "loadout.version":
        record["loadout"]!["version"] = 2;
        break;
      case "loadout.suitFamily":
        record["loadout"]!["suitFamily"] = "another-suit";
        break;
      case "loadout.suitGrade":
        record["loadout"]!["suitGrade"] = 3;
        break;
      case "loadout.suitModifications":
        ((JsonArray)record["loadout"]!["suitModifications"]!).RemoveAt(0);
        break;
      default:
        ((JsonArray)record["loadout"]!["weapons"]!).RemoveAt(0);
        break;
    }
    return record;
  }

  private static JsonObject Named(JsonObject record, string name)
  {
    record["build"]!["shipName"] = name;
    return record;
  }

  private static RecordChange[] Change(JsonObject record, long? baseRevision = null)
  {
    var read = RecordRequestReader.Read(
      Encoding.UTF8.GetBytes(
        RecordFixtures.Request(0, RecordFixtures.Write(record, baseRevision)).ToJsonString()
      )
    );
    Assert.NotNull(read.Request);
    return [.. read.Request.Changes];
  }

  private async Task<RecordSynchronisationOutcome> ApplyAsync(
    long customerId,
    TimeProvider clock,
    RecordChange[] changes
  )
  {
    await using var context = database.CreateContext();
    var service = new RecordSynchronisationService(context, clock);
    return await service.ApplyAsync(
      customerId,
      new RecordSynchronisationRequest(0, changes),
      CancellationToken.None
    );
  }

  private async Task NewAccountAsync(long customerId)
  {
    await using var context = database.CreateContext();
    context.CommanderAccounts.Add(
      new CommanderAccount
      {
        CustomerId = customerId,
        CommanderName = "Test Commander",
        ProtectedAccessToken = "protected access",
        ProtectedRefreshToken = "protected refresh",
        AccessTokenExpiresAt = InitialTime.AddHours(1),
      }
    );
    await context.SaveChangesAsync();
  }

  private CommanderTestServer NewServer(
    out FakeFrontierClient frontier,
    out ManualTimeProvider clock
  )
  {
    var fake = new FakeFrontierClient();
    var manual = new ManualTimeProvider(InitialTime);
    frontier = fake;
    clock = manual;
    return new CommanderTestServer(database, fake, manual);
  }

  private static Task<SignedInCommander> SignInAsync(
    CommanderTestServer server,
    FakeFrontierClient frontier,
    long customerId
  ) => SignedInCommander.SignInAsync(server, frontier, customerId, InitialTime);
}
