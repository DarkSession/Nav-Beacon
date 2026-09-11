using System.Data;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using NavBeacon.Server.Contracts;
using NavBeacon.Server.Persistence;

namespace NavBeacon.Server.Records;

/// <summary>
/// Applies one synchronisation batch against the account revision stream. The
/// service compares every change before it writes, so an invalid, cross-account
/// or conflicting change leaves the account exactly as it was (020/FR-026).
/// </summary>
public sealed class RecordSynchronisationService(
  NavBeaconDbContext database,
  TimeProvider timeProvider
)
{
  /// <summary>How long an unnamed record lives after its last accepted content.</summary>
  public static readonly TimeSpan ModificationPeriod = TimeSpan.FromDays(7);

  /// <summary>How far each accepted upload and renewal moves the protection deadline.</summary>
  public static readonly TimeSpan ProtectionPeriod = TimeSpan.FromDays(8);

  public const string WorkingKind = "working";

  private enum PlannedAction
  {
    None,
    WriteLive,
    WriteTombstone,
    Renew,
  }

  private sealed record Evaluation(ChangeResult Result, PlannedAction Action);

  /// <summary>
  /// Replaces every unnamed record whose modification period and protection
  /// deadline have both passed with a deletion marker (020/FR-025). Server time
  /// alone decides, so a skewed browser clock cannot expire a record early or
  /// hold an expired one.
  /// </summary>
  public async Task ExpireAsync(long customerId, CancellationToken cancellationToken)
  {
    var now = timeProvider.GetUtcNow();
    var contentBefore = now - ModificationPeriod;
    await using var transaction = await database.Database.BeginTransactionAsync(
      IsolationLevel.ReadCommitted,
      cancellationToken
    );
    var account = await LockAccountAsync(customerId, cancellationToken);
    if (account is null)
    {
      await transaction.RollbackAsync(cancellationToken);
      return;
    }

    var expired = await database
      .SynchronisedRecords.Where(record =>
        record.CustomerId == customerId
        && record.Payload != null
        && record.RecordKind == WorkingKind
        && record.ServerContentAt <= contentBefore
        && record.ProtectionDeadline <= now
      )
      .OrderBy(record => record.RecordId)
      .ToListAsync(cancellationToken);
    if (expired.Count > 0)
    {
      var revision = account.RecordRevision;
      foreach (var record in expired)
      {
        MakeTombstone(record, ++revision);
      }
      account.RecordRevision = revision;
      await database.SaveChangesAsync(cancellationToken);
    }

    await transaction.CommitAsync(cancellationToken);
  }

  public async Task<RecordSynchronisationOutcome> ApplyAsync(
    long customerId,
    RecordSynchronisationRequest request,
    CancellationToken cancellationToken
  )
  {
    var now = timeProvider.GetUtcNow();
    await using var transaction = await database.Database.BeginTransactionAsync(
      IsolationLevel.ReadCommitted,
      cancellationToken
    );
    var account =
      await LockAccountAsync(customerId, cancellationToken)
      ?? throw new InvalidOperationException("The signed-in account has no record stream.");

    var named = request.Changes.Select(change => change.RecordId).ToArray();
    var rows =
      named.Length == 0
        ? []
        : await database
          .SynchronisedRecords.Where(record => named.Contains(record.RecordId))
          .ToListAsync(cancellationToken);
    var mine = rows.Where(record => record.CustomerId == customerId)
      .ToDictionary(record => record.RecordId);
    var otherAccounts = rows.Where(record => record.CustomerId != customerId)
      .Select(record => record.RecordId)
      .ToHashSet();

    var evaluations = request
      .Changes.Select(change =>
        Evaluate(change, mine.GetValueOrDefault(change.RecordId), otherAccounts)
      )
      .ToList();
    var results = evaluations.Select(evaluation => evaluation.Result).ToList();

    var refusal = results.FirstOrDefault(result => result.Outcome == ChangeOutcome.Refused);
    var conflicted = results.Any(result => result.Outcome == ChangeOutcome.Conflict);
    if (refusal is not null || conflicted)
    {
      await transaction.RollbackAsync(cancellationToken);
      return new RecordSynchronisationOutcome(
        refusal?.Code ?? RecordErrorCodes.Conflict,
        account.RecordRevision,
        [.. results.Select(Withhold)],
        []
      );
    }

    var accepted = account.RecordRevision;
    for (var index = 0; index < request.Changes.Count; index++)
    {
      var change = request.Changes[index];
      switch (evaluations[index].Action)
      {
        case PlannedAction.WriteLive:
          var live = Row(mine, customerId, change.RecordId);
          live.Revision = ++accepted;
          live.Payload = change.Payload;
          live.RecordKind = change.RecordKind;
          live.CreatedAt = change.CreatedAt;
          live.BrowserModifiedAt = change.BrowserModifiedAt;
          live.ServerContentAt = now;
          live.ProtectionDeadline =
            change.RecordKind == WorkingKind ? now + ProtectionPeriod : null;
          results[index] = results[index] with { Revision = accepted };
          break;
        case PlannedAction.WriteTombstone:
          MakeTombstone(mine[change.RecordId], ++accepted);
          results[index] = results[index] with { Revision = accepted };
          break;
        case PlannedAction.Renew:
          var renewed = mine[change.RecordId];
          if (renewed.ProtectionDeadline is not null)
          {
            renewed.ProtectionDeadline = now + ProtectionPeriod;
          }
          break;
        case PlannedAction.None:
        default:
          break;
      }
    }

    account.RecordRevision = accepted;
    await database.SaveChangesAsync(cancellationToken);
    var stream = await database
      .SynchronisedRecords.AsNoTracking()
      .Where(record =>
        record.CustomerId == customerId && record.Revision > request.SinceRevision
      )
      .OrderBy(record => record.Revision)
      .Select(record => new RecordStreamEntry(record.Revision, record.Payload, record.RecordId))
      .ToListAsync(cancellationToken);
    await transaction.CommitAsync(cancellationToken);
    return new RecordSynchronisationOutcome(null, accepted, results, stream);
  }

  private static Evaluation Evaluate(
    RecordChange change,
    SynchronisedRecord? row,
    HashSet<Guid> otherAccounts
  )
  {
    // A record identity another account already holds is never readable,
    // writable or deletable here, and refuses the complete batch.
    if (row is null && otherAccounts.Contains(change.RecordId))
    {
      return new Evaluation(
        new ChangeResult(
          change.Index,
          ChangeOutcome.Refused,
          change.RecordId,
          0,
          RecordErrorCodes.CrossAccountRecord,
          null
        ),
        PlannedAction.None
      );
    }

    return change.Kind switch
    {
      RecordChangeKind.Write => EvaluateWrite(change, row),
      RecordChangeKind.Delete => EvaluateDelete(change, row),
      _ => EvaluateRenewal(change, row),
    };
  }

  private static Evaluation EvaluateWrite(RecordChange change, SynchronisedRecord? row)
  {
    // Identical content against the record the account already holds is a
    // no-op, so a retry after a lost committed response creates no revision.
    if (SameContent(row, change))
    {
      return Unchanged(change, row!.Revision, PlannedAction.None);
    }

    var current = row?.Revision ?? 0;
    return change.ExpectedRevision == current
      ? new Evaluation(
        new ChangeResult(change.Index, ChangeOutcome.Applied, change.RecordId, 0, null, null),
        PlannedAction.WriteLive
      )
      : Conflict(change, current, row?.Payload);
  }

  /// <summary>
  /// Compares one submitted record with the stored record. The store returns
  /// its own JSON form, so both sides are read back through the same exact
  /// contract before the comparison.
  /// </summary>
  private static bool SameContent(SynchronisedRecord? row, RecordChange change)
  {
    if (row?.Payload is null || change.Payload is null)
    {
      return false;
    }
    if (row.Payload == change.Payload)
    {
      return true;
    }

    try
    {
      using var stored = JsonDocument.Parse(row.Payload);
      return CanonicalRecordJson.Write(RemoteContractJson.ParseRecord(stored.RootElement))
        == change.Payload;
    }
    catch (JsonException)
    {
      return false;
    }
  }

  private static Evaluation EvaluateDelete(RecordChange change, SynchronisedRecord? row)
  {
    if (row is null)
    {
      return Unchanged(change, 0, PlannedAction.None);
    }

    // A repeated delete against a deletion marker returns the current revision.
    if (row.Payload is null)
    {
      return Unchanged(change, row.Revision, PlannedAction.None);
    }

    return change.ExpectedRevision == row.Revision
      ? new Evaluation(
        new ChangeResult(change.Index, ChangeOutcome.Applied, change.RecordId, 0, null, null),
        PlannedAction.WriteTombstone
      )
      : Conflict(change, row.Revision, row.Payload);
  }

  private static Evaluation EvaluateRenewal(RecordChange change, SynchronisedRecord? row)
  {
    // A live page that renews protection for a record the account no longer
    // holds learns of the deletion instead, and keeps its local work.
    if (row?.Payload is null)
    {
      return Conflict(change, row?.Revision ?? 0, null);
    }

    return Unchanged(change, row.Revision, PlannedAction.Renew);
  }

  private static Evaluation Unchanged(RecordChange change, long revision, PlannedAction action) =>
    new(
      new ChangeResult(change.Index, ChangeOutcome.Unchanged, change.RecordId, revision, null, null),
      action
    );

  private static Evaluation Conflict(RecordChange change, long revision, string? payload) =>
    new(
      new ChangeResult(
        change.Index,
        ChangeOutcome.Conflict,
        change.RecordId,
        revision,
        RecordErrorCodes.Conflict,
        payload
      ),
      PlannedAction.None
    );

  private static ChangeResult Withhold(ChangeResult result) =>
    result.Outcome is ChangeOutcome.Conflict or ChangeOutcome.Refused
      ? result
      : result with
      {
        Outcome = ChangeOutcome.NotApplied,
        Revision = 0,
      };

  private SynchronisedRecord Row(
    Dictionary<Guid, SynchronisedRecord> mine,
    long customerId,
    Guid recordId
  )
  {
    if (mine.TryGetValue(recordId, out var existing))
    {
      return existing;
    }

    var added = new SynchronisedRecord { CustomerId = customerId, RecordId = recordId };
    database.SynchronisedRecords.Add(added);
    mine[recordId] = added;
    return added;
  }

  private static void MakeTombstone(SynchronisedRecord record, long revision)
  {
    record.Revision = revision;
    record.Payload = null;
    record.RecordKind = null;
    record.Name = null;
    record.CreatedAt = null;
    record.BrowserModifiedAt = null;
    record.ServerContentAt = null;
    record.ProtectionDeadline = null;
  }

  private async Task<CommanderAccount?> LockAccountAsync(
    long customerId,
    CancellationToken cancellationToken
  ) =>
    await database
      .CommanderAccounts.FromSqlInterpolated(
        $"SELECT * FROM commander_accounts WHERE customer_id = {customerId} FOR UPDATE"
      )
      .SingleOrDefaultAsync(cancellationToken);
}
