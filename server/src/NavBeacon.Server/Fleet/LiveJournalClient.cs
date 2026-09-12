using System.Globalization;
using System.Net;
using System.Net.Http.Headers;

namespace NavBeacon.Server.Fleet;

/// <summary>How one dated journal request ended.</summary>
public enum JournalReadOutcome
{
  /// <summary>The whole day. Its last line ends the day.</summary>
  Complete,

  /// <summary>Frontier marks the response incomplete. Its lines are still lines.</summary>
  Incomplete,

  /// <summary>A complete day with no lines.</summary>
  Empty,

  /// <summary>A retryable failure the refresh cannot pass now.</summary>
  Retryable,

  /// <summary>Frontier refused the authorisation twice.</summary>
  AuthorisationExpired,

  /// <summary>Frontier answered with something that does not retry.</summary>
  Failed,

  /// <summary>The response crossed the 25 MiB bound.</summary>
  ResponseTooLarge,
}

public sealed record JournalRead(
  JournalReadOutcome Outcome,
  string Body,
  DateTimeOffset? NextPermittedRefreshAt
);

/// <summary>The account's Frontier authorisation, as one dated read needs it.</summary>
public interface IJournalAuthorisation
{
  Task<string?> GetAccessTokenAsync(bool forceRefresh, CancellationToken cancellationToken);
}

public interface ILiveJournalClient
{
  Task<JournalRead> ReadAsync(
    DateOnly date,
    IJournalAuthorisation authorisation,
    CancellationToken cancellationToken
  );
}

/// <summary>The wait a bounded retry makes, as its own seam so a test can read it.</summary>
public interface IRefreshDelay
{
  Task WaitAsync(TimeSpan duration, CancellationToken cancellationToken);
}

public sealed class RefreshDelay : IRefreshDelay
{
  public Task WaitAsync(TimeSpan duration, CancellationToken cancellationToken) =>
    Task.Delay(duration, cancellationToken);
}

