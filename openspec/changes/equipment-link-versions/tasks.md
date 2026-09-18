## 1. Turn the codec into a factory over a table

- [ ] 1.0 Capture the corpus before anything below changes the codec. Encode loadouts with the code
      as it stands, and write the fragments, and the loadout each one opens to, out to the
      scratchpad. Verify each fragment decodes to its recorded loadout under this unchanged code.
      Nothing else in this section starts until the capture is out of the working tree.
- [ ] 1.1 Export an `EquipmentLinkCodecTables` type derived from `equipment-link-table-1.json`, and
      verify `pnpm run typecheck` passes with the committed table assigned to it.
- [ ] 1.2 Move the encode and decode pair into a `createEquipmentLinkCodec(tableVersion, table)`
      factory, with the seven module constants and every `table.` read inside it. Verify
      `equipment-link-codec.ts` imports no table file, so the registry of task 2.1 is the only module
      that does. Verify the existing `equipment-link-codec.spec.ts` passes unchanged against a codec
      built on table 1.
- [ ] 1.3 Have the factory's encoder write the table version it was built with rather than a module
      constant, and verify a fragment encoded by a codec built on a test-only version 2 table carries
      2 in its first ten bits.

## 2. Read a payload against the table it names

- [ ] 2.1 Add a registry beside the codec: a `ReadonlyMap` holding one codec per version, each built
      from a statically imported table, exported with `CURRENT_EQUIPMENT_TABLE_VERSION`. Point the
      comment where it is declared at `docs/equipment-link-codec.md`, which carries the size reason
      and does not move when this change is archived. Verify the map returns a codec for version 1
      and for no other version, and that `CURRENT_EQUIPMENT_TABLE_VERSION` is the highest version the
      map holds.
- [ ] 2.2 Have `decodeEquipmentLinkFragment(fragment, codecs = EQUIPMENT_CODECS_BY_TABLE_VERSION)`
      read the version field first and select the codec the payload names, keeping the function
      synchronous, and verify a version 1 fragment decodes to the same loadout as before the change.
- [ ] 2.3 Refuse a payload naming a version the given map does not hold with
      `unsupportedTableVersion`. Have the internal message name the version read and the versions
      carried. Verify the refusal reaches the bench as `link.error.unsupportedTableVersion` through
      `LinkErrorMapper`, that the restored loadout is unchanged, and that no catalogue key is added.
- [ ] 2.4 Keep `encodeEquipmentLinkFragment` writing the current version whatever version was read,
      and verify a loadout decoded from a version 1 fragment re-encodes to a fragment naming the
      current version and restoring the same loadout.
- [ ] 2.5 Drive `LoadoutLinkCoordinator` with a codec that refuses the open loadout. Verify the link
      state is `refused` and carries the slot. Verify an equipment fragment already in the address is
      removed, and a fragment belonging to another tool is left as it is. Verify the loadout on the
      bench is untouched. Verify no link is offered for export, and that the structured payload and
      the readable summary still are. Verify the refusal reaches the Commander through
      `LinkErrorMapper` in the equipment wording, naming the mount by its package name or the suit,
      and the reason.

## 3. Hold the published table immutable

- [ ] 3.1 Derive the generator's output path and its published-version set from `TABLE_VERSION`
      rather than writing the file name down, and change the `codec:tables:equipment` script to
      format `equipment-link-table-*.json`. Verify `pnpm run codec:tables:equipment` reproduces the
      committed table with the working tree clean afterwards.
- [ ] 3.2 Give the generator a minting path. Where the file for `TABLE_VERSION` is absent, it writes
      it only where a version below it is committed. Table 1 has no version below it, so it keeps the
      refusal the script carries today. Where the committed file's payload has moved, the run fails
      and names the version the new content belongs under. Today `TABLE_VERSION` reaches only the
      messages and the `$generated` stamp, so raising it to 2 rewrites table 1 in place stamped as
      version 2, and `CURRENT_TABLE_VERSION` is read back from that stamp. Verify the following in
      `test:scripts`, against a temporary directory, once 3.1 derives the path. Raising the version
      writes `equipment-link-table-2.json`. A moved payload under an unchanged version writes nothing
      and names version 2 in the failure. `equipment-link-table-1.json` is byte-identical after both.
      An absent table 1 still fails and writes nothing, which
      `generate-equipment-link-codec-tables.test.mjs` already pins and this task keeps as a
      regression guard.
