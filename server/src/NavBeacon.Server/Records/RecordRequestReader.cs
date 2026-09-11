using System.Text;
using System.Text.Json;
using NavBeacon.Server.Contracts;

namespace NavBeacon.Server.Records;

public sealed record RecordRequestRead(
  RecordSynchronisationRequest? Request,
  string? Code,
  int? Index,
  int ChangeCount
);

/// <summary>
/// Reads one synchronisation request and applies every bound in 020/FR-026
/// before the service compares or writes anything.
/// </summary>
public static class RecordRequestReader
{
  private static readonly string[] RequestKeys = ["sinceRevision", "changes"];
  private static readonly string[] WriteKeys = ["type", "record", "baseRevision"];
  private static readonly string[] DeleteKeys = ["type", "id", "baseRevision"];
  private static readonly string[] RenewKeys = ["type", "id"];

  public static RecordRequestRead Read(ReadOnlyMemory<byte> body)
  {
    if (body.Length > RecordSynchronisationLimits.MaximumRequestBytes)
    {
      return Refused(RecordErrorCodes.RequestTooLarge, null, 0);
    }

    JsonDocument document;
    try
    {
      document = JsonDocument.Parse(body);
    }
    catch (JsonException)
    {
      return Refused(RecordErrorCodes.InvalidRequest, null, 0);
    }

    using (document)
    {
      return Read(document.RootElement);
    }
  }

  private static RecordRequestRead Read(JsonElement root)
  {
    if (
      root.ValueKind != JsonValueKind.Object
      || !HasOnly(root, RequestKeys)
      || !root.TryGetProperty("sinceRevision", out var since)
      || since.ValueKind != JsonValueKind.Number
      || !since.TryGetInt64(out var sinceRevision)
      || sinceRevision < 0
      || !root.TryGetProperty("changes", out var changes)
      || changes.ValueKind != JsonValueKind.Array
    )
    {
      return Refused(RecordErrorCodes.InvalidRequest, null, 0);
    }

    var count = changes.GetArrayLength();
    if (count > RecordSynchronisationLimits.MaximumChanges)
    {
      return Refused(RecordErrorCodes.TooManyChanges, null, count);
    }

    var read = new List<RecordChange>(count);
    var named = new HashSet<Guid>();
    var index = 0;
    foreach (var element in changes.EnumerateArray())
    {
      var (change, code) = ReadChange(element, index);
      if (change is null)
      {
        return Refused(code!, index, count);
      }

      // One record carries at most one pending operation, so a batch that names
      // the same record twice has no defined order and is refused before the
      // service compares anything.
      if (!named.Add(change.RecordId))
      {
        return Refused(RecordErrorCodes.InvalidRequest, index, count);
      }

      read.Add(change);
      index++;
    }

    return new RecordRequestRead(
      new RecordSynchronisationRequest(sinceRevision, read),
      null,
      null,
      count
    );
  }

  private static (RecordChange? Change, string? Code) ReadChange(JsonElement change, int index)
  {
    if (
      change.ValueKind != JsonValueKind.Object
      || !change.TryGetProperty("type", out var type)
      || type.ValueKind != JsonValueKind.String
    )
    {
      return (null, RecordErrorCodes.InvalidRequest);
    }

    return type.GetString() switch
    {
      "write" => ReadWrite(change, index),
      "delete" => ReadIdentified(change, index, RecordChangeKind.Delete, DeleteKeys),
      "renew" => ReadIdentified(change, index, RecordChangeKind.Renew, RenewKeys),
      _ => (null, RecordErrorCodes.InvalidRequest),
    };
  }

  private static (RecordChange? Change, string? Code) ReadWrite(JsonElement change, int index)
  {
    if (
      !HasOnly(change, WriteKeys)
      || !change.TryGetProperty("record", out var record)
      || record.ValueKind != JsonValueKind.Object
      || !TryReadExpectedRevision(change, out var expected)
    )
    {
      return (null, RecordErrorCodes.InvalidRequest);
    }

    if (
      Encoding.UTF8.GetByteCount(record.GetRawText())
      > RecordSynchronisationLimits.MaximumRecordBytes
    )
    {
      return (null, RecordErrorCodes.RecordTooLarge);
    }

    if (!SupportedVersion(record))
    {
      return (null, RecordErrorCodes.UnsupportedRecordVersion);
    }

    object parsed;
    try
    {
      parsed = RemoteContractJson.ParseRecord(record);
    }
    catch (JsonException)
    {
      return (null, RecordErrorCodes.InvalidRecord);
    }

    var described = Describe(parsed);
    return (
      new RecordChange(
        index,
        RecordChangeKind.Write,
        described.RecordId,
        expected,
        CanonicalRecordJson.Write(parsed),
        described.Kind,
        described.CreatedAt,
        described.ModifiedAt
      ),
      null
    );
  }

  private static (RecordChange? Change, string? Code) ReadIdentified(
    JsonElement change,
    int index,
    RecordChangeKind kind,
    string[] keys
  )
  {
    if (
      !HasOnly(change, keys)
      || !change.TryGetProperty("id", out var id)
      || id.ValueKind != JsonValueKind.String
      || !Guid.TryParseExact(id.GetString(), "D", out var recordId)
      || recordId == Guid.Empty
      || !TryReadExpectedRevision(change, out var expected)
    )
    {
      return (null, RecordErrorCodes.InvalidRequest);
    }

    return (new RecordChange(index, kind, recordId, expected, null, null, null, null), null);
  }

  private static (
    Guid RecordId,
    string Kind,
    DateTimeOffset CreatedAt,
    DateTimeOffset ModifiedAt
  ) Describe(object parsed) =>
    parsed switch
    {
      RemoteShipRecordContract ship => (ship.Id, ship.Kind, ship.CreatedAt, ship.ModifiedAt),
      RemoteEquipmentRecordContract equipment => (
        equipment.Id,
        equipment.Kind,
        equipment.CreatedAt,
        equipment.ModifiedAt
      ),
      _ => throw new JsonException("The remote record tool is not supported."),
    };

  /// <summary>
  /// Reads the revision the browser expects the account to hold. An absent
  /// revision and zero both state that the account holds no record under this
  /// identity.
  /// </summary>
  private static bool TryReadExpectedRevision(JsonElement change, out long expected)
  {
    expected = 0;
    if (
      !change.TryGetProperty("baseRevision", out var value)
      || value.ValueKind == JsonValueKind.Null
    )
    {
      return true;
    }

    return value.ValueKind == JsonValueKind.Number
      && value.TryGetInt64(out expected)
      && expected >= 0;
  }

  private static bool SupportedVersion(JsonElement record) =>
    (
      !record.TryGetProperty("format", out var format)
      || format.ValueKind != JsonValueKind.String
      || format.GetString() == RemoteContractConstants.RecordFormat
    )
    && (
      !record.TryGetProperty("version", out var version)
      || version.ValueKind != JsonValueKind.Number
      || (version.TryGetInt32(out var number) && number == RemoteContractConstants.RecordVersion)
    );

  private static bool HasOnly(JsonElement value, string[] keys)
  {
    foreach (var property in value.EnumerateObject())
    {
      if (!keys.Contains(property.Name))
      {
        return false;
      }
    }
    return true;
  }

  private static RecordRequestRead Refused(string code, int? index, int changeCount) =>
    new(null, code, index, changeCount);
}
