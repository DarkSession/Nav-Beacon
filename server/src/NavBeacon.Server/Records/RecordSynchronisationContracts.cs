using System.Globalization;
using System.Text.Json;
using System.Text.Json.Serialization;
using NavBeacon.Server.Contracts;

namespace NavBeacon.Server.Records;

/// <summary>Fixed request bounds published by 020/FR-026.</summary>
public static class RecordSynchronisationLimits
{
  public const int MaximumChanges = 100;

  public const int MaximumRequestBytes = 1024 * 1024;

  public const int MaximumRecordBytes = RemoteContractJson.MaximumRecordBytes;
}

/// <summary>Stable application error codes carried by Problem Details bodies.</summary>
public static class RecordErrorCodes
{
  public const string Unauthorised = "unauthorised";
  public const string InvalidAntiForgery = "invalid-anti-forgery";
  public const string InvalidRequest = "invalid-request";
  public const string RequestTooLarge = "request-too-large";
  public const string TooManyChanges = "too-many-changes";
  public const string RecordTooLarge = "record-too-large";
  public const string UnsupportedRecordVersion = "unsupported-record-version";
  public const string InvalidRecord = "invalid-record";
  public const string CrossAccountRecord = "cross-account-record";
  public const string Conflict = "conflict";
  public const string ValidationUnavailable = "validation-unavailable";
  public const string SynchronisationFailed = "synchronisation-failed";
}

public enum RecordChangeKind
{
  Write,
  Delete,
  Renew,
}

/// <summary>One submitted change, already read into its exact contract.</summary>
public sealed record RecordChange(
  int Index,
  RecordChangeKind Kind,
  Guid RecordId,
  long ExpectedRevision,
  string? Payload,
  string? RecordKind,
  DateTimeOffset? CreatedAt,
  DateTimeOffset? BrowserModifiedAt
);

public sealed record RecordSynchronisationRequest(
  long SinceRevision,
  IReadOnlyList<RecordChange> Changes
);

public enum ChangeOutcome
{
  Applied,
  Unchanged,
  Conflict,
  Refused,
  NotApplied,
}

/// <summary>
/// The result of one submitted change. A conflict carries the revision and the
/// live content the account holds now, so the browser can offer overwrite, keep
/// both and cancel without another request.
/// </summary>
public sealed record ChangeResult(
  int Index,
  ChangeOutcome Outcome,
  Guid RecordId,
  long Revision,
  string? Code,
  string? CurrentPayload
);

public sealed record RecordStreamEntry(long Revision, string? Payload, Guid RecordId);

/// <summary>
/// What one synchronisation request produced.
///
/// `AccountRevision` is the cursor the account stands at. It is `null` only
/// where there is no account to state one for, which is the account deleted
/// between authenticating this request and locking its row: `0` cannot say
/// that, because `0` is the cursor of an account that has stored nothing yet.
/// </summary>
public sealed record RecordSynchronisationOutcome(
  string? Code,
  long? AccountRevision,
  IReadOnlyList<ChangeResult> Results,
  IReadOnlyList<RecordStreamEntry> Stream
);

/// <summary>
/// Writes one exact live-record contract in a single stable form, so equality
/// between a submitted record and a stored record is a byte comparison.
/// </summary>
public static class CanonicalRecordJson
{
  private static readonly JsonSerializerOptions Options = new()
  {
    PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
    Converters = { new UtcMillisecondInstantConverter() },
  };

  public static string Write(object record) =>
    JsonSerializer.Serialize(record, record.GetType(), Options);

  private sealed class UtcMillisecondInstantConverter : JsonConverter<DateTimeOffset>
  {
    public override DateTimeOffset Read(
      ref Utf8JsonReader reader,
      Type typeToConvert,
      JsonSerializerOptions options
    ) => reader.GetDateTimeOffset();

    public override void Write(
      Utf8JsonWriter writer,
      DateTimeOffset value,
      JsonSerializerOptions options
    ) =>
      writer.WriteStringValue(
        value.ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fffZ", CultureInfo.InvariantCulture)
      );
  }
}
