using System.Net;
using System.Net.Http.Headers;
using NavBeacon.Server.Fleet;

namespace NavBeacon.Server.UnitTests;

public sealed class LiveJournalClientTests
{
  private static readonly DateTimeOffset Now = new(2026, 9, 11, 12, 0, 0, TimeSpan.Zero);
  private static readonly DateOnly Today = new(2026, 9, 11);
  private static readonly DateOnly Yesterday = new(2026, 9, 10);

  [Fact]
  public void Published_journal_bounds_are_exact()
  {
    Assert.Equal(25 * 1024 * 1024, FleetLimits.MaximumResponseBytes);
    Assert.Equal(1024 * 1024, FleetLimits.MaximumLineBytes);
    Assert.Equal(100, FleetLimits.MaximumBatchLines);
    Assert.Equal(4 * 1024 * 1024, FleetLimits.MaximumBatchBytes);
    Assert.Equal(10, FleetLimits.MaximumBatches);
    Assert.Equal(4 * 1024 * 1024, FleetLimits.MaximumProjectionOutputBytes);
    Assert.Equal(TimeSpan.FromSeconds(30), FleetLimits.ProjectionTimeout);
    Assert.Equal(3, FleetLimits.MaximumAttempts);
    Assert.Equal(TimeSpan.FromDays(14), FleetLimits.InitialCoverage);
  }

  [Fact]
  public async Task ACompleteResponseCarriesTheDatedAddressAndItsBody()
  {
    var handler = new QueueHandler(Text(HttpStatusCode.OK, "{\"event\":\"Loadout\"}"));
    var client = Client(handler, out _);

    var read = await client.ReadAsync(Yesterday, new Authorisation(), CancellationToken.None);

    Assert.Equal(JournalReadOutcome.Complete, read.Outcome);
    Assert.Equal("{\"event\":\"Loadout\"}", read.Body);
    Assert.Null(read.NextPermittedRefreshAt);
    var request = Assert.Single(handler.Requests);
    Assert.Equal("companion.orerve.net", request.Address.Host);
    Assert.Equal("/journal/2026/09/10", request.Address.AbsolutePath);
    Assert.Equal("Bearer access-token", request.Authorisation);
  }

  [Theory]
  [InlineData(HttpStatusCode.NoContent, "")]
  [InlineData(HttpStatusCode.OK, "")]
  [InlineData(HttpStatusCode.OK, "   \n")]
  public async Task AnEmptyDayIsComplete(HttpStatusCode status, string body)
  {
    var client = Client(new QueueHandler(Text(status, body)), out _);

    var read = await client.ReadAsync(Yesterday, new Authorisation(), CancellationToken.None);

    Assert.Equal(JournalReadOutcome.Empty, read.Outcome);
    Assert.Null(read.NextPermittedRefreshAt);
  }

  [Fact]
  public async Task AnIncompleteResponseForAPastDateRetriesThreeTimes()
  {
    var handler = new QueueHandler(
      Text(HttpStatusCode.PartialContent, "one"),
      Text(HttpStatusCode.PartialContent, "one\ntwo"),
      Text(HttpStatusCode.PartialContent, "one\ntwo\nthree")
    );
    var client = Client(handler, out var delay);

    var read = await client.ReadAsync(Yesterday, new Authorisation(), CancellationToken.None);

    Assert.Equal(JournalReadOutcome.Incomplete, read.Outcome);
    Assert.Equal("one\ntwo\nthree", read.Body);
    Assert.Equal(3, handler.Requests.Count);
    Assert.Equal([TimeSpan.FromSeconds(1), TimeSpan.FromSeconds(2)], delay.Waits);
    Assert.Equal(Now.AddSeconds(60), read.NextPermittedRefreshAt);
  }

  [Fact]
  public async Task AnIncompleteResponseForTheCurrentDateIsReadOnce()
  {
    var handler = new QueueHandler(Text(HttpStatusCode.PartialContent, "one"));
    var client = Client(handler, out var delay);

    var read = await client.ReadAsync(Today, new Authorisation(), CancellationToken.None);

    Assert.Equal(JournalReadOutcome.Incomplete, read.Outcome);
    Assert.Equal("one", read.Body);
    Assert.Single(handler.Requests);
    Assert.Empty(delay.Waits);
    Assert.Null(read.NextPermittedRefreshAt);
  }

