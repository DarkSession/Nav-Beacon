## Context

See [proposal.md](./proposal.md) for the reason for this change. The accepted constitution forbids
an application server, accounts and server persistence. This design therefore includes a major
constitutional amendment before any server code can be accepted.

The existing Angular application owns model reconstruction and calculations through
`@elite-dangerous-almanac/core`. The server cannot become another game-data source. A small Node
command uses the same pinned package to convert candidate `Loadout` events before the ASP.NET
service stores them. The browser also reconstructs and calculates values through the package.

Frontier `/profile` does not provide a complete ship loadout. Live CAPI journal `Loadout` events are
the fleet loadout source. EDOverwatch provides a working reference for OAuth refresh, dated journal
requests, line cursors and incomplete-response retries. Its source is an implementation reference,
not a dependency: <https://github.com/DarkSession/EDOverwatch/blob/master/src/EDCApi/CAPI.cs> and
<https://github.com/DarkSession/EDOverwatch/blob/master/src/EDDataProcessor/CApiJournal/JournalProcessor.cs>.

.NET 10 is the current LTS release and is supported until November 2028. The server targets its
latest supported patch: <https://dotnet.microsoft.com/en-us/platform/support/policy>.

## Goals / Non-Goals

**Goals:**

- Keep the existing anonymous product local-first and independent of account service availability.
- Give one Frontier Commander a secure account, synchronised records and a read-only owned-ship
  projection whose journal coverage is stated.
- Store only data named by an accepted requirement.
- Let any API instance handle any request without process-local Commander state.
- Keep package-owned game data and calculations under the pinned Almanac package at both loadout
  boundaries.

**Non-Goals:**

- Complete Commander progress, inventory, materials or credits.
- A claim that the owned-ship projection is complete when journal coverage cannot confirm it.
- Legacy game data, local journal upload or continuous journal polling.
- Real-time push, Redis, RabbitMQ, a background scheduler or a general cache.
- Social sign-in, application passwords, public profiles or server-side sharing.
- Editing a Frontier-confirmed owned ship in place.

## Decisions

### 1. Amend the constitution for the optional Commander service

Principle I becomes `Local-First with Optional Commander Services`. It permits a same-origin
application API, Frontier authentication, feature-specific Frontier requests and selected remote
persistence. It keeps these constraints:

- anonymous tools store records in memory, browser storage or URL fragments;
- build and loadout payloads never enter a path, query or referrer;
- browser code contacts only its own origin, except for deliberate navigation during Frontier OAuth;
- the server contacts only Frontier for accepted Commander features;
- telemetry, analytics and third-party beacons remain prohibited;
- non-Commander capabilities remain available offline after first load;
- cached Commander records remain readable when the service is unavailable.

The constitution version becomes 11.0.0. Its sync impact report names
`ship-builder/build-lifecycle`, `equipment-builder/loadout-persistence`,
`equipment-builder/loadout-assembly`, `ship-builder/build-link`, `ship-builder/slef-exchange`,
`platform/journal-files`, `platform/published-addresses` and `platform/application-delivery` as
invalidated specifications. Principle V permits Frontier OAuth state to expire after ten minutes
and permits other security credentials to expire. An expired state ends only that sign-in attempt
and changes no local work. No security expiry needs another WCAG 2.2.1 exclusion. Principle VIII
applies an 80% line, branch and method coverage floor to .NET unit tests. The technology constraints
add .NET 10, ASP.NET Core, EF Core, PostgreSQL and the Node runtime already used by the repository.
They replace the static-only deployment rule with a static Angular output served beside a separate
same-origin API.

Alternative considered: keep the constitution unchanged and treat the service as an exception. This
is invalid because governance names introducing a server as a major amendment.

### 2. Use a modular monolith in this repository

Add one ASP.NET Core application under `server/` with account, record-sync and fleet modules. Add
unit and integration test projects under `server/tests/`. Each module owns its API, application
logic and persistence mapping, but all modules deploy as one process.

The browser resolves `api/...` against the document base address. Production at the origin root
therefore uses `/api`; a sub-path deployment uses its own base-relative API address. The public edge
serves Angular files and routes that API address to any healthy server instance.

