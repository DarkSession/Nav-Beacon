using System.Text.Json.Serialization;

namespace NavBeacon.Server.Contracts;

public static class RemoteContractConstants
{
  public const string RecordFormat = "ednb.remote-record";
  public const int RecordVersion = 1;
  public const string BuildFormat = "ednb.build";
  public const int BuildVersion = 1;
  public const string LoadoutFormat = "ednb.loadout";
  public const int LoadoutVersion = 1;
}

[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed class RemoteShipRecordContract
{
  public required string Format { get; init; }
  public int Version { get; init; }
  public Guid Id { get; init; }
  public required string Tool { get; init; }
  public required string Kind { get; init; }
  public DateTimeOffset CreatedAt { get; init; }
  public DateTimeOffset ModifiedAt { get; init; }
  public required BuildContract Build { get; init; }
}

[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed class RemoteEquipmentRecordContract
{
  public required string Format { get; init; }
  public int Version { get; init; }
  public Guid Id { get; init; }
  public required string Tool { get; init; }
  public required string Kind { get; init; }
  public string? Name { get; init; }
  public DateTimeOffset CreatedAt { get; init; }
  public DateTimeOffset ModifiedAt { get; init; }
  public required EquipmentLoadoutContract Loadout { get; init; }
}

[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed class RemoteTombstoneContract
{
  public Guid Id { get; init; }
  public long Revision { get; init; }
}

[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed class BuildContract
{
  public required string Format { get; init; }
  public int Version { get; init; }
  public required string ShipSymbol { get; init; }
  public string? ShipName { get; init; }
  public string? ShipIdent { get; init; }
  public required IReadOnlyList<ModuleContract> Modules { get; init; }
}

[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed class ModuleContract
{
  public required string Slot { get; init; }
  public required string Symbol { get; init; }
  public bool? Enabled { get; init; }
  public int? Priority { get; init; }
  public PreEngineeredContract? PreEngineered { get; init; }
  public EngineeringContract? Engineering { get; init; }
}

[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed class PreEngineeredContract
{
  public required string Symbol { get; init; }
  public required string Blueprint { get; init; }
  public int Grade { get; init; }
  public required string Acquisition { get; init; }
  public string? Experimental { get; init; }
}

[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed class EngineeringContract
{
  public string? Blueprint { get; init; }
  public int Grade { get; init; }
  public double Quality { get; init; }
  public string? Experimental { get; init; }
}

[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed class EquipmentLoadoutContract
{
  public required string Format { get; init; }
  public int Version { get; init; }
  public required string SuitFamily { get; init; }
  public int SuitGrade { get; init; }
  public required IReadOnlyList<string?> SuitModifications { get; init; }
  public required IReadOnlyList<WeaponContract?> Weapons { get; init; }
}

[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed class WeaponContract
{
  public required string Symbol { get; init; }
  public int Grade { get; init; }
  public required IReadOnlyList<string?> Modifications { get; init; }
}

/// <summary>
/// The package-produced ship model the fleet service stores, and nothing
/// beside it. The roll quality an ordinary engineering block carries is absent
/// on purpose: an owned ship states a completed grade, and 020/FR-015 excludes
/// the quality figure from fleet storage.
/// </summary>
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed class OwnedShipPayloadContract
{
  public required string HullSymbol { get; init; }
  public string? ShipName { get; init; }
  public string? ShipIdent { get; init; }
  public required IReadOnlyList<OwnedShipModuleContract> Modules { get; init; }
}

[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed class OwnedShipModuleContract
{
  public required string Slot { get; init; }
  public required string Symbol { get; init; }
  public bool? Enabled { get; init; }
  public int? Priority { get; init; }
  public PreEngineeredContract? PreEngineered { get; init; }
  public OwnedShipEngineeringContract? Engineering { get; init; }
}

[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed class OwnedShipEngineeringContract
{
  public string? Blueprint { get; init; }
  public int Grade { get; init; }
  public string? Experimental { get; init; }
}
