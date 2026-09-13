using System.Data.Common;
using System.Globalization;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Antiforgery;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Primitives;
using NavBeacon.Server.Accounts;
using NavBeacon.Server.Logging;

namespace NavBeacon.Server.Fleet;

public static class FleetEndpoints
{
  public const string FleetRoute = "api/fleet";
  public const string RefreshRoute = "api/fleet/refresh";

  /// <summary>
  /// The locales this application ships, in the package's own spelling.
  ///
  /// `SHIPPED_LOCALES` in `src/app/i18n/locale-registry.ts` is where a locale is
  /// added, and this list follows it. A locale in one list and not the other is
  /// a Commander reading the package's answer in English while the rest of the
  /// screen is in their own language (020/FR-016).
  /// </summary>
  private static readonly string[] SupportedLocales = ["en", "de"];

  public static IEndpointRouteBuilder MapFleetEndpoints(this IEndpointRouteBuilder endpoints)
  {
    endpoints.MapGet(FleetRoute, ReadAsync);
    endpoints.MapPost(RefreshRoute, RefreshAsync);
    return endpoints;
  }

  private static async Task<IResult> ReadAsync(
    CommanderSessionService sessions,
    FleetService fleet,
    HttpRequest request,
    HttpResponse response,
    CommanderEventLog events,
    CancellationToken cancellationToken
  )
  {
    var access = await sessions.AuthenticateAsync(
      CommanderCookies.ReadSession(request),
      cancellationToken
    );
    if (access is null)
    {
      CommanderCookies.DeleteSession(response);
      return Refusal(FleetErrorCodes.Unauthorised);
    }

    try
    {
      var state = await fleet.ReadAsync(access.CustomerId, cancellationToken);
      events.Write(CommanderEventCategory.FleetRead, Result(state), FleetRoute);
      return Body(state);
    }
    catch (Exception failure) when (failure is DbException or DbUpdateException)
    {
      events.Write(
        CommanderEventCategory.FleetRead,
        CommanderResultCode.FleetUnavailable,
        FleetRoute
      );
      return Refusal(FleetErrorCodes.FleetUnavailable);
    }
  }

  private static async Task<IResult> RefreshAsync(
    CommanderSessionService sessions,
    FleetService fleet,
    IAntiforgery antiforgery,
    HttpRequest request,
    HttpResponse response,
    CommanderEventLog events,
    CancellationToken cancellationToken
  )
  {
    try
    {
      await antiforgery.ValidateRequestAsync(request.HttpContext);
    }
    catch (AntiforgeryValidationException)
    {
      return Refusal(FleetErrorCodes.InvalidAntiForgery);
    }

    var access = await sessions.AuthenticateAsync(
      CommanderCookies.ReadSession(request),
      cancellationToken
    );
    if (access is null)
    {
      CommanderCookies.DeleteSession(response);
      return Refusal(FleetErrorCodes.Unauthorised);
    }

    try
    {
      var state = await fleet.RefreshAsync(
        access.CustomerId,
        Locale(request),
        cancellationToken
      );
      events.Write(CommanderEventCategory.FleetRefresh, Result(state), RefreshRoute);
      return Body(state);
    }
    catch (Exception failure) when (failure is DbException or DbUpdateException)
    {
      events.Write(
        CommanderEventCategory.FleetRefresh,
        CommanderResultCode.FleetUnavailable,
        RefreshRoute
      );
      return Refusal(FleetErrorCodes.FleetUnavailable);
    }
  }

  /// <summary>
  /// The locale the refresh asks the package for. The request states it, and
  /// anything this application does not ship falls back to English rather than
  /// asking the package for a locale it does not have (020/FR-016).
  /// </summary>
  private static string Locale(HttpRequest request)
  {
    if (!request.Headers.TryGetValue("Accept-Language", out StringValues header))
    {
      return SupportedLocales[0];
    }

    foreach (var entry in header.ToString().Split(',', StringSplitOptions.RemoveEmptyEntries))
    {
      var tag = entry.Split(';')[0].Trim();
      var language = tag.Split('-')[0].ToLowerInvariant();
      var supported = Array.Find(SupportedLocales, locale => locale == language);
      if (supported is not null)
      {
        return supported;
      }
    }

    return SupportedLocales[0];
  }

  private static IResult Body(FleetState state)
  {
    var ships = new JsonArray();
    foreach (var ship in state.Ships)
    {
      ships.Add(
        new JsonObject
        {
          ["shipId"] = ship.ShipId,
          ["sourceDate"] = Date(ship.SourceDate),
          ["sourceLine"] = ship.SourceLine,
          ["model"] = JsonNode.Parse(ship.ModelJson),
        }
      );
    }

    return Results.Json(
      new JsonObject
      {
        ["result"] = state.Result,
        ["ships"] = ships,
        ["coverage"] = Coverage(state.Coverage),
        ["pending"] = state.Pending,
        ["failure"] = state.Failure,
        ["packageRefusal"] = Refusal(state.Refusal),
      },
      statusCode: StatusCodes.Status200OK
    );
  }

  private static JsonObject? Coverage(FleetCoverage? coverage)
  {
    if (coverage is null)
    {
      return null;
    }

    var storedShips =
      coverage.StoredShipsDate is DateOnly date
      && coverage.StoredShipsLine is int line
      && coverage.StoredShipsComplete is bool complete
        ? new JsonObject
        {
          ["date"] = Date(date),
          ["line"] = line,
          ["complete"] = complete,
        }
        : null;

    return new JsonObject
    {
      ["startDate"] = Date(coverage.StartDate),
      ["cursorDate"] = Date(coverage.CursorDate),
      ["cursorLine"] = coverage.CursorLine,
      ["storedShips"] = storedShips,
      ["nextPermittedRefreshAt"] = coverage.NextPermittedRefreshAt is DateTimeOffset permitted
        ? permitted.ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fffZ", CultureInfo.InvariantCulture)
        : null,
    };
  }

  private static JsonObject? Refusal(PackageRefusal? refusal) =>
    refusal is null
      ? null
      : new JsonObject
      {
        ["code"] = refusal.Code,
        ["constraint"] = refusal.Constraint,
        ["path"] = refusal.Path,
        ["message"] = refusal.Message,
      };

  private static string Date(DateOnly date) =>
    date.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);

  private static CommanderResultCode Result(FleetState state) =>
    state.Result switch
    {
      FleetResults.Waiting => CommanderResultCode.FleetWaiting,
      FleetResults.Failed => CommanderResultCode.FleetFailed,
      FleetResults.AuthorisationExpired => CommanderResultCode.FreshSignInRequired,
      _ => CommanderResultCode.FleetAccepted,
    };

  private static IResult Refusal(string code) =>
    TypedResults.Problem(
      title: Title(code),
      statusCode: Status(code),
      extensions: new Dictionary<string, object?> { ["code"] = code }
    );

  private static int Status(string code) =>
    code switch
    {
      FleetErrorCodes.Unauthorised => StatusCodes.Status401Unauthorized,
      FleetErrorCodes.FleetUnavailable => StatusCodes.Status500InternalServerError,
      _ => StatusCodes.Status400BadRequest,
    };

  private static string Title(string code) =>
    code switch
    {
      FleetErrorCodes.Unauthorised => "The request carries no signed-in session.",
      FleetErrorCodes.FleetUnavailable => "The service could not read the owned fleet.",
      _ => "The request carries no valid anti-forgery token.",
    };
}
