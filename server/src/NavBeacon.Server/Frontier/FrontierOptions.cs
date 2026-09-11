namespace NavBeacon.Server.Frontier;

public sealed class FrontierOptions
{
  public const string SectionName = "Frontier";

  public string ClientId { get; set; } = string.Empty;

  public string ClientSecret { get; set; } = string.Empty;

  public string RedirectUri { get; set; } = string.Empty;
}
