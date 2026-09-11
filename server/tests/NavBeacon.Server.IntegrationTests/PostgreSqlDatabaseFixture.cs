using Microsoft.EntityFrameworkCore;
using NavBeacon.Server.Persistence;
using Npgsql;

namespace NavBeacon.Server.IntegrationTests;

public sealed class PostgreSqlDatabaseFixture : IAsyncLifetime
{
  private readonly string databaseName = $"navbeacon_test_{Guid.NewGuid():N}";
  private string? databaseConnectionString;

  public string ConnectionString =>
    databaseConnectionString
    ?? throw new InvalidOperationException("The PostgreSQL test database is not ready.");

  public async Task InitializeAsync()
  {
    var developmentConnection =
      Environment.GetEnvironmentVariable("ConnectionStrings__NavBeacon")
      ?? "Host=database;Database=navbeacon;Username=postgres;SSL Mode=Disable";
    var adminBuilder = new NpgsqlConnectionStringBuilder(developmentConnection)
    {
      Database = "postgres",
      Pooling = false,
    };

    await using (var adminConnection = new NpgsqlConnection(adminBuilder.ConnectionString))
    {
      await adminConnection.OpenAsync();
      await using var createDatabase = adminConnection.CreateCommand();
      createDatabase.CommandText = $"CREATE DATABASE {databaseName}";
      await createDatabase.ExecuteNonQueryAsync();
    }

    var databaseBuilder = new NpgsqlConnectionStringBuilder(developmentConnection)
    {
      Database = databaseName,
      Pooling = false,
    };
    databaseConnectionString = databaseBuilder.ConnectionString;

    await using var context = CreateContext();
    await context.Database.MigrateAsync();
  }

  public NavBeaconDbContext CreateContext()
  {
    var options = new DbContextOptionsBuilder<NavBeaconDbContext>()
      .UseNpgsql(ConnectionString)
      .Options;
    return new NavBeaconDbContext(options);
  }

  public async Task DisposeAsync()
  {
    if (databaseConnectionString is null)
    {
      return;
    }

    var adminBuilder = new NpgsqlConnectionStringBuilder(databaseConnectionString)
    {
      Database = "postgres",
      Pooling = false,
    };
    await using var adminConnection = new NpgsqlConnection(adminBuilder.ConnectionString);
    await adminConnection.OpenAsync();
    await using var dropDatabase = adminConnection.CreateCommand();
    dropDatabase.CommandText = $"DROP DATABASE IF EXISTS {databaseName} WITH (FORCE)";
    await dropDatabase.ExecuteNonQueryAsync();
  }
}
