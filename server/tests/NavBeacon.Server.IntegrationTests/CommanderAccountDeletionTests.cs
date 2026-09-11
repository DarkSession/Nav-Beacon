using Microsoft.EntityFrameworkCore;
using NavBeacon.Server.Accounts;
using NavBeacon.Server.Persistence;

namespace NavBeacon.Server.IntegrationTests;

public sealed class CommanderAccountDeletionTests(PostgreSqlDatabaseFixture database)
  : IClassFixture<PostgreSqlDatabaseFixture>
{
  [Fact]
  public async Task OneTransactionRemovesTheAccountAndEveryDependentRecord()
  {
    var now = DateTimeOffset.UtcNow;
    const long customerId = 50_001;
    await using var context = database.CreateContext();
    var account = new CommanderAccount
    {
      CustomerId = customerId,
      CommanderName = "Test Commander",
      ProtectedAccessToken = "protected-access",
      ProtectedRefreshToken = "protected-refresh",
      AccessTokenExpiresAt = now.AddHours(1),
    };
    context.CommanderAccounts.Add(account);
    context.Sessions.Add(
      new CommanderSession
      {
        SessionHash = new byte[32],
        CustomerId = customerId,
        CreatedAt = now,
        LastRenewedAt = now,
        RenewableExpiresAt = now.AddDays(30),
        AbsoluteExpiresAt = now.AddDays(180),
      }
    );
    context.SynchronisedRecords.AddRange(
      new SynchronisedRecord
      {
        CustomerId = customerId,
        RecordId = Guid.NewGuid(),
        Revision = 1,
        RecordKind = "named",
        Name = "Test record",
        Payload = "{}",
        CreatedAt = now,
        BrowserModifiedAt = now,
        ServerContentAt = now,
      },
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
    var service = new CommanderAccountDeletionService(context);

    await service.DeleteAsync(customerId, CancellationToken.None);
    await service.DeleteAsync(customerId, CancellationToken.None);

    Assert.False(await context.CommanderAccounts.AnyAsync(item => item.CustomerId == customerId));
    Assert.False(await context.Sessions.AnyAsync(item => item.CustomerId == customerId));
    Assert.False(await context.SynchronisedRecords.AnyAsync(item => item.CustomerId == customerId));
    Assert.False(await context.OwnedShips.AnyAsync(item => item.CustomerId == customerId));
    Assert.False(await context.JournalCursors.AnyAsync(item => item.CustomerId == customerId));
  }
}
