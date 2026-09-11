namespace NavBeacon.Server.Fleet;

/// <summary>Fixed journal and projection bounds published by 020/FR-013.</summary>
public static class FleetLimits
{
  /// <summary>How far back the first cursor reaches.</summary>
  public static readonly TimeSpan InitialCoverage = TimeSpan.FromDays(14);

  public const int MaximumResponseBytes = 25 * 1024 * 1024;

  public const int MaximumLineBytes = 1024 * 1024;

  public const int MaximumBatchLines = 100;

  public const int MaximumBatchBytes = 4 * 1024 * 1024;

  public const int MaximumBatches = 10;

  public const int MaximumProjectionOutputBytes = 4 * 1024 * 1024;

  public static readonly TimeSpan ProjectionTimeout = TimeSpan.FromSeconds(30);

  public const int MaximumAttempts = 3;

  public static readonly TimeSpan FirstRetryDelay = TimeSpan.FromSeconds(1);

  public static readonly TimeSpan SecondRetryDelay = TimeSpan.FromSeconds(2);

  /// <summary>The longest delay a refresh waits out inside its own request.</summary>
  public static readonly TimeSpan MaximumInRequestDelay = TimeSpan.FromSeconds(30);

  /// <summary>The floor under the next permitted time after a third failure.</summary>
  public static readonly TimeSpan FailureDelay = TimeSpan.FromSeconds(60);
}

/// <summary>What the fleet is, as one word the application states (020/FR-018).</summary>
public static class FleetResults
{
  /// <summary>Current to the accepted journal cursor.</summary>
  public const string Current = "current";

  /// <summary>No journal line confirms a ship yet.</summary>
  public const string Empty = "empty";

  /// <summary>Accepted, and journal coverage cannot confirm the complete fleet.</summary>
  public const string Incomplete = "incomplete";

  /// <summary>Frontier or another refresh of this account holds the next attempt.</summary>
  public const string Waiting = "waiting";

  /// <summary>The refresh stopped on a failure. The last accepted fleet stands.</summary>
  public const string Failed = "failed";

  /// <summary>Frontier authorisation is gone and a fresh sign-in is required.</summary>
  public const string AuthorisationExpired = "authorisation-expired";
}

/// <summary>Why a refresh stopped, where it stopped on something nameable.</summary>
public static class FleetFailures
{
  public const string Frontier = "frontier-unavailable";
  public const string ResponseTooLarge = "response-too-large";
  public const string LineTooLarge = "line-too-large";
  public const string LineMalformed = "line-malformed";
  public const string PackageRefused = "package-refused";
  public const string ProjectionUnavailable = "projection-unavailable";
}

/// <summary>Stable application error codes carried by fleet Problem Details bodies.</summary>
public static class FleetErrorCodes
{
  public const string Unauthorised = "unauthorised";
  public const string InvalidAntiForgery = "invalid-anti-forgery";
  public const string FleetUnavailable = "fleet-unavailable";
}

/// <summary>
/// The package's own answer to a candidate it refused, as refresh feedback.
/// `Message` is what the package publishes for the requested locale and is
/// `null` where it publishes none. Nothing here is stored (020/FR-016).
/// </summary>
public sealed record PackageRefusal(
  string Code,
  string? Constraint,
  string? Path,
  string? Message
);

/// <summary>One owned ship, as the service holds it.</summary>
public sealed record FleetShip(long ShipId, DateOnly SourceDate, int SourceLine, string ModelJson);

/// <summary>
/// The four journal metadata items 020/FR-015 allows, and nothing else.
/// </summary>
public sealed record FleetCoverage(
  DateOnly StartDate,
  DateOnly CursorDate,
  int CursorLine,
  DateOnly? StoredShipsDate,
  int? StoredShipsLine,
  bool? StoredShipsComplete,
  DateTimeOffset? NextPermittedRefreshAt
);

/// <summary>What a fleet read or refresh answers.</summary>
public sealed record FleetState(
  string Result,
  IReadOnlyList<FleetShip> Ships,
  FleetCoverage? Coverage,
  bool Pending,
  string? Failure,
  PackageRefusal? Refusal
);
