using System.Net;
using Microsoft.AspNetCore.Mvc.Testing;

namespace NavBeacon.Server.IntegrationTests;

public sealed class HealthEndpointTests : IClassFixture<PostgreSqlDatabaseFixture>
{
  private readonly PostgreSqlDatabaseFixture database;

  public HealthEndpointTests(PostgreSqlDatabaseFixture database)
  {
    this.database = database;
  }

  [Fact]
  public async Task Health_endpoint_reports_success()
  {
    using var factory = new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
      builder.UseSetting("ConnectionStrings:NavBeacon", database.ConnectionString)
    );
    using var client = factory.CreateClient();

    using var response = await client.GetAsync("health");

    Assert.Equal(HttpStatusCode.OK, response.StatusCode);
  }
}
