using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using NavBeacon.Server.Configuration;

namespace NavBeacon.Server.IntegrationTests;

/// <summary>
/// An instance reads its configuration before it serves. A production
/// deployment that is missing a setting, or that carries an unsafe one, stops
/// here rather than at the first Commander request.
/// </summary>
public sealed class ProductionStartupTests
{
  private const string SafeConnectionString =
    "Host=database;Database=navbeacon;Username=navbeacon;SSL Mode=VerifyFull";

  [Fact]
  public void ProductionRefusesToStartWithoutItsRequiredSettings()
  {
    var error = Refusal(
      new Dictionary<string, string> { ["ConnectionStrings:NavBeacon"] = SafeConnectionString }
    );

    Assert.Contains("Frontier:ClientId is required.", error.Message);
    Assert.Contains("Frontier:ClientSecret is required.", error.Message);
    Assert.Contains("Frontier:RedirectUri is required.", error.Message);
    Assert.Contains("DataProtection:CertificateBase64 is required", error.Message);
    Assert.Contains("DataProtection:CertificatePassword is required.", error.Message);
    Assert.Contains("Deployment:KnownProxies or Deployment:KnownNetworks", error.Message);
  }

  [Fact]
  public void ProductionRefusesToStartOnAnUnprotectedDatabaseLink()
  {
    var settings = Complete();
    settings["ConnectionStrings:NavBeacon"] = "Host=database;Database=navbeacon;SSL Mode=Disable";

    var error = Refusal(settings);

    Assert.Contains(
      "ConnectionStrings:NavBeacon must set SSL Mode to Require, VerifyCA or VerifyFull.",
      error.Message
    );
  }

  [Fact]
  public void ProductionRefusesToStartWithHttpsTurnedOff()
  {
    var settings = Complete();
    settings[ServerConfiguration.RequireHttpsKey] = "false";

    var error = Refusal(settings);

    Assert.Contains("Deployment:RequireHttps must be true.", error.Message);
  }

  [Fact]
  public void ProductionRefusesToStartOnAnUnboundedRequestBody()
  {
    var settings = Complete();
    settings[ServerConfiguration.MaximumRequestBodyKey] = string.Empty;

    var error = Refusal(settings);

    Assert.Contains("Kestrel:Limits:MaxRequestBodySize is required", error.Message);
  }

  [Fact]
  public void ProductionRefusesToStartOnAKeyRingItCannotProtect()
  {
    var settings = Complete();
    settings["DataProtection:CertificateBase64"] = "not-a-certificate";

    var error = Refusal(settings);

    Assert.Equal("The production Data Protection certificate is invalid.", error.Message);
  }

  private static Dictionary<string, string> Complete() =>
    new()
    {
      ["ConnectionStrings:NavBeacon"] = SafeConnectionString,
      ["Frontier:ClientId"] = "client-id",
      ["Frontier:ClientSecret"] = "client-secret",
      ["Frontier:RedirectUri"] = "https://navbeacon.app/api/auth/frontier/callback",
      ["DataProtection:CertificateBase64"] = "Y2VydGlmaWNhdGU=",
      ["DataProtection:CertificatePassword"] = "certificate-password",
      [ServerConfiguration.KnownNetworksKey + ":0"] = "10.0.0.0/8",
    };

  private static InvalidOperationException Refusal(IDictionary<string, string> settings)
  {
    using var factory = new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
    {
      builder.UseEnvironment("Production");
      foreach (var setting in settings)
      {
        builder.UseSetting(setting.Key, setting.Value);
      }
    });

    return Assert.Throws<InvalidOperationException>(() => factory.CreateClient());
  }
}
