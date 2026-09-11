## 1. Constitutional and project foundation

- [x] 1.1 Amend `CONSTITUTION.md` to version 11.0.0 and update `AGENTS.md` with the local-first,
      optional-server, security-expiry, .NET coverage and NuGet maturity rules from the design; add the
      `commander` capability group to the documented OpenSpec layout; verify the constitution names all
      eight invalidated specifications and both files pass the repository Markdown formatter.
- [x] 1.2 Add a .NET 10 solution with one ASP.NET Core application and unit and integration test
      projects under `server/`; verify `dotnet restore`, `dotnet build --no-restore` and `dotnet test
--no-build` pass.
- [x] 1.3 Add only the ASP.NET Core, EF Core, Npgsql, coverage and test packages required by this
      change; verify NuGet registration metadata shows each selected release is at least seven days old,
      the dependency audit reports no known vulnerability and no Redis, SignalR or messaging package is
      present; if a younger security fix is required, first record the advisory and exact-version
      exception under the project dependency policy.
- [x] 1.4 Add local PostgreSQL configuration, secret placeholders and a container-based development
      service without committed credentials; verify a fresh environment starts the database and the
      server health check succeeds.
- [x] 1.5 Add server restore, formatting, build, test and 80% line, branch and method coverage checks
      to the repository and CI gates; verify a deliberate coverage failure fails the main check and the
      restored test makes the gate pass.

## 2. Data model and protection

- [x] 2.1 Implement the EF Core model for Commander accounts, OAuth attempts, sessions, synchronised
      records, owned ships, journal cursors, account revisions and data-protection keys; verify
      PostgreSQL integration tests enforce every primary key, foreign key, unique key, cascade,
      session lifetime, server content time and exact tombstone shape in the design.
- [x] 2.2 Add the initial EF Core migration and database startup check; verify the migration applies
      to an empty PostgreSQL database and rolls back without a manual schema change.
- [x] 2.3 Implement the exact ship, equipment, tombstone and owned-ship JSON contracts plus the
      bounded package-backed Node validator; verify contract tests reject unknown fields, duplicate
      listing fields, notes, source relations, local revisions, device claims, derived values, unknown
      identities, invalid hull-slot, engineering, suit, mount, grade and modification combinations,
      over-limit bodies and every field excluded by 020/FR-012 and 020/FR-015; verify the 30-second
      record-validator deadline refuses at the boundary, 64 KiB output is accepted, one byte more is
      refused, and a timeout, crash or non-zero exit refuses the complete batch.
- [x] 2.4 Configure a shared PostgreSQL ASP.NET Core Data Protection key ring with required
      production encryption-at-rest settings; verify two test server instances can unprotect the same
      protected value and startup fails when production key protection is absent.
- [x] 2.5 Add structured and access-log filtering before callback logging; verify successful and failed
      requests log no Customer ID, Commander name, token, OAuth code, OAuth state,
      browser-correlation value, anti-forgery value, cookie, query string, journal body, build data or
      loadout data, record name, record UUID, `ShipId` or package diagnostic text and record only the
      callback route template.

## 3. Frontier account

- [x] 3.1 Implement the Frontier OAuth client, single-use state handling, token refresh and profile
      identity read; verify fake-Frontier tests cover success, the ten-minute state boundary, rejected
      state, expired tokens, refresh failure, unchanged local work after expiry, same Customer ID with a
      changed name and rejection of non-Live data; verify two instances accept one callback once and
      remove used and expired state rows; verify a callback without the starting browser's correlation
      cookie atomically consumes the attempt, creates no session, starts no upload and cannot be replayed
      by the starting browser; verify the account interface states that a fresh sign-in is required.
- [x] 3.2 Implement hashed opaque sessions, secure cookie settings and anti-forgery checks; verify
      HTTP tests prove tokens never reach the browser and cross-site state-changing requests fail.
- [x] 3.3 Implement session, sign-in callback and sign-out endpoints with base-relative return
      addresses; verify contract tests cover anonymous, pending, signed-in, revoked, 30-day renewable and
      180-day absolute expiry, mandatory first-request renewal after 24 hours, expiry from the last
      renewal rather than the last request, no second daily write, opportunistic row removal and
      fleet-cache cleanup.
