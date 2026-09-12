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
    CommanderSessionService sessions,
    IFrontierClient frontier,
    HttpResponse response,
    CancellationToken cancellationToken
  )
  {
    await sessions.RemoveExpiredAsync(cancellationToken);
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
    // Three things end a callback with nobody signed in: no authorisation code,
    // which is what a Commander who declined at Frontier comes back with; a
    // state this browser did not start; and a code Frontier would not exchange.
    // One outcome covers all three. Naming which would state what happened
    // between the Commander and Frontier, and a refused state is exactly the
    // case where this server cannot know that.
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

  // Answers what this browser's session is, in the two property sets the
  // browser accepts.
  //
  // Both sets are written down in `src/app/platform/network/session-response.contract.json`,
  // which the browser's own parser reads and `SessionContractTests` asserts this
  // answer against. The browser refuses a body whose property set is not exactly
  // the one it accepts, so a property added here alone is a Commander who cannot
  // sign in.
  //
  // A refusal says only that there is no session. The browser clears its account
  // state and the fleet cache whenever it reads one, and it knows from the
  // request it made whether that is an expiry or plain anonymity, so neither
  // judgement is the server's to send (020/FR-003).
  private static async Task<IResult> ReadSessionAsync(
    CommanderSessionService sessions,
    IAntiforgery antiforgery,
    HttpRequest request,
    HttpResponse response,
    CancellationToken cancellationToken
  )
  {
    var secret = CommanderCookies.ReadSession(request);
    var access = await sessions.AuthenticateAsync(secret, cancellationToken);
    if (access is null)
    {
      CommanderCookies.DeleteSession(response);
      return Results.Json(
        new { signedIn = false },
        statusCode: StatusCodes.Status401Unauthorized
      );
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
