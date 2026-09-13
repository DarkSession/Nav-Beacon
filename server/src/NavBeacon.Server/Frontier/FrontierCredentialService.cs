using System.Data;
using System.Security.Cryptography;
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

  /// <summary>
  /// The account's access token, refreshed only when it has expired.
  /// </summary>
  public Task<string?> GetAccessTokenAsync(long customerId, CancellationToken cancellationToken) =>
    ReadAsync(customerId, false, cancellationToken);

  /// <summary>
  /// The account's access token after one refresh, whatever the stored token
  /// says about its own expiry. Frontier refusing a token it has not expired is
  /// the one case that needs this (020/FR-013).
  /// </summary>
  public Task<string?> RefreshAccessTokenAsync(
    long customerId,
    CancellationToken cancellationToken
  ) => ReadAsync(customerId, true, cancellationToken);

  private async Task<string?> ReadAsync(
    long customerId,
    bool forceRefresh,
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
    // A locking re-read of an entity this request already tracks returns the
    // tracked one and keeps its values, so the row is read again here. The
    // tokens and their expiry decide whether Frontier is asked to refresh, and
    // a refresh answered on another request has already rotated them: acting on
    // the values read before it would send a refresh token Frontier has
    // retired. The tracker is not cleared instead, because a fleet refresh
    // holds its journal cursor across this call.
    await database.Entry(account).ReloadAsync(cancellationToken);

    if (!forceRefresh && account.AccessTokenExpiresAt > timeProvider.GetUtcNow())
    {
      await transaction.CommitAsync(cancellationToken);
      return Read(account.ProtectedAccessToken);
    }

    var refreshToken = Read(account.ProtectedRefreshToken);
    if (refreshToken is null)
    {
      await transaction.CommitAsync(cancellationToken);
      return null;
    }

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

  /// <summary>
  /// One stored token, or `null` where this server cannot read it.
  ///
  /// A key ring that was lost or replaced leaves the stored tokens as bytes
  /// nothing here opens. That is Frontier authorisation this server no longer
  /// holds, so it is answered as the authorisation that has gone: a Commander
  /// signs in with Frontier again, and the tokens are stored under the ring now
  /// in use. Reading it regardless would end the request in an unhandled
  /// failure, which states nothing and offers nothing (020/FR-018).
  /// </summary>
  private string? Read(string protectedToken)
  {
    try
    {
      return tokenProtector.Unprotect(protectedToken);
    }
    catch (CryptographicException)
    {
      return null;
    }
  }
}
