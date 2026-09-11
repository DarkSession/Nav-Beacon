# Contract: Distribution Artifacts

This contract defines the build boundary that makes the modal's versions, one legal excerpt,
external destinations and source-distribution terms traceable to the artifacts actually shipped. It
is a Node/tooling contract, not a runtime API.

## Inputs

The generator reads only local installed/repository artifacts plus explicit release metadata:

| Input                                                    | Authoritative value                                            |
| -------------------------------------------------------- | -------------------------------------------------------------- |
| root `package.json`                                      | application name/version                                       |
| root `LICENSE`                                           | project-specific Frontier disclaimer and distribution boundary |
| resolved Almanac `package.json`                          | exact package name and version                                 |
| resolved Almanac `LICENSE`                               | package terms mirrored in source distribution                  |
| resolved Almanac `THIRD_PARTY_NOTICES.md`                | package notices mirrored in source distribution                |
| `docs/legal/almanac/LICENSE`                             | tracked mirror of installed package licence                    |
| `docs/legal/almanac/THIRD_PARTY_NOTICES.md`              | tracked mirror of installed package notices                    |
| three audited URL constants                              | the two complete-legal-terms destinations and the source one   |
| release-workflow evidence or non-release CI/git evidence | build classification and identifier                            |

The Almanac root is located from
`import.meta.resolve('@elite-dangerous-almanac/core/ships/ships')` and relative URLs, matching the
existing codec-table generator. The pipeline does not depend on a pnpm-store path, registry request,
git remote, unexported browser import or runtime filesystem.

## Disclaimer extraction

The generator must:

1. decode root `LICENSE` as strict UTF-8;
2. find exactly one Markdown section headed
   `Elite Dangerous game data and imagery (Frontier media-usage notice)`;
3. within that section, find exactly one `Under those rules:` marker;
4. select the immediately following non-empty contiguous Markdown-indented block;
5. remove exactly four structural leading spaces from each block line and no other content;
6. reject a blank, malformed, duplicate, nested or section-crossing result; and
7. record the resulting UTF-8 bytes, byte count, SHA-256, source `LICENSE` and language `en`.

The selected block is the only legal body emitted to the browser manifest. The generator must not
emit the surrounding MIT terms, Almanac wording, third-party notices or a rewritten summary as legal
text. A generated-runtime check independently re-encodes the emitted string and compares its byte
count/hash with a fresh source extraction.

## External destinations

The audited application constant is exactly:

```text
https://github.com/DarkSession/Nav-Beacon/blob/main/LICENSE
```

It must parse as HTTPS with host `github.com`, the expected repository/ref/path, and no credentials,
port, query or fragment. It is tagged `completeLegalTerms`.

Two more are audited the same way and against their own expected paths: the bundled library's
`LICENSE`, also tagged `completeLegalTerms`, and this repository's own page, tagged `sourceCode`.
Each id is checked against the path **and** the purpose it declares, so a page cannot be published
as terms it is not.

```text
https://github.com/DarkSession/Elite-Dangerous-Almanac/blob/main/LICENSE
https://github.com/DarkSession/Nav-Beacon
```

No issue-tracker destination is emitted. FR-009 is withdrawn, so the installed package's `bugs.url`
is not read and cannot become a fourth navigation. Any missing, changed or unsafe destination fails
generation so a repository change receives review rather than silently widening navigation.

## Build identity

- `applicationVersion` is copied exactly from root `package.json#version`.
- `almanac.version` is copied exactly from the resolved installed `package.json#version`.

### Release declaration

A release workflow is declared by exactly one input, and the generator reads no other environment
variable for this decision:

| Variable                   | Meaning                                                                            |
| -------------------------- | ---------------------------------------------------------------------------------- |
| `SHIP_BUILDER_RELEASE_TAG` | Non-empty after trimming: a release workflow is declared, and this is its evidence |
| `GITHUB_RUN_ID`            | Optional bounded CI run identifier used as the non-release `buildId`               |

Classification is total; there is no fourth outcome:

1. `SHIP_BUILDER_RELEASE_TAG` unset or empty after trimming → **no release workflow is declared** →
   `kind: nonRelease`, with a required safe immutable `buildId`.
2. Declared, the trimmed value equals `v${applicationVersion}` exactly, and `applicationVersion` is
   not `0.0.0` → `kind: release`.
3. Declared and anything else — value not equal to `v${applicationVersion}`, `applicationVersion` of
   `0.0.0`, or a placeholder such as `v0.0.0`, `latest`, `HEAD` or `undefined` → **generation fails**.
   The build is never silently downgraded to `nonRelease`.

Worked example — root `package.json#version` of `1.0.0`:

