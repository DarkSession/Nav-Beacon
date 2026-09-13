using Microsoft.AspNetCore.DataProtection.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata;
using Microsoft.Extensions.Diagnostics.HealthChecks;
using NavBeacon.Server.Persistence;

namespace NavBeacon.Server.IntegrationTests;

public sealed class PersistenceModelTests : IClassFixture<PostgreSqlDatabaseFixture>
{
  private readonly PostgreSqlDatabaseFixture database;

  public PersistenceModelTests(PostgreSqlDatabaseFixture database)
  {
    this.database = database;
  }

  [Fact]
  public void Model_defines_every_identity_unique_key_and_cascade()
  {
    using var context = database.CreateContext();

    AssertPrimaryKey<CommanderAccount>(context, nameof(CommanderAccount.CustomerId));
    AssertPrimaryKey<OAuthAttempt>(context, nameof(OAuthAttempt.StateHash));
    AssertPrimaryKey<CommanderSession>(context, nameof(CommanderSession.SessionHash));
    AssertPrimaryKey<SynchronisedRecord>(
      context,
      nameof(SynchronisedRecord.CustomerId),
      nameof(SynchronisedRecord.RecordId)
    );
    AssertPrimaryKey<OwnedShip>(
      context,
      nameof(OwnedShip.CustomerId),
      nameof(OwnedShip.ShipId)
    );
    AssertPrimaryKey<JournalCursor>(context, nameof(JournalCursor.CustomerId));
    AssertPrimaryKey<DataProtectionKey>(context, nameof(DataProtectionKey.Id));

    AssertUniqueIndex<OAuthAttempt>(context, nameof(OAuthAttempt.BrowserCorrelationHash));
    AssertUniqueIndex<SynchronisedRecord>(
      context,
      nameof(SynchronisedRecord.CustomerId),
      nameof(SynchronisedRecord.Revision)
    );
    AssertUniqueIndex<OwnedShip>(
      context,
      nameof(OwnedShip.CustomerId),
      nameof(OwnedShip.SourceDate),
      nameof(OwnedShip.SourceLine)
    );

    AssertCascade<CommanderSession>(context);
    AssertCascade<SynchronisedRecord>(context);
    AssertCascade<OwnedShip>(context);
    AssertCascade<JournalCursor>(context);
  }

  [Fact]
  public async Task PostgreSql_rejects_each_duplicate_primary_key()
  {
    await using var context = database.CreateContext();
    await using var transaction = await context.Database.BeginTransactionAsync();
    var now = DateTimeOffset.UtcNow;
    var account = Account(10_001);
    context.Add(account);
    context.AddRange(
      Attempt(1, 1, now),
      Session(1, account.CustomerId, now),
      LiveRecord(account.CustomerId, Guid.NewGuid(), 1, now),
      Ship(account.CustomerId, 1, new DateOnly(2026, 9, 1), 0),
      Cursor(account.CustomerId),
      new DataProtectionKey { Id = 1, FriendlyName = "key", Xml = "<key />" }
    );
    await context.SaveChangesAsync();
    context.ChangeTracker.Clear();

    var duplicates = new object[]
    {
      Account(account.CustomerId),
      Attempt(1, 2, now),
      Session(1, account.CustomerId, now),
      LiveRecord(account.CustomerId, context.Set<SynchronisedRecord>().AsNoTracking().Single().RecordId, 2, now),
      Ship(account.CustomerId, 1, new DateOnly(2026, 9, 1), 1),
      Cursor(account.CustomerId),
      new DataProtectionKey { Id = 1, FriendlyName = "other", Xml = "<key />" },
    };

    foreach (var duplicate in duplicates)
    {
      context.Add(duplicate);
      await Assert.ThrowsAsync<DbUpdateException>(() => context.SaveChangesAsync());
      context.Entry(duplicate).State = EntityState.Detached;
    }
  }

