using System.Net;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace NavBeacon.Server.IntegrationTests;

/// <summary>Reads the frozen live-record contracts the server tests submit.</summary>
internal static class RecordFixtures
{
  public static JsonObject Ship(Guid? id = null, string kind = "working") =>
    Load("ship-record.json", id, kind);

  public static JsonObject Equipment(Guid? id = null, string kind = "named") =>
    Load("equipment-record.json", id, kind);

  public static JsonObject Write(JsonObject record, long? baseRevision = null)
  {
    var change = new JsonObject { ["type"] = "write", ["record"] = record };
    if (baseRevision is not null)
    {
      change["baseRevision"] = baseRevision;
    }
    return change;
  }

  public static JsonObject Delete(Guid id, long? baseRevision = null)
  {
    var change = new JsonObject { ["type"] = "delete", ["id"] = id.ToString() };
    if (baseRevision is not null)
    {
      change["baseRevision"] = baseRevision;
    }
    return change;
  }

  public static JsonObject Renew(Guid id) =>
    new() { ["type"] = "renew", ["id"] = id.ToString() };

  public static JsonObject Request(long sinceRevision, params JsonObject[] changes) =>
    new()
    {
      ["sinceRevision"] = sinceRevision,
      ["changes"] = new JsonArray([.. changes.Select(change => (JsonNode)change)]),
    };

  public static Guid IdOf(JsonObject record) => Guid.Parse(record["id"]!.GetValue<string>());

  private static JsonObject Load(string file, Guid? id, string kind)
  {
    var text = File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Fixtures", file));
    var record = (JsonObject)JsonNode.Parse(text)!;
    record["kind"] = kind;
    if (id is not null)
    {
      record["id"] = id.Value.ToString();
    }
    return record;
  }
}

internal sealed record SynchronisationResponse(HttpStatusCode Status, JsonObject Body)
{
  public string? Code => Body["code"]?.GetValue<string>();

  public long AccountRevision => Body["accountRevision"]!.GetValue<long>();

  public JsonArray Results => (JsonArray)Body["results"]!;

  public JsonArray Records => (JsonArray)Body["records"]!;

  public JsonArray Tombstones => (JsonArray)Body["tombstones"]!;

  public string Outcome(int index) => Results[index]!["outcome"]!.GetValue<string>();

  public long Revision(int index) => Results[index]!["revision"]!.GetValue<long>();

  public JsonNode? Current(int index) => Results[index]!["record"];

  public string? ResultCode(int index) => Results[index]!["code"]?.GetValue<string>();
}

/// <summary>One signed-in browser with its anti-forgery token.</summary>
internal sealed class SignedInCommander(HttpClient client, string antiForgeryToken, long customerId)
  : IDisposable
{
  public long CustomerId => customerId;

  public HttpClient Client => client;

  public string AntiForgeryToken => antiForgeryToken;

  public static async Task<SignedInCommander> SignInAsync(
    CommanderTestServer server,
    FakeFrontierClient frontier,
    long customerId,
    DateTimeOffset now
  )
  {
    frontier.Authentication = FakeFrontierClient.Identity(customerId, "Test Commander", now);
    var client = server.CreateClient();
    using var start = await client.PostAsync("api/auth/frontier", content: null);
    using var startJson = JsonDocument.Parse(await start.Content.ReadAsStringAsync());
    var location = new Uri(startJson.RootElement.GetProperty("authorisationUri").GetString()!);
    var state = CommanderTestServer.QueryValue(location, "state");
    using var callback = await client.GetAsync(
      $"api/auth/frontier/callback?code=authorisation-code&state={Uri.EscapeDataString(state)}"
    );
    Assert.Equal(HttpStatusCode.Redirect, callback.StatusCode);

    using var session = await client.GetAsync("api/session");
    Assert.Equal(HttpStatusCode.OK, session.StatusCode);
    using var sessionJson = JsonDocument.Parse(await session.Content.ReadAsStringAsync());
    return new SignedInCommander(
      client,
      sessionJson.RootElement.GetProperty("antiForgeryToken").GetString()!,
      customerId
    );
  }

  public Task<SynchronisationResponse> SynchroniseAsync(JsonObject request) =>
    SendAsync(request.ToJsonString());

  public async Task<SynchronisationResponse> SendAsync(
    string body,
    bool withToken = true,
    CancellationToken cancellationToken = default
  )
  {
    using var message = new HttpRequestMessage(HttpMethod.Post, "api/records/synchronise")
    {
      Content = new StringContent(body, Encoding.UTF8),
    };
    message.Content.Headers.ContentType = new MediaTypeHeaderValue("application/json");
    if (withToken)
    {
      message.Headers.Add("X-CSRF-TOKEN", antiForgeryToken);
    }

    using var response = await client.SendAsync(message, cancellationToken);
    var text = await response.Content.ReadAsStringAsync(cancellationToken);
    return new SynchronisationResponse(
      response.StatusCode,
      text.Length == 0 ? [] : (JsonObject)JsonNode.Parse(text)!
    );
  }

  public void Dispose() => client.Dispose();
}
