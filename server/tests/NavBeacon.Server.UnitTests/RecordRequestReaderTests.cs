using System.Text;
using NavBeacon.Server.Records;

namespace NavBeacon.Server.UnitTests;

public sealed class RecordRequestReaderTests
{
  private const string Ship = """
    {
      "format": "ednb.remote-record",
      "version": 1,
      "id": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      "tool": "ship",
      "kind": "working",
      "createdAt": "2026-09-11T12:00:00.000Z",
      "modifiedAt": "2026-09-11T12:00:00.000Z",
      "build": {
        "format": "ednb.build",
        "version": 1,
        "shipSymbol": "SideWinder",
        "shipName": null,
        "shipIdent": null,
        "modules": []
      }
    }
    """;

  [Fact]
  public void Published_bounds_are_exact()
  {
    Assert.Equal(100, RecordSynchronisationLimits.MaximumChanges);
    Assert.Equal(1_048_576, RecordSynchronisationLimits.MaximumRequestBytes);
    Assert.Equal(65_536, RecordSynchronisationLimits.MaximumRecordBytes);
  }

  [Fact]
  public void A_pull_request_carries_its_cursor_and_no_change()
  {
    var read = Read("""{"sinceRevision":12,"changes":[]}""");

    Assert.Null(read.Code);
    Assert.Equal(12, read.Request!.SinceRevision);
    Assert.Empty(read.Request.Changes);
  }

  [Fact]
  public void Each_change_kind_is_read()
  {
    var read = Read(
      $$"""
      {
        "sinceRevision": 0,
        "changes": [
          { "type": "write", "record": {{Ship}} },
          { "type": "delete", "id": "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "baseRevision": 4 },
          { "type": "renew", "id": "cccccccc-cccc-4ccc-8ccc-cccccccccccc" }
        ]
      }
      """
    );

    Assert.Null(read.Code);
    var changes = read.Request!.Changes;
    Assert.Equal(RecordChangeKind.Write, changes[0].Kind);
    Assert.Equal(Guid.Parse("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"), changes[0].RecordId);
    Assert.Equal(0, changes[0].ExpectedRevision);
    Assert.Equal("working", changes[0].RecordKind);
    Assert.Equal(RecordChangeKind.Delete, changes[1].Kind);
    Assert.Equal(4, changes[1].ExpectedRevision);
    Assert.Equal(RecordChangeKind.Renew, changes[2].Kind);
  }

  [Fact]
  public void An_absent_and_a_zero_base_revision_both_expect_no_record()
  {
    var absent = Read($$"""{"sinceRevision":0,"changes":[{"type":"write","record":{{Ship}}}]}""");
    var zero = Read(
      $$"""{"sinceRevision":0,"changes":[{"type":"write","record":{{Ship}},"baseRevision":0}]}"""
    );

    Assert.Equal(0, absent.Request!.Changes[0].ExpectedRevision);
    Assert.Equal(0, zero.Request!.Changes[0].ExpectedRevision);
  }

  [Theory]
  [InlineData("not json at all")]
  [InlineData("""[]""")]
  [InlineData("""{"sinceRevision":0}""")]
  [InlineData("""{"changes":[]}""")]
  [InlineData("""{"sinceRevision":-1,"changes":[]}""")]
  [InlineData("""{"sinceRevision":0,"changes":[],"extra":1}""")]
  [InlineData("""{"sinceRevision":0,"changes":{}}""")]
  [InlineData("""{"sinceRevision":0,"changes":[{"type":"unknown","id":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"}]}""")]
  [InlineData("""{"sinceRevision":0,"changes":[{"type":"delete","id":"not-a-uuid"}]}""")]
  [InlineData("""{"sinceRevision":0,"changes":[{"type":"delete","id":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb","extra":1}]}""")]
  [InlineData("""{"sinceRevision":0,"changes":[{"type":"renew","id":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb","baseRevision":1}]}""")]
  [InlineData("""{"sinceRevision":0,"changes":[{"type":"delete","id":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb","baseRevision":-1}]}""")]
  [InlineData("""{"sinceRevision":0,"changes":[{"type":"write","record":"text"}]}""")]
  public void An_unreadable_request_is_refused(string body)
  {
    var read = Read(body);

    Assert.Null(read.Request);
    Assert.Equal("invalid-request", read.Code);
  }

  [Fact]
  public void One_record_named_twice_is_refused()
  {
    var read = Read(
      $$"""
      {
        "sinceRevision": 0,
        "changes": [
          { "type": "write", "record": {{Ship}} },
          { "type": "delete", "id": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }
        ]
      }
      """
    );

    Assert.Equal("invalid-request", read.Code);
    Assert.Equal(1, read.Index);
    Assert.Equal(2, read.ChangeCount);
  }

  [Fact]
  public void More_than_a_hundred_changes_are_refused()
  {
    var changes = string.Join(
      ',',
      Enumerable
        .Range(0, 101)
        .Select(index =>
          $$"""{"type":"renew","id":"{{index:x8}}-bbbb-4bbb-8bbb-bbbbbbbbbbbb"}"""
        )
    );

    var read = Read($$"""{"sinceRevision":0,"changes":[{{changes}}]}""");

    Assert.Equal("too-many-changes", read.Code);
    Assert.Equal(101, read.ChangeCount);
  }

  [Fact]
  public void A_hundred_changes_are_accepted()
  {
    var changes = string.Join(
      ',',
      Enumerable
        .Range(0, 100)
        .Select(index =>
          $$"""{"type":"renew","id":"{{index:x8}}-bbbb-4bbb-8bbb-bbbbbbbbbbbb"}"""
        )
    );

    var read = Read($$"""{"sinceRevision":0,"changes":[{{changes}}]}""");

    Assert.Null(read.Code);
    Assert.Equal(100, read.Request!.Changes.Count);
  }

