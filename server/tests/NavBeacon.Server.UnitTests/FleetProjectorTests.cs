using System.Text.Json;
using Microsoft.Extensions.FileProviders;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Options;
using NavBeacon.Server.Fleet;

namespace NavBeacon.Server.UnitTests;

/// <summary>
/// The journal mode of the one Node command, through the projector that runs it.
/// The accepted cases run the published bundle, so what a fleet stores is what
/// the package produced rather than what a stand-in said it would.
/// </summary>
public sealed class FleetProjectorTests
{
  private static readonly DateOnly Date = new(2026, 9, 10);

  private const string Anaconda =
    """{"timestamp":"2026-09-10T10:00:00Z","event":"Loadout","Ship":"anaconda","ShipID":12,"ShipName":"Night Watch","ShipIdent":"NW-01","HullValue":146969451,"Rebuy":7348472,"CargoCapacity":64,"Hot":false,"Modules":[{"Slot":"PowerPlant","Item":"Int_Powerplant_Size8_Class5","On":true,"Priority":0,"Health":0.964,"Value":57931}]}""";

  private const string EngineeredSidewinder =
    """{"timestamp":"2026-09-10T11:00:00Z","event":"Loadout","Ship":"sidewinder","ShipID":13,"Modules":[{"Slot":"FrameShiftDrive","Item":"Int_Hyperdrive_Size2_Class1","On":true,"Priority":1,"Engineering":{"Engineer":"Felicity Farseer","EngineerID":300100,"BlueprintID":128673694,"BlueprintName":"FSD_LongRange","Level":5,"Quality":0.82,"ExperimentalEffect":"special_fsd_heavy","Modifiers":[{"Label":"FSDOptimalMass","Value":1000,"OriginalValue":900,"LessIsGood":0}]}}]}""";

  private const string UnknownModule =
    """{"timestamp":"2026-09-10T12:00:00Z","event":"Loadout","Ship":"anaconda","ShipID":14,"Modules":[{"Slot":"PowerPlant","Item":"Int_Powerplant_Size8_Class99"}]}""";

  private const string UnreadableLoadout =
    """{"timestamp":"2026-09-10T12:00:00Z","event":"Loadout","Ship":"anaconda","ShipID":15,"Modules":[{"Slot":5,"Item":"Int_Powerplant_Size8_Class5"}]}""";

  [Fact]
  public async Task ACandidateBecomesTheModelTheFleetStores()
  {
    var result = await Published().ProjectAsync([Candidate(12, 4, Anaconda)], "en", default);

    Assert.Equal(ProjectionOutcome.Projected, result.Outcome);
    var ship = Assert.Single(result.Ships);
    Assert.Equal(12, ship.ShipId);
    Assert.Equal(Date, ship.Date);
    Assert.Equal(4, ship.Line);
    using var model = JsonDocument.Parse(ship.ModelJson);
    var root = model.RootElement;
    Assert.Equal("anaconda", root.GetProperty("hullSymbol").GetString());
    Assert.Equal("Night Watch", root.GetProperty("shipName").GetString());
    Assert.Equal("NW-01", root.GetProperty("shipIdent").GetString());
    Assert.Equal(
      ["hullSymbol", "shipName", "shipIdent", "modules"],
      root.EnumerateObject().Select(property => property.Name)
    );
  }

  [Fact]
  public async Task AProjectedModelCarriesNoExcludedField()
  {
    var result = await Published().ProjectAsync([Candidate(12, 4, Anaconda)], "en", default);

    var ship = Assert.Single(result.Ships);
    using var model = JsonDocument.Parse(ship.ModelJson);

    foreach (var module in model.RootElement.GetProperty("modules").EnumerateArray())
    {
      Assert.Equal(
        ["slot", "symbol", "enabled", "priority", "preEngineered", "engineering"],
        module.EnumerateObject().Select(property => property.Name)
      );
    }
    foreach (
      var excluded in (string[])
        [
          "hullValue",
          "modulesValue",
          "rebuy",
          "cargoCapacity",
          "unladenMass",
          "maxJumpRange",
          "fuelCapacity",
          "hot",
          "health",
          "ammo",
          "engineer",
          "blueprintID",
          "quality",
          "modifiers",
          "timestamp",
          "event",
        ]
    )
    {
      Assert.DoesNotContain(
        $"\"{excluded}\"",
        ship.ModelJson,
        StringComparison.OrdinalIgnoreCase
      );
    }
  }

  [Fact]
  public async Task ModuleEngineeringKeepsItsIdentityAndGradeOnly()
  {
    var result = await Published()
      .ProjectAsync([Candidate(13, 1, EngineeredSidewinder)], "en", default);

    var ship = Assert.Single(result.Ships);
    using var model = JsonDocument.Parse(ship.ModelJson);
    var drive = model
      .RootElement.GetProperty("modules")
      .EnumerateArray()
      .Single(module => module.GetProperty("slot").GetString() == "FrameShiftDrive");
    var engineering = drive.GetProperty("engineering");
    Assert.Equal("FSD_LongRange", engineering.GetProperty("blueprint").GetString());
    Assert.Equal(5, engineering.GetProperty("grade").GetInt32());
    Assert.Equal("special_fsd_heavy", engineering.GetProperty("experimental").GetString());
    Assert.Equal(
      ["blueprint", "grade", "experimental"],
      engineering.EnumerateObject().Select(property => property.Name)
    );
    Assert.True(drive.GetProperty("enabled").GetBoolean());
    Assert.Equal(1, drive.GetProperty("priority").GetInt32());
  }

