using System.Security.Cryptography;
using System.Text;

namespace NavBeacon.Server.Security;

public static class SecretHash
{
  public static string CreateRandomValue() =>
    Convert.ToBase64String(RandomNumberGenerator.GetBytes(32))
      .TrimEnd('=')
      .Replace('+', '-')
      .Replace('/', '_');

  public static byte[] Compute(string value) => SHA256.HashData(Encoding.UTF8.GetBytes(value));
}
