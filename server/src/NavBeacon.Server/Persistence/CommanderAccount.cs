namespace NavBeacon.Server.Persistence;

public sealed class CommanderAccount
{
  public long CustomerId { get; set; }

  public required string CommanderName { get; set; }

  public required string ProtectedAccessToken { get; set; }

  public required string ProtectedRefreshToken { get; set; }

  public DateTimeOffset AccessTokenExpiresAt { get; set; }

  public long RecordRevision { get; set; }

  public ICollection<CommanderSession> Sessions { get; } = [];

  public ICollection<SynchronisedRecord> SynchronisedRecords { get; } = [];

  public ICollection<OwnedShip> OwnedShips { get; } = [];

  public JournalCursor? JournalCursor { get; set; }
}
