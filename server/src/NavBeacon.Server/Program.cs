using Microsoft.EntityFrameworkCore;
using NavBeacon.Server.Accounts;
using NavBeacon.Server.Frontier;
using NavBeacon.Server.Logging;
using NavBeacon.Server.Persistence;
using NavBeacon.Server.Security;

var builder = WebApplication.CreateBuilder(args);
builder.Logging.AddCommanderLogging();

var connectionString = builder.Configuration.GetConnectionString("NavBeacon");
if (string.IsNullOrWhiteSpace(connectionString))
{
  throw new InvalidOperationException("ConnectionStrings:NavBeacon is required.");
}

builder.Services.AddDbContext<NavBeaconDbContext>(options => options.UseNpgsql(connectionString));
builder.Services.AddCommanderDataProtection(builder.Configuration, builder.Environment);
builder.Services.Configure<FrontierOptions>(
  builder.Configuration.GetSection(FrontierOptions.SectionName)
);
builder.Services.AddSingleton(TimeProvider.System);
builder.Services.AddHttpClient<IFrontierClient, FrontierClient>();
builder.Services.AddScoped<OAuthStateService>();
builder.Services.AddScoped<OAuthCallbackService>();
builder.Services.AddScoped<FrontierCredentialService>();
builder.Services.AddScoped<CommanderSessionService>();
builder.Services.AddScoped<CommanderAccountDeletionService>();
builder.Services.AddSingleton<CommanderEventLog>();
builder.Services.AddAntiforgery(options =>
{
  options.HeaderName = "X-CSRF-TOKEN";
  options.Cookie.Name = "__Host-NavBeacon-Antiforgery";
  options.Cookie.SecurePolicy = CookieSecurePolicy.Always;
  options.Cookie.HttpOnly = true;
  options.Cookie.SameSite = SameSiteMode.Strict;
  options.Cookie.Path = "/";
});
builder.Services.AddScoped<DatabaseStartupCheck>();
builder.Services.AddHealthChecks().AddCheck<DatabaseHealthCheck>("database");

var app = builder.Build();

await using (var scope = app.Services.CreateAsyncScope())
{
  var databaseCheck = scope.ServiceProvider.GetRequiredService<DatabaseStartupCheck>();
  await databaseCheck.ValidateAsync();
}

app.UseRouting();
app.UseCommanderAccessLogging();
app.MapHealthChecks("/health");
app.MapAccountEndpoints();

app.Run();

public partial class Program;
