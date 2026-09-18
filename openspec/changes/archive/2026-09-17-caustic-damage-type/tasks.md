## 1. Almanac contract

- [x] 1.1 Add package-acceptance coverage for the six required amounts `damageByType` carries, and
      verify the suite names kinetic, thermal, explosive, caustic, absolute and anti-xeno.
- [x] 1.2 Add package-acceptance coverage for the caustic amount the caustic missile deals beside
      its explosive share, and verify both the burst and the sustained split carry it.
- [x] 1.3 Sweep the hardpoint catalogue for an unclassified amount, and verify the assertion states
      what the suite's comment claims rather than checking one article.
- [x] 1.4 Sweep the hardpoint catalogue for a caustic amount, and verify exactly one article carries
      it, so the fixture stands for the whole of what the catalogue says.
- [x] 1.5 Set `@elite-dangerous-almanac/core` to exact version 0.2.13 and update the lockfile.
- [x] 1.6 Verify `pnpm list @elite-dangerous-almanac/core --depth 0` resolves 0.2.13, and that
      `pnpm run legal:sync` leaves the mirrored licence and notices unchanged.
- [x] 1.7 Repoint the offence fixture `OFFENCE_WEAPONS.caustic` at `Hpt_CausticMissile_Fixed_Medium`,
      and verify its comment states the fixture's condition without writing down a damage figure.

## 2. The caustic reading

- [x] 2.1 Add caustic to the conventional damage types the offence domain projects, taken from
      `DamageSplit` less `antiXeno`.
- [x] 2.2 Pin the projection against `everyStateBuild()` by segment order and caustic amount, and
      verify the assertion fails when caustic leaves the projected list.
- [x] 2.3 Add the caustic legend label to every shipped locale, and verify `pnpm run typecheck`
      accepts the label record against `Record<ConventionalDamageType, MessageKey>`.
- [x] 2.4 Pin the rendered legend line against the active locale's caustic label, and verify the
      assertion fails when caustic leaves the projected list.
- [x] 2.5 Add the semantic colour token and the segment rule the bar draws caustic with, and verify
      the token meets the AA non-text contrast ratio against the bar's own ground.
- [x] 2.6 Add caustic to the offence ownership policy's figure fields, and verify
      `node scripts/policy/offence-ownership.mjs` reports no violation.
- [x] 2.7 Add an end-to-end step that fits the caustic article to a medium hardpoint, and verify the
      reading gains one legend line naming the type with an amount, a share and a segment.
- [x] 2.8 Move the end-to-end suppression step onto the caustic label, because the catalogue can
      deal caustic and the stock Anaconda does not, where no article deals unclassified at all.
      Verify the step finds no caustic line and no extra segment.

## 3. Build-link codec table

- [x] 3.1 Mint build-link codec table 2 for the catalogue under 0.2.13, restore table 1 to the
      content it was published with, and verify the difference between the two tables is confined to
      frame-shift-drive module sets.
- [x] 3.2 Verify no symbol leaves `MODULES` and no index into `MODULES` moves, so the new table moves
      only positions within candidate sets, and verify `pnpm run codec:capacity` reports 272 of 377
      bytes for every committed table.
- [x] 3.3 Raise the loader's current table version to 2 and add the case that imports table 2, and
      verify a link written against table 1 still decodes through the loader while a codec pinned to
      table 2 refuses it.
- [x] 3.4 Remove the `--overwrite` escape from both codec generators, re-hash every published table
      before the current table is written, and verify the generator exits non-zero and writes
      nothing when a published table has been edited.
- [x] 3.5 Derive the published table versions from the current table number rather than a
      written-down list, and verify `pnpm run codec:tables` and `pnpm run codec:tables:equipment`
      each reproduce their committed table.
- [x] 3.6 Pin the content hash of both tables in the codec suite, re-pin the reference corpus
      against table 2, and verify the corpus states the length each value now carries.
- [x] 3.7 State the two tables, the catalogue move that separates them and the rule that a published
      table is never written again in `docs/ship-link-codec.md` and `docs/equipment-link-codec.md`,
      and verify each document's corpus and capacity tables state the measured values.
- [x] 3.8 Verify the working tree is clean after both generators run.
- [x] 3.9 Hash the committed equipment table's payload back before the generator writes, refuse a
      missing one, and verify `node --test scripts/generate-equipment-link-codec-tables.test.mjs`
      covers the edited table, the absent table and the unchanged one.
- [x] 3.10 Verify the ship generator names the next version when the catalogue moves the current
      table, with a node:test case over a table whose declared hash matches its own edited content.
- [x] 3.11 Hold a published link for every table version a link can name, pinned to the build it
      opens, and verify each one is read through the loader, read again against the table it is
      filed under, and rewritten with the current table on the same build.

## 4. The record

- [x] 4.1 State in the offence-profile requirement that each amount comes from `damageByType` on
      `BuildMetrics.weaponMetrics()`, and the conventional types from that split less `antiXeno`.
- [x] 4.2 State in the build-link requirement that a published identifier table is immutable, that a
      package upgrade mints the next version, and that the build refuses to write a published table.
- [x] 4.3 Hold the conventional damage types complete by the compiler rather than by a list, and
      verify `pnpm run typecheck` fails when a type the package carries is absent from the record.
- [x] 4.4 Refuse a build link whose payload names an article the installed catalogue declines to
      fit, reading the package's own `importOutcomes` rather than re-deriving the fit, and verify
      a table-1 payload naming a withdrawn Supercruise Overcharge drive raises
      `reconstructionFailed` naming the article and the mount.
- [x] 4.5 Take the pre-engineered record for a Mercenary article whose capture states no modifiers,
      because the Almanac reads such a capture as the purchase untouched and the purchase grade has
      no ordinary record to fall back on. Verify every Mercenary article round-trips out of a
      capture carrying its blueprint and grade alone.
- [x] 4.6 Fold both deltas into the accepted capability specifications and archive this change in the
      same commit, and verify `pnpm run policy:specs` reports no violation.

## 5. Verification

- [x] 5.1 Run `pnpm run typecheck`, `pnpm run format:check`, `pnpm run help:artifacts:check` and
      `pnpm run search:sitemap:check`, and verify each passes.
- [x] 5.2 Run `pnpm run build`, `pnpm run build:preview`, `pnpm run policy` and
      `pnpm run codec:capacity`, and verify each passes with its output in `dist/verification/`.
- [x] 5.3 Run `pnpm run test:scripts` and `pnpm run test`, and verify every suite passes with unit
      coverage above the 80% threshold.
- [ ] 5.4 Run the five Chromium projects of the responsive matrix, `pnpm run e2e:timing` and
      `pnpm run e2e:offline` to completion, store each log under `dist/verification/`, and verify
      the offence journey names the caustic type where the build deals it and gives it no line
      where the build does not.
- [ ] 5.5 Run the five Firefox projects of the responsive matrix, and verify each project passes.
- [ ] 5.6 Run `pnpm run check` and verify format, typecheck, build, policy, unit coverage and the
      complete ten-project Playwright matrix pass.

The versioned screen-reader and 400% browser-zoom protocols need no new run. Neither protocol covers
feature 007, and the change adds a legend line of a kind the reading already carries.
