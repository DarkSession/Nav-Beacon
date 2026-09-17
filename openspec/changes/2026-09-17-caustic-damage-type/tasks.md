## 1. Almanac contract

- [x] 1.1 Add package-acceptance coverage for the caustic amount the Enzyme Missile Rack deals
      beside its explosive share, and for the required amounts `damageByType` now carries, and verify
      the suite names all six conventional types.
- [x] 1.2 Set `@elite-dangerous-almanac/core` to exact version 0.2.13, update the lockfile, verify
      `pnpm list @elite-dangerous-almanac/core --depth 0` resolves that version, and verify
      `pnpm run legal:sync` leaves the mirrored licence and notices unchanged.
- [x] 1.3 Repoint the offence fixture that formerly produced an unclassified amount at
      `Hpt_CausticMissile_Fixed_Medium`, and verify the package-acceptance suite still pins that no
      article reports an unclassified amount as zero.

## 2. The caustic reading

- [x] 2.1 Add caustic to the conventional damage types the offence domain projects, derived from
      `DamageSplit` less `antiXeno`, and verify the projection tests place it between explosive and
      absolute with its own amount and share.
- [x] 2.2 Add the caustic legend label to every shipped locale and the semantic colour token and
      segment rule the bar draws it with, and verify `pnpm run typecheck` accepts the label record
      against `Record<ConventionalDamageType, MessageKey>`.
- [x] 2.3 Add caustic to the offence ownership policy's figure fields, and verify
      `node scripts/policy/offence-ownership.mjs` reports no violation.
- [x] 2.4 Move the end-to-end step that proves an undealt type gets no segment and no line onto the
      caustic label, because no 0.2.13 article deals unclassified, and verify the step passes on the
      stock Anaconda.

## 3. Build-link codec table

- [x] 3.1 Regenerate build-link codec table 1 under 0.2.13 with `--overwrite`, verify the change is
      confined to frame-shift-drive module sets, that no symbol left the table and that no global
      index moved, and verify `pnpm run codec:capacity` reports the same capacity.
- [x] 3.2 Re-pin the reference corpus value whose position moved and the reviewed table 1 content
      hash, and verify the codec suites pass and the re-pinned value keeps its own length.
- [x] 3.3 Record the tenth overwrite, its cause and its new content hash in
      `docs/ship-link-codec.md`, and verify the document's corpus table states the re-pinned value.

## 4. Verification

- [x] 4.1 Run `pnpm run typecheck`, `pnpm run format:check`, `pnpm run help:artifacts:check`,
      `pnpm run search:sitemap:check`, `pnpm run build`, `pnpm run build:preview`,
      `pnpm run policy`, `pnpm run codec:capacity` and `pnpm run test:scripts`, and verify each
      passes with its output in `dist/verification/`.
- [x] 4.2 Run `pnpm run test` and verify every suite passes with unit coverage above the 80%
      threshold.
- [x] 4.3 Run the five Chromium projects of the responsive matrix, `e2e:timing` and `e2e:offline`,
      and verify the offence journey states the caustic line and gives the undealt type no line.
- [ ] 4.4 Run the five Firefox projects of the responsive matrix and verify they pass. The container
      this change was built in cannot install the Firefox build Playwright pins, so continuous
      integration runs them.

The versioned screen-reader and 400% browser-zoom protocols need no new run. Neither covers feature
007, and the change adds a legend line of a kind the reading already carries rather than a new
screen state.