| `SHIP_BUILDER_RELEASE_TAG` | Outcome                                        |
| -------------------------- | ---------------------------------------------- |
| unset or `""`              | `nonRelease` with a `buildId`                  |
| `v1.0.0`                   | `release`                                      |
| `1.0.0`                    | fails — the `v` prefix is required             |
| `V1.0.0`                   | fails — no case folding                        |
| `v1.0.0 `                  | `release` — surrounding whitespace is trimmed  |
| `v1.0`, `v1.0.0-rc.1`      | fails — no semver range or prerelease matching |
| `v0.9.0`                   | fails — does not match the shipped version     |
| `latest`, `HEAD`, `v0.0.0` | fails — placeholder                            |

Comparison is byte-exact after trimming surrounding whitespace: no `v`-prefix tolerance beyond the
one required character, no semver range matching, no case folding.

The non-release `buildId` resolves in this order, and generation fails if none of them yields an
accepted identifier: `GITHUB_RUN_ID` when it is 1–32 ASCII digits; otherwise `git rev-parse --short
HEAD` yielding 7–12 lowercase hex characters, suffixed `-dirty` when the working tree is dirty.

- Production optimisation, branch name, workflow name and `CI=true` are **not** release evidence and
  are never read for this decision.
- The accepted identifier format excludes whitespace, URLs, slashes, backslashes, colon-separated
  paths, branch names, user/email/host/runner/account names, timestamps and random values.

Because the decision is env-driven, both the release and the failure branches are exercised by
setting `SHIP_BUILDER_RELEASE_TAG` in a generator fixture. No workflow needs to exist for them to be
tested.

**Current repository state**: no workflow sets `SHIP_BUILDER_RELEASE_TAG`. `ci.yml` gates `main` and
pull requests and publishes successful `main` pushes to Pages; `deploy.yml` can manually republish
the same validated artifact. Neither declares a release. Every build the repository produces today is
therefore `nonRelease` with a `buildId`, and that is the correct outcome, not a gap.

Root `package.json#version` declares `major.minor.0` and CI supplies the patch:
`scripts/resolve-build-version.mjs` resolves `major.minor.<commits since that major.minor was
declared>` and `ci.yml` stamps it into the manifest immediately before the build. `applicationVersion`
is still copied exactly from root `package.json#version` — the rule above is unchanged — but the
manifest it is copied from is the stamped one, so **generation has to run after that stamp step**. A
generation step placed before it reads `major.minor.0` while the bundle beside it reports
`major.minor.<count>`, and the modal would then state a version no build carries. The stamp is a
property of the commit — a re-run and the manual republish resolve the same number — and it is not
release evidence: an automatically stamped patch changes nothing about the classification above,
which reads only `SHIP_BUILDER_RELEASE_TAG`.

**When release automation lands**, it needs one thing from this contract: export
`SHIP_BUILDER_RELEASE_TAG` as `v` plus the version the build is stamped with — the value
`node scripts/resolve-build-version.mjs` prints for that commit, so `v1.0.7` for a build stamped
`1.0.7`, and never the `major.minor.0` the manifest carries in git. Nothing in this feature changes.
A tag-triggered workflow can take the value straight from the tag ref, provided the tag and the
stamped version agree — if they disagree, generation fails by rule 3, which is the intended behaviour
rather than something to work around.

The UI receives separate application and Almanac values and may never label either as a live-game or
live-catalogue version.

## Source-distribution mirrors

Both installed Almanac legal inputs must be valid UTF-8, non-empty and non-whitespace. Their tracked
counterparts under `docs/legal/almanac/` must be byte-for-byte identical. Normal generation/check commands
are read-only with respect to tracked mirrors and fail on any drift.

The two mirrored artifacts are `LICENSE` and `THIRD_PARTY_NOTICES.md`, and that count is derived
rather than assumed: the installed package root was inspected and carries no other terms-bearing
file. Its `PROVENANCE/` tree holds derivation records (`SOURCES.md`, `SNAPSHOTS.md`) that document
where values came from, not terms under which they are redistributed, so it is deliberately not
mirrored. To keep that conclusion from silently expiring, generation fails when the installed package
root gains an unmirrored top-level file whose name matches a terms-bearing pattern — `LICENSE*`,
`LICENCE*`, `COPYING*`, `NOTICE*` or `*THIRD_PARTY*` — so an Almanac upgrade that adds one receives
review instead of dropping it from the source distribution.

`pnpm run legal:sync` is that separate explicit maintainer command, and it is the only path that
writes the mirrors. It copies the current installed artifacts after a dependency upgrade, and the
resulting legal diff is reviewed alongside the package update — a mirror silently refreshed by a
build is a redistribution obligation nobody read. Root `LICENSE` remains tracked and must continue to
state that the application MIT licence does not grant rights in package game data or artwork.

