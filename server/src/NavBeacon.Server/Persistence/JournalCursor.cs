namespace NavBeacon.Server.Persistence;

public sealed class JournalCursor
{
  public long CustomerId { get; set; }

  public CommanderAccount Account { get; set; } = null!;

  public DateOnly CoverageStartDate { get; set; }

  public DateOnly NextUnreadDate { get; set; }

  public int NextUnreadLine { get; set; }

  public DateOnly? LastStoredShipsDate { get; set; }

  public int? LastStoredShipsLine { get; set; }

  public bool? LastStoredShipsComplete { get; set; }

  public DateTimeOffset? NextPermittedRefreshAt { get; set; }
}