- [ ] 3.3 Add the guard that holds every version below `TABLE_VERSION` to the hash it declares, as
      the build-link generator does. The committed table for the current version is already guarded,
      so verify the sweep's own case: in `test:scripts`, against a temporary directory with
      `TABLE_VERSION` raised, a table below it whose content no longer matches its declared hash
      fails the run, names that table, and writes nothing.

## 4. Prove an old link stays readable

- [ ] 4.1 Commit what task 1.0 captured as `published-equipment-links.fixture.json`: the fragments
      as literals, keyed by table version, each with the loadout it opens to and the modifications
      its mounts carry. The fixture is transcribed from that capture and never regenerated by the
      changed code. Verify every entry's payload version field matches the key it is filed under, and
      that every fragment and loadout is byte-identical to the captured one.
- [ ] 4.2 Add a suite that opens every fixture fragment through `decodeEquipmentLinkFragment` and
      asserts the recorded loadout, and verify it fails when an entry is filed under the wrong
      version.
- [ ] 4.3 Assert in that suite that every version the shipped registry holds has at least one corpus
      entry, reading the registry's keys as `build-link-published-links.spec.ts` reads its table map,
      and verify the test fails when a version is registered with no entry.
- [ ] 4.4 Assert that every fixture fragment re-encodes to the current version and reopens on the
      same loadout, and verify the held weapons and modifications survive the rewrite.
- [ ] 4.5 Exercise version selection without committing a table. Build a test-only version 2 table,
      and pass a map holding its codec beside version 1 into `decodeEquipmentLinkFragment`. Verify
      the shipped function decodes a version 2 fragment and a version 1 fragment to their own
      loadouts in the same run, and refuses a version 3 payload.

## 5. State the behaviour

- [ ] 5.1 Rewrite the passages of `docs/equipment-link-codec.md` this change makes false:
  - the binary body's preamble, which derives the widths "at module load" where they are now derived
    per version;
  - the generator paragraph, which names "both refusals" where there are more;
  - the paragraph holding that the table is imported statically because "there is one of them" and
    that `build-link-codec-loader.ts` "is the one to copy";
  - the Status section's closing, that "the version handling described above is what the first
    change to it needs".

  Verify no passage still says the widths are derived at module load, that the table is imported
  statically because there is one of it, that `build-link-codec-loader.ts` is the pattern to copy, or
  that the script test pins both refusals. A passage naming table 1 as the only minted table stays
  true and stays as it is.

- [ ] 5.2 State in the same document that a published table is immutable. State that a payload names
      the table that decodes it. State that the registry is synchronous because the equipment table
      is 3,021 bytes where a build-link table is about 198 KB. Verify every size figure in the
      document is the measured one, and that the per-table size and the table count are both stated.
- [ ] 5.3 Extend the `equipment/link` journey in `e2e/equipment-link.spec.ts` with a literal `e.`
      fragment naming a table version this application does not carry, captured from task 4.5's
      test-only table. Verify the bench states the refusal where the Commander is and leaves the open
      loadout alone.
- [ ] 5.4 Add two assertions to the `equipment/link` entry in `e2e/coverage-ledger.ts`: that a
      published `e.` link opens against the table version its payload names, and that a payload
      naming a table version this application does not carry is refused where the Commander is. Word
      the second so it does not read as a duplicate of the existing line about a link this version
      cannot read. Verify `pnpm run policy:specs` reports no violation, and that the journey carries
      a test for each assertion added.

## 6. Verification

- [ ] 6.1 Run `pnpm run typecheck`, `pnpm run format:check` and `pnpm run policy`, and verify each
      passes.
- [ ] 6.2 Run `pnpm run test:scripts` and `pnpm run test`, and verify every suite passes with unit
      coverage above the 80% threshold.
- [ ] 6.3 Run the equipment journeys of the responsive matrix across the five Chromium profiles and
      verify a loadout shared as a link opens on the same loadout at every profile.
- [ ] 6.4 Run `pnpm run check` and verify format, typecheck, build, policy, unit coverage and the
      complete ten-project Playwright matrix pass.
- [ ] 6.5 After the implementation gate reports no actionable finding, fold the delta into
      `openspec/specs/equipment-builder/loadout-persistence/spec.md` and archive this change in the
      same commit, and verify `pnpm run policy:specs` reports no violation.
