using System.Data.Common;
using System.Net;
using System.Text;
using System.Text.Json.Nodes;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using NavBeacon.Server.Persistence;
using NavBeacon.Server.Records;
using Npgsql;

namespace NavBeacon.Server.IntegrationTests;

/// <summary>
/// Covers the account revision stream, the request bounds and the atomic
/// refusal rules of 020/FR-026 over HTTP.
/// </summary>
public sealed class RecordSynchronisationTests(PostgreSqlDatabaseFixture database)
  : IClassFixture<PostgreSqlDatabaseFixture>
{
  private static readonly DateTimeOffset InitialTime = new(
    DateTimeOffset.UtcNow.Date.AddDays(1),
    TimeSpan.Zero
  );

  [Fact]
  public async Task AnAnonymousRequestIsRefused()
  {
    using var server = NewServer(out _, out _);
    using var client = server.CreateClient();

    using var response = await client.PostAsync(
      "api/records/synchronise",
      new StringContent("{\"sinceRevision\":0,\"changes\":[]}", Encoding.UTF8, "application/json")
    );

    Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
  }

  [Fact]
  public async Task ASignedInRequestWithoutAnAntiForgeryTokenIsRefused()
  {
    using var server = NewServer(out var frontier, out _);
    using var commander = await SignInAsync(server, frontier, 70_001);

    var response = await commander.SendAsync(
      RecordFixtures.Request(0).ToJsonString(),
      withToken: false
    );

    Assert.Equal(HttpStatusCode.BadRequest, response.Status);
    Assert.Equal("invalid-anti-forgery", response.Code);
  }

  [Fact]
  public async Task AnExpiredSessionIsUnauthorised()
  {
    using var server = NewServer(out var frontier, out var clock);
    using var commander = await SignInAsync(server, frontier, 70_002);
    clock.Advance(TimeSpan.FromDays(31));

    var response = await commander.SynchroniseAsync(RecordFixtures.Request(0));

    Assert.Equal(HttpStatusCode.Unauthorized, response.Status);
    Assert.Equal("unauthorised", response.Code);
  }

  [Fact]
  public async Task BothRecordKindsUploadAndTheStreamStartsAfterTheSuppliedRevision()
  {
    using var server = NewServer(out var frontier, out _);
    using var commander = await SignInAsync(server, frontier, 70_003);
    var ship = RecordFixtures.Ship(Guid.NewGuid());
    var equipment = RecordFixtures.Equipment(Guid.NewGuid());

    var accepted = await commander.SynchroniseAsync(
      RecordFixtures.Request(0, RecordFixtures.Write(ship), RecordFixtures.Write(equipment))
    );

    Assert.Equal(HttpStatusCode.OK, accepted.Status);
    Assert.Equal("applied", accepted.Outcome(0));
    Assert.Equal("applied", accepted.Outcome(1));
    Assert.Equal(1, accepted.Revision(0));
    Assert.Equal(2, accepted.Revision(1));
    Assert.Equal(2, accepted.AccountRevision);
    Assert.Equal(2, accepted.Records.Count);
    Assert.Empty(accepted.Tombstones);

    var later = await commander.SynchroniseAsync(RecordFixtures.Request(1));

    Assert.Equal(HttpStatusCode.OK, later.Status);
    Assert.Single(later.Records);
    Assert.Equal(2, later.Records[0]!["revision"]!.GetValue<long>());
    Assert.Equal(
      RecordFixtures.IdOf(equipment).ToString(),
      later.Records[0]!["record"]!["id"]!.GetValue<string>()
    );

    var deleted = await commander.SynchroniseAsync(
      RecordFixtures.Request(2, RecordFixtures.Delete(RecordFixtures.IdOf(ship), 1))
    );

    Assert.Equal("applied", deleted.Outcome(0));
    Assert.Single(deleted.Tombstones);
    Assert.Equal(
      RecordFixtures.IdOf(ship).ToString(),
      deleted.Tombstones[0]!["id"]!.GetValue<string>()
    );
    Assert.Equal(3, deleted.Tombstones[0]!["revision"]!.GetValue<long>());
    Assert.Empty(deleted.Records);
    await AssertTombstoneShapeAsync(70_003, RecordFixtures.IdOf(ship));
  }

  [Fact]
  public async Task AMixedBatchWithOneConflictAppliesNothingAndLeavesTheCursor()
  {
    using var server = NewServer(out var frontier, out _);
    using var commander = await SignInAsync(server, frontier, 70_004);
    var stale = RecordFixtures.Ship(Guid.NewGuid());
    await commander.SynchroniseAsync(RecordFixtures.Request(0, RecordFixtures.Write(stale)));
    var changed = (JsonObject)stale.DeepClone();
    changed["build"]!["shipName"] = "Changed elsewhere";
    await commander.SynchroniseAsync(RecordFixtures.Request(1, RecordFixtures.Write(changed, 1)));

    var fresh = RecordFixtures.Ship(Guid.NewGuid());
    var conflicting = (JsonObject)stale.DeepClone();
    conflicting["build"]!["shipIdent"] = "LOCAL";
    var refused = await commander.SynchroniseAsync(
      RecordFixtures.Request(
        2,
        RecordFixtures.Write(fresh),
        RecordFixtures.Write(conflicting, 1),
        RecordFixtures.Delete(Guid.NewGuid())
      )
    );

    Assert.Equal(HttpStatusCode.Conflict, refused.Status);
    Assert.Equal("conflict", refused.Code);
    Assert.Equal(3, refused.Results.Count);
    Assert.Equal("not-applied", refused.Outcome(0));
    Assert.Equal("conflict", refused.Outcome(1));
    Assert.Equal("not-applied", refused.Outcome(2));
    Assert.Equal(2, refused.Revision(1));
    Assert.Equal(
      "Changed elsewhere",
      refused.Current(1)!["build"]!["shipName"]!.GetValue<string>()
    );
    Assert.Equal(2, refused.AccountRevision);

    await using var context = database.CreateContext();
    var rows = await context
      .SynchronisedRecords.AsNoTracking()
      .Where(record => record.CustomerId == 70_004)
      .ToListAsync();
    Assert.Single(rows);
    Assert.Equal(2, rows[0].Revision);
    Assert.Equal(
      2,
      (await context.CommanderAccounts.AsNoTracking().SingleAsync(a => a.CustomerId == 70_004))
        .RecordRevision
    );
  }

  [Fact]
  public async Task ARetryAfterALostCommittedResponseCreatesNoFurtherRevision()
  {
    using var server = NewServer(out var frontier, out _);
    using var commander = await SignInAsync(server, frontier, 70_005);
    var kept = RecordFixtures.Ship(Guid.NewGuid());
    var removed = RecordFixtures.Equipment(Guid.NewGuid());
    var batch = RecordFixtures.Request(
      0,
      RecordFixtures.Write((JsonObject)kept.DeepClone()),
      RecordFixtures.Write((JsonObject)removed.DeepClone())
    );
    var first = await commander.SynchroniseAsync(batch);
    Assert.Equal(2, first.AccountRevision);

    var replayedWrites = await commander.SynchroniseAsync(batch);

    Assert.Equal(HttpStatusCode.OK, replayedWrites.Status);
    Assert.Equal("unchanged", replayedWrites.Outcome(0));
    Assert.Equal(1, replayedWrites.Revision(0));
    Assert.Equal("unchanged", replayedWrites.Outcome(1));
    Assert.Equal(2, replayedWrites.Revision(1));
    Assert.Equal(2, replayedWrites.AccountRevision);

    var delete = RecordFixtures.Request(
      2,
      RecordFixtures.Delete(RecordFixtures.IdOf(removed), 2)
    );
    var deleted = await commander.SynchroniseAsync(delete);
    Assert.Equal(3, deleted.AccountRevision);

    var replayedDelete = await commander.SynchroniseAsync(delete);

    Assert.Equal(HttpStatusCode.OK, replayedDelete.Status);
    Assert.Equal("unchanged", replayedDelete.Outcome(0));
    Assert.Equal(3, replayedDelete.Revision(0));
    Assert.Equal(3, replayedDelete.AccountRevision);
    await using var context = database.CreateContext();
    Assert.Equal(
      3,
      (await context.CommanderAccounts.AsNoTracking().SingleAsync(a => a.CustomerId == 70_005))
        .RecordRevision
    );
  }

  [Fact]
  public async Task ARecordAtTheBoundIsAcceptedAndOneByteMoreIsRefused()
  {
    using var server = NewServer(out var frontier, out _);
    using var commander = await SignInAsync(server, frontier, 70_006);

    var exact = PaddedShip(Guid.NewGuid(), RecordSynchronisationLimits.MaximumRecordBytes);
    Assert.Equal(65_536, Encoding.UTF8.GetByteCount(exact.ToJsonString()));
    var accepted = await commander.SynchroniseAsync(
      RecordFixtures.Request(0, RecordFixtures.Write(exact))
    );

    Assert.Equal(HttpStatusCode.OK, accepted.Status);
    Assert.Equal("applied", accepted.Outcome(0));

    var over = PaddedShip(Guid.NewGuid(), RecordSynchronisationLimits.MaximumRecordBytes + 1);
    Assert.Equal(65_537, Encoding.UTF8.GetByteCount(over.ToJsonString()));
    var refused = await commander.SynchroniseAsync(
      RecordFixtures.Request(1, RecordFixtures.Write(over))
    );

    Assert.Equal(HttpStatusCode.BadRequest, refused.Status);
    Assert.Equal("record-too-large", refused.Code);
    Assert.Equal("refused", refused.Outcome(0));
    Assert.Equal("record-too-large", refused.ResultCode(0));
    Assert.Equal(1, accepted.AccountRevision);
  }

  [Fact]
  public async Task AHundredChangesAreAcceptedAndOneMoreIsRefused()
  {
    using var server = NewServer(out var frontier, out _);
    using var commander = await SignInAsync(server, frontier, 70_007);
    var accepted = await commander.SynchroniseAsync(
      RecordFixtures.Request(0, Writes(RecordSynchronisationLimits.MaximumChanges))
    );

    Assert.Equal(HttpStatusCode.OK, accepted.Status);
    Assert.Equal(100, accepted.AccountRevision);

    var refused = await commander.SynchroniseAsync(
      RecordFixtures.Request(100, Writes(RecordSynchronisationLimits.MaximumChanges + 1))
    );

    Assert.Equal(HttpStatusCode.BadRequest, refused.Status);
    Assert.Equal("too-many-changes", refused.Code);
  }

  [Fact]
  public async Task ARequestAtTheByteBoundIsAcceptedAndOneByteMoreIsRefused()
  {
    using var server = NewServer(out var frontier, out _);
    using var commander = await SignInAsync(server, frontier, 70_008);

    var exact = PaddedRequest(RecordSynchronisationLimits.MaximumRequestBytes);
    Assert.Equal(1_048_576, Encoding.UTF8.GetByteCount(exact));
    var accepted = await commander.SendAsync(exact);

    Assert.Equal(HttpStatusCode.OK, accepted.Status);

    var over = PaddedRequest(RecordSynchronisationLimits.MaximumRequestBytes + 1);
    Assert.Equal(1_048_577, Encoding.UTF8.GetByteCount(over));
    var refused = await commander.SendAsync(over);

    Assert.Equal(HttpStatusCode.RequestEntityTooLarge, refused.Status);
    Assert.Equal("request-too-large", refused.Code);
  }

  [Fact]
  public async Task AnUnsupportedRecordVersionIsRefused()
  {
    using var server = NewServer(out var frontier, out _);
    using var commander = await SignInAsync(server, frontier, 70_009);
    var newer = RecordFixtures.Ship(Guid.NewGuid());
    newer["version"] = 99;

    var refused = await commander.SynchroniseAsync(
      RecordFixtures.Request(0, RecordFixtures.Write(newer))
    );

    Assert.Equal(HttpStatusCode.BadRequest, refused.Status);
    Assert.Equal("unsupported-record-version", refused.Code);
    Assert.Equal("refused", refused.Outcome(0));
  }

  [Fact]
  public async Task AnIdentityThePackageDoesNotPublishRefusesTheCompleteBatch()
  {
    using var server = NewServer(out var frontier, out _);
    using var commander = await SignInAsync(server, frontier, 70_010);
    var unknownHull = RecordFixtures.Ship(Guid.NewGuid());
    unknownHull["build"]!["shipSymbol"] = "Nonexistent_Hull";

    var refused = await commander.SynchroniseAsync(
      RecordFixtures.Request(
        0,
        RecordFixtures.Write(RecordFixtures.Ship(Guid.NewGuid())),
        RecordFixtures.Write(unknownHull)
      )
    );

    Assert.Equal(HttpStatusCode.BadRequest, refused.Status);
    Assert.Equal("invalid-record", refused.Code);
    Assert.Equal("not-applied", refused.Outcome(0));
    Assert.Equal("refused", refused.Outcome(1));

    await using var context = database.CreateContext();
    Assert.Empty(
      await context.SynchronisedRecords.AsNoTracking().Where(r => r.CustomerId == 70_010).ToListAsync()
    );
  }

  [Fact]
  public async Task AFieldOutsideTheLiveContractIsRefused()
  {
    using var server = NewServer(out var frontier, out _);
    using var commander = await SignInAsync(server, frontier, 70_011);
    var withNote = RecordFixtures.Ship(Guid.NewGuid());
    withNote["note"] = "kept local";

    var refused = await commander.SynchroniseAsync(
      RecordFixtures.Request(0, RecordFixtures.Write(withNote))
    );

    Assert.Equal(HttpStatusCode.BadRequest, refused.Status);
    Assert.Equal("invalid-record", refused.Code);
  }

  [Fact]
  public async Task OneCommanderCannotReadChangeOrDeleteAnotherCommandersRecords()
  {
    using var server = NewServer(out var frontier, out _);
    using var owner = await SignInAsync(server, frontier, 70_012);
    var record = RecordFixtures.Ship(Guid.NewGuid());
    var identity = RecordFixtures.IdOf(record);
    var owned = await owner.SynchroniseAsync(
      RecordFixtures.Request(0, RecordFixtures.Write(record))
    );
    Assert.Equal(HttpStatusCode.OK, owned.Status);

    using var other = await SignInAsync(server, frontier, 70_013);
    var read = await other.SynchroniseAsync(RecordFixtures.Request(0));
    Assert.Empty(read.Records);
    Assert.Empty(read.Tombstones);
    Assert.Equal(0, read.AccountRevision);

    var taken = (JsonObject)record.DeepClone();
    taken["build"]!["shipName"] = "Taken";
    foreach (
      var change in new[]
      {
        RecordFixtures.Write(taken, 1),
        RecordFixtures.Delete(identity, 1),
        RecordFixtures.Renew(identity),
      }
    )
    {
      var refused = await other.SynchroniseAsync(RecordFixtures.Request(0, change));
      Assert.Equal(HttpStatusCode.Forbidden, refused.Status);
      Assert.Equal("cross-account-record", refused.Code);
      Assert.Equal("refused", refused.Outcome(0));
    }

    var mixed = await other.SynchroniseAsync(
      RecordFixtures.Request(
        0,
        RecordFixtures.Write(RecordFixtures.Ship(Guid.NewGuid())),
        RecordFixtures.Delete(identity, 1)
      )
    );
    Assert.Equal(HttpStatusCode.Forbidden, mixed.Status);
    Assert.Equal("not-applied", mixed.Outcome(0));
    Assert.Equal("refused", mixed.Outcome(1));

    await using var context = database.CreateContext();
    var rows = await context
      .SynchronisedRecords.AsNoTracking()
      .Where(item => item.RecordId == identity)
      .ToListAsync();
    var stored = Assert.Single(rows);
    Assert.Equal(70_012, stored.CustomerId);
    Assert.DoesNotContain("Taken", stored.Payload!, StringComparison.Ordinal);
    Assert.Empty(
      await context.SynchronisedRecords.AsNoTracking().Where(r => r.CustomerId == 70_013).ToListAsync()
    );
  }

  [Fact]
  public async Task ADatabaseFailureIsRefusedWithoutAWrite()
  {
    var interceptor = new FailingRecordInterceptor();
    using var server = NewServer(out var frontier, out _, interceptor);
    using var commander = await SignInAsync(server, frontier, 70_014);
    interceptor.Enabled = true;

    var refused = await commander.SynchroniseAsync(
      RecordFixtures.Request(0, RecordFixtures.Write(RecordFixtures.Ship(Guid.NewGuid())))
    );

    Assert.Equal(HttpStatusCode.InternalServerError, refused.Status);
    Assert.Equal("synchronisation-failed", refused.Code);
    interceptor.Enabled = false;
    await using var context = database.CreateContext();
    Assert.Empty(
      await context.SynchronisedRecords.AsNoTracking().Where(r => r.CustomerId == 70_014).ToListAsync()
    );
  }

  [Fact]
  public async Task AValidatorThatCannotRunRefusesTheBatchBeforeAnyWrite()
  {
    var frontier = new FakeFrontierClient();
    using var server = new CommanderTestServer(
      database,
      frontier,
      new ManualTimeProvider(InitialTime),
      settings: new Dictionary<string, string>
      {
        ["RecordValidation:Command"] = "a-command-that-does-not-exist",
      }
    );
    using var commander = await SignInAsync(server, frontier, 70_017);

    var refused = await commander.SynchroniseAsync(
      RecordFixtures.Request(0, RecordFixtures.Write(RecordFixtures.Ship(Guid.NewGuid())))
    );

    Assert.Equal(HttpStatusCode.ServiceUnavailable, refused.Status);
    Assert.Equal("validation-unavailable", refused.Code);
    await using var context = database.CreateContext();
    Assert.Empty(
      await context.SynchronisedRecords.AsNoTracking().Where(r => r.CustomerId == 70_017).ToListAsync()
    );
  }

  [Fact]
  public async Task AMissingValidatorBundleRefusesABatchTooLargeForThePipe()
  {
    var frontier = new FakeFrontierClient();
    using var server = new CommanderTestServer(
      database,
      frontier,
      new ManualTimeProvider(InitialTime),
      settings: new Dictionary<string, string>
      {
        ["RecordValidation:ScriptPath"] = Path.Combine(
          AppContext.BaseDirectory,
          "Fixtures",
          "no-such-validator.mjs"
        ),
      }
    );
    using var commander = await SignInAsync(server, frontier, 70_018);

    // Forty records is about 96 KiB of canonical JSON, past the 64 KiB pipe
    // buffer Linux gives a child's stdin, so the request is still being written
    // when the missing bundle exits. A batch that fits the buffer lands in it
    // and is answered by the exit code instead. This is well inside the 100
    // changes and 1 MiB a batch may carry (deployment document, "Settings each
    // instance reads").
    var refused = await commander.SynchroniseAsync(
      RecordFixtures.Request(
        0,
        [
          .. Enumerable
            .Range(0, 40)
            .Select(_ => RecordFixtures.Write(RecordFixtures.Ship(Guid.NewGuid()))),
        ]
      )
    );

    Assert.Equal(HttpStatusCode.ServiceUnavailable, refused.Status);
    Assert.Equal("validation-unavailable", refused.Code);
    await using var context = database.CreateContext();
    Assert.Empty(
      await context.SynchronisedRecords.AsNoTracking().Where(r => r.CustomerId == 70_018).ToListAsync()
    );
  }

  [Fact]
  public async Task ACancelledRequestWritesNothing()
  {
    using var server = NewServer(out var frontier, out var clock);
    using var commander = await SignInAsync(server, frontier, 70_015);
    await using var scope = database.CreateContext();
    var service = new RecordSynchronisationService(scope, clock);
    var read = RecordRequestReader.Read(
      Encoding.UTF8.GetBytes(
        RecordFixtures
          .Request(0, RecordFixtures.Write(RecordFixtures.Ship(Guid.NewGuid())))
          .ToJsonString()
      )
    );
    using var cancelled = new CancellationTokenSource();
    await cancelled.CancelAsync();

    await Assert.ThrowsAnyAsync<OperationCanceledException>(() =>
      service.ApplyAsync(70_015, read.Request!, cancelled.Token)
    );

    await using var context = database.CreateContext();
    Assert.Empty(
      await context.SynchronisedRecords.AsNoTracking().Where(r => r.CustomerId == 70_015).ToListAsync()
    );
  }

  [Fact]
  public async Task LogsCarryOnlyTheRouteTemplate()
  {
    var logs = new CapturingLoggerProvider();
    var frontier = new FakeFrontierClient();
    using var server = new CommanderTestServer(
      database,
      frontier,
      new ManualTimeProvider(InitialTime),
      logs
    );
    using var commander = await SignInAsync(server, frontier, 70_016);
    var record = RecordFixtures.Ship(Guid.NewGuid());

    await commander.SynchroniseAsync(RecordFixtures.Request(0, RecordFixtures.Write(record)));

    var text = logs.Text;
    Assert.Contains("api/records/synchronise", text, StringComparison.Ordinal);
    Assert.DoesNotContain(RecordFixtures.IdOf(record).ToString(), text, StringComparison.Ordinal);
    Assert.DoesNotContain("70016", text, StringComparison.Ordinal);
    Assert.DoesNotContain("SideWinder", text, StringComparison.Ordinal);
  }

  private async Task AssertTombstoneShapeAsync(long customerId, Guid recordId)
  {
    await using var context = database.CreateContext();
    var tombstone = await context
      .SynchronisedRecords.AsNoTracking()
      .SingleAsync(record => record.CustomerId == customerId && record.RecordId == recordId);
    Assert.Null(tombstone.Payload);
    Assert.Null(tombstone.RecordKind);
    Assert.Null(tombstone.CreatedAt);
    Assert.Null(tombstone.BrowserModifiedAt);
    Assert.Null(tombstone.ServerContentAt);
    Assert.Null(tombstone.ProtectionDeadline);
  }

  private static JsonObject[] Writes(int count) =>
    [
      .. Enumerable
        .Range(0, count)
        .Select(_ => RecordFixtures.Write(RecordFixtures.Ship(Guid.NewGuid()))),
    ];

  private static JsonObject PaddedShip(Guid id, int bytes)
  {
    var record = RecordFixtures.Ship(id);
    record["build"]!["shipName"] = string.Empty;
    var padding = bytes - Encoding.UTF8.GetByteCount(record.ToJsonString());
    record["build"]!["shipName"] = new string('N', padding);
    return record;
  }

  private static string PaddedRequest(int bytes)
  {
    const int records = 17;
    var changes = Enumerable
      .Range(0, records)
      .Select(_ =>
      {
        var record = RecordFixtures.Ship(Guid.NewGuid());
        record["build"]!["shipName"] = string.Empty;
        return RecordFixtures.Write(record);
      })
      .ToArray();
    var request = RecordFixtures.Request(0, changes);
    var padding = bytes - Encoding.UTF8.GetByteCount(request.ToJsonString());
    for (var index = 0; index < records; index++)
    {
      var share = padding / records + (index == 0 ? padding % records : 0);
      changes[index]["record"]!["build"]!["shipName"] = new string('N', share);
    }
    return request.ToJsonString();
  }

  [Fact]
  public async Task AnAccountRevisionCommittedMidRequestIsNotOverwritten()
  {
    var race = new RevisionRaceInterceptor(database.ConnectionString);
    using var server = NewServer(out var frontier, out _, race);
    using var commander = await SignInAsync(server, frontier, 70_019);

    var accepted = await commander.SynchroniseAsync(
      RecordFixtures.Request(0, RecordFixtures.Write(RecordFixtures.Ship(Guid.NewGuid())))
    );

    Assert.Equal(HttpStatusCode.OK, accepted.Status);
    await using var context = database.CreateContext();
    var account = await context
      .CommanderAccounts.AsNoTracking()
      .SingleAsync(entry => entry.CustomerId == 70_019);
    // The account revision only ever moves forward. Writing a number below one
    // another device already holds would put this record behind that device's
    // cursor, and it would never be sent (design decision "Records", one
    // monotonic account revision).
    Assert.True(
      account.RecordRevision > race.Committed,
      $"The account revision went from {race.Committed} to {account.RecordRevision}."
    );
  }

  [Fact]
  public async Task AnAccountDeletedMidRequestRefusesTheBatchAsUnauthorised()
  {
    using var server = NewServer(
      out var frontier,
      out _,
      new AccountDeletingInterceptor(database.ConnectionString)
    );
    using var commander = await SignInAsync(server, frontier, 70_020);

    var refused = await commander.SynchroniseAsync(
      RecordFixtures.Request(0, RecordFixtures.Write(RecordFixtures.Ship(Guid.NewGuid())))
    );

    // An account that is gone is answered the way an unsigned request is, with
    // a code the browser can read, rather than by an exception the endpoint
    // does not catch and a body that states nothing.
    Assert.Equal(HttpStatusCode.Unauthorized, refused.Status);
    Assert.Equal("unauthorised", refused.Code);
  }

  private CommanderTestServer NewServer(
    out FakeFrontierClient frontier,
    out ManualTimeProvider clock,
    IInterceptor? interceptor = null
  )
  {
    var fake = new FakeFrontierClient();
    var manual = new ManualTimeProvider(InitialTime);
    frontier = fake;
    clock = manual;
    return new CommanderTestServer(database, fake, manual, interceptor: interceptor);
  }

  private static Task<SignedInCommander> SignInAsync(
    CommanderTestServer server,
    FakeFrontierClient frontier,
    long customerId
  ) => SignedInCommander.SignInAsync(server, frontier, customerId, InitialTime);
}