Alternative considered: separate services for identity, records and journal ingestion. They add
deployment, messaging and consistency work without an independent scaling need.

### 3. Use .NET 10, EF Core and PostgreSQL

The server targets .NET 10 LTS. EF Core migrations own the PostgreSQL schema. PostgreSQL holds
durable state, synchronisation order, journal cursors, session revocation and refresh exclusion.
API processes hold no required session or job state.

The project's seven-day dependency maturity rule applies to NuGet packages. The implementation
records exact versions and verifies their publication times through NuGet registration metadata
before restore. A younger security fix requires the same advisory-named, exact-version exception as
another project dependency and removes that exception after seven days.

PostgreSQL row locks prevent two requests from refreshing one Frontier token or journal cursor at
the same time. This avoids a Redis lock. A later measured bottleneck can justify a cache or queue in
a separate change.

Alternative considered: add Redis and RabbitMQ in the foundation. No accepted capability needs
distributed transient state, push delivery or independent workers.

### 4. Use server-side OAuth and opaque browser sessions

The server performs Frontier's authorisation-code flow. It stores a state hash, browser-correlation
hash and expiry for each attempt in PostgreSQL. The starting browser receives the random correlation
value in a temporary secure, HTTP-only, same-site cookie. A callback must match both hashes. It is
valid when server elapsed time is less than ten minutes and invalid when server elapsed time is ten
minutes or more. The callback atomically deletes and consumes its attempt row, so another instance
cannot accept a replay. A sign-in start or callback removes expired rows without a background job. A
late, repeated or cross-browser callback ends that attempt and offers a fresh sign-in. If a state
hash matches but browser correlation does not, the callback atomically deletes that attempt before
it reports the refusal. The starting browser cannot reuse it.

The callback reads the Frontier Customer ID and Commander name, protects the tokens and creates an
opaque browser session. A session has a 30-day renewable lifetime and a 180-day absolute lifetime,
both measured by server time. Renewable expiry is 30 days after creation or the last renewal, not
the last protected request. The first successful protected request at least 24 hours after the last
renewal sets renewable expiry to 30 days after that request and never beyond absolute expiry. A
sign-in start or protected request removes expired session rows. When the browser detects expiry, it
clears account state and the fleet cache. It keeps planning records and current work. A protected
request asks for sign-in again after a session or Frontier credential expires.

The cookie contains only a random session secret. The database stores its hash, account identity and
expiry. The cookie is `Secure`, `HttpOnly` and `SameSite=Lax`. State-changing API requests require a
same-origin anti-forgery token. Sign-out revokes one session and clears browser account state and the
fleet cache. When account deletion is confirmed, the browser first clears account and fleet state,
clears pending remote operations, and marks retained planning records local-only. It sends the
authenticated deletion only after that local transaction commits. A local storage failure stops the
request and states the failure. A committed deletion removes the account in one server transaction.
If the response is lost, the browser stays anonymous and local-only. A later sign-in either finds
the account when the transaction did not commit or creates it again when deletion committed. Local
records do not upload in either case until an explicit save or copy makes them eligible.

Frontier tokens are protected with ASP.NET Core Data Protection. Every instance uses the same
application name and a PostgreSQL key ring. Production configuration must encrypt that key ring at
rest with a deployment-managed certificate or key. Microsoft documents shared EF Core key storage
for multiple instances: <https://learn.microsoft.com/en-us/aspnet/core/security/data-protection/implementation/key-storage-providers?view=aspnetcore-10.0>.

Alternative considered: send Frontier tokens to Angular and store them in browser storage. Script
access and cross-device copies would increase the token exposure surface.

### 5. Use explicit feature tables and validated versioned payloads

The initial schema contains these records:

