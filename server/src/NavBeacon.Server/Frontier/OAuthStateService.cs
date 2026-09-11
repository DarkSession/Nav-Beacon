using System.Data;
using Microsoft.EntityFrameworkCore;
using NavBeacon.Server.Persistence;
using NavBeacon.Server.Security;

namespace NavBeacon.Server.Frontier;

public sealed record OAuthStart(string State, string BrowserCorrelation, DateTimeOffset ExpiresAt);

public sealed class OAuthStateService(NavBeaconDbContext database, TimeProvider timeProvider)
{
  public static readonly TimeSpan Lifetime = TimeSpan.FromMinutes(10);

  public async Task<OAuthStart> StartAsync(CancellationToken cancellationToken)
  {
    var now = timeProvider.GetUtcNow();
    await database.OAuthAttempts.Where(attempt => attempt.ExpiresAt <= now).ExecuteDeleteAsync(cancellationToken);

    var state = SecretHash.CreateRandomValue();
    var correlation = SecretHash.CreateRandomValue();
    var expiry = now.Add(Lifetime);
    database.OAuthAttempts.Add(
      new OAuthAttempt
      {
        StateHash = SecretHash.Compute(state),
        BrowserCorrelationHash = SecretHash.Compute(correlation),
        ExpiresAt = expiry,
      }
    );
    await database.SaveChangesAsync(cancellationToken);
    return new OAuthStart(state, correlation, expiry);
  }

  public async Task<bool> ConsumeAsync(
    string state,
    string? browserCorrelation,
    CancellationToken cancellationToken
  )
  {
    var now = timeProvider.GetUtcNow();
    var stateHash = SecretHash.Compute(state);
    await using var transaction = await database.Database.BeginTransactionAsync(
      IsolationLevel.ReadCommitted,
      cancellationToken
    );
    await database.OAuthAttempts.Where(attempt => attempt.ExpiresAt <= now).ExecuteDeleteAsync(cancellationToken);
    var attempt = await database
      .OAuthAttempts.FromSqlInterpolated(
        $"SELECT * FROM oauth_attempts WHERE state_hash = {stateHash} FOR UPDATE"
      )
      .SingleOrDefaultAsync(cancellationToken);
    if (attempt is null)
    {
      await transaction.CommitAsync(cancellationToken);
      return false;
    }

    database.OAuthAttempts.Remove(attempt);
    await database.SaveChangesAsync(cancellationToken);
    await transaction.CommitAsync(cancellationToken);

    return browserCorrelation is not null
      && System.Security.Cryptography.CryptographicOperations.FixedTimeEquals(
        attempt.BrowserCorrelationHash,
        SecretHash.Compute(browserCorrelation)
      );
  }
}