- [x] 3.4 Implement confirmed account deletion as one database transaction; verify an integration
      test removes identity, tokens, all sessions, remote records, deletion markers, fleet projections
      and cursor metadata while a browser fixture clears account state, fleet cache, sync state and
      pending operations before the request but keeps its planning records local-only; verify committed
      lost-response and uncommitted failure cases both stay anonymous, never upload retained records and
      allow a later sign-in to create or delete the account as applicable; verify a refused local
      cleanup sends no server deletion and leaves the account available for another attempt.
- [x] 3.5 Add the frame account action and account dialog with localised design-system components;
      state the exact account data use there and verify component tests cover every state in the screen
      inventory at desktop, tablet and mobile widths, both orientations, with touch-sized actions and no
      horizontal page scrolling; add component previews for every state and verify each at 200% text.

## 4. Cross-device record service

- [x] 4.1 Implement the account revision stream and synchronisation request validation; verify
      integration tests return only records and tombstones after the supplied account revision; verify
      a mixed batch is atomic, returns one indexed result per change and leaves the cursor unchanged on
      any invalid, cross-account or conflicting change; verify a lost committed response retries as
      no-ops without another revision.
- [x] 4.2 Implement conditional record writes with database revisions; verify concurrent PostgreSQL
      tests accept one stale pair of writes and return both versions for overwrite, keep-both or cancel;
      verify equality covers every live-contract field, a changed name or named state conflicts,
      identical stale content is a no-op and cancel clears the pending operation by making the local
      version local-only.
- [x] 4.3 Implement record deletion markers, the remote protection deadline and unnamed-record
      expiry; verify an online live page renews protection, expiry waits for both deadlines and an
      offline live page receives a conflict without losing its local record; verify server time controls
      first upload and later content expiry despite skewed device clocks, and renewal changes no content
      or account revision.
- [x] 4.4 Implement the authenticated synchronisation endpoint with body limits and Problem Details
      error codes; verify API tests cover each record kind, the 64 KiB record bound, the 100-change and
      1 MiB batch bounds, atomic refusal, unsupported versions, unauthorised access, cancellation and
      database failure; verify 65,536 bytes, 100 changes and 1,048,576 bytes are accepted while one
      byte or change above each limit is refused; verify one Commander session cannot read, change or
      delete another Commander's records, including when those operations share a mixed batch.

## 5. Angular record synchronisation

- [x] 5.1 Add a typed, base-relative account and record API client with no new client-generation
      dependency; verify unit tests resolve requests correctly at root and sub-path base addresses.
- [x] 5.2 Extend browser persistence with remote revisions, account cursors and pending operations
      plus unbound, Customer-bound and local-only record states while keeping device claims and notes
      local; verify migration tests preserve every supported record and never serialise a note into a
      request.
- [x] 5.3 Implement first-sign-in merge and later synchronisation triggers in framework-agnostic
      stores; verify tests cover local-only, remote-only, same-name, same-identity equal and divergent,
      offline, lost committed responses and interrupted local commits without silent loss or duplicate
      revisions.
- [x] 5.4 Implement shared overwrite, keep-both and cancel handling for stale writes and remote
      deletion conflicts; verify overwrite supersedes the marker under the old identity, keep-both
      retains it and mints an identity, and cancel retains it while marking the local copy local-only and
      clearing the pending operation; verify an unchanged active record survives remote deletion,
      pauses autosave and uses overwrite on explicit resume, while an unclaimed unchanged copy is
      removed.
- [x] 5.5 Connect ship-build and equipment-loadout named saves, autosaves, deletes and seven-day
      expiry to the shared synchronisation store; verify existing anonymous persistence tests still pass
      and signed-in tests synchronise and renew live-page protection for both record kinds without
      sending records bound to another Customer ID; verify skewed browser clocks cannot expire a remote
      record early.
- [x] 5.6 Let a signed-in fragment, SLEF or selected-journal import enter synchronisation only after
      browser reconstruction and record persistence; verify network tests prove the source request and
      import operation send no fragment, SLEF, file, line, event, provenance or capture-only data and
      anonymous opening sends no build data; verify selected-journal ship-build and equipment-loadout
      records both follow this boundary.
- [x] 5.7 Add localised current, pending, failed and conflict states to both record libraries with
      existing design-system parts; verify component tests cover 200% text and all screen-inventory
      states at desktop, tablet and mobile widths in both orientations, with touch-sized actions and no
      colour-only meaning; add component previews for every state.

## 6. Live journal and owned fleet service

- [x] 6.1 Implement a small Live CAPI client for dated journal responses, empty days, incomplete
      responses, authorisation refresh, cancellation and bounded retry; verify fake-Frontier tests cover
      each HTTP outcome, three-attempt limit, one-second and two-second delays, short and long
      `Retry-After`, 60-second fallback, single token refresh, next-permitted-time calculation and the
      inclusive 25 MiB response bound.