  [Fact]
  public async Task APackageRefusalNamesTheLineAndKeepsTheAcceptedPrefix()
  {
    var result = await Published()
      .ProjectAsync(
        [Candidate(12, 4, Anaconda), Candidate(14, 5, UnknownModule)],
        "en",
        default
      );

    Assert.Equal(ProjectionOutcome.Refused, result.Outcome);
    Assert.Equal(1, result.RefusedIndex);
    Assert.Equal(12, Assert.Single(result.Ships).ShipId);
    Assert.Equal("unknown-identity", result.Refusal?.Code);
  }

  [Fact]
  public async Task APackageDiagnosticComesBackInTheRequestedLocale()
  {
    var english = await Published()
      .ProjectAsync([Candidate(15, 6, UnreadableLoadout)], "en", default);
    var german = await Published()
      .ProjectAsync([Candidate(15, 6, UnreadableLoadout)], "de", default);

    Assert.Equal("invalidModule", english.Refusal?.Code);
    Assert.Equal("invalidModule", german.Refusal?.Code);
    Assert.False(string.IsNullOrWhiteSpace(english.Refusal?.Message));
    // The package publishes no German text for this diagnostic, and that
    // absence travels rather than becoming a translation of this application's.
    Assert.Null(german.Refusal?.Message);
    Assert.Equal(english.Refusal?.Path, german.Refusal?.Path);
  }

  [Fact]
  public async Task ABatchOf100CandidatesIsProjected()
  {
    var candidates = Enumerable
      .Range(0, FleetLimits.MaximumBatchLines)
      .Select(index => Candidate(100 + index, index, Loadout(100 + index)))
      .ToList();

    var result = await Published().ProjectAsync(candidates, "en", default);

    Assert.Equal(ProjectionOutcome.Projected, result.Outcome);
    Assert.Equal(FleetLimits.MaximumBatchLines, result.Ships.Count);
  }

  [Fact]
  public async Task AProcessPastItsDeadlineIsUnavailable()
  {
    var result = await Fixture(TimeSpan.FromMilliseconds(100))
      .ProjectAsync([Candidate(12, 0, Anaconda)], "timeout", default);

    Assert.Equal(ProjectionOutcome.Unavailable, result.Outcome);
  }

  [Fact]
  public async Task OutputAt4MiBIsAccepted()
  {
    var result = await Fixture().ProjectAsync([Candidate(12, 0, Anaconda)], "exact", default);

    Assert.Equal(ProjectionOutcome.Refused, result.Outcome);
  }

  [Fact]
  public async Task OutputOneByteOver4MiBIsUnavailable()
  {
    var result = await Fixture().ProjectAsync([Candidate(12, 0, Anaconda)], "flood", default);

    Assert.Equal(ProjectionOutcome.Unavailable, result.Outcome);
  }

  [Theory]
  [InlineData("garbage")]
  [InlineData("crash")]
  [InlineData("short")]
  [InlineData("silent")]
  public async Task AnAnswerTheCallerCannotReadIsUnavailable(string answer)
  {
    var result = await Fixture().ProjectAsync([Candidate(12, 0, Anaconda)], answer, default);

    Assert.Equal(ProjectionOutcome.Unavailable, result.Outcome);
  }

  [Fact]
  public async Task AMissingCommandIsUnavailable()
  {
    var projector = new FleetProjector(
      Options.Create(
        new FleetProjectionOptions
        {
          Command = "a-command-that-does-not-exist",
          ScriptPath = FixturePath,
        }
      ),
      new TestEnvironment()
    );

    var result = await projector.ProjectAsync([Candidate(12, 0, Anaconda)], "en", default);

    Assert.Equal(ProjectionOutcome.Unavailable, result.Outcome);
  }

  private static string Loadout(long shipId) =>
    $$"""{"timestamp":"2026-09-10T10:00:00Z","event":"Loadout","Ship":"sidewinder","ShipID":{{shipId}},"Modules":[]}""";

  private static ProjectionCandidate Candidate(long shipId, int line, string text) =>
    new(shipId, Date, line, text);

  private static FleetProjector Published() =>
    new(
      Options.Create(new FleetProjectionOptions { ScriptPath = PublishedBundle }),
      new TestEnvironment()
    );

  private static FleetProjector Fixture(TimeSpan? timeout = null) =>
    new(
      Options.Create(
        new FleetProjectionOptions
        {
          ScriptPath = FixturePath,
          TimeoutSeconds = (int)(timeout ?? FleetLimits.ProjectionTimeout).TotalSeconds,
        }
      ),
      new TestEnvironment()
    );

  private static string PublishedBundle =>
    Path.GetFullPath(
      Path.Combine(
        AppContext.BaseDirectory,
        "..",
        "..",
        "..",
        "..",
        "..",
        "validator",
        "dist",
        "commander-validator.mjs"
      )
    );

  private static string FixturePath =>
    Path.Combine(AppContext.BaseDirectory, "Fixtures", "projection-process.mjs");

  private sealed class TestEnvironment : IHostEnvironment
  {
    public string ApplicationName { get; set; } = "tests";

    public IFileProvider ContentRootFileProvider { get; set; } =
      new NullFileProvider();

    public string ContentRootPath { get; set; } = AppContext.BaseDirectory;

    public string EnvironmentName { get; set; } = "Test";
  }
}
