using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using Microsoft.AspNetCore.DataProtection;
using NavBeacon.Server.Persistence;

namespace NavBeacon.Server.Security;

public static class CommanderDataProtection
{
  public const string ApplicationName = "NavBeacon.Commander";

  public static IDataProtectionBuilder AddCommanderDataProtection(
    this IServiceCollection services,
    IConfiguration configuration,
    IHostEnvironment environment
  )
  {
    var builder = services
      .AddDataProtection()
      .SetApplicationName(ApplicationName)
      .PersistKeysToDbContext<NavBeaconDbContext>();

    if (!environment.IsProduction())
    {
      return builder;
    }

    var encodedCertificate = configuration["DataProtection:CertificateBase64"];
    var certificatePassword = configuration["DataProtection:CertificatePassword"];
    if (string.IsNullOrWhiteSpace(encodedCertificate) || string.IsNullOrWhiteSpace(certificatePassword))
    {
      throw new InvalidOperationException(
        "Production Data Protection certificate settings are required."
      );
    }

    X509Certificate2 certificate;
    try
    {
      certificate = X509CertificateLoader.LoadPkcs12(
        Convert.FromBase64String(encodedCertificate),
        certificatePassword,
        X509KeyStorageFlags.EphemeralKeySet
      );
    }
    catch (Exception error) when (error is FormatException or CryptographicException)
    {
      throw new InvalidOperationException(
        "The production Data Protection certificate is invalid.",
        error
      );
    }

    return builder.ProtectKeysWithCertificate(certificate);
  }
}
