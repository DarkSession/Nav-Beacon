## 1. Almanac contract

- [x] 1.1 Add package-acceptance coverage for the six required amounts `damageByType` carries, and
      verify the suite names kinetic, thermal, explosive, caustic, absolute and anti-xeno.
- [x] 1.2 Add package-acceptance coverage for the caustic amount the caustic missile deals beside
      its explosive share, and verify both the burst and the sustained split carry it.
- [x] 1.3 Set `@elite-dangerous-almanac/core` to exact version 0.2.13 and update the lockfile.
- [x] 1.4 Verify `pnpm list @elite-dangerous-almanac/core --depth 0` resolves 0.2.13, and that
      `pnpm run legal:sync` leaves the mirrored licence and notices unchanged.
- [x] 1.5 Repoint the offence fixture `OFFENCE_WEAPONS.caustic` at `Hpt_CausticMissile_Fixed_Medium`,
      and verify the suite still pins that no article reports an unclassified amount as zero.

## 2. The caustic reading

- [x] 2.1 Add caustic to the conventional damage types the offence domain projects, taken from
      `DamageSplit` less `antiXeno`, and verify the projection tests place it between explosive and
      absolute with its own amount and share.
- [x] 2.2 Add the caustic legend label to every shipped locale, and verify `pnpm run typecheck`
      accepts the label record against `Record<ConventionalDamageType, MessageKey>`.
- [x] 2.3 Add the semantic colour token and the segment rule the bar draws caustic with, and verify
      the token meets the AA non-text contrast ratio against the bar's own ground.
- [x] 2.4 Add caustic to the offence ownership policy's figure fields, and verify
      `node scripts/policy/offence-ownership.mjs` reports no violation.
- [x] 2.5 Include caustic in the end-to-end legend step, so a build that deals it is named in the
      legend and nowhere else, and verify the step passes on the stock Anaconda.
- [x] 2.6 Move the end-to-end suppression step onto the caustic label, because the catalogue can
      deal caustic and the stock Anaconda does not, where no article deals unclassified at all.
      Verify the step finds no caustic line and no extra segment.

## 3. Build-link codec table

- [x] 3.1 Regenerate build-link codec table 1 under 0.2.13 with `--overwrite`, and verify the change
      is confined to frame-shift-drive module sets.
- [x] 3.2 Verify no symbol leaves `MODULES` and no index into `MODULES` moves, so the overwrite moves
      only positions within candidate sets, and verify `pnpm run codec:capacity` reports 272 of 377
      bytes.
- [x] 3.3 Re-pin the reference corpus value whose candidate-set position moved and the reviewed
      table 1 content hash, and verify the codec suites pass and the re-pinned value keeps its
      length.
- [x] 3.4 Record the tenth overwrite, its cause and its content hash in `docs/ship-link-codec.md`,
      and verify the document's corpus table states the re-pinned value.

## 4. Verification

- [x] 4.1 Run `pnpm run typecheck`, `pnpm run format:check`, `pnpm run help:artifacts:check` and
      `pnpm run search:sitemap:check`, and verify each passes.
- [x] 4.2 Run `pnpm run build`, `pnpm run build:preview`, `pnpm run policy` and
      `pnpm run codec:capacity`, and verify each passes with its output in `dist/verification/`.
- [x] 4.3 Run `pnpm run test:scripts` and `pnpm run test`, and verify every suite passes with unit
      coverage above the 80% threshold.
- [x] 4.4 Run the five Chromium projects of the responsive matrix, `pnpm run e2e:timing` and
      `pnpm run e2e:offline`, and verify the offence journey names the caustic type where the build
      deals it and gives it no line where the build does not.
- [ ] 4.5 Run the five Firefox projects of the responsive matrix, and verify each project passes.
- [ ] 4.6 Run `pnpm run check` and verify format, typecheck, build, policy, unit coverage and the
      complete ten-project Playwright matrix pass.

The versioned screen-reader and 400% browser-zoom protocols need no new run. Neither protocol covers
feature 007, and the change adds a legend line of a kind the reading already carries.
