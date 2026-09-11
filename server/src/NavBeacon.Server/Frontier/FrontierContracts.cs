namespace NavBeacon.Server.Frontier;

public sealed record FrontierTokens(
  string AccessToken,
  string RefreshToken,
  DateTimeOffset AccessTokenExpiresAt
);

public sealed record FrontierIdentity(long CustomerId, string CommanderName);

public sealed record FrontierAuthentication(FrontierTokens Tokens, FrontierIdentity Identity);

public interface IFrontierClient
{
  Uri CreateAuthorisationUri(string state);

  Task<FrontierAuthentication?> AuthenticateAsync(
    string authorisationCode,
    CancellationToken cancellationToken
  );

  Task<FrontierTokens?> RefreshAsync(
    string refreshToken,
    CancellationToken cancellationToken
  );
}
