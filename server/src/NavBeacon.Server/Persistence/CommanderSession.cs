namespace NavBeacon.Server.Persistence;

public sealed class CommanderSession
{
  public required byte[] SessionHash { get; set; }

  public long CustomerId { get; set; }

  public CommanderAccount Account { get; set; } = null!;

  public DateTimeOffset CreatedAt { get; set; }

  public DateTimeOffset LastRenewedAt { get; set; }

  public DateTimeOffset RenewableExpiresAt { get; set; }

  public DateTimeOffset AbsoluteExpiresAt { get; set; }
}