/// <summary>
/// Reads one dated Live journal response from the Frontier companion service.
///
/// The retry rules are 020/FR-013 exactly: at most three attempts for one dated
/// response, one second before the second attempt and two before the third, a
/// `Retry-After` honoured up to 30 seconds inside the request and ending it
/// beyond that, and a next permitted time of the later of `Retry-After` and 60
/// seconds after a third failure. One token refresh may follow an
/// authentication failure; a second failure marks authorisation expired.
///
/// The response for the current UTC date is the one day Frontier cannot have
/// finished writing, so an incomplete answer for it is the expected answer and
/// is read rather than retried. Its lines still commit; only the date does not
/// advance.
/// </summary>
public sealed class LiveJournalClient(
  HttpClient httpClient,
  TimeProvider timeProvider,
  IRefreshDelay delay
) : ILiveJournalClient
{
  private static readonly Uri JournalEndpoint = new("https://companion.orerve.net/journal/");

  public async Task<JournalRead> ReadAsync(
    DateOnly date,
    IJournalAuthorisation authorisation,
    CancellationToken cancellationToken
  )
  {
    var token = await authorisation.GetAccessTokenAsync(false, cancellationToken);
    if (token is null)
    {
      return Ended(JournalReadOutcome.AuthorisationExpired);
    }

    var refreshed = false;
    var attempts = 0;
    while (true)
    {
      var attempt = await SendAsync(date, token, cancellationToken);
      switch (attempt.Outcome)
      {
        case JournalReadOutcome.Complete:
        case JournalReadOutcome.Empty:
        case JournalReadOutcome.Failed:
        case JournalReadOutcome.ResponseTooLarge:
          return new JournalRead(attempt.Outcome, attempt.Body, null);
        case JournalReadOutcome.AuthorisationExpired:
          if (refreshed)
          {
            return Ended(JournalReadOutcome.AuthorisationExpired);
          }
          refreshed = true;
          token = await authorisation.GetAccessTokenAsync(true, cancellationToken);
          if (token is null)
          {
            return Ended(JournalReadOutcome.AuthorisationExpired);
          }
          continue;
        case JournalReadOutcome.Incomplete when !Retryable(date):
          return new JournalRead(JournalReadOutcome.Incomplete, attempt.Body, null);
        default:
          break;
      }

      attempts++;
      var now = timeProvider.GetUtcNow();
      // The third failure is decided first, because both rules end the read and
      // only one of them is right about when the next one is permitted. A
      // `Retry-After` between the in-request bound and the failure delay — 45
      // seconds, say — is longer than the one and shorter than the other, and
      // taking it alone would permit the next refresh before the floor
      // (020/FR-013).
      if (attempts >= FleetLimits.MaximumAttempts)
      {
        var supplied = now + (attempt.RetryAfter ?? TimeSpan.Zero);
        var floor = now + FleetLimits.FailureDelay;
        return Ended(attempt, supplied > floor ? supplied : floor);
      }
      if (attempt.RetryAfter > FleetLimits.MaximumInRequestDelay)
      {
        return Ended(attempt, now + attempt.RetryAfter.Value);
      }

      await delay.WaitAsync(
        attempt.RetryAfter
          ?? (attempts == 1 ? FleetLimits.FirstRetryDelay : FleetLimits.SecondRetryDelay),
        cancellationToken
      );
    }
  }

  /// <summary>
  /// Whether an incomplete answer for this date is worth another attempt. The
  /// current UTC day is still being written, so its incomplete answer is not.
  /// </summary>
  private bool Retryable(DateOnly date) =>
    date < DateOnly.FromDateTime(timeProvider.GetUtcNow().UtcDateTime);

  private async Task<Attempt> SendAsync(
    DateOnly date,
    string accessToken,
    CancellationToken cancellationToken
  )
  {
    HttpResponseMessage response;
    try
    {
      using var request = new HttpRequestMessage(HttpMethod.Get, Address(date));
      request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", accessToken);
      request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
      response = await httpClient.SendAsync(
        request,
        HttpCompletionOption.ResponseHeadersRead,
        cancellationToken
      );
    }
    catch (HttpRequestException)
    {
      return new Attempt(JournalReadOutcome.Retryable, string.Empty, null);
    }
    catch (TaskCanceledException) when (!cancellationToken.IsCancellationRequested)
    {
      return new Attempt(JournalReadOutcome.Retryable, string.Empty, null);
    }

    using (response)
    {
      var retryAfter = RetryAfter(response);
      switch (response.StatusCode)
      {
        case HttpStatusCode.OK:
        case HttpStatusCode.PartialContent:
          var body = await ReadBoundedAsync(response, cancellationToken);
          if (body is null)
          {
            return new Attempt(JournalReadOutcome.ResponseTooLarge, string.Empty, null);
          }
          if (
            response.StatusCode == HttpStatusCode.OK
            && string.IsNullOrWhiteSpace(body)
          )
          {
            return new Attempt(JournalReadOutcome.Empty, string.Empty, null);
          }
          return new Attempt(
            response.StatusCode == HttpStatusCode.OK
              ? JournalReadOutcome.Complete
              : JournalReadOutcome.Incomplete,
            body,
            retryAfter
          );
        case HttpStatusCode.NoContent:
          return new Attempt(JournalReadOutcome.Empty, string.Empty, null);
        case HttpStatusCode.Unauthorized:
        case HttpStatusCode.Forbidden:
          return new Attempt(JournalReadOutcome.AuthorisationExpired, string.Empty, null);
        case HttpStatusCode.TooManyRequests:
        case HttpStatusCode.BadGateway:
        case HttpStatusCode.ServiceUnavailable:
        case HttpStatusCode.GatewayTimeout:
          return new Attempt(JournalReadOutcome.Retryable, string.Empty, retryAfter);
        default:
          return new Attempt(JournalReadOutcome.Failed, string.Empty, null);
      }
    }
  }

  private static Uri Address(DateOnly date) =>
    new(
      JournalEndpoint,
      date.ToString("yyyy'/'MM'/'dd", CultureInfo.InvariantCulture)
    );

  /// <summary>The delay Frontier asked for, in either form the header takes.</summary>
  private TimeSpan? RetryAfter(HttpResponseMessage response)
  {
    var header = response.Headers.RetryAfter;
    var delay = header?.Delta ?? (header?.Date - timeProvider.GetUtcNow());
    if (delay is not TimeSpan requested)
    {
      return null;
    }
    return requested < TimeSpan.Zero ? TimeSpan.Zero : requested;
  }

  /// <summary>Reads the response up to the inclusive 25 MiB bound.</summary>
  private static async Task<string?> ReadBoundedAsync(
    HttpResponseMessage response,
    CancellationToken cancellationToken
  )
  {
    if (response.Content.Headers.ContentLength > FleetLimits.MaximumResponseBytes)
    {
      return null;
    }

    await using var stream = await response.Content.ReadAsStreamAsync(cancellationToken);
    using var body = new MemoryStream();
    var buffer = new byte[64 * 1024];
    while (true)
    {
      var read = await stream.ReadAsync(buffer, cancellationToken);
      if (read == 0)
      {
        break;
      }
      if (body.Length + read > FleetLimits.MaximumResponseBytes)
      {
        return null;
      }
      body.Write(buffer, 0, read);
    }

    return System.Text.Encoding.UTF8.GetString(body.ToArray());
  }

  private static JournalRead Ended(JournalReadOutcome outcome) =>
    new(outcome, string.Empty, null);

  private static JournalRead Ended(Attempt attempt, DateTimeOffset nextPermitted) =>
    new(
      attempt.Outcome == JournalReadOutcome.Incomplete
        ? JournalReadOutcome.Incomplete
        : JournalReadOutcome.Retryable,
      attempt.Body,
      nextPermitted
    );

  private sealed record Attempt(JournalReadOutcome Outcome, string Body, TimeSpan? RetryAfter);
}