/// <summary>
/// Commits one revision for this account from another connection, the first
/// time the account row is locked.
///
/// It stands in for a second device that synchronised while this request was
/// between authenticating and applying — a window the validator subprocess
/// holds open for as long as it runs.
/// </summary>
internal sealed class RevisionRaceInterceptor(string connectionString) : DbCommandInterceptor
{
  private bool done;

  public long Committed { get; private set; }

  public override ValueTask<InterceptionResult<DbDataReader>> ReaderExecutingAsync(
    DbCommand command,
    CommandEventData eventData,
    InterceptionResult<DbDataReader> result,
    CancellationToken cancellationToken = default
  )
  {
    // Before the lock is taken, so the other connection is never waiting on it.
    if (!done && command.CommandText.Contains("FOR UPDATE", StringComparison.Ordinal)
      && command.CommandText.Contains("commander_accounts", StringComparison.Ordinal))
    {
      done = true;
      Committed = Raise();
    }
    return base.ReaderExecutingAsync(command, eventData, result, cancellationToken);
  }

  private long Raise()
  {
    using var connection = new NpgsqlConnection(connectionString);
    connection.Open();
    using var command = connection.CreateCommand();
    command.CommandText =
      "UPDATE commander_accounts SET record_revision = record_revision + 5 "
      + "RETURNING record_revision";
    return (long)command.ExecuteScalar()!;
  }
}