  [Theory]
  [InlineData(HttpStatusCode.TooManyRequests)]
  [InlineData(HttpStatusCode.BadGateway)]
  [InlineData(HttpStatusCode.ServiceUnavailable)]
  [InlineData(HttpStatusCode.GatewayTimeout)]
  public async Task AThirdRetryableFailureWaitsSixtySeconds(HttpStatusCode status)
  {
    var handler = new QueueHandler(Text(status, ""), Text(status, ""), Text(status, ""));
    var client = Client(handler, out var delay);

    var read = await client.ReadAsync(Yesterday, new Authorisation(), CancellationToken.None);

    Assert.Equal(JournalReadOutcome.Retryable, read.Outcome);
    Assert.Equal(3, handler.Requests.Count);
    Assert.Equal([TimeSpan.FromSeconds(1), TimeSpan.FromSeconds(2)], delay.Waits);
    Assert.Equal(Now.AddSeconds(60), read.NextPermittedRefreshAt);
  }

  [Fact]
  public async Task ANetworkFailureRetries()
  {
    var handler = new QueueHandler(
      new QueueHandler.Answer(new HttpRequestException("no route")),
      Text(HttpStatusCode.OK, "line")
    );
    var client = Client(handler, out var delay);

    var read = await client.ReadAsync(Yesterday, new Authorisation(), CancellationToken.None);

    Assert.Equal(JournalReadOutcome.Complete, read.Outcome);
    Assert.Equal([TimeSpan.FromSeconds(1)], delay.Waits);
  }

  [Fact]
  public async Task ATimedOutRequestRetries()
  {
    var handler = new QueueHandler(
      new QueueHandler.Answer(new TaskCanceledException("deadline")),
      Text(HttpStatusCode.OK, "line")
    );
    var client = Client(handler, out var delay);

    var read = await client.ReadAsync(Yesterday, new Authorisation(), CancellationToken.None);

    Assert.Equal(JournalReadOutcome.Complete, read.Outcome);
    Assert.Equal([TimeSpan.FromSeconds(1)], delay.Waits);
  }

  [Fact]
  public async Task AShortRetryAfterIsWaitedOutInsideTheRequest()
  {
    var handler = new QueueHandler(
      Text(HttpStatusCode.TooManyRequests, "", TimeSpan.FromSeconds(30)),
      Text(HttpStatusCode.OK, "line")
    );
    var client = Client(handler, out var delay);

    var read = await client.ReadAsync(Yesterday, new Authorisation(), CancellationToken.None);

    Assert.Equal(JournalReadOutcome.Complete, read.Outcome);
    Assert.Equal([TimeSpan.FromSeconds(30)], delay.Waits);
    Assert.Null(read.NextPermittedRefreshAt);
  }

  [Fact]
  public async Task ALongRetryAfterEndsTheRequest()
  {
    var handler = new QueueHandler(
      Text(HttpStatusCode.ServiceUnavailable, "", TimeSpan.FromSeconds(31))
    );
    var client = Client(handler, out var delay);

    var read = await client.ReadAsync(Yesterday, new Authorisation(), CancellationToken.None);

    Assert.Equal(JournalReadOutcome.Retryable, read.Outcome);
    Assert.Single(handler.Requests);
    Assert.Empty(delay.Waits);
    Assert.Equal(Now.AddSeconds(31), read.NextPermittedRefreshAt);
  }

  [Fact]
  public async Task ARetryAfterDateIsReadAsADelay()
  {
    var handler = new QueueHandler(
      new QueueHandler.Answer(HttpStatusCode.ServiceUnavailable, "", null, Now.AddMinutes(5))
    );
    var client = Client(handler, out _);

    var read = await client.ReadAsync(Yesterday, new Authorisation(), CancellationToken.None);

    Assert.Equal(Now.AddMinutes(5), read.NextPermittedRefreshAt);
  }

