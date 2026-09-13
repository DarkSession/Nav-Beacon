using System.Text.Json;
using System.Text;
using NavBeacon.Server.Contracts;

namespace NavBeacon.Server.UnitTests;

public sealed class RemoteContractJsonTests
{
  [Fact]
  public void Exact_ship_record_is_accepted()
  {
    using var document = JsonDocument.Parse(ShipRecordJson());

    var record = Assert.IsType<RemoteShipRecordContract>(
      RemoteContractJson.ParseRecord(document.RootElement)
    );

    Assert.Equal("SideWinder", record.Build.ShipSymbol);
  }

  [Fact]
  public void Record_at_64_KiB_is_accepted_and_one_byte_more_is_refused()
  {
    var json = Encoding.UTF8.GetBytes(ShipRecordJson());
    var accepted = json
      .Concat(Enumerable.Repeat((byte)' ', RemoteContractJson.MaximumRecordBytes - json.Length))
      .ToArray();
    var refused = accepted.Append((byte)' ').ToArray();

    Assert.IsType<RemoteShipRecordContract>(RemoteContractJson.ParseRecord(accepted));
    Assert.Throws<JsonException>(() => RemoteContractJson.ParseRecord(refused));
  }

  [Fact]
  public void Exact_equipment_record_and_nested_values_are_accepted()
  {
    using var document = JsonDocument.Parse(
      """
      {
        "format":"ednb.remote-record",
        "version":1,
        "id":"8abfd536-4f44-48f0-a72f-f93e85073a0c",
        "tool":"equipment",
        "kind":"named",
        "name":"Ground loadout",
        "createdAt":"2026-09-11T12:00:00Z",
        "modifiedAt":"2026-09-11T13:00:00Z",
        "loadout":{
          "format":"ednb.loadout",
          "version":1,
          "suitFamily":"utilitysuit",
          "suitGrade":3,
          "suitModifications":[null,null,null,null],
          "weapons":[{
            "symbol":"wpn_m_rifle_kinetic_fauto",
            "grade":2,
            "modifications":[null,null,null,null]
          },null,null]
        }
      }
      """
    );

    var record = Assert.IsType<RemoteEquipmentRecordContract>(
      RemoteContractJson.ParseRecord(document.RootElement)
    );

    Assert.Equal(RemoteContractConstants.RecordFormat, record.Format);
    Assert.Equal(RemoteContractConstants.RecordVersion, record.Version);
    Assert.NotEqual(Guid.Empty, record.Id);
    Assert.Equal("equipment", record.Tool);
    Assert.Equal("named", record.Kind);
    Assert.Equal("Ground loadout", record.Name);
    Assert.NotEqual(default, record.CreatedAt);
    Assert.NotEqual(default, record.ModifiedAt);
    Assert.Equal(RemoteContractConstants.LoadoutFormat, record.Loadout.Format);
    Assert.Equal(RemoteContractConstants.LoadoutVersion, record.Loadout.Version);
    Assert.Equal("utilitysuit", record.Loadout.SuitFamily);
    Assert.Equal(3, record.Loadout.SuitGrade);
    Assert.Equal(4, record.Loadout.SuitModifications.Count);
    var weapon = Assert.IsType<WeaponContract>(record.Loadout.Weapons[0]);
    Assert.Equal("wpn_m_rifle_kinetic_fauto", weapon.Symbol);
    Assert.Equal(2, weapon.Grade);
    Assert.Equal(4, weapon.Modifications.Count);
  }

  [Theory]
  [InlineData("{}")]
  [InlineData("{\"tool\":\"other\"}")]
  public void Missing_or_unknown_record_tool_is_rejected(string json)
  {
    using var document = JsonDocument.Parse(json);

    Assert.Throws<JsonException>(() => RemoteContractJson.ParseRecord(document.RootElement));
  }

