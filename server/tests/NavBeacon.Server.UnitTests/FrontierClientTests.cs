using System.Net;
using Microsoft.Extensions.Options;
using NavBeacon.Server.Frontier;

namespace NavBeacon.Server.UnitTests;

public sealed class FrontierClientTests
{
  private static readonly DateTimeOffset Now = new(2026, 9, 11, 12, 0, 0, TimeSpan.Zero);

  [Fact]
  public void AuthorisationUsesFrontierAndCarriesTheRequiredValues()
  {
    var client = CreateClient(new QueueHandler());

    var address = client.CreateAuthorisationUri("state-value");

    Assert.Equal("https", address.Scheme);
    Assert.Equal("auth.frontierstore.net", address.Host);
    Assert.Equal("/auth", address.AbsolutePath);
    Assert.Contains("client_id=client-id", address.Query, StringComparison.Ordinal);
    Assert.Contains("response_type=code", address.Query, StringComparison.Ordinal);
    Assert.Contains("scope=capi", address.Query, StringComparison.Ordinal);
    Assert.Contains("state=state-value", address.Query, StringComparison.Ordinal);
    Assert.Contains(
      "redirect_uri=https%3A%2F%2Fnavbeacon.example%2Fapi%2Fauth%2Ffrontier%2Fcallback",
      address.Query,
      StringComparison.Ordinal
    );
  }

  [Fact]
  public async Task AuthenticationReadsCustomerAndCommanderFromFrontierLive()
  {
    var handler = new QueueHandler(
      Json(
        """
        {"access_token":"access-token","refresh_token":"refresh-token","expires_in":3600}
        """
      ),
      Json("""{"customer_id":"123456789"}"""),
      Json("""{"commander":{"name":"Test Commander"}}""")
    );
    var client = CreateClient(handler);

    var result = await client.AuthenticateAsync("authorisation-code", CancellationToken.None);

    Assert.NotNull(result);
    Assert.Equal(123456789, result.Identity.CustomerId);
    Assert.Equal("Test Commander", result.Identity.CommanderName);
    Assert.Equal("access-token", result.Tokens.AccessToken);
    Assert.Equal("refresh-token", result.Tokens.RefreshToken);
    Assert.Equal(Now.AddHours(1), result.Tokens.AccessTokenExpiresAt);
    Assert.Collection(
      handler.Requests,
      request =>
      {
        Assert.Equal(HttpMethod.Post, request.Method);
        Assert.Equal("auth.frontierstore.net", request.Address.Host);
        Assert.Contains("grant_type=authorization_code", request.Body, StringComparison.Ordinal);
        Assert.Contains("code=authorisation-code", request.Body, StringComparison.Ordinal);
      },
      request =>
      {
        Assert.Equal("auth.frontierstore.net", request.Address.Host);
        Assert.Equal("Bearer access-token", request.Authorisation);
      },
      request =>
      {
        Assert.Equal("companion.orerve.net", request.Address.Host);
        Assert.Equal("Bearer access-token", request.Authorisation);
      }
    );
  }

  [Theory]
  [InlineData("legacy")]
  [InlineData("Legacy")]
  [InlineData("beta")]
  public async Task AProfileThatIsNotLiveIsRejected(string gameVersion)
  {
    var client = CreateClient(
      new QueueHandler(
        Json(
          """
          {"access_token":"access-token","refresh_token":"refresh-token","expires_in":3600}
          """
        ),
        Json("""{"customer_id":123456789}"""),
        Json("{\"gameVersion\":\"" + gameVersion + "\",\"commander\":{\"name\":\"Test Commander\"}}")
      )
    );

    Assert.Null(await client.AuthenticateAsync("code", CancellationToken.None));
  }

  [Fact]
  public async Task AProfileFrontierMarksLiveIsAccepted()
  {
    var client = CreateClient(
      new QueueHandler(
        Json(
          """
          {"access_token":"access-token","refresh_token":"refresh-token","expires_in":3600}
          """
        ),
        Json("""{"customer_id":123456789}"""),
        Json("""{"gameVersion":"Live","commander":{"name":"Test Commander"}}""")
      )
    );

    var result = await client.AuthenticateAsync("code", CancellationToken.None);

    Assert.NotNull(result);
    Assert.Equal("Test Commander", result.Identity.CommanderName);
  }

  [Theory]
  [InlineData("{\"expires_in\":3600}")]
  [InlineData("{\"access_token\":\"token\",\"expires_in\":0}")]
  [InlineData("{\"access_token\":\"token\",\"expires_in\":3600}")]
  // A `200` that is not the token document at all, which is what a proxy or a
  // captive portal answers.
  [InlineData("<html>Gateway</html>")]
  [InlineData("[]")]
  public async Task InvalidInitialTokenResponseIsRejected(string tokenResponse)
  {
    var client = CreateClient(new QueueHandler(Json(tokenResponse)));

    Assert.Null(await client.AuthenticateAsync("code", CancellationToken.None));
  }

  [Fact]
  public async Task FailedTokenRequestIsRejected()
  {
    var client = CreateClient(new QueueHandler(new HttpResponseMessage(HttpStatusCode.Unauthorized)));

    Assert.Null(await client.AuthenticateAsync("code", CancellationToken.None));
  }

