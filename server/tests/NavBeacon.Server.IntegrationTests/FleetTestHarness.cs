using System.Net;
using System.Text.Json.Nodes;
using Microsoft.EntityFrameworkCore;
using NavBeacon.Server.Persistence;

namespace NavBeacon.Server.IntegrationTests;

internal sealed record FleetResponse(HttpStatusCode Status, JsonObject Body)
{
  public string Result => Body["result"]!.GetValue<string>();

  public JsonArray Ships => (JsonArray)Body["ships"]!;

  public JsonObject? Coverage => Body["coverage"] as JsonObject;

  public bool Pending => Body["pending"]!.GetValue<bool>();

  public string? Failure => Body["failure"]?.GetValue<string>();

  public JsonObject? Refusal => Body["packageRefusal"] as JsonObject;

  public string? Code => Body["code"]?.GetValue<string>();

  public string CursorDate => Coverage!["cursorDate"]!.GetValue<string>();

  public int CursorLine => Coverage!["cursorLine"]!.GetValue<int>();

  public JsonObject? StoredShips => Coverage?["storedShips"] as JsonObject;

  public JsonObject Ship(long shipId) =>
    Ships
      .Cast<JsonObject>()
      .Single(ship => ship["shipId"]!.GetValue<long>() == shipId);
}

/// <summary>The journal lines the fleet tests read, in the game's own spelling.</summary>
internal static class JournalFixtures
{
  public static string Loadout(
    long shipId,
    string ship = "sidewinder",
    string timestamp = "2026-09-10T10:00:00Z",
    string? name = null,
    string? ident = null,
    string modules = "[]",
    int padding = 0
  )
  {
    var shipName = name is null ? string.Empty : $",\"ShipName\":\"{name}\"";
    var shipIdent = ident is null ? string.Empty : $",\"ShipIdent\":\"{ident}\"";
    var filler = padding == 0 ? string.Empty : $",\"Padding\":\"{new string('x', padding)}\"";
    return $"{{\"timestamp\":\"{timestamp}\",\"event\":\"Loadout\",\"Ship\":\"{ship}\","
      + $"\"ShipID\":{shipId}{shipName}{shipIdent}{filler},\"Modules\":{modules}}}";
  }

  public static string Sale(long shipId, string timestamp = "2026-09-10T11:00:00Z") =>
    $"{{\"timestamp\":\"{timestamp}\",\"event\":\"ShipyardSell\",\"ShipType\":\"sidewinder\","
    + $"\"SellShipID\":{shipId},\"ShipPrice\":32000}}";

  public static string StoredShips(
    string timestamp = "2026-09-10T12:00:00Z",
    params long[] shipIds
  )
  {
    var here = string.Join(',', shipIds.Select(id => $"{{\"ShipID\":{id}}}"));
    return $"{{\"timestamp\":\"{timestamp}\",\"event\":\"StoredShips\",\"StationName\":\"Jameson\","
      + $"\"ShipsHere\":[{here}],\"ShipsRemote\":[]}}";
  }

  public static string Other(string timestamp = "2026-09-10T09:00:00Z") =>
    $"{{\"timestamp\":\"{timestamp}\",\"event\":\"Docked\",\"StationName\":\"Jameson\"}}";
}

internal static class FleetRequests
{
  public static async Task<FleetResponse> ReadFleetAsync(this SignedInCommander commander)
  {
    using var response = await commander.Client.GetAsync("api/fleet");
    return await ReadAsync(response);
  }

  public static async Task<FleetResponse> RefreshFleetAsync(
    this SignedInCommander commander,
    string? locale = null,
    bool withToken = true
  )
  {
    using var message = new HttpRequestMessage(HttpMethod.Post, "api/fleet/refresh");
    if (withToken)
    {
      message.Headers.Add("X-CSRF-TOKEN", commander.AntiForgeryToken);
    }
    if (locale is not null)
    {
      message.Headers.Add("Accept-Language", locale);
    }
    using var response = await commander.Client.SendAsync(message);
    return await ReadAsync(response);
  }

  /// <summary>Places the account's cursor, the way an earlier refresh leaves it.</summary>
  public static async Task SeedCursorAsync(
    this PostgreSqlDatabaseFixture database,
    long customerId,
    DateOnly date,
    int line,
    DateOnly? coverageStart = null
  )
  {
    await using var context = database.CreateContext();
    var cursor = await context.JournalCursors.SingleOrDefaultAsync(entry =>
      entry.CustomerId == customerId
    );
    if (cursor is null)
    {
      context.JournalCursors.Add(
        new JournalCursor
        {
          CustomerId = customerId,
          CoverageStartDate = coverageStart ?? date,
          NextUnreadDate = date,
          NextUnreadLine = line,
        }
      );
    }
    else
    {
      cursor.NextUnreadDate = date;
      cursor.NextUnreadLine = line;
    }
    await context.SaveChangesAsync();
  }

  private static async Task<FleetResponse> ReadAsync(HttpResponseMessage response)
  {
    var text = await response.Content.ReadAsStringAsync();
    return new FleetResponse(
      response.StatusCode,
      text.Length == 0 ? [] : (JsonObject)JsonNode.Parse(text)!
    );
  }
}
