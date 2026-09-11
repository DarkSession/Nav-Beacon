using System.Data.Common;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Antiforgery;
using Microsoft.EntityFrameworkCore;
using NavBeacon.Server.Accounts;
using NavBeacon.Server.Validation;

namespace NavBeacon.Server.Records;

public static class RecordEndpoints
{
  public const string SynchroniseRoute = "api/records/synchronise";

  public static IEndpointRouteBuilder MapRecordEndpoints(this IEndpointRouteBuilder endpoints)
  {
    endpoints.MapPost(SynchroniseRoute, SynchroniseAsync);
    return endpoints;
  }

  private static async Task<IResult> SynchroniseAsync(
    CommanderSessionService sessions,
    RecordSynchronisationService records,
    RecordValidator validator,
    IAntiforgery antiforgery,
    HttpRequest request,
    HttpResponse response,
    CancellationToken cancellationToken
  )
  {
    try
    {
      await antiforgery.ValidateRequestAsync(request.HttpContext);
    }
    catch (AntiforgeryValidationException)
    {
      return Refusal(StatusCodes.Status400BadRequest, RecordErrorCodes.InvalidAntiForgery);
    }

    var access = await sessions.AuthenticateAsync(
      CommanderCookies.ReadSession(request),
      cancellationToken
    );
    if (access is null)
    {
      CommanderCookies.DeleteSession(response);
      return Refusal(StatusCodes.Status401Unauthorized, RecordErrorCodes.Unauthorised);
    }

    var body = await ReadBoundedBodyAsync(request, cancellationToken);
    if (body is null)
    {
      return Refusal(
        StatusCodes.Status413PayloadTooLarge,
        RecordErrorCodes.RequestTooLarge
      );
    }

    var read = RecordRequestReader.Read(body.Value);
    if (read.Request is null)
    {
      return Refusal(
        read.Code == RecordErrorCodes.RequestTooLarge
          ? StatusCodes.Status413PayloadTooLarge
          : StatusCodes.Status400BadRequest,
        read.Code!,
        read.Index is null ? null : Withheld(read.ChangeCount, read.Index, read.Code!)
      );
    }

    var writes = read
      .Request.Changes.Where(change => change.Kind == RecordChangeKind.Write)
      .ToList();
    if (writes.Count > 0)
    {
      var validation = await validator.ValidateAsync(
        [.. writes.Select(change => change.Payload!)],
        cancellationToken
      );
      if (!validation.IsValid)
      {
        return validation.Failure == RecordValidationFailure.Refused
          ? Refusal(
            StatusCodes.Status400BadRequest,
            RecordErrorCodes.InvalidRecord,
            Withheld(
              read.Request.Changes.Count,
              RefusedChangeIndex(writes, validation.Index),
              RecordErrorCodes.InvalidRecord
            )
          )
          : Refusal(
            StatusCodes.Status503ServiceUnavailable,
            RecordErrorCodes.ValidationUnavailable
          );
      }
    }

    try
    {
      await records.ExpireAsync(access.CustomerId, cancellationToken);
      var outcome = await records.ApplyAsync(
        access.CustomerId,
        read.Request,
        cancellationToken
      );
      return outcome.Code is null ? Accepted(outcome) : Refused(outcome);
    }
    catch (Exception failure) when (failure is DbException or DbUpdateException)
    {
      return Refusal(
        StatusCodes.Status500InternalServerError,
        RecordErrorCodes.SynchronisationFailed
      );
    }
  }

  private static IResult Accepted(RecordSynchronisationOutcome outcome)
  {
    var live = new JsonArray();
    var tombstones = new JsonArray();
    foreach (var entry in outcome.Stream)
    {
      if (entry.Payload is null)
      {
        tombstones.Add(
          new JsonObject
          {
            ["id"] = entry.RecordId.ToString(),
            ["revision"] = entry.Revision,
          }
        );
      }
      else
      {
        live.Add(
          new JsonObject
          {
            ["revision"] = entry.Revision,
            ["record"] = JsonNode.Parse(entry.Payload),
          }
        );
      }
    }

    return Results.Json(
      new JsonObject
      {
        ["accountRevision"] = outcome.AccountRevision,
        ["results"] = ChangeResults(outcome.Results),
        ["records"] = live,
        ["tombstones"] = tombstones,
      },
      statusCode: StatusCodes.Status200OK
    );
  }

