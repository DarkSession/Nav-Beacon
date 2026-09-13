using System.Data;
using Microsoft.EntityFrameworkCore;
using NavBeacon.Server.Frontier;
using NavBeacon.Server.Persistence;

namespace NavBeacon.Server.Fleet;

/// <summary>
/// Reads and refreshes one Commander's owned fleet.
///
/// A refresh reads dated Live journal responses from the account's cursor,
/// projects candidate `Loadout` lines through the one bounded Node command and
/// commits each batch with the cursor it reached (020/FR-013, 020/FR-014). It
/// stops before any line it cannot accept, so the last accepted fleet and cursor
/// stay exactly where they were and the same line is retried later.
///
/// Only one refresh may run for one account. The exclusion is a PostgreSQL
/// advisory lock held on this request's own connection, so a second instance
/// answers that the account is waiting rather than reading the same lines twice.
/// </summary>
public sealed class FleetService(
  NavBeaconDbContext database,
  ILiveJournalClient journal,
  FleetProjector projector,
  FrontierCredentialService credentials,
  TimeProvider timeProvider
)
{
  /// <summary>The advisory-lock keyspace this service owns.</summary>
  private const long LockNamespace = 0x4E42_0000_0000_0000;

  public async Task<FleetState> ReadAsync(long customerId, CancellationToken cancellationToken)
  {
    var ships = await ShipsAsync(customerId, cancellationToken);
    var cursor = await database
      .JournalCursors.AsNoTracking()
      .SingleOrDefaultAsync(entry => entry.CustomerId == customerId, cancellationToken);
    return Settled(ships, Coverage(cursor), Pending(cursor), null, null);
  }

  /// <summary>
  /// Whether a day the cursor has not reached has ended without being read.
  /// </summary>
  ///
  /// <remarks>
  /// A cursor left on a date before the current one is a refresh that stopped
  /// short: the days between it and today have ended, and nothing in them was
  /// read. Answering no there would take a refresh Frontier failed, or one a
  /// response too large ended, and report it on the next page load as a fleet
  /// the journal confirms whole — with nothing having been read in between
  /// (020/FR-016).
  ///
  /// A cursor inside the current day is answered no, and that is a choice
  /// rather than a fact. Fleet import metadata holds four items, and they
  /// cannot tell a refresh that read the day to its end from one that stopped
  /// on the batch bound inside it: both leave the same date and the same line
  /// count, and a fifth item is what 020/FR-015 forbids. The coverage carries
  /// that date and line either way, which is what states how far reading
  /// reached.
  ///
  /// So a refresh that stops inside the current day answers `incomplete` and
  /// asks to be run again, and a reload of the same unchanged state answers
  /// `current`. Reading the cursor back cannot recover what the refresh knew.
  /// </remarks>
  private bool Pending(JournalCursor? cursor) =>
    cursor is not null
    && cursor.NextUnreadDate < DateOnly.FromDateTime(timeProvider.GetUtcNow().UtcDateTime);

  public async Task<FleetState> RefreshAsync(
    long customerId,
    string locale,
    CancellationToken cancellationToken
  )
  {
    await database.Database.OpenConnectionAsync(cancellationToken);
    try
    {
      if (!await TryLockAsync(customerId, cancellationToken))
      {
        return await WaitingAsync(customerId, cancellationToken);
      }

      try
      {
        return await RunAsync(customerId, locale, cancellationToken);
      }
      finally
      {
        await UnlockAsync(customerId, cancellationToken);
      }
    }
    finally
    {
      await database.Database.CloseConnectionAsync();
    }
  }

  private async Task<FleetState> RunAsync(
    long customerId,
    string locale,
    CancellationToken cancellationToken
  )
  {
    var now = timeProvider.GetUtcNow();
    var today = DateOnly.FromDateTime(now.UtcDateTime);
    var cursor = await CursorAsync(customerId, today, cancellationToken);
    if (cursor.NextPermittedRefreshAt > now)
    {
      return await SettledAsync(
        customerId,
        cursor,
        true,
        FleetResults.Waiting,
        cancellationToken
      );
    }

    var authorisation = new AccountAuthorisation(credentials, customerId);
    var context = new RefreshContext(customerId, locale, cursor);
    while (context.Batches < FleetLimits.MaximumBatches)
    {
      if (cursor.NextUnreadDate > today)
      {
        return await SettledAsync(customerId, cursor, false, null, cancellationToken);
      }

      var read = await journal.ReadAsync(
        cursor.NextUnreadDate,
        authorisation,
        cancellationToken
      );
      switch (read.Outcome)
      {
        case JournalReadOutcome.AuthorisationExpired:
          return await SettledAsync(
            customerId,
            cursor,
            true,
            FleetResults.AuthorisationExpired,
            cancellationToken
          );
        case JournalReadOutcome.Failed:
          return await FailedAsync(
            customerId,
            cursor,
            FleetFailures.Frontier,
            null,
            cancellationToken
          );
        case JournalReadOutcome.ResponseTooLarge:
          return await FailedAsync(
            customerId,
            cursor,
            FleetFailures.ResponseTooLarge,
            null,
            cancellationToken
          );
        case JournalReadOutcome.Retryable:
          await SaveNextPermittedAsync(cursor, read.NextPermittedRefreshAt, cancellationToken);
          return await SettledAsync(
            customerId,
            cursor,
            true,
            FleetResults.Waiting,
            cancellationToken
          );
        case JournalReadOutcome.Empty:
          await ClearDelayAsync(cursor, cancellationToken);
          if (cursor.NextUnreadDate >= today)
          {
            // The cursor advances past a day that has ended, and the current
            // UTC day has not. A Commander who has not played yet today gets
            // the same empty answer as a day with no journal at all, and
            // advancing on it would pass over the rest of the day for good:
            // nothing brings the cursor back to a date it has left, so every
            // ship bought or refitted later that day would never be read. The
            // coverage would state the day as read as well (020/FR-013,
            // constitution IV).
            return await SettledAsync(customerId, cursor, false, null, cancellationToken);
          }
          await CommitAsync(context, [], cursor.NextUnreadDate.AddDays(1), 0, cancellationToken);
          continue;
        default:
          break;
      }

      var complete = read.Outcome == JournalReadOutcome.Complete;
      if (complete)
      {
        await ClearDelayAsync(cursor, cancellationToken);
      }
      // The cursor leaves a date when that date has ended, which is this
      // service's own reading of the clock and not Frontier's completeness
      // flag: Frontier answers the current day complete as readily as a past
      // one. Nothing brings the cursor back to a date it has left, so a day
      // left early is a day whose remaining ships are never read, under a
      // coverage that states it as taken in (020/FR-013, constitution IV).
      //
      // The lines read still commit either way. Only the date stays.
      var ended = complete && cursor.NextUnreadDate < today;
      var day = await ReadDayAsync(context, read.Body, ended, cancellationToken);
      if (day.Failure is not null)
      {
        await SaveNextPermittedAsync(cursor, read.NextPermittedRefreshAt, cancellationToken);
        return await FailedAsync(customerId, cursor, day.Failure, day.Refusal, cancellationToken);
      }
      if (!ended)
      {
        // The cursor stays on the date for either of the two reasons that
        // reach here: the date has not ended and is still being written, or
        // Frontier answered it incomplete. In both, more of that day may still
        // be readable, and a date the cursor leaves is never read again.
        //
        // `Pending` is asked alongside the batch bound because the second
        // reason can hold on a date that has ended, and a day that has ended
        // with journal left in it is what a later read answers `pending` from.
        // Answering `false` here would be contradicted by the next page load,
        // off the same stored state (020/FR-016).
        await SaveNextPermittedAsync(cursor, read.NextPermittedRefreshAt, cancellationToken);
        return await SettledAsync(
          customerId,
          cursor,
          day.Stopped || Pending(cursor),
          read.NextPermittedRefreshAt is null ? null : FleetResults.Waiting,
          cancellationToken
        );
      }
      if (day.Stopped)
      {
        break;
      }
    }

    return await SettledAsync(
      customerId,
      cursor,
      cursor.NextUnreadDate <= today,
      null,
      cancellationToken
    );
  }

  /// <summary>
  /// Reads one dated response from the cursor line, in batches bounded by line
  /// count and size. A batch closes before its next candidate would cross a
  /// bound, and a refresh handles at most ten of them (020/FR-013).
  /// </summary>
  private async Task<DayResult> ReadDayAsync(
    RefreshContext context,
    string body,
    bool ended,
    CancellationToken cancellationToken
  )
  {
    var date = context.Cursor.NextUnreadDate;
    var start = context.Cursor.NextUnreadLine;
    using var reader = new StringReader(body);
    var framer = new JournalFramer(reader);
    var operations = new List<JournalOperation>();
    var candidates = new List<ProjectionCandidate>();
    var batchBytes = 0;
    var lastLine = start - 1;

    while (true)
    {
      var line = framer.Read();
      if (line is null)
      {
        break;
      }
      if (line.Index < start)
      {
        continue;
      }

      if (line.Status != JournalLineStatus.Framed)
      {
        var closed = await ProjectAndCommitAsync(
          context,
          operations,
          candidates,
          date,
          line.Index,
          cancellationToken
        );
        return closed.Failure is not null
          ? closed
          : new DayResult(
            line.Status == JournalLineStatus.TooLarge
              ? FleetFailures.LineTooLarge
              : FleetFailures.LineMalformed,
            null,
            true
          );
      }

      if (line.Kind == JournalLineKind.Loadout)
      {
        var bytes = System.Text.Encoding.UTF8.GetByteCount(line.Text);
        if (
          candidates.Count == FleetLimits.MaximumBatchLines
          || batchBytes + bytes > FleetLimits.MaximumBatchBytes
        )
        {
          var closed = await ProjectAndCommitAsync(
            context,
            operations,
            candidates,
            date,
            line.Index,
            cancellationToken
          );
          if (closed.Failure is not null || closed.Stopped)
          {
            return closed;
          }
          operations = [];
          candidates = [];
          batchBytes = 0;
        }

        candidates.Add(new ProjectionCandidate(line.ShipId, date, line.Index, line.Text));
        batchBytes += bytes;
      }

      switch (line.Kind)
      {
        case JournalLineKind.Loadout:
          operations.Add(new LoadoutOperation(date, line.Index, line.ShipId));
          break;
        case JournalLineKind.ShipSale:
          operations.Add(new SaleOperation(date, line.Index, line.ShipId));
          break;
        case JournalLineKind.StoredShips:
          operations.Add(new StoredShipsOperation(date, line.Index, line.StoredShipIds));
          break;
        default:
          break;
      }
      lastLine = line.Index;
    }

    // The date the cursor moves to, which is decided by the clock rather than
    // by Frontier's completeness flag: the caller states why.
    var nextDate = ended ? date.AddDays(1) : date;
    var nextLine = ended ? 0 : lastLine + 1;
    return await ProjectAndCommitAsync(
      context,
      operations,
      candidates,
      nextDate,
      nextLine,
      cancellationToken
    );
  }

  private async Task<DayResult> ProjectAndCommitAsync(
    RefreshContext context,
    IReadOnlyList<JournalOperation> operations,
    IReadOnlyList<ProjectionCandidate> candidates,
    DateOnly nextDate,
    int nextLine,
    CancellationToken cancellationToken
  )
  {
    if (candidates.Count == 0)
    {
      var stopped = await CommitAsync(context, operations, nextDate, nextLine, cancellationToken);
      return new DayResult(null, null, stopped);
    }

    context.Batches++;
    var projection = await projector.ProjectAsync(candidates, context.Locale, cancellationToken);
    if (projection.Outcome == ProjectionOutcome.Unavailable)
    {
      return new DayResult(FleetFailures.ProjectionUnavailable, null, true);
    }

    foreach (var ship in projection.Ships)
    {
      context.Models[(ship.Date, ship.Line)] = ship.ModelJson;
    }

    if (projection.Outcome == ProjectionOutcome.Refused)
    {
      var refused = candidates[projection.RefusedIndex];
      var accepted = operations
        .Where(operation => Before(operation, refused.Date, refused.Line))
        .ToList();
      await CommitAsync(context, accepted, refused.Date, refused.Line, cancellationToken);
      return new DayResult(FleetFailures.PackageRefused, projection.Refusal, true);
    }

    var reached = await CommitAsync(context, operations, nextDate, nextLine, cancellationToken);
    return new DayResult(null, null, reached);
  }

  private static bool Before(JournalOperation operation, DateOnly date, int line) =>
    operation.Date < date || (operation.Date == date && operation.Line < line);

  /// <summary>
  /// Applies one batch of accepted operations and the cursor it reached in one
  /// transaction, so a projection and the continuation it justifies commit
  /// together (020/FR-013).
  /// </summary>
  private async Task<bool> CommitAsync(
    RefreshContext context,
    IReadOnlyList<JournalOperation> operations,
    DateOnly nextDate,
    int nextLine,
    CancellationToken cancellationToken
  )
  {
    await using var transaction = await database.Database.BeginTransactionAsync(
      IsolationLevel.ReadCommitted,
      cancellationToken
    );
    var ships = await database
      .OwnedShips.Where(ship => ship.CustomerId == context.CustomerId)
      .ToListAsync(cancellationToken);

    foreach (var operation in operations)
    {
      Apply(context, ships, operation);
    }

    context.Cursor.NextUnreadDate = nextDate;
    context.Cursor.NextUnreadLine = nextLine;
    await database.SaveChangesAsync(cancellationToken);
    await transaction.CommitAsync(cancellationToken);
    context.Models.Clear();
    return context.Batches >= FleetLimits.MaximumBatches;
  }

  private void Apply(RefreshContext context, List<OwnedShip> ships, JournalOperation operation)
  {
    switch (operation)
    {
      case LoadoutOperation loadout:
        ApplyLoadout(context, ships, loadout);
        break;
      case SaleOperation sale:
        {
          var sold = ships.SingleOrDefault(ship => ship.ShipId == sale.ShipId);
          if (sold is not null && Later(sale.Date, sale.Line, sold))
          {
            database.OwnedShips.Remove(sold);
            ships.Remove(sold);
          }
          break;
        }
      case StoredShipsOperation stored:
        ApplyStoredShips(context, ships, stored);
        break;
      default:
        break;
    }
  }

  private void ApplyLoadout(
    RefreshContext context,
    List<OwnedShip> ships,
    LoadoutOperation loadout
  )
  {
    if (!context.Models.TryGetValue((loadout.Date, loadout.Line), out var model))
    {
      return;
    }

    var existing = ships.SingleOrDefault(ship => ship.ShipId == loadout.ShipId);
    if (existing is null)
    {
      var added = new OwnedShip
      {
        CustomerId = context.CustomerId,
        ShipId = loadout.ShipId,
        SourceDate = loadout.Date,
        SourceLine = loadout.Line,
        Payload = model,
      };
      database.OwnedShips.Add(added);
      ships.Add(added);
      return;
    }

    if (!Later(loadout.Date, loadout.Line, existing))
    {
      return;
    }

    existing.SourceDate = loadout.Date;
    existing.SourceLine = loadout.Line;
    existing.Payload = model;
  }

  /// <summary>
  /// Reconciles the projections against Frontier's own list of stored ships
  /// plus the current ship the latest accepted `Loadout` identifies. A
  /// projection in neither set leaves; nothing here creates one. The stored
  /// result is the tuple and one word, and never the ship identities it
  /// compared (020/FR-015).
  /// </summary>
  private void ApplyStoredShips(
    RefreshContext context,
    List<OwnedShip> ships,
    StoredShipsOperation stored
  )
  {
    var cursor = context.Cursor;
    if (
      cursor.LastStoredShipsDate is DateOnly date
      && cursor.LastStoredShipsLine is int line
      && !(stored.Date > date || (stored.Date == date && stored.Line > line))
    )
    {
      return;
    }

    var current = ships
      .OrderByDescending(ship => ship.SourceDate)
      .ThenByDescending(ship => ship.SourceLine)
      .FirstOrDefault();
    var keep = new HashSet<long>(stored.ShipIds);
    if (current is not null)
    {
      keep.Add(current.ShipId);
    }

    foreach (var ship in ships.ToList())
    {
      if (!keep.Contains(ship.ShipId) && Later(stored.Date, stored.Line, ship))
      {
        database.OwnedShips.Remove(ship);
        ships.Remove(ship);
      }
    }

    cursor.LastStoredShipsDate = stored.Date;
    cursor.LastStoredShipsLine = stored.Line;
    cursor.LastStoredShipsComplete =
      current is not null && stored.ShipIds.All(id => ships.Any(ship => ship.ShipId == id));
  }

  private static bool Later(DateOnly date, int line, OwnedShip ship) =>
    date > ship.SourceDate || (date == ship.SourceDate && line > ship.SourceLine);

  private async Task<JournalCursor> CursorAsync(
    long customerId,
    DateOnly today,
    CancellationToken cancellationToken
  )
  {
    var cursor = await database.JournalCursors.SingleOrDefaultAsync(
      entry => entry.CustomerId == customerId,
      cancellationToken
    );
    if (cursor is not null)
    {
      return cursor;
    }

    var start = today.AddDays(-(int)FleetLimits.InitialCoverage.TotalDays);
    cursor = new JournalCursor
    {
      CustomerId = customerId,
      CoverageStartDate = start,
      NextUnreadDate = start,
      NextUnreadLine = 0,
    };
    database.JournalCursors.Add(cursor);
    await database.SaveChangesAsync(cancellationToken);
    return cursor;
  }

  private async Task SaveNextPermittedAsync(
    JournalCursor cursor,
    DateTimeOffset? nextPermitted,
    CancellationToken cancellationToken
  )
  {
    cursor.NextPermittedRefreshAt = nextPermitted;
    await database.SaveChangesAsync(cancellationToken);
  }

  private async Task<IReadOnlyList<FleetShip>> ShipsAsync(
    long customerId,
    CancellationToken cancellationToken
  ) =>
    await database
      .OwnedShips.AsNoTracking()
      .Where(ship => ship.CustomerId == customerId)
      .OrderBy(ship => ship.ShipId)
      .Select(ship => new FleetShip(
        ship.ShipId,
        ship.SourceDate,
        ship.SourceLine,
        ship.Payload
      ))
      .ToListAsync(cancellationToken);

  private async Task<FleetState> WaitingAsync(long customerId, CancellationToken cancellationToken)
  {
    var state = await ReadAsync(customerId, cancellationToken);
    return state with { Result = FleetResults.Waiting };
  }

  private async Task<FleetState> FailedAsync(
    long customerId,
    JournalCursor cursor,
    string failure,
    PackageRefusal? refusal,
    CancellationToken cancellationToken
  )
  {
    var ships = await ShipsAsync(customerId, cancellationToken);
    return new FleetState(
      FleetResults.Failed,
      ships,
      Coverage(cursor),
      true,
      failure,
      refusal
    );
  }

  private async Task<FleetState> SettledAsync(
    long customerId,
    JournalCursor cursor,
    bool pending,
    string? result,
    CancellationToken cancellationToken
  )
  {
    var ships = await ShipsAsync(customerId, cancellationToken);
    var state = Settled(ships, Coverage(cursor), pending, null, null);
    return result is null ? state : state with { Result = result };
  }

  private async Task ClearDelayAsync(JournalCursor cursor, CancellationToken cancellationToken)
  {
    if (cursor.NextPermittedRefreshAt is not null)
    {
      await SaveNextPermittedAsync(cursor, null, cancellationToken);
    }
  }

  private static FleetState Settled(
    IReadOnlyList<FleetShip> ships,
    FleetCoverage? coverage,
    bool pending,
    string? failure,
    PackageRefusal? refusal
  )
  {
    var result = ships.Count == 0
      ? FleetResults.Empty
      : coverage?.StoredShipsComplete == true && !pending
        ? FleetResults.Current
        : FleetResults.Incomplete;
    return new FleetState(result, ships, coverage, pending, failure, refusal);
  }

  private static FleetCoverage? Coverage(JournalCursor? cursor) =>
    cursor is null
      ? null
      : new FleetCoverage(
        cursor.CoverageStartDate,
        cursor.NextUnreadDate,
        cursor.NextUnreadLine,
        cursor.LastStoredShipsDate,
        cursor.LastStoredShipsLine,
        cursor.LastStoredShipsComplete,
        cursor.NextPermittedRefreshAt
      );

  private async Task<bool> TryLockAsync(long customerId, CancellationToken cancellationToken)
  {
    await using var command = database.Database.GetDbConnection().CreateCommand();
    command.CommandText = "SELECT pg_try_advisory_lock(@key)";
    var key = command.CreateParameter();
    key.ParameterName = "key";
    key.Value = LockKey(customerId);
    command.Parameters.Add(key);
    return await command.ExecuteScalarAsync(cancellationToken) is true;
  }

  private async Task UnlockAsync(long customerId, CancellationToken cancellationToken)
  {
    await using var command = database.Database.GetDbConnection().CreateCommand();
    command.CommandText = "SELECT pg_advisory_unlock(@key)";
    var key = command.CreateParameter();
    key.ParameterName = "key";
    key.Value = LockKey(customerId);
    command.Parameters.Add(key);
    await command.ExecuteScalarAsync(cancellationToken);
  }

  private static long LockKey(long customerId) =>
    unchecked(LockNamespace | (customerId & 0x0000_FFFF_FFFF_FFFF));

  /// <summary>The account's tokens, as one dated read asks for them.</summary>
  private sealed class AccountAuthorisation(FrontierCredentialService credentials, long customerId)
    : IJournalAuthorisation
  {
    public Task<string?> GetAccessTokenAsync(
      bool forceRefresh,
      CancellationToken cancellationToken
    ) =>
      forceRefresh
        ? credentials.RefreshAccessTokenAsync(customerId, cancellationToken)
        : credentials.GetAccessTokenAsync(customerId, cancellationToken);
  }

  private sealed record DayResult(string? Failure, PackageRefusal? Refusal, bool Stopped);

  private abstract record JournalOperation(DateOnly Date, int Line);

  private sealed record LoadoutOperation(DateOnly Date, int Line, long ShipId)
    : JournalOperation(Date, Line);

  private sealed record SaleOperation(DateOnly Date, int Line, long ShipId)
    : JournalOperation(Date, Line);

  private sealed record StoredShipsOperation(
    DateOnly Date,
    int Line,
    IReadOnlyList<long> ShipIds
  ) : JournalOperation(Date, Line);

  private sealed class RefreshContext(long customerId, string locale, JournalCursor cursor)
  {
    public long CustomerId => customerId;

    public string Locale => locale;

    public JournalCursor Cursor => cursor;

    public int Batches { get; set; }

    /// <summary>The models one batch projected, by their source tuple.</summary>
    public Dictionary<(DateOnly Date, int Line), string> Models { get; } = [];
  }
}
