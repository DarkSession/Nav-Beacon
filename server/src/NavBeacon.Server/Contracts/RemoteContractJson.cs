using System.Text.Json;

namespace NavBeacon.Server.Contracts;

public static class RemoteContractJson
{
  public const int MaximumRecordBytes = 64 * 1024;

  private static readonly JsonSerializerOptions Options = new()
  {
    PropertyNameCaseInsensitive = false,
    PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
  };

  public static object ParseRecord(JsonElement element)
  {
    if (!element.TryGetProperty("tool", out var tool) || tool.ValueKind != JsonValueKind.String)
    {
      throw new JsonException("A remote record must identify its tool.");
    }

    return tool.GetString() switch
    {
      "ship" => ValidateShip(element.Deserialize<RemoteShipRecordContract>(Options)),
      "equipment" => ValidateEquipment(
        element.Deserialize<RemoteEquipmentRecordContract>(Options)
      ),
      _ => throw new JsonException("The remote record tool is not supported."),
    };
  }

  public static object ParseRecord(ReadOnlyMemory<byte> utf8Json)
  {
    if (utf8Json.Length > MaximumRecordBytes)
    {
      throw new JsonException("A remote record exceeds 64 KiB.");
    }
    using var document = JsonDocument.Parse(utf8Json);
    return ParseRecord(document.RootElement);
  }

  public static RemoteTombstoneContract ParseTombstone(JsonElement element)
  {
    var tombstone = element.Deserialize<RemoteTombstoneContract>(Options);
    if (tombstone is null || tombstone.Id == Guid.Empty || tombstone.Revision < 1)
    {
      throw new JsonException("The remote tombstone is invalid.");
    }
    return tombstone;
  }

  public static OwnedShipPayloadContract ParseOwnedShip(JsonElement element)
  {
    var ship = element.Deserialize<OwnedShipPayloadContract>(Options);
    if (ship is null || string.IsNullOrWhiteSpace(ship.HullSymbol))
    {
      throw new JsonException("The owned-ship payload is invalid.");
    }
    return ship;
  }

  private static RemoteShipRecordContract ValidateShip(RemoteShipRecordContract? record)
  {
    if (
      record is null
      || record.Format != RemoteContractConstants.RecordFormat
      || record.Version != RemoteContractConstants.RecordVersion
      || record.Id == Guid.Empty
      || record.Tool != "ship"
      || !ValidKind(record.Kind)
      || record.CreatedAt == default
      || record.ModifiedAt == default
      || record.Build.Format != RemoteContractConstants.BuildFormat
      || record.Build.Version != RemoteContractConstants.BuildVersion
    )
    {
      throw new JsonException("The remote ship record is invalid.");
    }
    return record;
  }

  private static RemoteEquipmentRecordContract ValidateEquipment(
    RemoteEquipmentRecordContract? record
  )
  {
    if (
      record is null
      || record.Format != RemoteContractConstants.RecordFormat
      || record.Version != RemoteContractConstants.RecordVersion
      || record.Id == Guid.Empty
      || record.Tool != "equipment"
      || !ValidKind(record.Kind)
      || record.CreatedAt == default
      || record.ModifiedAt == default
      || record.Loadout.Format != RemoteContractConstants.LoadoutFormat
      || record.Loadout.Version != RemoteContractConstants.LoadoutVersion
    )
    {
      throw new JsonException("The remote equipment record is invalid.");
    }
    return record;
  }

  private static bool ValidKind(string kind) => kind is "working" or "named";
}
