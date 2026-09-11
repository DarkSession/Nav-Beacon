using System.Net;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Hosting;
using NavBeacon.Server.Configuration;

namespace NavBeacon.Server.UnitTests;

public sealed class ServerConfigurationTests
{
  private const string ProductionName = "Production";

  private const string PlaceholderPassword = "placeholder-database-password";

  [Fact]
  public void ProductionAcceptsACompleteDeployment()
  {
    var settings = ServerConfiguration.Read(Configuration(Production()), Environment());

    Assert.True(settings.RequireHttps);
    Assert.Equal([IPAddress.Parse("203.0.113.7")], settings.KnownProxies);
    Assert.Equal([IPNetwork.Parse("10.0.0.0/8")], settings.KnownNetworks);
    Assert.Contains("Database=navbeacon", settings.ConnectionString);
  }

  [Fact]
  public void EveryEnvironmentRequiresAConnectionString()
  {
    var error = Refusal([], Environments.Development);

    Assert.Contains("ConnectionStrings:NavBeacon is required.", error.Message);
  }

  [Fact]
  public void DevelopmentAsksForOnlyTheConnectionString()
  {
    var settings = ServerConfiguration.Read(
      Configuration(
        new Dictionary<string, string?>
        {
          ["ConnectionStrings:NavBeacon"] = "Host=database;Database=navbeacon;SSL Mode=Disable",
        }
      ),
      Environment(Environments.Development)
    );

    Assert.False(settings.RequireHttps);
    Assert.Empty(settings.KnownProxies);
    Assert.Empty(settings.KnownNetworks);
  }

  [Fact]
  public void DevelopmentMayAskForHttps()
  {
    var settings = ServerConfiguration.Read(
      Configuration(
        new Dictionary<string, string?>
        {
          ["ConnectionStrings:NavBeacon"] = "Host=database;Database=navbeacon;SSL Mode=Disable",
          [ServerConfiguration.RequireHttpsKey] = "true",
        }
      ),
      Environment(Environments.Development)
    );

    Assert.True(settings.RequireHttps);
  }

  [Fact]
  public void ProductionRefusesAnAbsentConnectionString()
  {
    var error = Refusal(Without("ConnectionStrings:NavBeacon"));

    Assert.Contains("ConnectionStrings:NavBeacon is required.", error.Message);
  }

  [Fact]
  public void ProductionRefusesADatabaseLinkWithoutTransportSecurity()
  {
    var error = Refusal(
      With(
        "ConnectionStrings:NavBeacon",
        $"Host=database;Database=navbeacon;Password={PlaceholderPassword};SSL Mode=Disable"
      )
    );

    Assert.Contains(
      "ConnectionStrings:NavBeacon must set SSL Mode to Require, VerifyCA or VerifyFull.",
      error.Message
    );
  }

  [Fact]
  public void ProductionRefusesADatabaseLinkThatLeavesTransportSecurityUnstated()
  {
    var error = Refusal(With("ConnectionStrings:NavBeacon", "Host=database;Database=navbeacon"));

    Assert.Contains(
      "ConnectionStrings:NavBeacon must set SSL Mode to Require, VerifyCA or VerifyFull.",
      error.Message
    );
  }

  [Fact]
  public void ProductionRefusesADatabaseLinkItCannotRead()
  {
    var error = Refusal(With("ConnectionStrings:NavBeacon", "Host=database;Unknown=value"));

    Assert.Contains(
      "ConnectionStrings:NavBeacon is not a PostgreSQL connection string.",
      error.Message
    );
  }

  [Fact]
  public void ARefusalNamesTheSettingAndNotItsValue()
  {
    var error = Refusal(
      With(
        "ConnectionStrings:NavBeacon",
        $"Host=database;Database=navbeacon;Password={PlaceholderPassword};SSL Mode=Disable"
      )
    );

    Assert.DoesNotContain(PlaceholderPassword, error.Message);
    Assert.DoesNotContain("client-secret", error.Message);
    Assert.DoesNotContain("certificate-password", error.Message);
  }

  [Theory]
  [InlineData("Frontier:ClientId", "Frontier:ClientId is required.")]
  [InlineData("Frontier:ClientSecret", "Frontier:ClientSecret is required.")]
  [InlineData("Frontier:RedirectUri", "Frontier:RedirectUri is required.")]
  public void ProductionRefusesAnAbsentFrontierSetting(string key, string named)
  {
    var error = Refusal(Without(key));

    Assert.Contains(named, error.Message);
  }

  [Theory]
  [InlineData("http://navbeacon.app/api/auth/frontier/callback")]
  [InlineData("api/auth/frontier/callback")]
  public void ProductionRefusesAReturnAddressThatIsNotHttps(string redirect)
  {
    var error = Refusal(With("Frontier:RedirectUri", redirect));

    Assert.Contains("Frontier:RedirectUri must be an absolute https address.", error.Message);
  }

  [Fact]
  public void ProductionRefusesAnUnprotectedKeyRing()
  {
    var error = Refusal(Without("DataProtection:CertificateBase64"));

    Assert.Contains(
      "DataProtection:CertificateBase64 is required: the shared key ring is encrypted at rest.",
      error.Message
    );
  }

  [Fact]
  public void ProductionRefusesAKeyRingCertificateWithoutItsPassword()
  {
    var error = Refusal(Without("DataProtection:CertificatePassword"));

    Assert.Contains("DataProtection:CertificatePassword is required.", error.Message);
  }

  [Fact]
  public void ProductionRefusesAnUnnamedEdge()
  {
    var settings = Without(ServerConfiguration.KnownProxiesKey + ":0");
    settings.Remove(ServerConfiguration.KnownNetworksKey + ":0");

    var error = Refusal(settings);

    Assert.Contains(
      "Deployment:KnownProxies or Deployment:KnownNetworks must name the edge that forwards requests.",
      error.Message
    );
  }