| Record              | Key                                      | Stored values                                                                                                           |
| ------------------- | ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Commander account   | Frontier Customer ID (`bigint`)          | Commander name, protected Frontier token material and monotonic record revision                                         |
| OAuth attempt       | Hash of random state                     | Browser-correlation hash and ten-minute expiry                                                                          |
| Session             | Hash of random session secret            | Customer ID, renewable expiry, absolute expiry and last renewal time                                                    |
| Synced record       | Customer ID plus application record UUID | One exact live-record or tombstone contract, record revision, server content time and optional protection deadline      |
| Owned ship          | Customer ID plus Frontier `ShipId`       | Source date-line tuple and validated package-produced ship model                                                        |
| Journal cursor      | Customer ID                              | Coverage start date, next-unread date-line tuple, last `StoredShips` result or absence, and next permitted refresh time |
| Data-protection key | Framework key identity                   | Protected ASP.NET Core key material                                                                                     |

The synchronised-record and owned-ship payloads use PostgreSQL `jsonb`, but neither accepts an
arbitrary document. A live ship record contains only its UUID, `ship` discriminator, named or
working kind, creation time, browser modification time, supported record format and version, and a
build. The build contains only its format, version, hull symbol, ship name, ship ident and module
entries. Each module entry contains only its game slot key, module symbol, enabled state, priority,
package pre-engineering identity and ordinary engineering identity. A pre-engineering identity
contains only module symbol, blueprint `fdname`, grade, acquisition identity and experimental-effect
`fdname` or null. Ordinary engineering contains only blueprint `fdname` or null, grade, completed
quality and experimental-effect `fdname` or null. A named record uses the build's ship name when
present. The accepted ident or hull fallback is derived for display when that name is absent. The
record holds no second name, hull listing copy or validation copy.

A live equipment record contains only its UUID, `equipment` discriminator, named or working kind,
name or null, creation time, browser modification time, supported record format and version, and a
loadout. The loadout contains only its format, version, suit family, suit grade, ordered suit
modification slots, and ordered weapon mounts. Each fitted weapon contains only its symbol, grade
and ordered modification slots. Each modification slot contains only a package modification symbol
or null. Each weapon mount contains only a fitted weapon or null. The record holds no second
suit-family copy.

A tombstone contains only the Customer ID relation, record UUID and server revision. Replacing a
live row with a tombstone removes its payload, times, kind, name and protection deadline. Neither
live contract contains a note, source-named relation, local revision, device claim, calculated
value, catalogue fact, price or validation snapshot. The server checks the strict shape and then
passes every supported live record to a bounded Node validation command. That command uses the same
browser reconstruction functions and pinned Almanac packages. The transaction accepts a record
only when complete reconstruction succeeds. A server version stores only formats it supports. An
older browser can therefore receive a supported server record whose version that browser cannot
yet open and keep it remote.

Record mode receives only the already bounded synchronisation request. One command handles one
request, has a 30-second deadline and can return at most 64 KiB. A timeout, oversized output, crash or
non-zero exit refuses the complete synchronisation batch before a database write.

An owned-ship payload contains only the package-produced model listed by 020/FR-015. No table stores
a raw CAPI response, a general journal event or an unresolved identity.

Alternative considered: normalise every module field into relational tables. It makes each existing
versioned browser format change a database migration and gives the server ownership of build shape.

### 6. Synchronise through an account revision stream

Each account has a monotonic record revision. A client sends its last accepted account revision and
local changes. The service validates the complete batch, locks the account, and evaluates every
change before it writes. An invalid or conflicting change refuses the complete batch. The response
gives an indexed result for every change and the account cursor stays unchanged. If all changes can
apply, one transaction writes them and returns changed records and tombstones after the client's
account revision. Each changed content record or tombstone receives the next account revision. A
protection renewal does not change the record revision or account revision.

An identical write against a record that already contains the submitted content succeeds as a
no-op and returns its current revision. Deleting an existing tombstone also succeeds as a no-op and
returns that tombstone. These rules make retry safe when the client did not receive a committed
response. The client advances its cursor and clears the matching pending operations only after it
commits the complete response to browser storage. A tombstone prevents a device that has been
offline from uploading a deleted record as if it were new.

Each local record is unbound, bound to one Frontier Customer ID or local-only. At first sign-in, only
unbound records and records bound to that Customer ID become remote records. A record bound to
another account remains usable locally but does not enter the signed-in account. Account deletion
marks retained records local-only, so another account cannot receive them without an explicit new
save or copy.

