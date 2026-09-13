# Commander service deployment

How the optional Commander service is deployed, changed and rolled back. The anonymous planning
tools do not read any of it: they are static files and keep working when no instance is running.

## What one deployment holds

- One public origin. It serves the built Angular files and routes the API address.
- One or more API instances of the same build. Any instance answers any request.
- One PostgreSQL database. It holds accounts, sessions, records, cursors and the key ring.
- One data-protection key ring, shared through that database.
- One deployment-managed certificate that encrypts the key ring at rest.

## Same-origin routing

The browser asks for `api/...` relative to the document base address, so the API is on the same
origin as the files. The edge is what makes that true.

1. Serve the built Angular files at the origin.
2. Route every request under the base-relative `api/` address to a healthy API instance.
3. Route `health` the same way, and use it to decide which instances are healthy.
4. If the origin serves the application at its root, route `/api/` and leave `PathBase` unset.
5. If the origin serves the application under a sub-path, set `PathBase` to that sub-path on every
   instance and route `<sub-path>/api/`.
6. Terminate TLS at the edge, and forward `X-Forwarded-Proto` and `X-Forwarded-For`.

An instance believes those two headers only from an address the deployment names, so name the edge
in `Deployment:KnownProxies` or `Deployment:KnownNetworks`. Without the scheme header an instance
answers `307` and sends the browser to `https`.

## Settings each instance reads

Settings come from `appsettings.json` and from the environment. An environment variable spells a
nested key with two underscores: `Deployment__KnownProxies__0`. Hold every secret in the
deployment's own secret store, never in a file in this repository.

| Setting                              | Holds                                                      |
| ------------------------------------ | ---------------------------------------------------------- |
| `ConnectionStrings:NavBeacon`        | The PostgreSQL link, with `SSL Mode` at `Require` or above |
| `Frontier:ClientId`                  | The Frontier OAuth client                                  |
| `Frontier:ClientSecret`              | The Frontier OAuth client secret                           |
| `Frontier:RedirectUri`               | The absolute `https` callback address on the public origin |
| `DataProtection:CertificateBase64`   | The PKCS#12 certificate that encrypts the key ring         |
| `DataProtection:CertificatePassword` | That certificate's password                                |
| `Deployment:KnownProxies`            | The edge addresses whose forwarded headers count           |
| `Deployment:KnownNetworks`           | The edge networks, in CIDR form, whose headers count       |
| `Deployment:RequireHttps`            | `true` in production; an instance refuses `false` there    |
| `Kestrel:Limits:MaxRequestBodySize`  | The largest body an instance reads, in bytes               |
| `PathBase`                           | The sub-path the origin serves the application under       |
| `RecordValidation:ScriptPath`        | The validator bundle in record mode, from the content root |
| `FleetProjection:ScriptPath`         | The same bundle in journal mode, from the content root     |

A production instance reads the Frontier settings, the Data Protection pair, the database link,
`Deployment:RequireHttps`, the known-proxy and known-network pair and the request body limit before
it serves anything. If one of those is absent or unsafe it names every unfit setting and stops. A
refusal names the setting and never its value.

`PathBase` and the two `ScriptPath` settings are not read at start-up. An instance whose validator
bundle is missing or unreadable starts and serves, and the first request that needs the bundle is
where it shows: a record synchronisation answers `503` with `validation-unavailable`, and a fleet
refresh answers with `projection-unavailable`. Step 6 of _Checking a deployment_ is what catches
this.

The body limit stands above the 1 MiB synchronisation batch so a request just over the batch bound
reaches the endpoint and receives the stated error code rather than a bare transport refusal. It is
between 1,048,577 and 4,194,304 bytes — one byte above the batch bound at its lowest, because a
limit equal to the bound would cut off the very request the error code is written for.

One bundle, `commander-validator.mjs`, is the output of `pnpm run server:validator`, and both script
settings name it. Publish it beside the application and give the instance a Node runtime on its
path.

## Applying migrations

The deployment applies migrations. A starting instance never does, because several instances start
together and one of them would meet a schema the others are still writing.

1. Before starting any instance of a release, run `pnpm run server:migrate` once, against the
   deployment's database.
2. If the command fails, stop. Do not start the release.
3. Start the instances of the release.

An instance whose schema is behind its build stops with
`The PostgreSQL schema is behind this server build.` Read that as a deployment that started
instances before it applied the migration.

## Running several instances

An instance keeps no Commander state of its own, so instances need no affinity and no shared cache.
Sessions, Frontier credentials, records, cursors and the key ring are all in PostgreSQL.

1. Give every instance the same database, the same key ring certificate and the same build.
2. Start each instance and wait for `health` to answer `Healthy`.
3. Add an instance to the edge only after its health check passes.
4. To restart a release in place, take one instance out of the edge, restart it, wait for its
   health check, and then take out the next.

A session created against one instance is accepted by every other instance. A value one instance
protects is unprotected by every other instance, because they share one key ring and one
application name.

## Backing up and restoring the key ring

The key ring is the `data_protection_keys` table. Losing it makes the stored Frontier tokens
unreadable, so every Commander is asked to sign in with Frontier again, and it invalidates the
anti-forgery tokens already issued, which the next `GET api/session` replaces. Commander sessions
survive it: a session is a hashed secret in the database and does not use the ring. The certificate
that encrypts the ring is equally load-bearing: a restored ring without its certificate is
unreadable.

1. Keep the key ring certificate in the deployment's secret store, with the same retention as the
   database backup.
2. To back up the ring, run
   `pg_dump --table data_protection_keys --data-only --column-inserts` against the database.
3. To restore the ring, load that dump with `psql` into the database the instances read.
4. After a restore, check one protected value: read `api/session` on one instance and use the
   anti-forgery token it returns against another instance.
5. If the check fails, the certificate does not match the restored ring. Restore the certificate
   that was current when the ring was written.

Instances that start together may each add a key to the ring. That is expected: every instance
reads every key in the ring.

## Rollback order

Rolling back removes the client first and the data last, because the records belong to Commanders.

1. Deploy the earlier Angular client.
2. Leave the API instances serving. The earlier client does not call them.
3. Keep the server schema and the data as they are.
4. Remove the schema and the data only when the retention and deletion policy permits it. Removing
   them destroys synchronised records.
5. If the API itself is at fault, stop the instances and leave the database standing.

## Checking a deployment

Run these against the deployment after a release, in this order.

1. `pnpm run server:migrate` reports no pending migration.
2. `health` answers `Healthy` on every instance.
3. `api/session` answers `401` with `signedIn: false` for a browser with no session.
4. A Commander signs in through the edge, and `api/session` answers `200` on another instance.
5. `api/fleet/refresh` on one instance answers `200` for a Commander who signed in on another.
6. A record synchronisation answers `200` rather than `503` with `validation-unavailable`, which is
   what a missing or unreadable validator bundle looks like from the outside.
