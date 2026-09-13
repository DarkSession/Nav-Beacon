using Microsoft.EntityFrameworkCore;
using NavBeacon.Server.Accounts;
using NavBeacon.Server.Persistence;

namespace NavBeacon.Server.IntegrationTests;

public sealed class CommanderSessionServiceTests(PostgreSqlDatabaseFixture database)
  : IClassFixture<PostgreSqlDatabaseFixture>
{
  private static readonly DateTimeOffset InitialTime = new(2026, 9, 11, 12, 0, 0, TimeSpan.Zero);

  [Fact]
  public async Task SessionSecretIsHashedAndTheThirtyDayBoundaryExpiresIt()
  {
    var clock = new ManualTimeProvider(InitialTime);
    await using var context = database.CreateContext();
    context.CommanderAccounts.Add(Account(30_001));
    await context.SaveChangesAsync();
    var service = new CommanderSessionService(context, clock);
    var created = await service.CreateAsync(30_001, CancellationToken.None);
    var stored = await context.Sessions.SingleAsync(item => item.CustomerId == 30_001);

    Assert.DoesNotContain(
      System.Text.Encoding.UTF8.GetBytes(created.Secret),
      stored.SessionHash
    );
    clock.Advance(TimeSpan.FromHours(24) - TimeSpan.FromTicks(1));
    Assert.NotNull(await service.AuthenticateAsync(created.Secret, CancellationToken.None));
    clock.Advance(TimeSpan.FromDays(29) + TimeSpan.FromTicks(1));
    Assert.Null(await service.AuthenticateAsync(created.Secret, CancellationToken.None));
    Assert.Empty(await context.Sessions.Where(item => item.CustomerId == 30_001).ToListAsync());
  }

  [Fact]
  public async Task FirstRequestAtTwentyFourHoursRenewsOnceForThatDay()
  {
    var clock = new ManualTimeProvider(InitialTime);
    await using var context = database.CreateContext();
    context.CommanderAccounts.Add(Account(30_002));
    await context.SaveChangesAsync();
    var service = new CommanderSessionService(context, clock);
    var created = await service.CreateAsync(30_002, CancellationToken.None);
    clock.Advance(TimeSpan.FromHours(24));

    var first = await service.AuthenticateAsync(created.Secret, CancellationToken.None);
    var afterFirst = await context.Sessions.AsNoTracking().SingleAsync(item => item.CustomerId == 30_002);
    clock.Advance(TimeSpan.FromHours(23));
    var second = await service.AuthenticateAsync(created.Secret, CancellationToken.None);
    var afterSecond = await context.Sessions.AsNoTracking().SingleAsync(item => item.CustomerId == 30_002);

    Assert.True(first!.Renewed);
    Assert.False(second!.Renewed);
    Assert.Equal(InitialTime.AddDays(1), afterFirst.LastRenewedAt);
    Assert.Equal(InitialTime.AddDays(31), afterFirst.RenewableExpiresAt);
    Assert.Equal(afterFirst.LastRenewedAt, afterSecond.LastRenewedAt);
    Assert.Equal(afterFirst.RenewableExpiresAt, afterSecond.RenewableExpiresAt);
  }

  [Fact]
  public async Task RenewalNeverExtendsPastTheAbsoluteBoundary()
  {
    var clock = new ManualTimeProvider(InitialTime);
    await using var context = database.CreateContext();
    var account = Account(30_003);
    context.CommanderAccounts.Add(account);
    context.Sessions.Add(
      new CommanderSession
      {
        SessionHash = NavBeacon.Server.Security.SecretHash.Compute("session-secret"),
        CustomerId = account.CustomerId,
        CreatedAt = InitialTime,
        LastRenewedAt = InitialTime.AddDays(175),
        RenewableExpiresAt = InitialTime.AddDays(180),
        AbsoluteExpiresAt = InitialTime.AddDays(180),
      }
    );
    await context.SaveChangesAsync();
    clock.Advance(TimeSpan.FromDays(176));
    var service = new CommanderSessionService(context, clock);

    var access = await service.AuthenticateAsync("session-secret", CancellationToken.None);

    var stored = await context.Sessions.AsNoTracking().SingleAsync(item => item.CustomerId == 30_003);
    Assert.True(access!.Renewed);
    Assert.Equal(InitialTime.AddDays(180), stored.RenewableExpiresAt);
    clock.Advance(TimeSpan.FromDays(4));
    Assert.Null(await service.AuthenticateAsync("session-secret", CancellationToken.None));
  }

  [Fact]
  public async Task RevocationRemovesOnlyTheNamedSession()
  {
    var clock = new ManualTimeProvider(InitialTime);
    await using var context = database.CreateContext();
    context.CommanderAccounts.Add(Account(30_004));
    await context.SaveChangesAsync();
    var service = new CommanderSessionService(context, clock);
    var first = await service.CreateAsync(30_004, CancellationToken.None);
    var second = await service.CreateAsync(30_004, CancellationToken.None);

    await service.RevokeAsync(first.Secret, CancellationToken.None);
    await service.RevokeAsync(null, CancellationToken.None);

    Assert.Null(await service.AuthenticateAsync(first.Secret, CancellationToken.None));
    Assert.NotNull(await service.AuthenticateAsync(second.Secret, CancellationToken.None));
  }

  private static CommanderAccount Account(long customerId) =>
    new()
    {
      CustomerId = customerId,
      CommanderName = "Test Commander",
      ProtectedAccessToken = "protected-access",
      ProtectedRefreshToken = "protected-refresh",
      AccessTokenExpiresAt = InitialTime.AddHours(1),
    };

  private sealed class ManualTimeProvider(DateTimeOffset current) : TimeProvider
  {
    public override DateTimeOffset GetUtcNow() => current;

    public void Advance(TimeSpan duration) => current += duration;
  }
}
