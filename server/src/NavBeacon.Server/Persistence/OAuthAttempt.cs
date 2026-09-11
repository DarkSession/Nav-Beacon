namespace NavBeacon.Server.Persistence;

public sealed class OAuthAttempt
{
  public required byte[] StateHash { get; set; }

  public required byte[] BrowserCorrelationHash { get; set; }

  public DateTimeOffset ExpiresAt { get; set; }
}