  [Theory]
  [InlineData("{}", "{\"commander\":{\"name\":\"Test Commander\"}}")]
  [InlineData("{\"customer_id\":\"not-a-number\"}", "{\"commander\":{\"name\":\"Test Commander\"}}")]
  [InlineData("{\"customer_id\":123}", "{}")]
  [InlineData("{\"customer_id\":123}", "{\"commander\":{\"name\":\"\"}}")]
  // Bodies of a shape this server does not own. Frontier answers `200` and the
  // reader takes each value under its own kind, so a sign-in is refused rather
  // than ending in a failure that states nothing.
  [InlineData("<html>Gateway</html>", "{\"commander\":{\"name\":\"Test Commander\"}}")]
  [InlineData("[]", "{\"commander\":{\"name\":\"Test Commander\"}}")]
  [InlineData("{\"customer_id\":123}", "<html>Gateway</html>")]
  [InlineData("{\"customer_id\":123}", "[]")]
  [InlineData(
    "{\"customer_id\":123}",
    "{\"gameVersion\":4,\"commander\":{\"name\":\"Test Commander\"}}"
  )]
  [InlineData("{\"customer_id\":123}", "{\"commander\":\"Test Commander\"}")]
  public async Task InvalidIdentityResponseIsRejected(string userInformation, string profile)
  {
    var client = CreateClient(
      new QueueHandler(
        Json(
          """
          {"access_token":"access-token","refresh_token":"refresh-token","expires_in":3600}
          """
        ),
        Json(userInformation),
        Json(profile)
      )
    );

    Assert.Null(await client.AuthenticateAsync("code", CancellationToken.None));
  }

  [Fact]
  public async Task FailedIdentityRequestIsRejected()
  {
    var client = CreateClient(
      new QueueHandler(
        Json(
          """
          {"access_token":"access-token","refresh_token":"refresh-token","expires_in":3600}
          """
        ),
        new HttpResponseMessage(HttpStatusCode.Unauthorized),
        new HttpResponseMessage(HttpStatusCode.Unauthorized)
      )
    );

    Assert.Null(await client.AuthenticateAsync("code", CancellationToken.None));
  }

  [Fact]
  public async Task RefreshKeepsTheExistingRefreshTokenWhenFrontierOmitsAReplacement()
  {
    var handler = new QueueHandler(
      Json("""{"access_token":"new-access","refresh_token":null,"expires_in":1800}""")
    );
    var client = CreateClient(handler);

    var result = await client.RefreshAsync("existing-refresh", CancellationToken.None);

    Assert.NotNull(result);
    Assert.Equal("new-access", result.AccessToken);
    Assert.Equal("existing-refresh", result.RefreshToken);
    Assert.Contains("grant_type=refresh_token", Assert.Single(handler.Requests).Body, StringComparison.Ordinal);
    Assert.Contains("refresh_token=existing-refresh", Assert.Single(handler.Requests).Body, StringComparison.Ordinal);
  }

  [Fact]
  public async Task RefreshFailureReturnsNoTokens()
  {
    var client = CreateClient(new QueueHandler(new HttpResponseMessage(HttpStatusCode.BadRequest)));

    Assert.Null(await client.RefreshAsync("expired-refresh", CancellationToken.None));
  }

  [Theory]
  [InlineData("", "secret", "https://navbeacon.example/api/auth/frontier/callback")]
  [InlineData("client", "", "https://navbeacon.example/api/auth/frontier/callback")]
  [InlineData("client", "secret", "not-an-address")]
  [InlineData("client", "secret", "http://navbeacon.example/api/auth/frontier/callback")]
  public void InvalidConfigurationStopsTheFlow(string clientId, string secret, string redirectUri)
  {
    var client = CreateClient(
      new QueueHandler(),
      new FrontierOptions
      {
        ClientId = clientId,
        ClientSecret = secret,
        RedirectUri = redirectUri,
      }
    );

    Assert.Throws<InvalidOperationException>(() => client.CreateAuthorisationUri("state"));
  }

  private static FrontierClient CreateClient(
    QueueHandler handler,
    FrontierOptions? options = null
  ) =>
    new(
      new HttpClient(handler),
      Options.Create(
        options
          ?? new FrontierOptions
          {
            ClientId = "client-id",
            ClientSecret = "client-secret",
            RedirectUri = "https://navbeacon.example/api/auth/frontier/callback",
          }
      ),
      new FixedTimeProvider(Now)
    );

  private static HttpResponseMessage Json(string body) =>
    new(HttpStatusCode.OK) { Content = new StringContent(body, System.Text.Encoding.UTF8, "application/json") };

  private sealed class FixedTimeProvider(DateTimeOffset now) : TimeProvider
  {
    public override DateTimeOffset GetUtcNow() => now;
  }

  private sealed record CapturedRequest(
    HttpMethod Method,
    Uri Address,
    string Body,
    string? Authorisation
  );

  private sealed class QueueHandler(params HttpResponseMessage[] responses) : HttpMessageHandler
  {
    private readonly Queue<HttpResponseMessage> responses = new(responses);

    public List<CapturedRequest> Requests { get; } = [];

    protected override async Task<HttpResponseMessage> SendAsync(
      HttpRequestMessage request,
      CancellationToken cancellationToken
    )
    {
      Requests.Add(
        new CapturedRequest(
          request.Method,
          request.RequestUri!,
          request.Content is null ? string.Empty : await request.Content.ReadAsStringAsync(cancellationToken),
          request.Headers.Authorization?.ToString()
        )
      );
      return responses.Dequeue();
    }
  }
}