  [Fact]
  public async Task PostgreSql_rejects_each_duplicate_unique_key()
  {
    await using var context = database.CreateContext();
    await using var transaction = await context.Database.BeginTransactionAsync();
    var now = DateTimeOffset.UtcNow;
    var account = Account(10_002);
    context.Add(account);
    context.AddRange(
      Attempt(2, 3, now),
      LiveRecord(account.CustomerId, Guid.NewGuid(), 1, now),
      Ship(account.CustomerId, 2, new DateOnly(2026, 9, 2), 4)
    );
    await context.SaveChangesAsync();

    var duplicates = new object[]
    {
      Attempt(4, 3, now),
      LiveRecord(account.CustomerId, Guid.NewGuid(), 1, now),
      Ship(account.CustomerId, 3, new DateOnly(2026, 9, 2), 4),
    };

    foreach (var duplicate in duplicates)
    {
      context.Add(duplicate);
      await Assert.ThrowsAsync<DbUpdateException>(() => context.SaveChangesAsync());
      context.Entry(duplicate).State = EntityState.Detached;
    }
  }

  [Fact]
  public async Task PostgreSql_rejects_each_unknown_account_foreign_key()
  {
    await using var context = database.CreateContext();
    await using var transaction = await context.Database.BeginTransactionAsync();
    var now = DateTimeOffset.UtcNow;
    var dependants = new object[]
    {
      Session(9, 999_001, now),
      LiveRecord(999_002, Guid.NewGuid(), 1, now),
      Ship(999_003, 1, new DateOnly(2026, 9, 1), 0),
      Cursor(999_004),
    };

    foreach (var dependant in dependants)
    {
      context.Add(dependant);
      await Assert.ThrowsAsync<DbUpdateException>(() => context.SaveChangesAsync());
      context.Entry(dependant).State = EntityState.Detached;
    }
  }

  [Fact]
  public async Task Account_delete_cascades_to_all_account_records()
  {
    await using var context = database.CreateContext();
    await using var transaction = await context.Database.BeginTransactionAsync();
    var now = DateTimeOffset.UtcNow;
    var account = Account(10_003);
    context.Add(account);
    context.AddRange(
      Session(5, account.CustomerId, now),
      LiveRecord(account.CustomerId, Guid.NewGuid(), 1, now),
      Ship(account.CustomerId, 4, new DateOnly(2026, 9, 3), 0),
      Cursor(account.CustomerId)
    );
    await context.SaveChangesAsync();

    context.Remove(account);
    await context.SaveChangesAsync();

    Assert.Empty(await context.Sessions.AsNoTracking().ToListAsync());
    Assert.Empty(await context.SynchronisedRecords.AsNoTracking().ToListAsync());
    Assert.Empty(await context.OwnedShips.AsNoTracking().ToListAsync());
    Assert.Empty(await context.JournalCursors.AsNoTracking().ToListAsync());
  }

  [Fact]
  public async Task PostgreSql_enforces_session_lifetime()
  {
    await using var context = database.CreateContext();
    await using var transaction = await context.Database.BeginTransactionAsync();
    var now = DateTimeOffset.UtcNow;
    var account = Account(10_004);
    context.Add(account);
    await context.SaveChangesAsync();

    var invalidSession = Session(6, account.CustomerId, now);
    invalidSession.RenewableExpiresAt = now.AddDays(31);
    context.Add(invalidSession);

    await Assert.ThrowsAsync<DbUpdateException>(() => context.SaveChangesAsync());
  }

  [Fact]
  public async Task Startup_check_refuses_an_unavailable_database()
  {
    var options = new DbContextOptionsBuilder<NavBeaconDbContext>()
      .UseNpgsql("Host=127.0.0.1;Port=1;Database=missing;Username=missing;Timeout=1")
      .Options;
    await using var context = new NavBeaconDbContext(options);
    var check = new DatabaseStartupCheck(context);

    await Assert.ThrowsAsync<InvalidOperationException>(() => check.ValidateAsync());
  }