Mirrored document bodies do not enter `HelpManifestV1`, the initial bundle or the modal. They satisfy
the source-distribution boundary without creating additional legal-details destinations.

## Generated output

The deterministic TypeScript module contains data equivalent to:

```text
HelpManifestV1 {
  schemaVersion: 1
  build: BuildIdentity
  almanac: { packageName, version }
  disclaimer: { documentId, source, language, exactText, byteLength, sha256 }
  destinations: { repositoryLicense, almanacLicense, repositorySource }
}
```

Generation may escape characters to produce valid TypeScript, but re-encoding the runtime
`exactText` must reproduce the extracted bytes. Output is stable for identical inputs, contains no
absolute workspace path and is imported eagerly by the application frame. The generated module is
ignored and rebuilt before typecheck, unit tests, development serve and production build.

## Two generated-artifact conventions, and neither generalises

_Relocated here from `AGENTS.md` on 2026-08-25, where T062 first recorded it. It is the one part of
this feature's boundary a contributor meets while working on a different feature, so it is stated in
the contract that owns it rather than in the repository briefing._

This repository generates two kinds of artifact and treats them **oppositely**. Check which one you
are looking at before deciding whether to commit it.

| Artifact                                            | Tracked?      | Regenerated                                            | Command                   |
| --------------------------------------------------- | ------------- | ------------------------------------------------------ | ------------------------- |
| `src/app/platform/build/help-manifest.generated.ts` | **ignored**   | before every Angular, Playwright and typecheck command | `pnpm run help:artifacts` |
| `src/app/platform/build/help-topics.generated.ts`   | **ignored**   | likewise, once Phase 5 lands its catalogue entries     | `pnpm run help:topics`    |
| the build-link codec table                          | **committed** | on demand                                              | `pnpm run codec:tables`   |

The difference is what the artifact is evidence of. A codec table is a shared wire format: it has to
be reviewable in a diff, because changing it changes what every published link decodes to. A help
manifest is a description of one build, correct only for the commit that produced it, and committing
it would mean every branch carrying a stale claim about itself.

`help-topics.generated.ts` deliberately carries only the topic ids and their message keys — not the
requirements and principles each answer is justified by, which stay in
`scripts/help-topic-definitions.mjs` as review evidence. `pnpm run help:artifacts:check` validates
the sources the manifest is derived from and is chained into `pnpm run check`.

## Required failures

Generation/check/release fails with a source-specific diagnostic when:

- a required manifest/legal/mirror file is absent, unreadable, invalid UTF-8, empty or whitespace-only;
- the root disclaimer section, marker or block is absent, duplicated, malformed or empty;
- emitted disclaimer bytes, byte count or hash differ from fresh source extraction;
- the installed package name is not `@elite-dangerous-almanac/core`, or either version is empty;
- an installed legal artifact differs by one byte from its source-distribution mirror;
- root `LICENSE` no longer distinguishes application MIT rights from package artwork/game data;
- any external destination is absent, unexpected, non-HTTPS or contains forbidden URL parts, or
  carries a purpose it was not audited for;
- other than two `completeLegalTerms` destinations and one `sourceCode` destination would be
  emitted;
- a declared release workflow has missing/mismatched/placeholder evidence, or a non-release ID is
  missing/unsafe;
- generated output contains an absolute path, personal/environment identifier, build data or an
  unrequested complete legal document.

There is no runtime missing/loading/error fallback for these failures.

## Pipeline integration

- Add a generator/check command before every Angular command importing the generated module.
- Run generator tests through `pnpm run test:scripts` and therefore `pnpm run check`.
- Verify generated/runtime exact-text bytes and identity values in unit and production E2E tests.
- Keep generated output and temporary test fixtures ignored; keep `LICENSE` and `docs/legal/almanac/`
  tracked.
- Do not use Angular's generic `3rdpartylicenses.txt` as a replacement for required source mirrors or
  as modal content.

---

# The repository is Nav-Beacon

> **Renamed on 2026-09-09.** `docs/navbeacon-migration.md` names the product Nav Beacon and records
> the repository name. This contract states two of the three audited constants literally, so what
> they read is recorded here.

The licence destination this contract states as
`https://github.com/DarkSession/Nav-Beacon/blob/main/LICENSE` is
`https://github.com/DarkSession/Nav-Beacon/blob/main/LICENSE`, and the source destination under it
is `https://github.com/DarkSession/Nav-Beacon`. Everything the audit decides — HTTPS, the host, the
exact path, no credentials, port, query or fragment, and the purpose each destination is tagged
with — is unchanged; only the repository's name is. The Almanac's destination does not move.
