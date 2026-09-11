using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using NavBeacon.Server.Persistence;
using Npgsql;

namespace NavBeacon.Server.IntegrationTests;

public sealed class InitialMigrationTests
{
  [Fact]
  public async Task Initial_migration_applies_to_empty_database_and_rolls_back()
  {
    var databaseName = $"navbeacon_migration_{Guid.NewGuid():N}";
    var developmentConnection =
      Environment.GetEnvironmentVariable("ConnectionStrings__NavBeacon")
      ?? "Host=database;Database=navbeacon;Username=postgres;SSL Mode=Disable";
    var adminBuilder = new NpgsqlConnectionStringBuilder(developmentConnection)
    {
      Database = "postgres",
      Pooling = false,
    };
    var databaseBuilder = new NpgsqlConnectionStringBuilder(developmentConnection)
    {
      Database = databaseName,
      Pooling = false,
    };

    await using (var adminConnection = new NpgsqlConnection(adminBuilder.ConnectionString))
    {
      await adminConnection.OpenAsync();
      await using var createDatabase = adminConnection.CreateCommand();
      createDatabase.CommandText = $"CREATE DATABASE {databaseName}";
      await createDatabase.ExecuteNonQueryAsync();
    }

    try
    {
      var options = new DbContextOptionsBuilder<NavBeaconDbContext>()
        .UseNpgsql(databaseBuilder.ConnectionString)
        .Options;
      await using var context = new NavBeaconDbContext(options);
      await context.Database.MigrateAsync();

      Assert.True(await TableExists(databaseBuilder.ConnectionString, "commander_accounts"));
      Assert.True(await TableExists(databaseBuilder.ConnectionString, "__EFMigrationsHistory"));

      var migrator = context.GetService<IMigrator>();
      await migrator.MigrateAsync(Migration.InitialDatabase);

      Assert.False(await TableExists(databaseBuilder.ConnectionString, "commander_accounts"));
      Assert.True(await TableExists(databaseBuilder.ConnectionString, "__EFMigrationsHistory"));

      // The rolled-back database is reachable and has no schema, which is the
      // state a deployment that forgot its migration leaves behind.
      await Assert.ThrowsAsync<InvalidOperationException>(
        () => new DatabaseStartupCheck(context).ValidateAsync()
      );
    }
    finally
    {
      await using var adminConnection = new NpgsqlConnection(adminBuilder.ConnectionString);
      await adminConnection.OpenAsync();
      await using var dropDatabase = adminConnection.CreateCommand();
      dropDatabase.CommandText = $"DROP DATABASE IF EXISTS {databaseName} WITH (FORCE)";
      await dropDatabase.ExecuteNonQueryAsync();
    }
  }

  private static async Task<bool> TableExists(string connectionString, string tableName)
  {
    await using var connection = new NpgsqlConnection(connectionString);
    await connection.OpenAsync();
    await using var command = connection.CreateCommand();
    command.CommandText =
      "SELECT EXISTS (SELECT 1 FROM pg_class AS tables "
      + "INNER JOIN pg_namespace AS schemas ON schemas.oid = tables.relnamespace "
      + "WHERE schemas.nspname = current_schema() AND tables.relname = @table_name)";
    command.Parameters.AddWithValue("table_name", tableName);
    return (bool)(await command.ExecuteScalarAsync() ?? false);
  }
}