  [Fact]
  public async Task Database_health_check_reports_an_unavailable_database()
  {
    var options = new DbContextOptionsBuilder<NavBeaconDbContext>()
      .UseNpgsql("Host=127.0.0.1;Port=1;Database=missing;Username=missing;Timeout=1")
      .Options;
    await using var context = new NavBeaconDbContext(options);
    var check = new DatabaseHealthCheck(context);

    var result = await check.CheckHealthAsync(new HealthCheckContext());

    Assert.Equal(HealthStatus.Unhealthy, result.Status);
  }

  [Fact]
  public async Task PostgreSql_stores_and_returns_every_value_a_record_holds()
  {
    await using var context = database.CreateContext();
    await using var transaction = await context.Database.BeginTransactionAsync();
    // Rounded to the microsecond PostgreSQL keeps, so the instants that come
    // back are compared against what the column can hold rather than against a
    // precision the database never promised.
    var now = Microseconds(DateTimeOffset.UtcNow);
    var recordId = Guid.NewGuid();
    var account = Account(10_007);
    account.RecordRevision = 1;
    var session = Session(11, account.CustomerId, now);
    var record = LiveRecord(account.CustomerId, recordId, 1, now);
    record.ProtectionDeadline = now;
    var ship = Ship(account.CustomerId, 12, new DateOnly(2026, 9, 4), 8);
    var cursor = Cursor(account.CustomerId);
    cursor.LastStoredShipsDate = new DateOnly(2026, 9, 3);
    cursor.LastStoredShipsLine = 7;
    cursor.LastStoredShipsComplete = false;
    cursor.NextPermittedRefreshAt = now;

    context.Add(account);
    context.AddRange(session, record, ship, cursor);
    await context.SaveChangesAsync();
    context.ChangeTracker.Clear();

    var stored = await context
      .CommanderAccounts.AsNoTracking()
      .Include(entry => entry.JournalCursor)
      .SingleAsync(entry => entry.CustomerId == account.CustomerId);
    var storedSession = await context.Sessions.AsNoTracking().SingleAsync();
    var storedRecord = await context.SynchronisedRecords.AsNoTracking().SingleAsync();
    var storedShip = await context.OwnedShips.AsNoTracking().SingleAsync();

    Assert.Equal(1, stored.RecordRevision);
    Assert.Equal("Test Commander", stored.CommanderName);
    Assert.Equal(now, storedSession.RenewableExpiresAt.AddDays(-30));
    Assert.Equal(recordId, storedRecord.RecordId);
    Assert.Equal("working", storedRecord.RecordKind);
    Assert.Equal(now, storedRecord.ProtectionDeadline);
    Assert.Equal(new DateOnly(2026, 9, 4), storedShip.SourceDate);
    Assert.Equal(8, storedShip.SourceLine);
    Assert.NotNull(stored.JournalCursor);
    Assert.Equal(new DateOnly(2026, 9, 11), stored.JournalCursor.NextUnreadDate);
    Assert.Equal(0, stored.JournalCursor.NextUnreadLine);
    Assert.Equal(new DateOnly(2026, 9, 3), stored.JournalCursor.LastStoredShipsDate);
    Assert.Equal(7, stored.JournalCursor.LastStoredShipsLine);
    Assert.False(stored.JournalCursor.LastStoredShipsComplete);
    Assert.Equal(now, stored.JournalCursor.NextPermittedRefreshAt);
  }

  /// <summary>
  /// One instant at the precision a `timestamptz` column keeps.
  /// </summary>
  private static DateTimeOffset Microseconds(DateTimeOffset value) =>
    new(value.Ticks - (value.Ticks % 10), value.Offset);

  [Fact]
  public async Task Live_record_requires_server_content_time()
  {
    await using var context = database.CreateContext();
    await using var transaction = await context.Database.BeginTransactionAsync();
    var now = DateTimeOffset.UtcNow;
    var account = Account(10_005);
    context.Add(account);
    await context.SaveChangesAsync();

    var record = LiveRecord(account.CustomerId, Guid.NewGuid(), 1, now);
    record.ServerContentAt = null;
    context.Add(record);

    await Assert.ThrowsAsync<DbUpdateException>(() => context.SaveChangesAsync());
  }

