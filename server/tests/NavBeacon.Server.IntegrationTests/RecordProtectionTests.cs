using System.Net;
using System.Text.Json.Nodes;
using Microsoft.EntityFrameworkCore;
using NavBeacon.Server.Persistence;
using NavBeacon.Server.Records;

namespace NavBeacon.Server.IntegrationTests;

/// <summary>
/// Covers the live-page protection deadline, unnamed-record expiry and the
/// deletion conflict an offline page receives (020/FR-010 and 020/FR-025).
/// </summary>
public sealed class RecordProtectionTests(PostgreSqlDatabaseFixture database)
  : IClassFixture<PostgreSqlDatabaseFixture>
{
  private static readonly DateTimeOffset InitialTime = new(
    DateTimeOffset.UtcNow.Date.AddDays(1),
    TimeSpan.Zero
  );

  [Fact]
  public async Task AnAcceptedAutosaveCarriesServerContentTimeAndTheFirstDeadline()
  {
    using var server = NewServer(out var frontier, out _);
    using var commander = await SignInAsync(server, frontier, 72_001);
    var record = RecordFixtures.Ship(Guid.NewGuid());

    await commander.SynchroniseAsync(RecordFixtures.Request(0, RecordFixtures.Write(record)));

    var stored = await ReadAsync(72_001, RecordFixtures.IdOf(record));
    Assert.Equal(InitialTime, stored.ServerContentAt);
    Assert.Equal(
      InitialTime + RecordSynchronisationService.ProtectionPeriod,
      stored.ProtectionDeadline
    );
  }

  [Fact]
  public async Task ANamedRecordCarriesNoProtectionDeadlineAndDoesNotExpire()
  {
    using var server = NewServer(out var frontier, out var clock);
    using var commander = await SignInAsync(server, frontier, 72_002);
    var record = RecordFixtures.Ship(Guid.NewGuid(), "named");

    await commander.SynchroniseAsync(RecordFixtures.Request(0, RecordFixtures.Write(record)));
    var stored = await ReadAsync(72_002, RecordFixtures.IdOf(record));
    Assert.Null(stored.ProtectionDeadline);

    clock.Advance(TimeSpan.FromDays(20));
    var pulled = await commander.SynchroniseAsync(RecordFixtures.Request(0));

    Assert.Single(pulled.Records);
    Assert.Empty(pulled.Tombstones);
    Assert.Equal(1, pulled.AccountRevision);
  }

  [Fact]
  public async Task AnOnlineLivePageRenewsProtectionWithoutChangingContentOrRevision()
  {
    using var server = NewServer(out var frontier, out var clock);
    using var commander = await SignInAsync(server, frontier, 72_003);
    var record = RecordFixtures.Ship(Guid.NewGuid());
    var identity = RecordFixtures.IdOf(record);
    await commander.SynchroniseAsync(RecordFixtures.Request(0, RecordFixtures.Write(record)));
    var before = await ReadAsync(72_003, identity);

    clock.Advance(TimeSpan.FromDays(7));
    var renewed = await commander.SynchroniseAsync(
      RecordFixtures.Request(1, RecordFixtures.Renew(identity))
    );

    Assert.Equal(HttpStatusCode.OK, renewed.Status);
    Assert.Equal("unchanged", renewed.Outcome(0));
    Assert.Equal(1, renewed.Revision(0));
    Assert.Equal(1, renewed.AccountRevision);
    Assert.Empty(renewed.Records);
    Assert.Empty(renewed.Tombstones);
    var after = await ReadAsync(72_003, identity);
    Assert.Equal(before.Revision, after.Revision);
    Assert.Equal(before.Payload, after.Payload);
    Assert.Equal(before.ServerContentAt, after.ServerContentAt);
    Assert.Equal(
      InitialTime + TimeSpan.FromDays(7) + RecordSynchronisationService.ProtectionPeriod,
      after.ProtectionDeadline
    );
  }

  [Fact]
  public async Task ExpiryWaitsForTheModificationPeriodAndTheProtectionDeadline()
  {
    using var server = NewServer(out var frontier, out var clock);
    using var commander = await SignInAsync(server, frontier, 72_004);
    var record = RecordFixtures.Ship(Guid.NewGuid());
    var identity = RecordFixtures.IdOf(record);
    await commander.SynchroniseAsync(RecordFixtures.Request(0, RecordFixtures.Write(record)));

    clock.Advance(RecordSynchronisationService.ModificationPeriod + TimeSpan.FromSeconds(1));
    var beforeDeadline = await commander.SynchroniseAsync(RecordFixtures.Request(1));

    Assert.Empty(beforeDeadline.Tombstones);
    Assert.Equal(1, beforeDeadline.AccountRevision);

    clock.Advance(RecordSynchronisationService.ProtectionPeriod);
    var afterDeadline = await commander.SynchroniseAsync(RecordFixtures.Request(1));

    Assert.Single(afterDeadline.Tombstones);
    Assert.Equal(identity.ToString(), afterDeadline.Tombstones[0]!["id"]!.GetValue<string>());
    Assert.Equal(2, afterDeadline.Tombstones[0]!["revision"]!.GetValue<long>());
    Assert.Equal(2, afterDeadline.AccountRevision);
    Assert.Empty(afterDeadline.Records);
    var stored = await ReadAsync(72_004, identity);
    Assert.Null(stored.Payload);
    Assert.Null(stored.ServerContentAt);
    Assert.Null(stored.ProtectionDeadline);
  }

  [Fact]
  public async Task ARenewedRecordSurvivesItsFirstDeadline()
  {
    using var server = NewServer(out var frontier, out var clock);
    using var commander = await SignInAsync(server, frontier, 72_005);
    var record = RecordFixtures.Ship(Guid.NewGuid());
    var identity = RecordFixtures.IdOf(record);
    await commander.SynchroniseAsync(RecordFixtures.Request(0, RecordFixtures.Write(record)));

    clock.Advance(TimeSpan.FromDays(7));
    await commander.SynchroniseAsync(RecordFixtures.Request(1, RecordFixtures.Renew(identity)));
    clock.Advance(TimeSpan.FromDays(1));
    var atFirstDeadline = await commander.SynchroniseAsync(RecordFixtures.Request(1));

    Assert.Empty(atFirstDeadline.Tombstones);

    clock.Advance(TimeSpan.FromDays(7));
    var atRenewedDeadline = await commander.SynchroniseAsync(RecordFixtures.Request(1));

    Assert.Single(atRenewedDeadline.Tombstones);
  }

  [Fact]
  public async Task AnOfflineLivePageReceivesAConflictWithoutLosingItsRecord()
  {
    using var server = NewServer(out var frontier, out var clock);
    using var commander = await SignInAsync(server, frontier, 72_006);
    var record = RecordFixtures.Ship(Guid.NewGuid());
    var identity = RecordFixtures.IdOf(record);
    await commander.SynchroniseAsync(RecordFixtures.Request(0, RecordFixtures.Write(record)));

    clock.Advance(TimeSpan.FromDays(16));
    var renewal = await commander.SynchroniseAsync(
      RecordFixtures.Request(1, RecordFixtures.Renew(identity))
    );

    Assert.Equal(HttpStatusCode.Conflict, renewal.Status);
    Assert.Equal("conflict", renewal.Code);
    Assert.Equal("conflict", renewal.Outcome(0));
    Assert.Null(renewal.Current(0));
    Assert.Equal(2, renewal.Revision(0));

    var resumed = await commander.SynchroniseAsync(
      RecordFixtures.Request(1, RecordFixtures.Write(RecordFixtures.Ship(identity), 2))
    );

    Assert.Equal(HttpStatusCode.OK, resumed.Status);
    Assert.Equal("applied", resumed.Outcome(0));
    Assert.Equal(3, resumed.Revision(0));
    var stored = await ReadAsync(72_006, identity);
    Assert.NotNull(stored.Payload);
    Assert.Equal(3, stored.Revision);
  }

  [Fact]
  public async Task ServerTimeControlsFirstUploadAndLaterExpiryDespiteSkewedDeviceClocks()
  {
    using var server = NewServer(out var frontier, out var clock);
    using var commander = await SignInAsync(server, frontier, 72_007);
    var behind = RecordFixtures.Ship(Guid.NewGuid());
    behind["createdAt"] = "2016-01-02T03:04:05.000Z";
    behind["modifiedAt"] = "2016-01-02T03:04:05.000Z";
    var ahead = RecordFixtures.Ship(Guid.NewGuid());
    ahead["createdAt"] = "2036-01-02T03:04:05.000Z";
    ahead["modifiedAt"] = "2036-01-02T03:04:05.000Z";

    await commander.SynchroniseAsync(
      RecordFixtures.Request(
        0,
        RecordFixtures.Write(behind),
        RecordFixtures.Write(ahead)
      )
    );

    foreach (var identity in new[] { RecordFixtures.IdOf(behind), RecordFixtures.IdOf(ahead) })
    {
      var stored = await ReadAsync(72_007, identity);
      Assert.Equal(InitialTime, stored.ServerContentAt);
      Assert.Equal(
        InitialTime + RecordSynchronisationService.ProtectionPeriod,
        stored.ProtectionDeadline
      );
    }

    clock.Advance(RecordSynchronisationService.ModificationPeriod + TimeSpan.FromHours(1));
    Assert.Empty((await commander.SynchroniseAsync(RecordFixtures.Request(2))).Tombstones);

    clock.Advance(RecordSynchronisationService.ProtectionPeriod);
    var expired = await commander.SynchroniseAsync(RecordFixtures.Request(2));

    Assert.Equal(2, expired.Tombstones.Count);
    Assert.Equal(4, expired.AccountRevision);
  }

  private async Task<SynchronisedRecord> ReadAsync(long customerId, Guid identity)
  {
    await using var context = database.CreateContext();
    return await context
      .SynchronisedRecords.AsNoTracking()
      .SingleAsync(record => record.CustomerId == customerId && record.RecordId == identity);
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
