using System.Data;
using Microsoft.EntityFrameworkCore;
using NavBeacon.Server.Persistence;

namespace NavBeacon.Server.Accounts;

public sealed class CommanderAccountDeletionService(NavBeaconDbContext database)
{
  public async Task DeleteAsync(long customerId, CancellationToken cancellationToken)
  {
    await using var transaction = await database.Database.BeginTransactionAsync(
      IsolationLevel.ReadCommitted,
      cancellationToken
    );
    var account = await database
      .CommanderAccounts.FromSqlInterpolated(
        $"SELECT * FROM commander_accounts WHERE customer_id = {customerId} FOR UPDATE"
      )
      .SingleOrDefaultAsync(cancellationToken);
    if (account is not null)
    {
      database.CommanderAccounts.Remove(account);
      await database.SaveChangesAsync(cancellationToken);
    }
    await transaction.CommitAsync(cancellationToken);
  }
}