- [x] 6.2 Implement a streaming journal framer and one bounded Node projection command that hands
      candidate Live `Loadout` lines unchanged to `inspectSlef`; verify fixtures cover malformed lines,
      unknown events, non-Live events, malformed-line and package refusal without cursor advancement,
      module engineering, ship names and idents; verify the inclusive 1 MiB line, 100-line and 4 MiB
      batch, ten-batch request, 30-second process and 4 MiB output bounds plus hard-bound failures;
      verify another batch starts before its bound, the next refresh resumes after ten batches, package
      refusals use the requested supported locale and no diagnostic string is stored.
- [x] 6.3 Implement the 14-day initial cursor and transactional date-and-line continuation; verify
      integration tests prove line `n` advances to `n + 1`, a complete empty day advances to the next UTC
      date at line zero, an incomplete day does not advance to the next date, a repeated line is
      idempotent and two server instances cannot refresh one account together; verify stored import
      metadata contains only the four items allowed by 020/FR-015, including the last `StoredShips`
      tuple and completeness result.
- [x] 6.4 Implement owned-ship upsert by `(CustomerId, ShipId)`, `ShipyardSell` removal and
      `StoredShips` reconciliation in date-line order; verify equal-timestamp lines use line order,
      earlier and equal cursor replays have no effect, later `Loadout` replaces one projection, known
      sold ships leave, incomplete comparison state is retained without missing ship IDs and no raw
      event or excluded field remains after commit.
- [x] 6.5 Implement authenticated fleet read and refresh endpoints; verify tests cover current,
      empty, incomplete, waiting, failed and expired-authorisation results while preserving the last
      accepted fleet after failure; verify package feedback uses the request locale; verify one Commander
      session cannot read, refresh or change another Commander's fleet.

## 7. Commander fleet interface

- [x] 7.1 Map a validated owned-ship payload through the existing persistence domain services into
      `ShipLoadout`; verify package-backed tests cover complete models and reject unsupported or
      unresolvable identities without retaining a replacement value.
- [ ] 7.2 Add a fleet store with browser caching and refresh status; verify an offline unit test can
      read the last accepted fleet and cannot claim that a network refresh completed.
- [ ] 7.3 Add the owned-ships view to the Ship Builder stored-build layer with responsive, localised
      design-system parts; verify tests cover every state in the screen inventory, package refusal
      feedback in each supported locale and an unchanged advertised route set at desktop, tablet and
      mobile widths in both orientations, with touch-sized actions and 200% text; add component previews
      for every state.
- [ ] 7.4 Implement copy-to-builder with a fresh application record identity and no write back to the
      owned ship; verify an end-to-end test changes and deletes the copied plan while the fleet entry
      remains unchanged.
- [ ] 7.5 Update the common help-route coverage record for the account dialog, account-deletion
      confirmation, owned-ships layer and conflict layer without adding a behaviour topic; verify `pnpm
run policy:specs` resolves every governing reference and help route.

## 8. Deployment and full verification

- [x] 8.1 Add production configuration checks for PostgreSQL, Frontier OAuth, shared key protection,
      trusted proxy headers, HTTPS and request limits; verify the server refuses production startup when
      each required setting is absent or unsafe.
- [x] 8.2 Add deployment guidance for same-origin routing, EF migration execution, horizontal
      instances, key-ring backup and rollback order; verify every command against the local disposable
      deployment with two API instances.
- [ ] 8.3 Register 020/FR-001 through 020/FR-026 in the end-to-end coverage ledger and add journeys
      for optional sign-in, first merge, offline save, conflict handling, account deletion, fleet
      refresh and fleet copy; verify all ten Playwright projects run each registered journey with the
      accessibility scan enabled.
- [ ] 8.4 Add manual screen-reader and actual 400% zoom protocol steps and result records for the
      account dialog, synchronisation conflict and owned-ships view; verify both protocols record
      desktop, tablet and mobile results in both orientations.
- [ ] 8.5 Run `openspec validate add-commander-account-sync --strict`, `pnpm run policy:specs`, the
      server restore, format, build and test commands, and `pnpm run check`; verify every command passes
      with no skipped, focused or quarantined test.
- [ ] 8.6 Run the required implementation review against the complete diff, fix every actionable
      finding and rerun task 8.5; verify the final reviewer reports no actionable finding.
