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
    using var response = await SendAsync(
      new HttpRequestMessage(HttpMethod.Post, TokenEndpoint)
      {
        Content = new FormUrlEncodedContent(values),
      },
      cancellationToken
    );
    if (response is null || !response.IsSuccessStatusCode)
    {
      return null;
    }

    TokenResponse? payload;
    try
    {
      payload = await response.Content.ReadFromJsonAsync<TokenResponse>(
        JsonOptions,
        cancellationToken
      );
    }
    catch (Exception failure) when (failure is JsonException or NotSupportedException)
    {
      // A 200 that is not the token document. A proxy or a captive portal
      // answers one, and so does Frontier on a day its own service is broken.
      // It is no token, which is what a refused sign-in already states.
      return null;
    }
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
    if (response is null || !response.IsSuccessStatusCode)
    {
      return null;
    }

    using var payload = await ReadDocumentAsync(response, cancellationToken);
    if (
      payload is null
      || payload.RootElement.ValueKind != JsonValueKind.Object
      || !payload.RootElement.TryGetProperty("customer_id", out var customerId)
    )
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
    if (response is null || !response.IsSuccessStatusCode)
    {
      return null;
    }

    using var payload = await ReadDocumentAsync(response, cancellationToken);
    if (payload is null || payload.RootElement.ValueKind != JsonValueKind.Object)
    {
      return null;
    }
    var root = payload.RootElement;
    // A profile that states a version is taken only where it states the live
    // one. A version of any other kind is not the live game either, so it is
    // refused rather than read as an absent field.
    if (root.TryGetProperty("gameVersion", out var gameVersion) && !IsLive(gameVersion))
    {
      return null;
    }
    if (
      !root.TryGetProperty("commander", out var commander)
      || commander.ValueKind != JsonValueKind.Object
      || !commander.TryGetProperty("name", out var name)
      || name.ValueKind != JsonValueKind.String
      || string.IsNullOrWhiteSpace(name.GetString())
    )
    {
      return null;
    }

    return name.GetString();
  }

  /// <summary>
  /// One answered body as a document, or `null` where it is not one.
  ///
  /// Frontier's answers are read under their own kinds throughout, because
  /// nothing here owns them: a body of the wrong shape is a Frontier this
  /// server cannot read, and it is answered as no identity. Reading it
  /// regardless would end a sign-in or a fleet refresh in a failure that states
  /// nothing (020/FR-001, 020/FR-018).
  /// </summary>
  private static async Task<JsonDocument?> ReadDocumentAsync(
    HttpResponseMessage response,
    CancellationToken cancellationToken
  )
  {
    try
    {
      return await JsonDocument.ParseAsync(
        await response.Content.ReadAsStreamAsync(cancellationToken),
        cancellationToken: cancellationToken
      );
    }
    catch (JsonException)
    {
      return null;
    }
  }

  private static bool IsLive(JsonElement gameVersion) =>
    gameVersion.ValueKind == JsonValueKind.String
    && string.Equals(gameVersion.GetString(), "live", StringComparison.OrdinalIgnoreCase);

  private Task<HttpResponseMessage?> SendAuthorisedGetAsync(
    Uri address,
    string accessToken,
    CancellationToken cancellationToken
  )
  {
    var request = new HttpRequestMessage(HttpMethod.Get, address);
    request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", accessToken);
    request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
    return SendAsync(request, cancellationToken);
  }

  /// <summary>
  /// One answer from Frontier, or `null` where this server could not reach it.
  ///
  /// A host that does not resolve, a refused connection and a request that ran
  /// out of time are all Frontier this server has no answer from, so they are
  /// answered as no answer: a sign-in ends in the fresh sign-in the account
  /// dialog already states, and a fleet refresh in the refusal it already
  /// draws. Letting the failure out instead would end the request in an empty
  /// 500, which leaves a Commander on a blank page with nothing to do
  /// (020/FR-001, 020/FR-003, 020/FR-018).
  /// </summary>
  private async Task<HttpResponseMessage?> SendAsync(
    HttpRequestMessage request,
    CancellationToken cancellationToken
  )
  {
    using (request)
    {
      try
      {
        return await httpClient.SendAsync(request, cancellationToken);
      }
      catch (HttpRequestException)
      {
        return null;
      }
      catch (TaskCanceledException) when (!cancellationToken.IsCancellationRequested)
      {
        return null;
      }
    }
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