  private static IResult Refused(RecordSynchronisationOutcome outcome) =>
    Refusal(
      outcome.Code == RecordErrorCodes.CrossAccountRecord
        ? StatusCodes.Status403Forbidden
        : StatusCodes.Status409Conflict,
      outcome.Code!,
      ChangeResults(outcome.Results),
      outcome.AccountRevision
    );

  private static JsonArray ChangeResults(IReadOnlyList<ChangeResult> results)
  {
    var array = new JsonArray();
    foreach (var result in results)
    {
      var entry = new JsonObject
      {
        ["index"] = result.Index,
        ["outcome"] = Name(result.Outcome),
      };
      if (result.RecordId != Guid.Empty)
      {
        entry["id"] = result.RecordId.ToString();
      }
      if (result.Outcome is ChangeOutcome.Applied or ChangeOutcome.Unchanged)
      {
        entry["revision"] = result.Revision;
      }
      if (result.Outcome == ChangeOutcome.Conflict)
      {
        entry["revision"] = result.Revision;
        entry["record"] =
          result.CurrentPayload is null ? null : JsonNode.Parse(result.CurrentPayload);
      }
      if (result.Code is not null)
      {
        entry["code"] = result.Code;
      }
      array.Add(entry);
    }
    return array;
  }

  /// <summary>
  /// States the result of every submitted change when one change refuses the
  /// batch before the service compares the account.
  /// </summary>
  private static JsonArray Withheld(int changes, int? index, string code)
  {
    var array = new JsonArray();
    for (var position = 0; position < changes; position++)
    {
      var entry = new JsonObject
      {
        ["index"] = position,
        ["outcome"] = position == index ? Name(ChangeOutcome.Refused) : Name(ChangeOutcome.NotApplied),
      };
      if (position == index)
      {
        entry["code"] = code;
      }
      array.Add(entry);
    }
    return array;
  }

  private static int? RefusedChangeIndex(IReadOnlyList<RecordChange> writes, int? validated) =>
    validated is int position && position >= 0 && position < writes.Count
      ? writes[position].Index
      : null;

  private static string Name(ChangeOutcome outcome) =>
    outcome switch
    {
      ChangeOutcome.Applied => "applied",
      ChangeOutcome.Unchanged => "unchanged",
      ChangeOutcome.Conflict => "conflict",
      ChangeOutcome.Refused => "refused",
      _ => "not-applied",
    };

  private static IResult Refusal(
    int statusCode,
    string code,
    JsonArray? results = null,
    long? accountRevision = null
  )
  {
    var extensions = new Dictionary<string, object?> { ["code"] = code };
    if (results is not null)
    {
      extensions["results"] = results;
    }
    if (accountRevision is not null)
    {
      extensions["accountRevision"] = accountRevision;
    }
    return TypedResults.Problem(
      title: Title(code),
      statusCode: statusCode,
      extensions: extensions
    );
  }

  private static string Title(string code) =>
    code switch
    {
      RecordErrorCodes.Unauthorised => "The request carries no signed-in session.",
      RecordErrorCodes.InvalidAntiForgery => "The request carries no valid anti-forgery token.",
      RecordErrorCodes.RequestTooLarge => "The request exceeds 1 MiB.",
      RecordErrorCodes.TooManyChanges => "The request contains more than 100 changes.",
      RecordErrorCodes.RecordTooLarge => "One record exceeds 64 KiB.",
      RecordErrorCodes.UnsupportedRecordVersion => "The service does not support that record version.",
      RecordErrorCodes.InvalidRecord => "One record is not a supported record.",
      RecordErrorCodes.CrossAccountRecord => "One change names a record of another account.",
      RecordErrorCodes.Conflict => "One change conflicts with the account.",
      RecordErrorCodes.ValidationUnavailable => "Record validation did not complete.",
      RecordErrorCodes.SynchronisationFailed => "The service could not apply the request.",
      _ => "The request is not a valid synchronisation request.",
    };

  private static async Task<ReadOnlyMemory<byte>?> ReadBoundedBodyAsync(
    HttpRequest request,
    CancellationToken cancellationToken
  )
  {
    if (request.ContentLength > RecordSynchronisationLimits.MaximumRequestBytes)
    {
      return null;
    }

    using var body = new MemoryStream();
    var buffer = new byte[8192];
    while (true)
    {
      var read = await request.Body.ReadAsync(buffer, cancellationToken);
      if (read == 0)
      {
        break;
      }
      if (body.Length + read > RecordSynchronisationLimits.MaximumRequestBytes)
      {
        return null;
      }
      body.Write(buffer, 0, read);
    }

    return body.ToArray();
  }
}
