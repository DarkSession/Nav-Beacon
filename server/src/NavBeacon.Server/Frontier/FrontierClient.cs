using System.Globalization;
using System.Net.Http.Headers;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.Extensions.Options;

namespace NavBeacon.Server.Frontier;

public sealed class FrontierClient(
  HttpClient httpClient,
  IOptions<FrontierOptions> options,
  TimeProvider timeProvider
) : IFrontierClient
{
  private static readonly Uri AuthorisationEndpoint = new("https://auth.frontierstore.net/auth");
  private static readonly Uri TokenEndpoint = new("https://auth.frontierstore.net/token");
  private static readonly Uri UserInformationEndpoint = new("https://auth.frontierstore.net/me");
  private static readonly Uri LiveProfileEndpoint = new("https://companion.orerve.net/profile");
  private static readonly JsonSerializerOptions JsonOptions = new()
  {
    PropertyNameCaseInsensitive = false,
    UnmappedMemberHandling = JsonUnmappedMemberHandling.Skip,
  };

  private readonly FrontierOptions options = options.Value;

  public Uri CreateAuthorisationUri(string state)
  {
    EnsureConfigured();
    var query = string.Join(
      '&',
      new Dictionary<string, string>
      {
        ["client_id"] = options.ClientId,
        ["response_type"] = "code",
        ["redirect_uri"] = options.RedirectUri,
        ["scope"] = "capi",
        ["state"] = state,
      }.Select(pair => $"{Encode(pair.Key)}={Encode(pair.Value)}")
    );
    return new UriBuilder(AuthorisationEndpoint) { Query = query }.Uri;
  }

  public async Task<FrontierAuthentication?> AuthenticateAsync(
    string authorisationCode,
    CancellationToken cancellationToken
  )
  {
    EnsureConfigured();
    var token = await RequestTokenAsync(
      new Dictionary<string, string>
      {
        ["grant_type"] = "authorization_code",
        ["code"] = authorisationCode,
        ["client_id"] = options.ClientId,
        ["client_secret"] = options.ClientSecret,
        ["redirect_uri"] = options.RedirectUri,
      },
      null,
      cancellationToken
    );
    if (token is null)
    {
      return null;
    }

    var customerId = await ReadCustomerIdAsync(token.AccessToken, cancellationToken);
    var commanderName = await ReadLiveCommanderNameAsync(token.AccessToken, cancellationToken);
    if (customerId is null || commanderName is null)
    {
      return null;
    }

    return new FrontierAuthentication(token, new FrontierIdentity(customerId.Value, commanderName));
  }

  public async Task<FrontierTokens?> RefreshAsync(
    string refreshToken,
    CancellationToken cancellationToken
  )
  {
    EnsureConfigured();
    return await RequestTokenAsync(
      new Dictionary<string, string>
      {
        ["grant_type"] = "refresh_token",
        ["refresh_token"] = refreshToken,
        ["client_id"] = options.ClientId,
        ["client_secret"] = options.ClientSecret,
      },
      refreshToken,
      cancellationToken
    );
  }

  private async Task<FrontierTokens?> RequestTokenAsync(
    Dictionary<string, string> values,
    string? existingRefreshToken,
    CancellationToken cancellationToken
  )
  {
    using var response = await httpClient.PostAsync(
      TokenEndpoint,
      new FormUrlEncodedContent(values),
      cancellationToken
    );
    if (!response.IsSuccessStatusCode)
    {
      return null;
    }

    var payload = await response.Content.ReadFromJsonAsync<TokenResponse>(
      JsonOptions,
      cancellationToken
    );
    if (
      payload is null
      || string.IsNullOrWhiteSpace(payload.AccessToken)
      || payload.ExpiresIn <= 0
      || (
        string.IsNullOrWhiteSpace(payload.RefreshToken)
        && string.IsNullOrWhiteSpace(existingRefreshToken)
      )
    )
    {
      return null;
    }

    return new FrontierTokens(
      payload.AccessToken,
      string.IsNullOrWhiteSpace(payload.RefreshToken)
        ? existingRefreshToken!
        : payload.RefreshToken,
      timeProvider.GetUtcNow().AddSeconds(payload.ExpiresIn)
    );
  }

  private async Task<long?> ReadCustomerIdAsync(
    string accessToken,
    CancellationToken cancellationToken
  )
  {
    using var response = await SendAuthorisedGetAsync(
      UserInformationEndpoint,
      accessToken,
      cancellationToken
    );
    if (!response.IsSuccessStatusCode)
    {
      return null;
    }

    using var payload = await JsonDocument.ParseAsync(
      await response.Content.ReadAsStreamAsync(cancellationToken),
      cancellationToken: cancellationToken
    );
    if (!payload.RootElement.TryGetProperty("customer_id", out var customerId))
    {
      return null;
    }

    return customerId.ValueKind switch
    {
      JsonValueKind.String
        when long.TryParse(
          customerId.GetString(),
          NumberStyles.None,
          CultureInfo.InvariantCulture,
          out var value
        ) => value,
      JsonValueKind.Number when customerId.TryGetInt64(out var value) => value,
      _ => null,
    };
  }

  private async Task<string?> ReadLiveCommanderNameAsync(
    string accessToken,
    CancellationToken cancellationToken
  )
  {
    using var response = await SendAuthorisedGetAsync(
      LiveProfileEndpoint,
      accessToken,
      cancellationToken
    );
    if (!response.IsSuccessStatusCode)
    {
      return null;
    }

    using var payload = await JsonDocument.ParseAsync(
      await response.Content.ReadAsStreamAsync(cancellationToken),
      cancellationToken: cancellationToken
    );
    var root = payload.RootElement;
    if (
      root.TryGetProperty("gameVersion", out var gameVersion)
      && !string.Equals(gameVersion.GetString(), "live", StringComparison.OrdinalIgnoreCase)
    )
    {
      return null;
    }
    if (
      !root.TryGetProperty("commander", out var commander)
      || !commander.TryGetProperty("name", out var name)
      || name.ValueKind != JsonValueKind.String
      || string.IsNullOrWhiteSpace(name.GetString())
    )
    {
      return null;
    }

    return name.GetString();
  }

  private async Task<HttpResponseMessage> SendAuthorisedGetAsync(
    Uri address,
    string accessToken,
    CancellationToken cancellationToken
  )
  {
    using var request = new HttpRequestMessage(HttpMethod.Get, address);
    request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", accessToken);
    request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
    return await httpClient.SendAsync(request, cancellationToken);
  }

  private void EnsureConfigured()
  {
    if (
      string.IsNullOrWhiteSpace(options.ClientId)
      || string.IsNullOrWhiteSpace(options.ClientSecret)
      || !Uri.TryCreate(options.RedirectUri, UriKind.Absolute, out var redirectUri)
      || (redirectUri.Scheme != Uri.UriSchemeHttps && redirectUri.Host != "localhost")
    )
    {
      throw new InvalidOperationException("Frontier OAuth settings are required.");
    }
  }

  private static string Encode(string value) => Uri.EscapeDataString(value);

  private sealed record TokenResponse(
    [property: JsonPropertyName("access_token")] string AccessToken,
    [property: JsonPropertyName("refresh_token")] string? RefreshToken,
    [property: JsonPropertyName("expires_in")] int ExpiresIn
  );
}
