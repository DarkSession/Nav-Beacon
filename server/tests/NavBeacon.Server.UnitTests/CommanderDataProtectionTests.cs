using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.FileProviders;
using Microsoft.Extensions.Hosting;
using NavBeacon.Server.Security;

namespace NavBeacon.Server.UnitTests;

public sealed class CommanderDataProtectionTests
{
  [Fact]
  public void ProductionRequiresCertificateSettings()
  {
    var services = new ServiceCollection();

    var error = Assert.Throws<InvalidOperationException>(() =>
      services.AddCommanderDataProtection(
        new ConfigurationBuilder().Build(),
        new EnvironmentStub(Environments.Production)
      )
    );

    Assert.Equal("Production Data Protection certificate settings are required.", error.Message);
  }

  [Fact]
  public void ProductionRejectsInvalidCertificateSettings()
  {
    var configuration = new ConfigurationBuilder()
      .AddInMemoryCollection(
        new Dictionary<string, string?>
        {
          ["DataProtection:CertificateBase64"] = "not-base64",
          ["DataProtection:CertificatePassword"] = "test-password",
        }
      )
      .Build();

    var error = Assert.Throws<InvalidOperationException>(() =>
      new ServiceCollection().AddCommanderDataProtection(
        configuration,
        new EnvironmentStub(Environments.Production)
      )
    );

    Assert.Equal("The production Data Protection certificate is invalid.", error.Message);
    Assert.IsType<FormatException>(error.InnerException);
  }

  [Fact]
  public void ProductionAcceptsADeploymentCertificate()
  {
    const string password = "test-password";
    using var key = RSA.Create(2048);
    var request = new CertificateRequest(
      "CN=Nav Beacon test",
      key,
      HashAlgorithmName.SHA256,
      RSASignaturePadding.Pkcs1
    );
    using var certificate = request.CreateSelfSigned(
      DateTimeOffset.UtcNow.AddMinutes(-1),
      DateTimeOffset.UtcNow.AddDays(1)
    );
    var configuration = new ConfigurationBuilder()
      .AddInMemoryCollection(
        new Dictionary<string, string?>
        {
          ["DataProtection:CertificateBase64"] = Convert.ToBase64String(
            certificate.Export(X509ContentType.Pkcs12, password)
          ),
          ["DataProtection:CertificatePassword"] = password,
        }
      )
      .Build();

    var builder = new ServiceCollection().AddCommanderDataProtection(
      configuration,
      new EnvironmentStub(Environments.Production)
    );

    Assert.NotNull(builder);
  }

  [Fact]
  public void DevelopmentDoesNotRequireCertificateSettings()
  {
    var builder = new ServiceCollection().AddCommanderDataProtection(
      new ConfigurationBuilder().Build(),
      new EnvironmentStub(Environments.Development)
    );

    Assert.NotNull(builder);
  }

  private sealed class EnvironmentStub(string environmentName) : IHostEnvironment
  {
    public string EnvironmentName { get; set; } = environmentName;

    public string ApplicationName { get; set; } = "NavBeacon.Server.UnitTests";

    public string ContentRootPath { get; set; } = Directory.GetCurrentDirectory();

    public IFileProvider ContentRootFileProvider { get; set; } = new NullFileProvider();
  }
}