Existing local UUIDs become remote record identities when eligible. Different UUIDs remain
different even when names or payloads match. Records with one UUID merge only when every field of
their live-record contract is equal. Server revision, server content time and protection deadline do
not affect equality. Any synchronised-field difference enters the stale-write conflict. Cancel
keeps both versions unchanged, marks the local version local-only and clears its pending operation.

The client synchronises after first sign-in, when a record library opens, after a local save or
autosave, after deletion, and after an explicit retry. It does not poll for record changes
continuously. A signed-in live page sends a protection renewal at least once each day while online.
The server moves the record's protection deadline eight days forward. Network failure leaves the
local transaction complete and marks the operation pending.

A stale write returns both revisions. The shared conflict interaction offers overwrite, keep both
and cancel. Keep both mints a UUID for the local version. The service records server content time
when it first accepts a historical local record and whenever it accepts a content change. Device
times remain part of the preserved local contract but never control server expiry or revision
order. An unnamed record expires only when seven days from its server content time and its
protection deadline have both passed. The first accepted autosave receives a protection deadline
eight days after server acceptance. A renewal moves only that deadline to eight days after server
receipt. Expiry writes a tombstone like an explicit delete. An offline live page keeps its local
record and receives a deletion conflict when it next synchronises.

For a deletion conflict, overwrite restores the record under its old UUID and supersedes the marker
with a newer revision. Keep both retains the marker and uploads the local version under a new UUID.
Cancel retains the marker, marks the local version local-only and clears the pending operation.
An unchanged record that a live page currently claims also becomes a deletion conflict. The page
keeps its active work and pauses autosave. Explicit resume uses overwrite and restores the old UUID.
An unchanged record that no live page claims is removed after synchronisation.

Alternative considered: last-write-wins timestamps. Device clocks and delayed writes could silently
discard work.

### 7. Project owned ships from journal events without retaining the journal

The first refresh cursor is the request date minus 14 days at line zero, matching the bounded
approach in the EDOverwatch reference. The cursor is the next unread UTC journal date and zero-based
line index. The date-line tuple, not an event timestamp, defines journal order. After line `n`
commits, the cursor becomes the same date and line `n + 1`. After a complete day ends, including an
empty day, it becomes the next UTC date and line zero. An incomplete response does not advance to
the next date. A package-refused `Loadout` stops before that line and retains the prior cursor and
fleet. The same line is retried after a package update can resolve it. A non-empty malformed line
also stops before that line and is retried rather than skipped.

The journal reader retries a network timeout, HTTP 429, HTTP 502, HTTP 503, HTTP 504 or a response
that Frontier marks incomplete. It makes at most three attempts for one dated response in one
refresh. Without `Retry-After`, it waits one second before the second attempt and two seconds before
the third. It honours `Retry-After` up to 30 seconds inside the request. A longer `Retry-After` ends
the request and sets the next permitted refresh time to that value. After the third retryable
failure, the next permitted time is the later of a supplied `Retry-After` and 60 seconds after the
failure. A successful complete response clears that delay. Other HTTP failures do not retry. One
token refresh may follow an authentication failure; another failure marks authorisation expired.

Only one API instance may refresh an account at a time. The per-account next permitted refresh time
lives in PostgreSQL. A refresh runs within the request for this change; no background worker or
queue is added.

The ASP.NET reader frames each journal line and reads only its event name and timestamp first. One
dated response can contain at most 25 MiB, one non-empty line at most 1 MiB, and one projection batch
at most 4 MiB and 100 candidate `Loadout` lines. The Node command has a 30-second deadline and a 4
MiB output limit. The service closes a batch before its next candidate would cross a batch bound and
starts another. One refresh handles at most ten batches, returns its accepted partial progress and
continues from that cursor on the next request. A response, line, process or output over its bound
stops before the affected line or response and does not advance the cursor over it. The application
states the bound and can retry after a compatible release or smaller Frontier response.

The service passes each candidate Live `Loadout` line unchanged to a Node command that calls
`inspectSlef` from `@elite-dangerous-almanac/core/ships/slef`. One command handles one bounded batch.
It returns only successfully constructed, package-produced ship models. A refused event is not
stored. The fleet request carries the active supported locale. The command asks the package locale
layer for its diagnostic and returns that text only in the response. The service does not store
diagnostic text or maintain its own translation of a game diagnostic.

