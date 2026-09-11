using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using Microsoft.AspNetCore.DataProtection;
using NavBeacon.Server.Persistence;

namespace NavBeacon.Server.Security;

public static class CommanderDataProtection
{
  public const string ApplicationName = "NavBeacon.Commander";

  public const string CertificateKey = "DataProtection:CertificateBase64";

  public const string CertificatePasswordKey = "DataProtection:CertificatePassword";

  /// <summary>
  /// Names each production key-protection setting the deployment has not
  /// supplied. Every instance reads one PostgreSQL key ring, so the ring is
  /// encrypted at rest with a deployment-managed certificate.
  /// </summary>
  public static IEnumerable<string> ProductionFailures(IConfiguration configuration)
  {
    if (string.IsNullOrWhiteSpace(configuration[CertificateKey]))
    {
      yield return $"{CertificateKey} is required: the shared key ring is encrypted at rest.";
    }

    if (string.IsNullOrWhiteSpace(configuration[CertificatePasswordKey]))
    {
      yield return $"{CertificatePasswordKey} is required.";
    }
  }

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

    if (ProductionFailures(configuration).Any())
    {
      throw new InvalidOperationException(
        "Production Data Protection certificate settings are required."
      );
    }

    var encodedCertificate = configuration[CertificateKey]!;
    var certificatePassword = configuration[CertificatePasswordKey]!;

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
