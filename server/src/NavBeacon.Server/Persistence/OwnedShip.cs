namespace NavBeacon.Server.Persistence;

public sealed class OwnedShip
{
  public long CustomerId { get; set; }

  public long ShipId { get; set; }

  public CommanderAccount Account { get; set; } = null!;

  public DateOnly SourceDate { get; set; }

  public int SourceLine { get; set; }

  public required string Payload { get; set; }
}