  [Fact]
  public async Task AThirdFailureTakesTheLaterOfRetryAfterAndSixtySeconds()
  {
    var handler = new QueueHandler(
      Text(HttpStatusCode.TooManyRequests, "", TimeSpan.FromSeconds(5)),
      Text(HttpStatusCode.TooManyRequests, "", TimeSpan.FromSeconds(5)),
      Text(HttpStatusCode.TooManyRequests, "", TimeSpan.FromSeconds(25))
    );
    var client = Client(handler, out var delay);

    var read = await client.ReadAsync(Yesterday, new Authorisation(), CancellationToken.None);

    Assert.Equal([TimeSpan.FromSeconds(5), TimeSpan.FromSeconds(5)], delay.Waits);
    Assert.Equal(Now.AddSeconds(60), read.NextPermittedRefreshAt);
  }

  [Fact]
  public async Task AThirdFailureKeepsARetryAfterPastTheFloor()
  {
    var handler = new QueueHandler(
      Text(HttpStatusCode.TooManyRequests, "", TimeSpan.FromSeconds(1)),
      Text(HttpStatusCode.TooManyRequests, "", TimeSpan.FromSeconds(1)),
      Text(HttpStatusCode.TooManyRequests, "", TimeSpan.FromSeconds(30))
    );
    var client = Client(handler, out _);

    var read = await client.ReadAsync(Yesterday, new Authorisation(), CancellationToken.None);

    Assert.Equal(Now.AddSeconds(60), read.NextPermittedRefreshAt);
  }

  [Theory]
  [InlineData(HttpStatusCode.NotFound)]
  [InlineData(HttpStatusCode.InternalServerError)]
  [InlineData(HttpStatusCode.BadRequest)]
  public async Task AnotherFailureDoesNotRetry(HttpStatusCode status)
  {
    var handler = new QueueHandler(Text(status, ""));
    var client = Client(handler, out var delay);

    var read = await client.ReadAsync(Yesterday, new Authorisation(), CancellationToken.None);

    Assert.Equal(JournalReadOutcome.Failed, read.Outcome);
    Assert.Single(handler.Requests);
    Assert.Empty(delay.Waits);
    Assert.Null(read.NextPermittedRefreshAt);
  }

  [Theory]
  [InlineData(HttpStatusCode.Unauthorized)]
  [InlineData(HttpStatusCode.Forbidden)]
  public async Task OneTokenRefreshFollowsAnAuthenticationFailure(HttpStatusCode status)
  {
    var handler = new QueueHandler(Text(status, ""), Text(HttpStatusCode.OK, "line"));
    var client = Client(handler, out var delay);
    var authorisation = new Authorisation();

    var read = await client.ReadAsync(Yesterday, authorisation, CancellationToken.None);

    Assert.Equal(JournalReadOutcome.Complete, read.Outcome);
    Assert.Equal(1, authorisation.Refreshes);
    Assert.Empty(delay.Waits);
  }

  [Fact]
  public async Task ASecondAuthenticationFailureMarksAuthorisationExpired()
  {
    var handler = new QueueHandler(
      Text(HttpStatusCode.Unauthorized, ""),
      Text(HttpStatusCode.Unauthorized, ""),
      Text(HttpStatusCode.OK, "line")
    );
    var client = Client(handler, out _);
    var authorisation = new Authorisation();

    var read = await client.ReadAsync(Yesterday, authorisation, CancellationToken.None);

    Assert.Equal(JournalReadOutcome.AuthorisationExpired, read.Outcome);
    Assert.Equal(1, authorisation.Refreshes);
    Assert.Equal(2, handler.Requests.Count);
  }

  [Fact]
  public async Task AnAccountWithoutATokenIsAuthorisationExpired()
  {
    var handler = new QueueHandler();
    var client = Client(handler, out _);

    var read = await client.ReadAsync(
      Yesterday,
      new Authorisation { Token = null },
      CancellationToken.None
    );

    Assert.Equal(JournalReadOutcome.AuthorisationExpired, read.Outcome);
    Assert.Empty(handler.Requests);
  }

  [Fact]
  public async Task ARefreshThatReturnsNoTokenIsAuthorisationExpired()
  {
    var handler = new QueueHandler(Text(HttpStatusCode.Unauthorized, ""));
    var client = Client(handler, out _);

    var read = await client.ReadAsync(
      Yesterday,
      new Authorisation { RefreshedToken = null },
      CancellationToken.None
    );

    Assert.Equal(JournalReadOutcome.AuthorisationExpired, read.Outcome);
  }

