using System.Collections.Concurrent;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Logging;
using NavBeacon.Server.Fleet;
using NavBeacon.Server.Frontier;
using NavBeacon.Server.Persistence;

namespace NavBeacon.Server.IntegrationTests;

internal sealed class ManualTimeProvider(DateTimeOffset current) : TimeProvider
{
  public override DateTimeOffset GetUtcNow() => current;

  public void Advance(TimeSpan duration) => current += duration;
}

internal sealed class FakeFrontierClient : IFrontierClient
{
  public FrontierAuthentication? Authentication { get; set; }

  public FrontierTokens? RefreshedTokens { get; set; }

  public int AuthenticationCalls { get; private set; }

  public int RefreshCalls { get; private set; }

  public Uri CreateAuthorisationUri(string state) =>
    new($"https://auth.frontierstore.net/auth?state={Uri.EscapeDataString(state)}");

  public Task<FrontierAuthentication?> AuthenticateAsync(
    string authorisationCode,
    CancellationToken cancellationToken
  )
  {
    AuthenticationCalls++;
    return Task.FromResult(Authentication);
  }

  public Task<FrontierTokens?> RefreshAsync(
    string refreshToken,
    CancellationToken cancellationToken
  )
  {
    RefreshCalls++;
    return Task.FromResult(RefreshedTokens);
  }

  public static FrontierAuthentication Identity(
    long customerId,
    string commanderName,
    DateTimeOffset now
  ) =>
    new(
      new FrontierTokens("access-token", "refresh-token", now.AddHours(1)),
      new FrontierIdentity(customerId, commanderName)
    );
}

/// <summary>One dated Live journal response per read, in the order the test queues them.</summary>
internal sealed class FakeJournalClient : ILiveJournalClient
{
  private readonly Dictionary<DateOnly, Queue<JournalRead>> reads = [];

  public List<DateOnly> Requested { get; } = [];

  public JournalRead Fallback { get; set; } =
    new(JournalReadOutcome.Empty, string.Empty, null);

  public FakeJournalClient Queue(DateOnly date, JournalRead read)
  {
    if (!reads.TryGetValue(date, out var queued))
    {
      queued = new Queue<JournalRead>();
      reads[date] = queued;
    }
    queued.Enqueue(read);
    return this;
  }

  public FakeJournalClient Complete(DateOnly date, params string[] lines) =>
    Queue(
      date,
      new JournalRead(JournalReadOutcome.Complete, string.Join('\n', lines), null)
    );

  public FakeJournalClient Incomplete(DateOnly date, params string[] lines) =>
    Queue(
      date,
      new JournalRead(JournalReadOutcome.Incomplete, string.Join('\n', lines), null)
    );

  public Task<JournalRead> ReadAsync(
    DateOnly date,
    IJournalAuthorisation authorisation,
    CancellationToken cancellationToken
  )
  {
    Requested.Add(date);
    return Task.FromResult(
      reads.TryGetValue(date, out var queued) && queued.Count > 0 ? queued.Dequeue() : Fallback
    );
  }
}

internal sealed class CapturingLoggerProvider : ILoggerProvider
{
  public ConcurrentBag<string> Entries { get; } = [];

  public string Text => string.Join('\n', Entries);

  public ILogger CreateLogger(string categoryName) => new CapturingLogger(Entries);

  public void Dispose() { }

  private sealed class CapturingLogger(ConcurrentBag<string> entries) : ILogger
  {
    public IDisposable? BeginScope<TState>(TState state)
      where TState : notnull => null;

    public bool IsEnabled(LogLevel logLevel) => true;

    public void Log<TState>(
      LogLevel logLevel,
      EventId eventId,
      TState state,
      Exception? exception,
      Func<TState, Exception?, string> formatter
    ) => entries.Add(formatter(state, exception));
  }
}

/// <summary>
/// Hosts the server over the disposable PostgreSQL database with a fake Frontier
/// service, so an HTTP contract test sees the same pipeline a browser does.
/// </summary>
internal sealed class CommanderTestServer : IDisposable
{
  private readonly WebApplicationFactory<Program> factory;

  public CommanderTestServer(
    PostgreSqlDatabaseFixture database,
    FakeFrontierClient frontier,
    TimeProvider? clock = null,
    CapturingLoggerProvider? logs = null,
    string? pathBase = null,
    IInterceptor? interceptor = null,
    IReadOnlyDictionary<string, string>? settings = null,
    ILiveJournalClient? journal = null
  )
  {
    factory = new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
    {
      builder.UseSetting("ConnectionStrings:NavBeacon", database.ConnectionString);
      builder.UseSetting("Frontier:ClientId", "client-id");
      builder.UseSetting("Frontier:ClientSecret", "client-secret");
      builder.UseSetting("Frontier:RedirectUri", "https://localhost/api/auth/frontier/callback");
      if (pathBase is not null)
      {
        builder.UseSetting("PathBase", pathBase);
      }

      foreach (var setting in settings ?? new Dictionary<string, string>())
      {
        builder.UseSetting(setting.Key, setting.Value);
      }

      builder.ConfigureTestServices(services =>
      {
        services.RemoveAll<IFrontierClient>();
        services.AddSingleton<IFrontierClient>(frontier);
        if (journal is not null)
        {
          services.RemoveAll<ILiveJournalClient>();
          services.AddSingleton(journal);
        }
        if (clock is not null)
        {
          services.RemoveAll<TimeProvider>();
          services.AddSingleton(clock);
        }

        if (logs is not null)
        {
          services.AddLogging(logging => logging.AddProvider(logs));
        }

        if (interceptor is not null)
        {
          services.RemoveAll<DbContextOptions<NavBeaconDbContext>>();
          services.RemoveAll<DbContextOptions>();
          services.AddDbContext<NavBeaconDbContext>(options =>
            options.UseNpgsql(database.ConnectionString).AddInterceptors(interceptor)
          );
        }
      });
    });
  }

  public HttpClient CreateClient(bool handleCookies = true) =>
    factory.CreateClient(
      new WebApplicationFactoryClientOptions
      {
        AllowAutoRedirect = false,
        BaseAddress = new Uri("https://localhost"),
        HandleCookies = handleCookies,
      }
    );

  public static string QueryValue(Uri address, string name) =>
    address
      .Query.TrimStart('?')
      .Split('&', StringSplitOptions.RemoveEmptyEntries)
      .Select(part => part.Split('=', 2))
      .Where(part => Uri.UnescapeDataString(part[0]) == name)
      .Select(part => Uri.UnescapeDataString(part[1]))
      .Single();

  public void Dispose() => factory.Dispose();
}