  [Fact]
  public async Task Tombstone_contains_only_identity_and_revision()
  {
    await using var context = database.CreateContext();
    await using var transaction = await context.Database.BeginTransactionAsync();
    var account = Account(10_006);
    context.Add(account);
    context.Add(new SynchronisedRecord
    {
      CustomerId = account.CustomerId,
      RecordId = Guid.NewGuid(),
      Revision = 1,
    });
    await context.SaveChangesAsync();

    var invalidTombstone = new SynchronisedRecord
    {
      CustomerId = account.CustomerId,
      RecordId = Guid.NewGuid(),
      Revision = 2,
      ProtectionDeadline = DateTimeOffset.UtcNow,
    };
    context.Add(invalidTombstone);

    await Assert.ThrowsAsync<DbUpdateException>(() => context.SaveChangesAsync());
  }

  private static CommanderAccount Account(long customerId) =>
    new()
    {
      CustomerId = customerId,
      CommanderName = "Test Commander",
      ProtectedAccessToken = "protected access",
      ProtectedRefreshToken = "protected refresh",
      AccessTokenExpiresAt = DateTimeOffset.UtcNow.AddHours(1),
    };

  private static OAuthAttempt Attempt(byte state, byte correlation, DateTimeOffset now) =>
    new()
    {
      StateHash = Hash(state),
      BrowserCorrelationHash = Hash(correlation),
      ExpiresAt = now.AddMinutes(10),
    };

  private static CommanderSession Session(byte hash, long customerId, DateTimeOffset now) =>
    new()
    {
      SessionHash = Hash(hash),
      CustomerId = customerId,
      CreatedAt = now,
      LastRenewedAt = now,
      RenewableExpiresAt = now.AddDays(30),
      AbsoluteExpiresAt = now.AddDays(180),
    };

  private static SynchronisedRecord LiveRecord(
    long customerId,
    Guid recordId,
    long revision,
    DateTimeOffset now
  ) =>
    new()
    {
      CustomerId = customerId,
      RecordId = recordId,
      Revision = revision,
      Payload = "{}",
      RecordKind = "working",
      CreatedAt = now,
      BrowserModifiedAt = now,
      ServerContentAt = now,
    };

  private static OwnedShip Ship(long customerId, long shipId, DateOnly date, int line) =>
    new()
    {
      CustomerId = customerId,
      ShipId = shipId,
      SourceDate = date,
      SourceLine = line,
      Payload = "{}",
    };

  private static JournalCursor Cursor(long customerId) =>
    new()
    {
      CustomerId = customerId,
      CoverageStartDate = new DateOnly(2026, 8, 28),
      NextUnreadDate = new DateOnly(2026, 9, 11),
    };

  private static byte[] Hash(byte value)
  {
    var hash = new byte[32];
    hash[0] = value;
    return hash;
  }

  private static void AssertPrimaryKey<TEntity>(NavBeaconDbContext context, params string[] names)
    where TEntity : class
  {
    var entity = context.Model.FindEntityType(typeof(TEntity));
    var primaryKey = Assert.IsAssignableFrom<IKey>(entity?.FindPrimaryKey());
    Assert.Equal(names, primaryKey.Properties.Select(property => property.Name));
  }

  private static void AssertUniqueIndex<TEntity>(NavBeaconDbContext context, params string[] names)
    where TEntity : class
  {
    var entity = Assert.IsAssignableFrom<IEntityType>(context.Model.FindEntityType(typeof(TEntity)));
    Assert.Contains(
      entity.GetIndexes(),
      index =>
        index.IsUnique
        && index.Properties.Select(property => property.Name).SequenceEqual(names)
    );
  }

  private static void AssertCascade<TEntity>(NavBeaconDbContext context)
    where TEntity : class
  {
    var entity = Assert.IsAssignableFrom<IEntityType>(context.Model.FindEntityType(typeof(TEntity)));
    Assert.All(entity.GetForeignKeys(), foreignKey => Assert.Equal(DeleteBehavior.Cascade, foreignKey.DeleteBehavior));
  }
}
