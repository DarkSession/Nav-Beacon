using System.Data;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.EntityFrameworkCore;
using NavBeacon.Server.Persistence;

namespace NavBeacon.Server.Frontier;

public sealed class FrontierCredentialService(
  NavBeaconDbContext database,
  IFrontierClient frontier,
  IDataProtectionProvider dataProtectionProvider,
  TimeProvider timeProvider
)
{
  private readonly IDataProtector tokenProtector = dataProtectionProvider.CreateProtector(
    "Frontier tokens v1"
  );

  public async Task<string?> GetAccessTokenAsync(
    long customerId,
    CancellationToken cancellationToken
  )
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
    if (account is null)
    {
      await transaction.CommitAsync(cancellationToken);
      return null;
    }

    if (account.AccessTokenExpiresAt > timeProvider.GetUtcNow())
    {
      await transaction.CommitAsync(cancellationToken);
      return tokenProtector.Unprotect(account.ProtectedAccessToken);
    }

    var refreshToken = tokenProtector.Unprotect(account.ProtectedRefreshToken);
    var refreshed = await frontier.RefreshAsync(refreshToken, cancellationToken);
    if (refreshed is null)
    {
      await transaction.CommitAsync(cancellationToken);
      return null;
    }

    account.ProtectedAccessToken = tokenProtector.Protect(refreshed.AccessToken);
    account.ProtectedRefreshToken = tokenProtector.Protect(refreshed.RefreshToken);
    account.AccessTokenExpiresAt = refreshed.AccessTokenExpiresAt;
    await database.SaveChangesAsync(cancellationToken);
    await transaction.CommitAsync(cancellationToken);
    return refreshed.AccessToken;
  }
}
