namespace NavBeacon.Server.Persistence;

public sealed class SynchronisedRecord
{
  public long CustomerId { get; set; }

  public Guid RecordId { get; set; }

  public CommanderAccount Account { get; set; } = null!;

  public long Revision { get; set; }

  public string? Payload { get; set; }

  public string? RecordKind { get; set; }

  public DateTimeOffset? CreatedAt { get; set; }

  public DateTimeOffset? BrowserModifiedAt { get; set; }

  public DateTimeOffset? ServerContentAt { get; set; }

  public DateTimeOffset? ProtectionDeadline { get; set; }
}