  [Theory]
  [InlineData("\"format\":\"wrong\"")]
  [InlineData("\"version\":2")]
  [InlineData("\"id\":\"00000000-0000-0000-0000-000000000000\"")]
  [InlineData("\"kind\":\"other\"")]
  [InlineData("\"format\":\"ednb.remote-record\"")]
  public void Invalid_equipment_envelope_is_rejected(string replacement)
  {
    var original = replacement.StartsWith("\"format\"", StringComparison.Ordinal)
      ? "\"format\":\"ednb.remote-record\""
      : replacement.StartsWith("\"version\"", StringComparison.Ordinal)
        ? "\"version\":1"
        : replacement.StartsWith("\"id\"", StringComparison.Ordinal)
          ? "\"id\":\"8abfd536-4f44-48f0-a72f-f93e85073a0c\""
          : "\"kind\":\"named\"";
    var json = EquipmentRecordJson().Replace(original, replacement, StringComparison.Ordinal);
    if (replacement == "\"format\":\"ednb.remote-record\"")
    {
      json = json.Replace("\"format\":\"ednb.loadout\"", "\"format\":\"wrong\"", StringComparison.Ordinal);
    }
    using var document = JsonDocument.Parse(json);

    Assert.Throws<JsonException>(() => RemoteContractJson.ParseRecord(document.RootElement));
  }

  [Theory]
  [InlineData("note")]
  [InlineData("sourceNamed")]
  [InlineData("revisionId")]
  [InlineData("deviceClaim")]
  [InlineData("hullSymbol")]
  [InlineData("validation")]
  [InlineData("price")]
  public void Excluded_ship_record_field_is_rejected(string field)
  {
    using var document = JsonDocument.Parse(ShipRecordJson(field));

    Assert.Throws<JsonException>(() => RemoteContractJson.ParseRecord(document.RootElement));
  }

  [Fact]
  public void Unknown_nested_build_field_is_rejected()
  {
    var json = ShipRecordJson().Replace(
      "\"shipSymbol\":\"SideWinder\"",
      "\"shipSymbol\":\"SideWinder\",\"rebuy\":0",
      StringComparison.Ordinal
    );
    using var document = JsonDocument.Parse(json);

    Assert.Throws<JsonException>(() => RemoteContractJson.ParseRecord(document.RootElement));
  }

  [Fact]
  public void Tombstone_accepts_only_identity_and_revision()
  {
    using var accepted = JsonDocument.Parse(
      "{\"id\":\"9abfd536-4f44-48f0-a72f-f93e85073a0c\",\"revision\":3}"
    );
    using var refused = JsonDocument.Parse(
      "{\"id\":\"9abfd536-4f44-48f0-a72f-f93e85073a0c\",\"revision\":3,\"name\":\"retained\"}"
    );

    Assert.Equal(3, RemoteContractJson.ParseTombstone(accepted.RootElement).Revision);
    Assert.Throws<JsonException>(() => RemoteContractJson.ParseTombstone(refused.RootElement));
  }

  [Fact]
  public void Owned_ship_rejects_an_excluded_field()
  {
    using var document = JsonDocument.Parse(
      """
      {
        "hullSymbol":"SideWinder",
        "shipName":null,
        "shipIdent":null,
        "modules":[],
        "hullValue":32000
      }
      """
    );

    Assert.Throws<JsonException>(() => RemoteContractJson.ParseOwnedShip(document.RootElement));
  }

