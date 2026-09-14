## 1. Almanac contract

- [x] 1.1 Add package-acceptance coverage for a fixed Mercenary experimental effect, including its
      empty package effect menu and retained state after a grade edit, and verify the affected unit test
      fails against 0.2.11 for the reported restriction.
- [x] 1.2 Add failing draft, editor, and end-to-end coverage for the visible fixed-effect fact and
      absent effect control before and after a grade edit, and verify the tests reproduce the interface
      defect against 0.2.11.
- [x] 1.3 Set `@elite-dangerous-almanac/core` to exact version 0.2.12, update the lockfile, verify
      `pnpm list @elite-dangerous-almanac/core --depth 0` resolves that version, and verify the task 1.1
      test passes.

## 2. Engineering presentation

- [x] 2.1 Use `ShipLoadout` from `@elite-dangerous-almanac/core/ships/ship-loadout` to keep the draft
      and effect control governed by `availableExperimentalEffects(slotKey)`, and verify the task 1.2
      draft tests pass.
- [x] 2.2 Present the carried `fittedModuleAt(slotKey).engineering.ExperimentalEffect` as a
      non-interactive fixed fact in both editor compositions, resolve its name with
      `getExperimentalEffectName` from
      `@elite-dangerous-almanac/core/i18n/experimental-effects`, add all application text to every
      shipped locale, and verify the task 1.2 editor tests cover localized, canonical, disclosed, and
      unavailable game-text states.
- [x] 2.3 Verify the task 1.2 journey passes in all ten responsive, touch and accessibility projects,
      including the visible fixed fact and the absent add, remove, and replace control before and after
      a grade edit.

## 3. Verification

- [x] 3.1 Run the README targeted-check procedure for module engineering and verify every affected
      unit and end-to-end project passes with full output in `dist/verification/`.
- [x] 3.2 Add 002/FR-012 and a fixed-effect engineering step to the screen-reader protocol, advance
      its version, and verify the protocol defines the carried-effect and absent-control observations
      for desktop, mobile, and tablet configurations.
- [ ] 3.3 Run the versioned screen-reader and actual 400% browser-zoom protocols for the fixed-effect
      state, append three screen-reader rows for the configured desktop, mobile, and tablet runs,
      append four zoom rows for Chromium and Firefox in landscape and portrait, and verify the
      automated 200% text-size check passes.
- [x] 3.4 Run `pnpm run check` and verify formatting, policy, type checking, builds, unit coverage,
      and the complete Playwright matrix pass.
