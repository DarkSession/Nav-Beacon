using NavBeacon.Server.Frontier;

namespace NavBeacon.Server.Accounts;

public static class CommanderCookies
{
  public const string SessionName = "__Host-NavBeacon-Session";
  public const string OAuthCorrelationName = "__Host-NavBeacon-OAuth";

  public static string? ReadSession(HttpRequest request) => request.Cookies[SessionName];

  public static void AppendSession(
    HttpResponse response,
    CreatedCommanderSession session
  ) => response.Cookies.Append(SessionName, session.Secret, Options(session.AbsoluteExpiresAt));

  public static void AppendOAuthCorrelation(
    HttpResponse response,
    OAuthStart start
  ) => response.Cookies.Append(OAuthCorrelationName, start.BrowserCorrelation, Options(start.ExpiresAt));

  public static void DeleteSession(HttpResponse response) => response.Cookies.Delete(SessionName, DeleteOptions());

  public static void DeleteOAuthCorrelation(HttpResponse response) =>
    response.Cookies.Delete(OAuthCorrelationName, DeleteOptions());

  private static CookieOptions Options(DateTimeOffset expires) =>
    new()
    {
      Secure = true,
      HttpOnly = true,
      SameSite = SameSiteMode.Lax,
      Path = "/",
      Expires = expires,
      IsEssential = true,
    };

  private static CookieOptions DeleteOptions() =>
    new()
    {
      Secure = true,
      HttpOnly = true,
      SameSite = SameSiteMode.Lax,
      Path = "/",
    };
}