  [Fact]
  public void Exact_owned_ship_and_nested_module_values_are_accepted()
  {
    using var document = JsonDocument.Parse(
      """
      {
        "hullSymbol":"SideWinder",
        "shipName":"Test ship",
        "shipIdent":"TS-1",
        "modules":[{
          "slot":"FrameShiftDrive",
          "symbol":"Int_Hyperdrive_Size2_Class1",
          "enabled":true,
          "priority":0,
          "preEngineered":{
            "symbol":"Int_Hyperdrive_Size2_Class1",
            "blueprint":"FSD_LongRange",
            "grade":1,
            "acquisition":"reward",
            "experimental":null
          },
          "engineering":{
            "blueprint":"FSD_LongRange",
            "grade":1,
            "experimental":null
          }
        }]
      }
      """
    );

    var ship = RemoteContractJson.ParseOwnedShip(document.RootElement);
    var module = Assert.Single(ship.Modules);

    Assert.Equal("SideWinder", ship.HullSymbol);
    Assert.Equal("Test ship", ship.ShipName);
    Assert.Equal("TS-1", ship.ShipIdent);
    Assert.Equal("FrameShiftDrive", module.Slot);
    Assert.Equal("Int_Hyperdrive_Size2_Class1", module.Symbol);
    Assert.True(module.Enabled);
    Assert.Equal(0, module.Priority);
    Assert.Equal("reward", module.PreEngineered?.Acquisition);
    Assert.Equal("FSD_LongRange", module.PreEngineered?.Blueprint);
    Assert.Equal(1, module.PreEngineered?.Grade);
    Assert.Equal("Int_Hyperdrive_Size2_Class1", module.PreEngineered?.Symbol);
    Assert.Null(module.PreEngineered?.Experimental);
    Assert.Equal("FSD_LongRange", module.Engineering?.Blueprint);
    Assert.Equal(1, module.Engineering?.Grade);
    Assert.Null(module.Engineering?.Experimental);
  }

  [Fact]
  public void Owned_ship_rejects_the_engineering_quality_020_FR_015_excludes()
  {
    using var document = JsonDocument.Parse(
      """
      {
        "hullSymbol":"SideWinder",
        "shipName":null,
        "shipIdent":null,
        "modules":[{
          "slot":"FrameShiftDrive",
          "symbol":"Int_Hyperdrive_Size2_Class1",
          "enabled":true,
          "priority":0,
          "preEngineered":null,
          "engineering":{
            "blueprint":"FSD_LongRange",
            "grade":1,
            "quality":1,
            "experimental":null
          }
        }]
      }
      """
    );

    Assert.Throws<JsonException>(() => RemoteContractJson.ParseOwnedShip(document.RootElement));
  }

  [Fact]
  public void Owned_ship_requires_a_slot_and_a_module_symbol()
  {
    using var document = JsonDocument.Parse(
      """
      {
        "hullSymbol":"SideWinder",
        "shipName":null,
        "shipIdent":null,
        "modules":[{
          "slot":"",
          "symbol":"Int_Hyperdrive_Size2_Class1",
          "enabled":null,
          "priority":null,
          "preEngineered":null,
          "engineering":null
        }]
      }
      """
    );

    Assert.Throws<JsonException>(() => RemoteContractJson.ParseOwnedShip(document.RootElement));
  }

  [Fact]
  public void Owned_ship_requires_a_hull()
  {
    using var document = JsonDocument.Parse(
      "{\"hullSymbol\":\"\",\"shipName\":null,\"shipIdent\":null,\"modules\":[]}"
    );

    Assert.Throws<JsonException>(() => RemoteContractJson.ParseOwnedShip(document.RootElement));
  }

  private static string ShipRecordJson(string? extraField = null)
  {
    var extra = extraField is null ? string.Empty : $",\"{extraField}\":null";
    return $$"""
      {
        "format":"ednb.remote-record",
        "version":1,
        "id":"9abfd536-4f44-48f0-a72f-f93e85073a0c",
        "tool":"ship",
        "kind":"working",
        "createdAt":"2026-09-11T12:00:00Z",
        "modifiedAt":"2026-09-11T12:00:00Z",
        "build":{
          "format":"ednb.build",
          "version":1,
          "shipSymbol":"SideWinder",
          "shipName":null,
          "shipIdent":null,
          "modules":[]
        }{{extra}}
      }
      """;
  }

  private static string EquipmentRecordJson() =>
    """
    {
      "format":"ednb.remote-record",
      "version":1,
      "id":"8abfd536-4f44-48f0-a72f-f93e85073a0c",
      "tool":"equipment",
      "kind":"named",
      "name":"Ground loadout",
      "createdAt":"2026-09-11T12:00:00Z",
      "modifiedAt":"2026-09-11T13:00:00Z",
      "loadout":{
        "format":"ednb.loadout",
        "version":1,
        "suitFamily":"utilitysuit",
        "suitGrade":3,
        "suitModifications":[null,null,null,null],
        "weapons":[null,null,null]
      }
    }
    """;
}
