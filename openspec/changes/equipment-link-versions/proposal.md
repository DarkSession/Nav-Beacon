## Why

The equipment link writes a table version into the first ten bits of every payload and then refuses
to read any version but the one the installed application carries. Every published `e.` link already
names version 1, so the format can say which table wrote a link and the decoder cannot act on it.
The first package upgrade that moves an equipment identity mints table 2, and every link a Commander
has already shared stops opening.

The ship builder already answers this question: Almanac 0.2.13 changed what its table holds,
and table 2 was minted beside a table 1 that still opens.

## What Changes

- The equipment codec reads a payload against the table the payload names, rather than against the
  one table the application was built with. Table 1 stays readable for as long as the tool exists.
- A payload naming a table version the application does not carry is refused rather than decoded
  against the wrong table, and the refusal is said in the words of a loadout, not of a ship build.
- The equipment table becomes immutable once published, as the build-link table is: a package
  upgrade that changes what the generator produces fails the build and names the version the new
  content belongs under. The generator already refuses to write table 1 once its content has moved;
  it gains the path that writes the next table and the guard that holds every earlier table to its
  declared hash.
- A published-link corpus holds real `e.` fragments per table version, each pinned to the loadout it
  opens to. A version the registry holds whose corpus is empty fails the suite.
- The bench publishes and exports a link in the current table version whatever version it opened, so
  a loadout that arrived on an older link is shared in the version this release writes.
- Where the current table cannot represent a loadout an older table carried, the bench publishes no
  link and states why, rather than writing one that restores something else.

No published link changes meaning and none stops opening. This change is not breaking.

## Capabilities

### New Capabilities

None. The link is already specified under `equipment-builder/loadout-persistence`.

### Modified Capabilities

- `equipment-builder/loadout-persistence`: gains the versioned-codec requirement — every published
  table stays readable, a published table is immutable, and a payload naming an unknown version is
  refused rather than guessed. The accepted requirement "Exporting the open loadout" gains the
  version an exported or published link names, and what happens to a loadout the current table
  cannot represent. "The address carries the loadout on the bench" gains the exception for such a
  loadout: nothing is published and an equipment fragment already in the address is removed.
  "Autosave of the open loadout" gains what becomes of a default loadout the current table cannot
  represent: no record holds it and no fragment carries it, so the Commander is told at once rather
  than on the next reload.

## Impact

- `src/app/domain/equipment/loadout-link/equipment-link-codec.ts` — `SUIT_BITS`, `WEAPON_BITS`,
  `GRADE_BITS`, the modification widths, `MODIFICATION_SLOTS` and `MOUNTS` are derived from the one
  imported table at module load, so all of them are recoverable per version; they move into the
  per-version codec. `CURRENT_TABLE_VERSION` is read from that table's stamp; the registry's
  `CURRENT_EQUIPMENT_TABLE_VERSION` replaces it and is the highest version the registry holds,
  because a current version is a property of the registry rather than of a table.
- A registry beside the codec, holding one codec per published version and the current table
  version.
- `scripts/generate-equipment-link-codec-tables.mjs` — `TABLE_VERSION` and the output path are
  written down separately, the script refuses to run when the file for the current version is
  absent, and no guard holds an earlier table to its hash. Raising the version therefore cannot
  mint a table today.
- `package.json` — the `codec:tables:equipment` script formats `equipment-link-table-1.json` by
  name.
- `src/app/application/build-link/link-error.mapper.ts` and `src/app/i18n/locales/en.json` and
  `de.json` — `unsupportedTableVersion` falls through to the ship wording, which names a build
  link. It gains an equipment entry beside `invalidPayload` and `unknownIdentity`.
- `src/app/domain/equipment/loadout-link/equipment-link-codec.spec.ts`,
  `src/app/application/equipment/loadout-link.spec.ts`,
  `scripts/generate-equipment-link-codec-tables.test.mjs`, a new published-link corpus fixture and
  its suite, `e2e/equipment-link.spec.ts` and the `equipment/link` entry in
  `e2e/coverage-ledger.ts`.
- `docs/equipment-link-codec.md`.
- No package dependency changes. `@elite-dangerous-almanac/core` stays the source of every identity.
