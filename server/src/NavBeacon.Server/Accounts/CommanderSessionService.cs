using System.Data;
using Microsoft.EntityFrameworkCore;
using NavBeacon.Server.Persistence;
using NavBeacon.Server.Security;

namespace NavBeacon.Server.Accounts;

public sealed record CreatedCommanderSession(string Secret, DateTimeOffset AbsoluteExpiresAt);

public sealed record CommanderSessionAccess(long CustomerId, string CommanderName, bool Renewed);

public sealed class CommanderSessionService(NavBeaconDbContext database, TimeProvider timeProvider)
{
  public static readonly TimeSpan RenewableLifetime = TimeSpan.FromDays(30);
  public static readonly TimeSpan AbsoluteLifetime = TimeSpan.FromDays(180);
  public static readonly TimeSpan RenewalInterval = TimeSpan.FromHours(24);

  public async Task<CreatedCommanderSession> CreateAsync(
    long customerId,
    CancellationToken cancellationToken
  )
  {
    var now = timeProvider.GetUtcNow();
    var secret = SecretHash.CreateRandomValue();
    var session = new CommanderSession
    {
      SessionHash = SecretHash.Compute(secret),
      CustomerId = customerId,
      CreatedAt = now,
      LastRenewedAt = now,
      RenewableExpiresAt = now.Add(RenewableLifetime),
      AbsoluteExpiresAt = now.Add(AbsoluteLifetime),
    };
    database.Sessions.Add(session);
    await database.SaveChangesAsync(cancellationToken);
    return new CreatedCommanderSession(secret, session.AbsoluteExpiresAt);
  }

  /// <summary>
  /// Removes expired session rows, which a sign-in start and every protected
  /// request do rather than a background job.
  /// </summary>
  public async Task RemoveExpiredAsync(CancellationToken cancellationToken)
  {
    var now = timeProvider.GetUtcNow();
    await database
      .Sessions.Where(session =>
        session.RenewableExpiresAt <= now || session.AbsoluteExpiresAt <= now
      )
      .ExecuteDeleteAsync(cancellationToken);
  }

  public async Task<CommanderSessionAccess?> AuthenticateAsync(
    string? secret,
    CancellationToken cancellationToken
  )
  {
    var now = timeProvider.GetUtcNow();
    await RemoveExpiredAsync(cancellationToken);
    if (string.IsNullOrWhiteSpace(secret))
    {
      return null;
    }

    var hash = SecretHash.Compute(secret);
    await using var transaction = await database.Database.BeginTransactionAsync(
      IsolationLevel.ReadCommitted,
      cancellationToken
    );
    var session = await database
      .Sessions.FromSqlInterpolated(
        $"SELECT * FROM commander_sessions WHERE session_hash = {hash} FOR UPDATE"
      )
      .SingleOrDefaultAsync(cancellationToken);
    if (session is null)
    {
      await transaction.CommitAsync(cancellationToken);
      return null;
    }

    await database.Entry(session).Reference(item => item.Account).LoadAsync(cancellationToken);
    var renewed = now - session.LastRenewedAt >= RenewalInterval;
    if (renewed)
    {
      session.LastRenewedAt = now;
      session.RenewableExpiresAt = Min(now.Add(RenewableLifetime), session.AbsoluteExpiresAt);
      await database.SaveChangesAsync(cancellationToken);
    }
    await transaction.CommitAsync(cancellationToken);
    return new CommanderSessionAccess(
      session.CustomerId,
      session.Account.CommanderName,
      renewed
    );
  }

  public async Task RevokeAsync(string? secret, CancellationToken cancellationToken)
  {
    if (string.IsNullOrWhiteSpace(secret))
    {
      return;
    }

    var hash = SecretHash.Compute(secret);
    await database.Sessions.Where(session => session.SessionHash == hash).ExecuteDeleteAsync(cancellationToken);
  }

  private static DateTimeOffset Min(DateTimeOffset first, DateTimeOffset second) =>
    first < second ? first : second;
}
