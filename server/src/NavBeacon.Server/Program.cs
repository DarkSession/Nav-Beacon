using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.EntityFrameworkCore;
using NavBeacon.Server.Accounts;
using NavBeacon.Server.Configuration;
using NavBeacon.Server.Fleet;
using NavBeacon.Server.Frontier;
using NavBeacon.Server.Logging;
using NavBeacon.Server.Persistence;
using NavBeacon.Server.Records;
using NavBeacon.Server.Security;
using NavBeacon.Server.Validation;

var builder = WebApplication.CreateBuilder(args);
builder.Logging.AddCommanderLogging();

var settings = ServerConfiguration.Read(builder.Configuration, builder.Environment);

builder.Services.AddDbContext<NavBeaconDbContext>(options =>
  options.UseNpgsql(settings.ConnectionString)
);
builder.Services.AddCommanderDataProtection(builder.Configuration, builder.Environment);
builder.Services.Configure<FrontierOptions>(
  builder.Configuration.GetSection(FrontierOptions.SectionName)
);
builder.Services.Configure<RecordValidationOptions>(
  builder.Configuration.GetSection(RecordValidationOptions.SectionName)
);
builder.Services.Configure<FleetProjectionOptions>(
  builder.Configuration.GetSection(FleetProjectionOptions.SectionName)
);
builder.Services.AddSingleton(TimeProvider.System);
builder.Services.AddHttpClient<IFrontierClient, FrontierClient>();
builder.Services.AddHttpClient<ILiveJournalClient, LiveJournalClient>();
builder.Services.AddScoped<OAuthStateService>();
builder.Services.AddScoped<OAuthCallbackService>();
builder.Services.AddScoped<FrontierCredentialService>();
builder.Services.AddScoped<CommanderSessionService>();
builder.Services.AddScoped<CommanderAccountDeletionService>();
builder.Services.AddScoped<RecordSynchronisationService>();
builder.Services.AddScoped<FleetService>();
builder.Services.AddSingleton<IRefreshDelay, RefreshDelay>();
builder.Services.AddSingleton<FleetProjector>();
builder.Services.AddSingleton<RecordValidator>();
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
// The edge terminates TLS and forwards the original scheme and client address.
// Only the addresses the deployment names are believed.
builder.Services.Configure<ForwardedHeadersOptions>(options =>
{
  options.ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto;
  if (settings.KnownProxies.Count == 0 && settings.KnownNetworks.Count == 0)
  {
    return;
  }

  options.KnownProxies.Clear();
  options.KnownIPNetworks.Clear();
  foreach (var proxy in settings.KnownProxies)
  {
    options.KnownProxies.Add(proxy);
  }
  foreach (var network in settings.KnownNetworks)
  {
    options.KnownIPNetworks.Add(network);
  }
});
if (settings.RequireHttps)
{
  builder.Services.AddHttpsRedirection(options => options.HttpsPort = 443);
}
builder.Services.AddScoped<DatabaseStartupCheck>();
builder.Services.AddHealthChecks().AddCheck<DatabaseHealthCheck>("database");

var app = builder.Build();

await using (var scope = app.Services.CreateAsyncScope())
{
  var databaseCheck = scope.ServiceProvider.GetRequiredService<DatabaseStartupCheck>();
  await databaseCheck.ValidateAsync();
}

// The application may be served under a sub-path, so every return address the
// server sends is relative to that base.
var pathBase = builder.Configuration["PathBase"];
if (!string.IsNullOrWhiteSpace(pathBase))
{
  app.UsePathBase(pathBase);
}

app.UseForwardedHeaders();
if (settings.RequireHttps)
{
  app.UseHsts();
  app.UseHttpsRedirection();
}

app.UseRouting();
app.UseCommanderAccessLogging();
app.MapHealthChecks("/health");
app.MapAccountEndpoints();
app.MapRecordEndpoints();
app.MapFleetEndpoints();

app.Run();

public partial class Program;