  [Fact]
  public async Task AResponseOf25MiBIsAccepted()
  {
    var body = new string('x', FleetLimits.MaximumResponseBytes);
    var client = Client(new QueueHandler(Text(HttpStatusCode.OK, body)), out _);

    var read = await client.ReadAsync(Yesterday, new Authorisation(), CancellationToken.None);

    Assert.Equal(JournalReadOutcome.Complete, read.Outcome);
    Assert.Equal(FleetLimits.MaximumResponseBytes, read.Body.Length);
  }

  [Fact]
  public async Task AResponseOneByteOver25MiBIsRefused()
  {
    var body = new string('x', FleetLimits.MaximumResponseBytes + 1);
    var client = Client(new QueueHandler(Text(HttpStatusCode.OK, body)), out _);

    var read = await client.ReadAsync(Yesterday, new Authorisation(), CancellationToken.None);

    Assert.Equal(JournalReadOutcome.ResponseTooLarge, read.Outcome);
    Assert.Equal(string.Empty, read.Body);
  }

  [Fact]
  public async Task ACancelledReadStops()
  {
    var handler = new QueueHandler(Text(HttpStatusCode.OK, "line"));
    var client = Client(handler, out _);
    using var cancelled = new CancellationTokenSource();
    await cancelled.CancelAsync();

    await Assert.ThrowsAnyAsync<OperationCanceledException>(() =>
      client.ReadAsync(Yesterday, new Authorisation(), cancelled.Token)
    );
  }

  private static LiveJournalClient Client(QueueHandler handler, out RecordingDelay delay)
  {
    delay = new RecordingDelay();
    return new LiveJournalClient(
      new HttpClient(handler),
      new FixedTimeProvider(Now),
      delay
    );
  }

  private static QueueHandler.Answer Text(
    HttpStatusCode status,
    string body,
    TimeSpan? retryAfter = null
  ) => new(status, body, retryAfter, null);

  private sealed class Authorisation : IJournalAuthorisation
  {
    public string? Token { get; init; } = "access-token";

    public string? RefreshedToken { get; init; } = "refreshed-token";

    public int Refreshes { get; private set; }

    public Task<string?> GetAccessTokenAsync(
      bool forceRefresh,
      CancellationToken cancellationToken
    )
    {
      if (!forceRefresh)
      {
        return Task.FromResult(Token);
      }
      Refreshes++;
      return Task.FromResult(RefreshedToken);
    }
  }

  private sealed class RecordingDelay : IRefreshDelay
  {
    public List<TimeSpan> Waits { get; } = [];

    public Task WaitAsync(TimeSpan duration, CancellationToken cancellationToken)
    {
      cancellationToken.ThrowIfCancellationRequested();
      Waits.Add(duration);
      return Task.CompletedTask;
    }
  }

  private sealed class FixedTimeProvider(DateTimeOffset now) : TimeProvider
  {
    public override DateTimeOffset GetUtcNow() => now;
  }

  private sealed class QueueHandler(params QueueHandler.Answer[] answers) : HttpMessageHandler
  {
    private readonly Queue<Answer> queued = new(answers);

    public List<Sent> Requests { get; } = [];

    protected override async Task<HttpResponseMessage> SendAsync(
      HttpRequestMessage request,
      CancellationToken cancellationToken
    )
    {
      cancellationToken.ThrowIfCancellationRequested();
      Requests.Add(new Sent(request.RequestUri!, request.Headers.Authorization?.ToString()));
      var answer = queued.Dequeue();
      if (answer.Failure is not null)
      {
        throw answer.Failure;
      }

      var response = new HttpResponseMessage(answer.Status)
      {
        Content = new StringContent(answer.Body),
      };
      if (answer.RetryAfter is TimeSpan delta)
      {
        response.Headers.RetryAfter = new RetryConditionHeaderValue(delta);
      }
      if (answer.RetryAt is DateTimeOffset at)
      {
        response.Headers.RetryAfter = new RetryConditionHeaderValue(at);
      }
      return await Task.FromResult(response);
    }

    internal sealed record Answer(
      HttpStatusCode Status,
      string Body,
      TimeSpan? RetryAfter,
      DateTimeOffset? RetryAt,
      Exception? Failure = null
    )
    {
      public Answer(Exception failure)
        : this(HttpStatusCode.OK, string.Empty, null, null, failure) { }
    }

    internal sealed record Sent(Uri Address, string? Authorisation);
  }
}