The service adds Frontier `ShipId` and the source date-line tuple to each accepted model. It stores
only hull symbol, game slot keys, module symbols, package-identified pre-engineering, blueprint
`fdname`, completed grade, experimental-effect `fdname`, enabled state, priority, ship name and
ident. It explicitly drops the fields excluded by 020/FR-015.

A later journal-order `Loadout` replaces the projection for its `(CustomerId, ShipId)` even when two
events have the same timestamp. `ShipyardSell` removes that ship in journal order. A later
`StoredShips` event reconciles existing projections against its stored ship IDs plus the current
ship ID from the latest accepted `Loadout`. It removes an absent projection but does not create one
without an accepted `Loadout`. Its stored result contains only its date-line tuple and whether all
observed ship IDs had projections. Replays at or before an accepted tuple have no effect. Every
other event and unused field is discarded before the transaction completes.

Structured and access logs contain event category, stable result code and route template only. They
exclude Frontier Customer IDs, Commander names, tokens, OAuth codes, OAuth state,
browser-correlation values, anti-forgery values, cookies, query strings, event bodies, build data and
loadout data. The OAuth callback query is redacted before request logging runs.

Fourteen days cannot find a ship that has no `Loadout` event in that range. The journal metadata
therefore contains exactly four items: the coverage start date; the next-unread date-line tuple; the
last accepted `StoredShips` result as its date-line tuple plus `complete` or `incomplete`, or its
absence; and the next permitted refresh time. The result is `incomplete` when that event names any
ship without an accepted projection or no accepted `Loadout` identifies the current ship. A later
accepted `Loadout` does not change it. A later `StoredShips` event recomputes it. The application
states the covered interval and this result. It never treats an unconfirmed ship as nonexistent.
Future refreshes extend coverage.

Alternative considered: persist the journal for later features. This conflicts with the selected
storage rule. A future feature must add its own event projection and fields through a separate
specification.

### 8. Keep Almanac ownership at both build boundaries

The Node command is the server's only game-model parser. Its journal mode uses the pinned Almanac
package and returns the same non-derived model the browser persistence contract accepts. Its record
mode uses the browser's strict record parsers and reconstruction functions with the pinned Almanac
packages. It rejects invalid hull-slot, engineering, suit, mount, grade and modification
combinations before PostgreSQL receives them.

Angular reconstructs the stored model through `ShipLoadout`, reads names from the package and calls
`BuildMetrics.of(build)` for derived values. If the package refuses a candidate event or remote
record, nothing unresolved enters fleet or remote storage. An unknown-hull local record remains
stored but unopened under its accepted persistence contract. The application states the package
reason and the blocked work waits for an upstream package release.

Alternative considered: use a separate game-data library on the server. Two data sources could
disagree and would violate Almanac ownership.

### 9. Use small same-origin HTTP contracts

The first API surface is:

- `GET api/session`, `POST api/auth/frontier`, `GET api/auth/frontier/callback`,
  `POST api/session/sign-out` and `DELETE api/account`;
- `POST api/records/synchronise` for revision-based batch exchange;
- `GET api/fleet` and `POST api/fleet/refresh`.

The server publishes an OpenAPI contract for tests. The small Angular client uses direct typed fetch
methods and does not add a generated-client toolchain. Problem Details responses use stable
application error codes and no personal payload. One record payload is limited to 64 KiB of UTF-8
JSON. One synchronisation request is limited to 100 changes and 1 MiB of UTF-8 JSON. An over-limit
request is refused atomically before any change. Database and Frontier calls have cancellation and
bounded timeouts. Health checks report only service and dependency state.

Alternative considered: GraphQL. The initial operations are fixed workflows with small contracts,
so query flexibility does not justify another runtime.

### 10. Screen inventory

All application-owned text uses the localisation layer. All surfaces use the design system and its
tokens. The interfaces support desktop, tablet and mobile, both orientations and touch. They meet
WCAG 2.2 AA except 2.1.1, 2.1.2, 2.1.4, 2.2.1, 2.4.1, 2.4.3, 2.4.7 and 2.4.11.

