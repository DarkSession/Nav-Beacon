## Why

Commanders cannot carry their saved work between devices or compare planned builds with the ships
they own. An optional Commander account layer can add those features while anonymous use keeps the
local behaviour that exists today.

## What Changes

- **BREAKING** Amend constitution principles I, V and VIII for a local-first application with an
  optional same-origin server. The amendment permits accounts, a ten-minute Frontier OAuth state
  timer, security credential expiry, selected server persistence and Frontier API access. It keeps
  anonymous tools local and applies an 80% coverage floor to .NET unit tests.
- Add Frontier sign-in for Live game accounts. The service stores the Frontier Customer ID,
  Commander name, protected Frontier tokens and required session metadata. It stores no other
  Commander data unless an accepted feature requires it.
- Synchronise named saves and unnamed autosaves for ship builds and equipment loadouts across a
  Commander's devices. First sign-in merges existing local records without a separate upload step.
- Keep notes out of remote records, links and SLEF. Keep a distinct record identity for each saved
  plan or autosave.
- Add a read-only Commander fleet from Live CAPI journal `Loadout` events. Each owned-ship record is
  identified by Frontier `ShipId` within one Commander account. Known ownership events remove ships
  that are no longer owned. The application states when available journal history cannot confirm a
  complete fleet.
- Let a Commander copy an owned ship into a separate editable saved plan. The copy receives an
  application record identity and never changes the owned-ship record.
- Keep link payloads in URL fragments. A signed-in autosave may synchronise the reconstructed record
  through the same-origin API after the link opens.
- Serve Angular and an ASP.NET Core API through one public origin. Use PostgreSQL through EF Core and
  keep API instances stateless for horizontal scaling.
- Defer Redis, SignalR, RabbitMQ, scheduled imports and general server caching until an accepted
  feature needs them.

## Capabilities

### New Capabilities

- `platform/frontier-account`: Frontier sign-in, session handling, account data limits and account
  deletion.
- `platform/cross-device-records`: Remote record identities, first sign-in merge, synchronisation,
  deletion and conflict handling.
- `commander/fleet`: Selective ingestion of Live CAPI journal `Loadout` events and a read-only view of
  the Commander's confirmed owned ships, with incomplete journal coverage stated.

### Modified Capabilities

- `ship-builder/build-lifecycle`: Saved builds and autosaves can synchronise for a signed-in
  Commander while notes remain local.
- `ship-builder/slef-exchange`: SLEF import and export stay in the browser, while a valid imported
  build record can use the separate record synchronisation flow.
- `equipment-builder/loadout-persistence`: Saved loadouts and autosaves can synchronise for a
  signed-in Commander.
- `equipment-builder/loadout-assembly`: Every local bench action stays available offline while
  remote synchronisation waits for a network.
- `ship-builder/build-link`: Opening a fragment build can create a remote autosave for a signed-in
  Commander without putting build data in the path or query.
- `platform/journal-files`: Selected journal files and their derived events stay in the browser,
  while a valid record created from an import can use the separate record synchronisation flow.
- `platform/published-addresses`: Existing planning capabilities stay available offline, while
  account connection and network synchronisation report that they need a network.
- `platform/application-delivery`: Security credential expiry is permitted without adding a
  user-interface time limit or another WCAG 2.2.1 exclusion.

## Impact

- The constitution receives a major version amendment and an invalidated-spec review.
- The repository gains an ASP.NET Core application and test projects beside the Angular
  application.
- Production needs PostgreSQL, Frontier OAuth credentials, token-protection keys and a same-origin
  route from `/api` to stateless API instances.
- The Angular application gains account, synchronisation and fleet domain stores and
  accessible localised interfaces across the existing ten-project end-to-end matrix.
- Build and deployment gates cover the .NET build, EF Core migrations, server tests, API contract
  tests and the existing browser checks.
- Server logs exclude Frontier Customer IDs, Commander names, tokens, OAuth codes, OAuth state,
  browser-correlation values, anti-forgery values, cookies, journal response bodies, build payloads
  and loadout payloads. Access logs omit the OAuth callback query.