/// <summary>
/// Deletes this account from another connection, the first time the account row
/// is locked.
///
/// It stands in for a Commander who asked for deletion on one device while a
/// batch from another was in flight. The deletion commits in its own request
/// and takes the sessions with it.
/// </summary>
internal sealed class AccountDeletingInterceptor(string connectionString) : DbCommandInterceptor
{
  private bool done;

  public override ValueTask<InterceptionResult<DbDataReader>> ReaderExecutingAsync(
    DbCommand command,
    CommandEventData eventData,
    InterceptionResult<DbDataReader> result,
    CancellationToken cancellationToken = default
  )
  {
    if (!done && command.CommandText.Contains("FOR UPDATE", StringComparison.Ordinal)
      && command.CommandText.Contains("commander_accounts", StringComparison.Ordinal))
    {
      done = true;
      using var connection = new NpgsqlConnection(connectionString);
      connection.Open();
      using var delete = connection.CreateCommand();
      delete.CommandText = "DELETE FROM commander_accounts";
      delete.ExecuteNonQuery();
    }
    return base.ReaderExecutingAsync(command, eventData, result, cancellationToken);
  }
}

/// <summary>Fails every record command, so the endpoint states a service failure.</summary>
internal sealed class FailingRecordInterceptor : DbCommandInterceptor
{
  public bool Enabled { get; set; }

  public override ValueTask<InterceptionResult<DbDataReader>> ReaderExecutingAsync(
    DbCommand command,
    CommandEventData eventData,
    InterceptionResult<DbDataReader> result,
    CancellationToken cancellationToken = default
  )
  {
    Refuse(command);
    return base.ReaderExecutingAsync(command, eventData, result, cancellationToken);
  }

  public override ValueTask<InterceptionResult<int>> NonQueryExecutingAsync(
    DbCommand command,
    CommandEventData eventData,
    InterceptionResult<int> result,
    CancellationToken cancellationToken = default
  )
  {
    Refuse(command);
    return base.NonQueryExecutingAsync(command, eventData, result, cancellationToken);
  }

  private void Refuse(DbCommand command)
  {
    if (Enabled && command.CommandText.Contains("synchronised_records", StringComparison.Ordinal))
    {
      throw new NpgsqlException("The record store is unavailable.");
    }
  }
}