  [Fact]
  public void A_body_over_one_mebibyte_is_refused_and_the_bound_itself_is_read()
  {
    var atBound = Padded(RecordSynchronisationLimits.MaximumRequestBytes);
    var overBound = Padded(RecordSynchronisationLimits.MaximumRequestBytes + 1);

    Assert.Equal(1_048_576, Encoding.UTF8.GetByteCount(atBound));
    Assert.Null(Read(atBound).Code);
    Assert.Equal(1_048_577, Encoding.UTF8.GetByteCount(overBound));
    Assert.Equal("request-too-large", Read(overBound).Code);
  }

  [Fact]
  public void A_record_over_sixty_four_kibibytes_is_refused_and_the_bound_itself_is_read()
  {
    var atBound = PaddedRecord(RecordSynchronisationLimits.MaximumRecordBytes);
    var overBound = PaddedRecord(RecordSynchronisationLimits.MaximumRecordBytes + 1);

    Assert.Null(Read($$"""{"sinceRevision":0,"changes":[{"type":"write","record":{{atBound}}}]}""").Code);
    var refused = Read(
      $$"""{"sinceRevision":0,"changes":[{"type":"write","record":{{overBound}}}]}"""
    );
    Assert.Equal("record-too-large", refused.Code);
    Assert.Equal(0, refused.Index);
  }

  [Theory]
  [InlineData("\"format\": \"ednb.remote-record\"", "\"format\": \"ednb.other\"")]
  [InlineData("\"version\": 1", "\"version\": 2")]
  public void An_unsupported_record_version_is_refused(string original, string replacement)
  {
    var record = ReplaceFirst(Ship, original, replacement);

    var read = Read($$"""{"sinceRevision":0,"changes":[{"type":"write","record":{{record}}}]}""");

    Assert.Equal("unsupported-record-version", read.Code);
  }

  [Theory]
  [InlineData("\"tool\": \"ship\"", "\"tool\": \"fleet\"")]
  [InlineData("\"kind\": \"working\"", "\"kind\": \"draft\"")]
  [InlineData("\"shipSymbol\": \"SideWinder\"", "\"note\": \"kept local\", \"shipSymbol\": \"SideWinder\"")]
  [InlineData("\"modules\": []", "\"modules\": [{\"slot\":\"S\",\"symbol\":\"M\",\"enabled\":null,\"priority\":null,\"preEngineered\":null,\"engineering\":null,\"health\":1}]")]
  public void A_record_outside_the_live_contract_is_refused(string original, string replacement)
  {
    var record = Ship.Replace(original, replacement, StringComparison.Ordinal);

    var read = Read($$"""{"sinceRevision":0,"changes":[{"type":"write","record":{{record}}}]}""");

    Assert.Equal("invalid-record", read.Code);
  }

  [Fact]
  public void One_record_has_one_canonical_form()
  {
    var reordered = """
      {
        "tool": "ship",
        "kind": "working",
        "modifiedAt": "2026-09-11T14:00:00.000+02:00",
        "createdAt": "2026-09-11T12:00:00Z",
        "id": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        "version": 1,
        "format": "ednb.remote-record",
        "build": {
          "modules": [],
          "shipIdent": null,
          "shipName": null,
          "shipSymbol": "SideWinder",
          "version": 1,
          "format": "ednb.build"
        }
      }
      """;

    var first = Read($$"""{"sinceRevision":0,"changes":[{"type":"write","record":{{Ship}}}]}""");
    var second = Read(
      $$"""{"sinceRevision":0,"changes":[{"type":"write","record":{{reordered}}}]}"""
    );

    Assert.Equal(first.Request!.Changes[0].Payload, second.Request!.Changes[0].Payload);
    Assert.Contains(
      "\"modifiedAt\":\"2026-09-11T12:00:00.000Z\"",
      second.Request.Changes[0].Payload!,
      StringComparison.Ordinal
    );
  }

  /// <summary>
  /// Builds a readable request of an exact size. One record cannot carry a
  /// mebibyte, so the padding is shared between records under their own bound.
  /// </summary>
  private static string Padded(int bytes)
  {
    const int count = 17;
    var padding = new int[count];
    var deficit = bytes - Encoding.UTF8.GetByteCount(Build(padding));
    for (var index = 0; index < count; index++)
    {
      padding[index] = (deficit / count) + (index == 0 ? deficit % count : 0);
    }
    return Build(padding);
  }

  private static string Build(int[] padding)
  {
    var changes = string.Join(
      ',',
      Enumerable
        .Range(0, padding.Length)
        .Select(index =>
          $$"""{"type":"write","record":{{Identified(WithName(padding[index]), index)}}}"""
        )
    );
    return $$"""{"sinceRevision":0,"changes":[{{changes}}]}""";
  }

  private static string Identified(string record, int index) =>
    record.Replace("aaaaaaaa-aaaa", $"{index:x8}-aaaa", StringComparison.Ordinal);

  private static string ReplaceFirst(string value, string original, string replacement)
  {
    var position = value.IndexOf(original, StringComparison.Ordinal);
    return value[..position] + replacement + value[(position + original.Length)..];
  }

  private static string PaddedRecord(int bytes) =>
    WithName(bytes - Encoding.UTF8.GetByteCount(WithName(0)));

  private static string WithName(int characters) =>
    Ship.Replace(
      "\"shipName\": null",
      $"\"shipName\": \"{new string('N', characters)}\"",
      StringComparison.Ordinal
    );

  private static RecordRequestRead Read(string body) =>
    RecordRequestReader.Read(Encoding.UTF8.GetBytes(body));
}
