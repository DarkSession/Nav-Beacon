using System.Globalization;
using System.Net;
using NavBeacon.Server.Records;
using NavBeacon.Server.Security;
using Npgsql;

namespace NavBeacon.Server.Configuration;

/// <summary>
/// The settings one instance serves on. <see cref="Read"/> refuses a production
/// configuration an instance cannot serve safely, so the instance stops before
/// the first request rather than serving without a setting it depends on.
/// </summary>
public sealed record ServerConfiguration(
  string ConnectionString,
  bool RequireHttps,
  IReadOnlyList<IPAddress> KnownProxies,
  IReadOnlyList<IPNetwork> KnownNetworks
)
{
  public const string ConnectionStringName = "NavBeacon";
  public const string KnownProxiesKey = "Deployment:KnownProxies";
  public const string KnownNetworksKey = "Deployment:KnownNetworks";
  public const string RequireHttpsKey = "Deployment:RequireHttps";
  public const string MaximumRequestBodyKey = "Kestrel:Limits:MaxRequestBodySize";

  /// <summary>
  /// The smallest body limit that still admits a legal synchronisation batch.
  /// </summary>
  public const long SmallestRequestBody = RecordSynchronisationLimits.MaximumRequestBytes;

  /// <summary>
  /// The largest body limit the endpoints tolerate. The limit sits above the
  /// batch bound so a request just over the bound reaches the endpoint and
  /// receives the stated error code instead of a bare transport refusal.
  /// </summary>
  public const long LargestRequestBody = 4 * SmallestRequestBody;

  public static ServerConfiguration Read(
    IConfiguration configuration,
    IHostEnvironment environment
  )
  {
    var failures = new List<string>();
    var production = environment.IsProduction();

    var connectionString = configuration.GetConnectionString(ConnectionStringName);
    if (string.IsNullOrWhiteSpace(connectionString))
    {
      failures.Add("ConnectionStrings:NavBeacon is required.");
    }
    else if (production)
    {
      ReadDatabaseTransport(connectionString, failures);
    }

    var proxies = ReadProxies(configuration, failures);
    var networks = ReadNetworks(configuration, failures);
    var requireHttps = ReadRequireHttps(configuration, production, failures);

    if (production)
    {
      ReadFrontier(configuration, failures);
      failures.AddRange(CommanderDataProtection.ProductionFailures(configuration));
      ReadRequestBodyLimit(configuration, failures);

      if (proxies.Count == 0 && networks.Count == 0)
      {
        failures.Add(
          $"{KnownProxiesKey} or {KnownNetworksKey} must name the edge that forwards requests."
        );
      }
    }

    if (failures.Count > 0)
    {
      throw new InvalidOperationException(
        $"The server configuration is unfit to serve:{Environment.NewLine}"
          + string.Join(Environment.NewLine, failures.Select(failure => $"- {failure}"))
      );
    }

    return new ServerConfiguration(connectionString!, requireHttps, proxies, networks);
  }

  /// <summary>
  /// Frontier tokens and session hashes travel to PostgreSQL, so the link
  /// carries them under TLS. Npgsql falls back to plain text under every mode
  /// below <c>Require</c>.
  /// </summary>
  private static void ReadDatabaseTransport(string connectionString, List<string> failures)
  {
    NpgsqlConnectionStringBuilder parsed;
    try
    {
      parsed = new NpgsqlConnectionStringBuilder(connectionString);
    }
    catch (Exception error) when (error is ArgumentException or FormatException)
    {
      failures.Add("ConnectionStrings:NavBeacon is not a PostgreSQL connection string.");
      return;
    }

    if (parsed.SslMode is not (SslMode.Require or SslMode.VerifyCA or SslMode.VerifyFull))
    {
      failures.Add(
        "ConnectionStrings:NavBeacon must set SSL Mode to Require, VerifyCA or VerifyFull."
      );
    }
  }

  private static void ReadFrontier(IConfiguration configuration, List<string> failures)
  {
    if (string.IsNullOrWhiteSpace(configuration["Frontier:ClientId"]))
    {
      failures.Add("Frontier:ClientId is required.");
    }

    if (string.IsNullOrWhiteSpace(configuration["Frontier:ClientSecret"]))
    {
      failures.Add("Frontier:ClientSecret is required.");
    }

    var redirect = configuration["Frontier:RedirectUri"];
    if (string.IsNullOrWhiteSpace(redirect))
    {
      failures.Add("Frontier:RedirectUri is required.");
      return;
    }

    if (
      !Uri.TryCreate(redirect, UriKind.Absolute, out var address)
      || address.Scheme != Uri.UriSchemeHttps
    )
    {
      failures.Add("Frontier:RedirectUri must be an absolute https address.");
    }
  }

  private static void ReadRequestBodyLimit(IConfiguration configuration, List<string> failures)
  {
    var configured = configuration[MaximumRequestBodyKey];
    if (string.IsNullOrWhiteSpace(configured))
    {
      failures.Add(
        $"{MaximumRequestBodyKey} is required: the record and fleet endpoints serve a bounded body."
      );
      return;
    }

    if (
      !long.TryParse(configured, NumberStyles.Integer, CultureInfo.InvariantCulture, out var bytes)
      || bytes < SmallestRequestBody
      || bytes > LargestRequestBody
    )
    {
      failures.Add(
        $"{MaximumRequestBodyKey} must be a whole number of bytes from {SmallestRequestBody} to {LargestRequestBody}."
      );
    }
  }

  private static bool ReadRequireHttps(
    IConfiguration configuration,
    bool production,
    List<string> failures
  )
  {
    var configured = configuration[RequireHttpsKey];
    if (string.IsNullOrWhiteSpace(configured))
    {
      return production;
    }

    if (!bool.TryParse(configured, out var required))
    {
      failures.Add($"{RequireHttpsKey} must be true or false.");
      return production;
    }

    if (production && !required)
    {
      failures.Add($"{RequireHttpsKey} must be true.");
    }

    return required || production;
  }

  private static IReadOnlyList<IPAddress> ReadProxies(
    IConfiguration configuration,
    List<string> failures
  )
  {
    var proxies = new List<IPAddress>();
    foreach (var entry in Entries(configuration, KnownProxiesKey))
    {
      if (!IPAddress.TryParse(entry, out var address))
      {
        failures.Add($"{KnownProxiesKey} holds an entry that is not an IP address.");
        continue;
      }

      if (address.Equals(IPAddress.Any) || address.Equals(IPAddress.IPv6Any))
      {
        failures.Add($"{KnownProxiesKey} must not trust every address.");
        continue;
      }

      proxies.Add(address);
    }

    return proxies;
  }

  private static IReadOnlyList<IPNetwork> ReadNetworks(
    IConfiguration configuration,
    List<string> failures
  )
  {
    var networks = new List<IPNetwork>();
    foreach (var entry in Entries(configuration, KnownNetworksKey))
    {
      if (!IPNetwork.TryParse(entry, out var network))
      {
        failures.Add($"{KnownNetworksKey} holds an entry that is not a network in CIDR form.");
        continue;
      }

      if (network.PrefixLength == 0)
      {
        failures.Add($"{KnownNetworksKey} must not trust every address.");
        continue;
      }

      networks.Add(network);
    }

    return networks;
  }

  private static IEnumerable<string> Entries(IConfiguration configuration, string key) =>
    configuration
      .GetSection(key)
      .GetChildren()
      .Select(child => child.Value)
      .Where(value => !string.IsNullOrWhiteSpace(value))
      .Select(value => value!.Trim());
}