  [Fact]
  public void ProductionRefusesAnEdgeAddressItCannotRead()
  {
    var error = Refusal(With(ServerConfiguration.KnownProxiesKey + ":0", "edge-one"));

    Assert.Contains(
      "Deployment:KnownProxies holds an entry that is not an IP address.",
      error.Message
    );
  }

  [Fact]
  public void ProductionRefusesAnEdgeNetworkItCannotRead()
  {
    var error = Refusal(With(ServerConfiguration.KnownNetworksKey + ":0", "10.0.0.0"));

    Assert.Contains(
      "Deployment:KnownNetworks holds an entry that is not a network in CIDR form.",
      error.Message
    );
  }

  [Fact]
  public void ProductionRefusesAnEdgeAddressThatTrustsEveryClient()
  {
    var error = Refusal(With(ServerConfiguration.KnownProxiesKey + ":0", "0.0.0.0"));

    Assert.Contains("Deployment:KnownProxies must not trust every address.", error.Message);
  }

  [Fact]
  public void ProductionRefusesAnEdgeNetworkThatTrustsEveryClient()
  {
    var error = Refusal(With(ServerConfiguration.KnownNetworksKey + ":0", "0.0.0.0/0"));

    Assert.Contains("Deployment:KnownNetworks must not trust every address.", error.Message);
  }

  [Fact]
  public void ProductionRefusesHttpsBeingTurnedOff()
  {
    var error = Refusal(With(ServerConfiguration.RequireHttpsKey, "false"));

    Assert.Contains("Deployment:RequireHttps must be true.", error.Message);
  }

  [Fact]
  public void EveryEnvironmentRefusesAnHttpsSettingItCannotRead()
  {
    var error = Refusal(With(ServerConfiguration.RequireHttpsKey, "sometimes"));

    Assert.Contains("Deployment:RequireHttps must be true or false.", error.Message);
  }

  [Fact]
  public void ProductionRefusesAnAbsentRequestBodyLimit()
  {
    var error = Refusal(Without(ServerConfiguration.MaximumRequestBodyKey));

    Assert.Contains(
      "Kestrel:Limits:MaxRequestBodySize is required: the record and fleet endpoints serve a bounded body.",
      error.Message
    );
  }

  [Theory]
  [InlineData("1048575")]
  [InlineData("4194305")]
  [InlineData("unbounded")]
  public void ProductionRefusesARequestBodyLimitTheEndpointsCannotServe(string configured)
  {
    var error = Refusal(With(ServerConfiguration.MaximumRequestBodyKey, configured));

    Assert.Contains(
      "Kestrel:Limits:MaxRequestBodySize must be a whole number of bytes from 1048576 to 4194304.",
      error.Message
    );
  }

  [Theory]
  [InlineData("1048576")]
  [InlineData("4194304")]
  public void ProductionAcceptsTheRequestBodyLimitsAtEachBound(string configured)
  {
    var settings = ServerConfiguration.Read(
      Configuration(With(ServerConfiguration.MaximumRequestBodyKey, configured)),
      Environment()
    );

    Assert.True(settings.RequireHttps);
  }

  [Fact]
  public void ARefusalNamesEveryUnfitSetting()
  {
    var error = Refusal([]);

    Assert.Contains("ConnectionStrings:NavBeacon is required.", error.Message);
    Assert.Contains("Frontier:ClientId is required.", error.Message);
    Assert.Contains("Frontier:ClientSecret is required.", error.Message);
    Assert.Contains("Frontier:RedirectUri is required.", error.Message);
    Assert.Contains("DataProtection:CertificateBase64 is required", error.Message);
    Assert.Contains("DataProtection:CertificatePassword is required.", error.Message);
    Assert.Contains("Deployment:KnownProxies or Deployment:KnownNetworks", error.Message);
    Assert.Contains("Kestrel:Limits:MaxRequestBodySize is required", error.Message);
  }

  private static InvalidOperationException Refusal(
    Dictionary<string, string?> settings,
    string environmentName = ProductionName
  ) =>
    Assert.Throws<InvalidOperationException>(() =>
      ServerConfiguration.Read(Configuration(settings), Environment(environmentName))
    );

  private static Dictionary<string, string?> With(string key, string value)
  {
    var settings = Production();
    settings[key] = value;
    return settings;
  }

  private static Dictionary<string, string?> Without(string key)
  {
    var settings = Production();
    settings.Remove(key);
    return settings;
  }

  private static Dictionary<string, string?> Production() =>
    new()
    {
      ["ConnectionStrings:NavBeacon"] =
        $"Host=database;Database=navbeacon;Username=navbeacon;Password={PlaceholderPassword};SSL Mode=VerifyFull",
      ["Frontier:ClientId"] = "client-id",
      ["Frontier:ClientSecret"] = "client-secret",
      ["Frontier:RedirectUri"] = "https://navbeacon.app/api/auth/frontier/callback",
      ["DataProtection:CertificateBase64"] = "certificate",
      ["DataProtection:CertificatePassword"] = "certificate-password",
      [ServerConfiguration.KnownProxiesKey + ":0"] = "203.0.113.7",
      [ServerConfiguration.KnownNetworksKey + ":0"] = "10.0.0.0/8",
      [ServerConfiguration.MaximumRequestBodyKey] = "2097152",
    };

  private static IConfiguration Configuration(Dictionary<string, string?> settings) =>
    new ConfigurationBuilder().AddInMemoryCollection(settings).Build();

  private static IHostEnvironment Environment(string environmentName = ProductionName) =>
    new TestHostEnvironment(environmentName);
}
