using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Diagnostics.HealthChecks;

namespace NavBeacon.Server.Persistence;

public sealed class DatabaseHealthCheck(NavBeaconDbContext database) : IHealthCheck
{
  public async Task<HealthCheckResult> CheckHealthAsync(
    HealthCheckContext context,
    CancellationToken cancellationToken = default
  )
  {
    return await database.Database.CanConnectAsync(cancellationToken)
      ? HealthCheckResult.Healthy()
      : HealthCheckResult.Unhealthy();
  }
}
