using Microsoft.EntityFrameworkCore;

namespace NavBeacon.Server.Persistence;

public sealed class DatabaseStartupCheck(NavBeaconDbContext database)
{
  public async Task ValidateAsync(CancellationToken cancellationToken = default)
  {
    if (!await database.Database.CanConnectAsync(cancellationToken))
    {
      throw new InvalidOperationException("The PostgreSQL database is unavailable.");
    }

    // Migrations are applied by the deployment, not by a starting instance:
    // several instances start together and the first request must not meet a
    // schema this build does not know.
    var pending = await database.Database.GetPendingMigrationsAsync(cancellationToken);
    if (pending.Any())
    {
      throw new InvalidOperationException("The PostgreSQL schema is behind this server build.");
    }
  }
}