| Surface                                                 | Design-system composition                                                                | States                                                                                                                                                                | Requirements                                   |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| Application frame account action and account dialog     | Frame action, modal, status text, action buttons and confirmation dialog                 | Anonymous, redirect pending, correlation refused, signed in, offline, expired session or authorisation, sign-out and account-deletion confirmation                    | 020/FR-001–006, 020/FR-022–024                 |
| Ship-build and equipment-loadout record libraries       | Existing record list and editors, sync status, pending marker and shared conflict modal  | Local only, first merge, current, pending, failed, account-bound, local-only, stale-write conflict, remote deletion conflict and unsupported remote version           | 020/FR-007–012, 020/FR-019–022, 020/FR-024–026 |
| Owned ships view in the Ship Builder stored-build layer | Existing layer, view selector, responsive ship list, selected-ship facts and copy action | Sign-in required, loading, current, incomplete coverage, no confirmed ships, waiting for Frontier, failed refresh, expired authorisation and refused package identity | 020/FR-013–018, 020/FR-022                     |

The owned-ships view uses the existing `/outfitting` address and adds no advertised address. Help
remains reachable through the common frame action after the stored-build layer closes. The help
route coverage record gains the account dialog, account-deletion confirmation, owned-ships layer and
conflict layer states. The fixed two-topic help content does not change. Account data use is
explained in the account dialog.

### 11. Test each boundary at its owner

Server unit tests cover OAuth state, session hashing, token protection, payload validation, revision
conflicts, account isolation, journal framing, package projection, cursor movement, partial
responses, ownership reconciliation and data deletion. Server coverage fails below 80% for lines,
branches or methods.
PostgreSQL integration tests run against a real disposable database and cover migrations, unique
keys, row locks, cascades and revision order. HTTP contract tests use a fake Frontier handler and
verify that logs and responses contain no protected data.

Angular unit tests cover account state, first merge, account isolation, offline queuing, conflict
choices, fleet reconstruction and refused Almanac identities. Playwright covers each user journey in the ten
existing browser and layout projects and runs the full accessibility scan on each state. Manual
screen-reader and 400% zoom protocols include the account dialog, record conflict and owned-ships
view.

## Risks / Trade-offs

- [The initial journal window misses ships not loaded during that period] → State that coverage is
  incomplete, state the covered interval and extend it on later refreshes.
- [A Frontier journal contract changes] → Validate every projected field, keep the last accepted
  fleet and report the refresh as failed or incomplete.
- [Two instances refresh one account] → Use a PostgreSQL row lock and commit the cursor with the
  projection.
- [Database availability affects signed-in features] → Keep local records authoritative for offline
  work and keep cached Commander records readable.
- [Deletion markers grow over time] → Keep only opaque record identities and revisions. Set a
  retention policy only when the product can prove that every supported offline device has passed
  the marker.
- [JSON payloads become an unreviewed data sink] → Accept only the exact versioned fields in
  020/FR-015 and the existing record contracts.
- [The package is ESM-only while the server is .NET] → Invoke one bounded Node command per refresh,
  pass candidate lines through standard input and fail the refresh if the command fails.
- [Protected tokens outlive a server deployment] → Share and back up the protected key ring, encrypt
  it at rest and test rotation before production.
- [The server increases operational cost] → Start as one modular process with PostgreSQL and add no
  optional infrastructure.

## Migration Plan

1. Amend the constitution to version 11.0.0 and apply all invalidated specification deltas.
2. Add the .NET solution, PostgreSQL schema, migrations and tests without changing anonymous browser
   behaviour.
3. Deploy PostgreSQL and the server with Frontier OAuth and key protection configured.
4. Route base-relative `api/` requests to the server and verify multiple instances share sessions,
   token protection and refresh exclusion.
5. Deploy the Angular account and record-sync client. Existing local records remain local until a
   Commander signs in.
6. Enable the owned-ships view after account deletion, selective journal storage and
   incomplete-coverage tests pass.
7. If rollback is required, deploy the earlier Angular client first. Keep the server schema and data
   until the retention and deletion policy permits removal, because removing it would destroy
   synchronised records.
