using Microsoft.Extensions.FileProviders;
using Microsoft.Extensions.Hosting;

namespace NavBeacon.Server.UnitTests;

/// <summary>Names the environment a check reads, and nothing else.</summary>
internal sealed class TestHostEnvironment(string environmentName) : IHostEnvironment
{
  public string EnvironmentName { get; set; } = environmentName;

  public string ApplicationName { get; set; } = "NavBeacon.Server.UnitTests";

  public string ContentRootPath { get; set; } = Directory.GetCurrentDirectory();

  public IFileProvider ContentRootFileProvider { get; set; } = new NullFileProvider();
}
