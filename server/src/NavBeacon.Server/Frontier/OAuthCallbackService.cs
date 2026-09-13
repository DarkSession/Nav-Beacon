using Microsoft.AspNetCore.DataProtection;
using Microsoft.EntityFrameworkCore;
using NavBeacon.Server.Persistence;

namespace NavBeacon.Server.Frontier;

public enum OAuthCallbackResult
{
  SignedIn,
  FreshSignInRequired,
}

public sealed record OAuthCallbackCompletion(
  OAuthCallbackResult Result,
  FrontierIdentity? Identity = null
);

public sealed class OAuthCallbackService(
  OAuthStateService states,
  IFrontierClient frontier,
  NavBeaconDbContext database,
  IDataProtectionProvider dataProtectionProvider
)
{
  private readonly IDataProtector tokenProtector = dataProtectionProvider.CreateProtector(
    "Frontier tokens v1"
  );

  public async Task<OAuthCallbackCompletion> CompleteAsync(
    string state,
    string? browserCorrelation,
    string authorisationCode,
    CancellationToken cancellationToken
  )
  {
    if (!await states.ConsumeAsync(state, browserCorrelation, cancellationToken))
    {
      return new OAuthCallbackCompletion(OAuthCallbackResult.FreshSignInRequired);
    }

    var authentication = await frontier.AuthenticateAsync(authorisationCode, cancellationToken);
    if (authentication is null)
    {
      return new OAuthCallbackCompletion(OAuthCallbackResult.FreshSignInRequired);
    }

    var account = await database.CommanderAccounts.SingleOrDefaultAsync(
      item => item.CustomerId == authentication.Identity.CustomerId,
      cancellationToken
    );
    if (account is null)
    {
      account = new CommanderAccount
      {
        CustomerId = authentication.Identity.CustomerId,
        CommanderName = authentication.Identity.CommanderName,
        ProtectedAccessToken = string.Empty,
        ProtectedRefreshToken = string.Empty,
      };
      database.CommanderAccounts.Add(account);
    }

    account.CommanderName = authentication.Identity.CommanderName;
    account.ProtectedAccessToken = tokenProtector.Protect(authentication.Tokens.AccessToken);
    account.ProtectedRefreshToken = tokenProtector.Protect(authentication.Tokens.RefreshToken);
    account.AccessTokenExpiresAt = authentication.Tokens.AccessTokenExpiresAt;
    try
    {
      await database.SaveChangesAsync(cancellationToken);
    }
    catch (DbUpdateException)
    {
      // A first sign-in for this Commander that another callback has already
      // written. Two browsers can reach here with the row read as absent in
      // both, and the second one writes into an account that now exists. It is
      // answered as a sign-in to start again, which the next attempt completes
      // against the stored account.
      return new OAuthCallbackCompletion(OAuthCallbackResult.FreshSignInRequired);
    }

    return new OAuthCallbackCompletion(OAuthCallbackResult.SignedIn, authentication.Identity);
  }
}
