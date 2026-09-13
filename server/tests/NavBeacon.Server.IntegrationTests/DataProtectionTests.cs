using Microsoft.AspNetCore.DataProtection;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using NavBeacon.Server.Persistence;
using NavBeacon.Server.Security;

namespace NavBeacon.Server.IntegrationTests;

public sealed class DataProtectionTests(PostgreSqlDatabaseFixture database)
  : IClassFixture<PostgreSqlDatabaseFixture>
{
  [Fact]
  public async Task IndependentInstancesShareProtectedValues()
  {
    await using var firstInstance = CreateInstance();
    var protectedValue = firstInstance
      .GetRequiredService<IDataProtectionProvider>()
      .CreateProtector("cross-instance-test")
      .Protect("shared secret");

    await using var secondInstance = CreateInstance();
    var unprotectedValue = secondInstance
      .GetRequiredService<IDataProtectionProvider>()
      .CreateProtector("cross-instance-test")
      .Unprotect(protectedValue);

    Assert.Equal("shared secret", unprotectedValue);
  }

  private ServiceProvider CreateInstance()
  {
    var services = new ServiceCollection();
    services.AddDbContext<NavBeaconDbContext>(options => options.UseNpgsql(database.ConnectionString));
    services
      .AddDataProtection()
      .SetApplicationName(CommanderDataProtection.ApplicationName)
      .PersistKeysToDbContext<NavBeaconDbContext>();
    return services.BuildServiceProvider();
  }
}
