using NavBeacon.Server.Fleet;

namespace NavBeacon.Server.UnitTests;

public sealed class JournalFramerTests
{
  private const string LiveHeader =
    """{"timestamp":"2026-09-10T09:00:00Z","event":"Fileheader","gameversion":"4.1.2.0","Odyssey":true}""";
  private const string LegacyHeader =
    """{"timestamp":"2026-09-10T09:00:00Z","event":"Fileheader","gameversion":"3.8.0.0","Odyssey":false}""";
  private const string Loadout =
    """{"timestamp":"2026-09-10T10:00:00Z","event":"Loadout","Ship":"anaconda","ShipID":12,"Modules":[]}""";

  [Fact]
  public void EachLineCarriesItsZeroBasedIndexAndKind()
  {
    var lines = Frame(
      LiveHeader,
      """{"timestamp":"2026-09-10T09:30:00Z","event":"Docked","StationName":"Jameson"}""",
      Loadout
    );

    Assert.Equal([0, 1, 2], lines.Select(line => line.Index));
    Assert.Equal(
      [JournalLineKind.Ignored, JournalLineKind.Ignored, JournalLineKind.Loadout],
      lines.Select(line => line.Kind)
    );
    Assert.Equal(12, lines[2].ShipId);
    Assert.Equal(Loadout, lines[2].Text);
    Assert.All(lines, line => Assert.Equal(JournalLineStatus.Framed, line.Status));
  }

  [Fact]
  public void AnEmptyLineIsFramedAndCounted()
  {
    var lines = Frame("", Loadout);

    Assert.Equal(JournalLineKind.Ignored, lines[0].Kind);
    Assert.Equal(JournalLineStatus.Framed, lines[0].Status);
    Assert.Equal(1, lines[1].Index);
  }

  [Theory]
  [InlineData("not json")]
  [InlineData("{\"event\":\"Loadout\"")]
  [InlineData("[]")]
  [InlineData("{\"event\":\"Loadout\"}")]
  [InlineData("{\"timestamp\":\"2026-09-10T10:00:00Z\"}")]
  [InlineData("{\"timestamp\":1,\"event\":\"Loadout\"}")]
  public void AMalformedLineStopsTheReader(string line)
  {
    var framed = Frame(Loadout, line, Loadout);

    Assert.Equal(JournalLineStatus.Framed, framed[0].Status);
    Assert.Equal(JournalLineStatus.Malformed, framed[1].Status);
    Assert.Equal(1, framed[1].Index);
  }

  [Fact]
  public void AnUnknownEventIsFramedAndIgnored()
  {
    var lines = Frame(
      """{"timestamp":"2026-09-10T10:00:00Z","event":"SomethingNew","Value":12}"""
    );

    Assert.Equal(JournalLineKind.Ignored, Assert.Single(lines).Kind);
  }

  [Fact]
  public void AnEventUnderALegacyHeaderIsNotACandidate()
  {
    var lines = Frame(LegacyHeader, Loadout, LiveHeader, Loadout);

    Assert.Equal(JournalLineKind.Ignored, lines[1].Kind);
    Assert.Equal(JournalLineKind.Loadout, lines[3].Kind);
  }

  [Fact]
  public void AHeaderThatStatesNoGameIsReadAsLive()
  {
    var lines = Frame(
      """{"timestamp":"2026-09-10T09:00:00Z","event":"Fileheader","part":1}""",
      Loadout
    );

    Assert.Equal(JournalLineKind.Loadout, lines[1].Kind);
  }

  [Fact]
  public void AHeaderThatDeniesOdysseyIsNotLive()
  {
    var lines = Frame(
      """{"timestamp":"2026-09-10T09:00:00Z","event":"Fileheader","Odyssey":false}""",
      Loadout
    );

    Assert.Equal(JournalLineKind.Ignored, lines[1].Kind);
  }

  [Fact]
  public void ALoadoutWithoutAShipIdentityIsNotACandidate()
  {
    var lines = Frame(
      """{"timestamp":"2026-09-10T10:00:00Z","event":"Loadout","Ship":"anaconda","Modules":[]}"""
    );

    Assert.Equal(JournalLineKind.Ignored, Assert.Single(lines).Kind);
  }

  [Fact]
  public void AShipSaleCarriesTheSoldIdentity()
  {
    var lines = Frame(
      """{"timestamp":"2026-09-10T11:00:00Z","event":"ShipyardSell","ShipType":"anaconda","SellShipID":12,"ShipPrice":146969451}"""
    );

    var line = Assert.Single(lines);
    Assert.Equal(JournalLineKind.ShipSale, line.Kind);
    Assert.Equal(12, line.ShipId);
  }

  [Fact]
  public void AStoredShipsEventCarriesEveryIdentityItLists()
  {
    var lines = Frame(
      """{"timestamp":"2026-09-10T11:00:00Z","event":"StoredShips","StationName":"Jameson","ShipsHere":[{"ShipID":12,"ShipType":"anaconda"}],"ShipsRemote":[{"ShipID":13},{"ShipType":"eagle"}]}"""
    );

    var line = Assert.Single(lines);
    Assert.Equal(JournalLineKind.StoredShips, line.Kind);
    Assert.Equal([12L, 13L], line.StoredShipIds);
  }

  [Fact]
  public void ALineOf1MiBIsAccepted()
  {
    var line = Filled(FleetLimits.MaximumLineBytes);

    var framed = Assert.Single(Frame(line));

    Assert.Equal(JournalLineStatus.Framed, framed.Status);
    Assert.Equal(JournalLineKind.Ignored, framed.Kind);
  }

  [Fact]
  public void ALineOneByteOver1MiBStopsTheReader()
  {
    var framed = Assert.Single(Frame(Filled(FleetLimits.MaximumLineBytes + 1)));

    Assert.Equal(JournalLineStatus.TooLarge, framed.Status);
    Assert.Equal(string.Empty, framed.Text);
  }

  [Fact]
  public void AMultiByteLineIsMeasuredInBytes()
  {
    var padding = new string('ä', FleetLimits.MaximumLineBytes / 2);
    var framed = Assert.Single(
      Frame($$"""{"timestamp":"2026-09-10T10:00:00Z","event":"Note","Text":"{{padding}}"}""")
    );

    Assert.Equal(JournalLineStatus.TooLarge, framed.Status);
  }

  [Fact]
  public void CarriageReturnsAreNotPartOfALine()
  {
    using var reader = new StringReader($"{Loadout}\r\n");
    var framed = new JournalFramer(reader).Read();

    Assert.NotNull(framed);
    Assert.Equal(Loadout, framed.Text);
  }

  /// <summary>A line whose padding fills it to exactly the stated byte count.</summary>
  private static string Filled(int bytes)
  {
    const string prefix = """{"timestamp":"2026-09-10T10:00:00Z","event":"Note","Text":" """;
    var head = prefix.TrimEnd();
    const string tail = "\"}";
    return head + new string('x', bytes - head.Length - tail.Length) + tail;
  }

  private static List<FramedJournalLine> Frame(params string[] lines)
  {
    using var reader = new StringReader(string.Join('\n', lines));
    var framer = new JournalFramer(reader);
    var framed = new List<FramedJournalLine>();
    while (framer.Read() is FramedJournalLine line)
    {
      framed.Add(line);
    }
    return framed;
  }
}
