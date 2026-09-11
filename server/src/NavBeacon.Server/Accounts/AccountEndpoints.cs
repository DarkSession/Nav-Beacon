using Microsoft.AspNetCore.Antiforgery;
using System.Globalization;
using NavBeacon.Server.Frontier;
using NavBeacon.Server.Logging;

namespace NavBeacon.Server.Accounts;

public static class AccountEndpoints
{
  public const string SignInRoute = "api/auth/frontier";
  public const string CallbackRoute = "api/auth/frontier/callback";

  public static IEndpointRouteBuilder MapAccountEndpoints(this IEndpointRouteBuilder endpoints)
  {
    endpoints.MapPost(SignInRoute, StartSignInAsync);
    endpoints.MapGet(CallbackRoute, CompleteSignInAsync);
    endpoints.MapGet("api/session", ReadSessionAsync);
    endpoints.MapPost("api/session/sign-out", SignOutAsync);
    endpoints.MapDelete("api/account", DeleteAccountAsync);
    return endpoints;
  }

  private static async Task<IResult> StartSignInAsync(
    OAuthStateService states,
    IFrontierClient frontier,
    HttpResponse response,
    CancellationToken cancellationToken
  )
  {
    var start = await states.StartAsync(cancellationToken);
    CommanderCookies.AppendOAuthCorrelation(response, start);
    return Results.Ok(
      new { authorisationUri = frontier.CreateAuthorisationUri(start.State).ToString() }
    );
  }

  private static async Task<IResult> CompleteSignInAsync(
    string? code,
    string? state,
    OAuthCallbackService callback,
    CommanderSessionService sessions,
    HttpRequest request,
    HttpResponse response,
    CommanderEventLog events,
    CancellationToken cancellationToken
  )
  {
    var correlation = request.Cookies[CommanderCookies.OAuthCorrelationName];
    CommanderCookies.DeleteOAuthCorrelation(response);
    if (string.IsNullOrWhiteSpace(code) || string.IsNullOrWhiteSpace(state))
    {
      events.Write(
        CommanderEventCategory.OAuthCallback,
        CommanderResultCode.FreshSignInRequired,
        CallbackRoute
      );
      return ReturnToApplication(request, "fresh-sign-in-required");
    }

    var completion = await callback.CompleteAsync(
      state,
      correlation,
      code,
      cancellationToken
    );
    if (completion.Result != OAuthCallbackResult.SignedIn || completion.Identity is null)
    {
      events.Write(
        CommanderEventCategory.OAuthCallback,
        CommanderResultCode.FreshSignInRequired,
        CallbackRoute
      );
      return ReturnToApplication(request, "fresh-sign-in-required");
    }

    var session = await sessions.CreateAsync(completion.Identity.CustomerId, cancellationToken);
    CommanderCookies.AppendSession(response, session);
    events.Write(
      CommanderEventCategory.OAuthCallback,
      CommanderResultCode.SignInComplete,
      CallbackRoute
    );
    return ReturnToApplication(request, "signed-in");
  }

  private static async Task<IResult> ReadSessionAsync(
    CommanderSessionService sessions,
    IAntiforgery antiforgery,
    HttpRequest request,
    HttpResponse response,
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
      return Results.Json(new { signedIn = false }, statusCode: StatusCodes.Status401Unauthorized);
    }

    var tokens = antiforgery.GetAndStoreTokens(request.HttpContext);
    return Results.Ok(
      new
      {
        signedIn = true,
        customerId = access.CustomerId.ToString(CultureInfo.InvariantCulture),
        commanderName = access.CommanderName,
        antiForgeryToken = tokens.RequestToken,
      }
    );
  }

  private static async Task<IResult> SignOutAsync(
    CommanderSessionService sessions,
    IAntiforgery antiforgery,
    HttpRequest request,
    HttpResponse response,
    CancellationToken cancellationToken
  )
  {
    try
    {
      await antiforgery.ValidateRequestAsync(request.HttpContext);
    }
    catch (AntiforgeryValidationException)
    {
      return Results.BadRequest();
    }

    await sessions.RevokeAsync(CommanderCookies.ReadSession(request), cancellationToken);
    CommanderCookies.DeleteSession(response);
    return Results.NoContent();
  }

  private static async Task<IResult> DeleteAccountAsync(
    CommanderSessionService sessions,
    CommanderAccountDeletionService accounts,
    IAntiforgery antiforgery,
    HttpRequest request,
    HttpResponse response,
    CancellationToken cancellationToken
  )
  {
    try
    {
      await antiforgery.ValidateRequestAsync(request.HttpContext);
    }
    catch (AntiforgeryValidationException)
    {
      return Results.BadRequest();
    }

    var access = await sessions.AuthenticateAsync(
      CommanderCookies.ReadSession(request),
      cancellationToken
    );
    if (access is null)
    {
      CommanderCookies.DeleteSession(response);
      return Results.Unauthorized();
    }

    await accounts.DeleteAsync(access.CustomerId, cancellationToken);
    CommanderCookies.DeleteSession(response);
    return Results.NoContent();
  }

  private static IResult ReturnToApplication(HttpRequest request, string accountResult)
  {
    var basePath = request.PathBase.HasValue ? request.PathBase.Value : string.Empty;
    return Results.LocalRedirect($"{basePath}/?account={accountResult}");
  }
}
