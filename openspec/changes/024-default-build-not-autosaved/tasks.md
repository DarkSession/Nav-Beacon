## 1. Scope and the failing tests

- [ ] 1.1 Hold the change to what it is: no template, style sheet, component or catalogue file is
      touched, and no string is added (design.md, Screens). Responsiveness, touch targets,
      screen-reader semantics, localisation and design-system composition therefore have nothing new
      to check, and are verified by the accessibility and responsive journeys passing unchanged in
      `pnpm run check`. Verify against proposal.md — Impact: every changed path is under
      `src/app/application/`, `src/app/domain/`, `e2e/` or `openspec/`.
- [ ] 1.2 Add to `src/app/domain/ships/build/` a failing unit test that the snapshot of
      `ShipLoadout.default(<hull symbol>)` is reported at the hull's package default, that the same
      build with one module replaced is not, and that the same build with a ship name or an ident is
      not. Verify it fails because the comparison does not exist yet (024/FR-001).
- [ ] 1.3 Add to `src/app/domain/equipment/loadout/` the same failing unit test for the bench: the
      loadout the bench starts for a suit is reported at that suit's default, and the same loadout
      with a weapon fitted, a modification fitted or a raised suit grade is not. Verify it fails for
      the same reason (024/FR-002).
- [ ] 1.4 Add to `src/app/application/build-library/autosave.service.spec.ts` the case that a build
      created from the package default writes no record and mints no identity, and that its first
      modelled edit writes one. Verify it fails against the standing autosave, which mints on the
      first tick (024/FR-001).
- [ ] 1.5 Add the same pair to `src/app/application/equipment/loadout-autosave.service.spec.ts` for a
      loadout at its suit's default. Verify it fails for the same reason (024/FR-002).

## 2. The comparison, in the domain

- [ ] 2.1 Add the ship comparison beside `build-fingerprint.ts`: it answers whether a build snapshot
      equals the snapshot of `ShipLoadout.default(<hull symbol>)`, compared by
      `baselineFingerprint`, and memoises the default fingerprint per hull symbol. A hull the
      package publishes no default for is not at a default, because there is none to be at. Verify
      task 1.2 passes and the memo is not consulted for an unknown hull (024/FR-001).
- [ ] 2.2 Add the bench comparison beside `loadout-fingerprint.ts`: it answers whether a loadout
      equals the loadout the bench starts for that suit family — the suit at the lowest grade
      `getSuitByFamily` publishes, no weapon on any mount, no modification fitted — compared by
      `loadoutFingerprint`, memoised per suit family. Verify task 1.3 passes (024/FR-002).
- [ ] 2.3 Verify the two comparisons stay tied to what the application actually starts: add a unit
      test asserting that the loadout `newLoadout` produces is at its default by 2.2's own answer,
      and that the build `StockBuildCreator` produces is at its default by 2.1's. This is the drift
      design.md names as a risk (024/FR-001, 024/FR-002).

## 3. The gate, in autosave

- [ ] 3.1 Add the fact to `WorkingRecordSubject` in
      `src/app/application/build-library/working-record.port.ts` — a signal saying whether the work
      carries a decision beyond its default — and answer it in `ActiveBuildStore` and `LoadoutStore`
      from the comparisons of task 2. Verify by typecheck and by each store's own suite, which
      already stands a subject up for both tools.
- [ ] 3.2 Add the branch to `WorkingRecordAutosave.#writeNow`: while the subject holds no record and
      is at its default, nothing is owed and it returns `true`, as the clean-subject branch does.
      Place it before `#allocate`, so no record is minted and none taken over. Verify tasks 1.4 and
      1.5 pass, and that an unnamed record already holding the default state is left alone rather
      than taken over (024/FR-001, 024/FR-002).
- [ ] 3.3 Skip the coalescing timer in `#schedule` under the same condition, so an untouched build
      wakes no timeout while it is open. Verify with a fake timer that no write is attempted across
      repeated revisions of an untouched build, and that the first edit schedules one.
- [ ] 3.4 Verify the record a tool already holds is unaffected: a build edited back to the package
      default keeps its record, and that record is written with the default state. Add the case to
      `autosave.service.spec.ts` and its bench twin (024/FR-001, 024/FR-002).

## 4. What follows from holding no record

- [ ] 4.1 Verify `TabOwnershipCoordinator.track` claims nothing for a tool holding no record, and
      leaves the other tool's claim untouched. `track` already skips a null identity, so this is a
      case added to `tab-ownership.coordinator.spec.ts` rather than a change — verify it passes
      against the code as it stands, and that a duplicated tab forks nothing for that tool
      (024/FR-001, 024/FR-002).
- [ ] 4.2 Verify a manual save from a build or a loadout holding no record writes a named record.
      `NamedRecordService` already mints where there is nothing to consume; add the case to
      `named-record.service.spec.ts` and to the bench's save suite, and verify the saved list holds
      one record afterwards (024/FR-001, 024/FR-002).
- [ ] 4.3 Verify `EmptyBenchService.start()` clears a bench holding a loadout at its suit's default,
      and still refuses to clear where the store refused a write, the store is full, a write failed
      or autosave is paused. Add both to `src/app/application/equipment/empty-bench.spec.ts`
      (024/FR-002).
- [ ] 4.4 Verify restoring after a reload: a tab holding a build or a loadout at its default restores
      it from the address, and a page built at an address carrying no fragment opens on the no-build
      state or the empty bench. Drive it in `build-workspace.page.spec.ts` and the bench page suite
      (024/FR-001, 024/FR-002).
- [ ] 4.5 Verify the address carries the work from the moment it opens, which is what 4.4 restores
      from: `FragmentPublisher` publishes for a build that becomes active and is not edited, and
      `LoadoutLinkCoordinator` for a suit chosen and nothing else done. Both start effects already
      run on the first revision, so add the cases to `build-link.spec.ts` and `loadout-link.spec.ts`
      and verify they pass against the code as it stands (024/FR-003).

## 5. Journeys and the coverage record

- [ ] 5.1 Update `e2e/build-working-state.spec.ts`: the journey that leaves four builds in a row
      leaves none until each is edited, so edit each build and verify four records; add the journey
      that creating a build and changing nothing leaves the library with no entry for it, and that
      the first edit makes one appear. Verify both in the ten-project matrix (024/FR-001).
- [ ] 5.2 Update `e2e/hull-detail.spec.ts` so its second-creation journey drops the assertion that
      the first build is stored, and verify it asserts what is true: the second creation replaces the
      first on screen without asking (024/FR-001).
- [ ] 5.3 Update the bench persistence journey in `e2e/tool-bar-navigation.spec.ts`, which carries
      the `equipment/bench-persistence` surface: choosing a suit and doing nothing else leaves the
      saved list with no entry, the first change makes one appear, and starting an empty bench on an
      untouched default leaves nothing behind. That surface already carries `017/FR-006`, so it is
      where the restated empty-bench requirement is evidenced. Verify in the matrix (024/FR-002).
- [ ] 5.4 Extend the address journeys: in `e2e/build-link.spec.ts`, a build that becomes active and
      is not edited has its link in the address, and a reload of that address restores it; in
      `e2e/equipment-link.spec.ts`, the same for a suit chosen and nothing else done. Verify both in
      the matrix (024/FR-003).
- [ ] 5.5 Verify the SLEF journey against its restated requirement: one selected event replaces the
      active build, writes no named record, and is in the address where it takes no record. Check
      `e2e/slef-import.spec.ts` asserts this, and that the batch still stores one named record per
      event selected (024/FR-001).
- [ ] 5.6 Register `024/FR-001`, `024/FR-002` and `024/FR-003` in `e2e/coverage-ledger.ts` — the
      first two on the `build` and `equipment/bench-persistence` surfaces, the third on
      `build/share-link` and `equipment/link` — restate the assertions those surfaces claim about
      records and the address, and add `024-default-build-not-autosaved` to `COVERED_FEATURES`.
      Verify `pnpm run policy:specs` passes and names no unregistered id.

## 6. The gate

- [ ] 6.1 Run the targeted checks the README defines for every capability touched — the ship
      workspace, the build library, the bench and the saved loadouts — across the matrix, storing
      full output under `dist/verification/`. Verify no journey outside this change's scope changed
      its result.
- [ ] 6.2 Run `pnpm run check` and verify it passes: format, help artifacts, sitemap, typecheck,
      build, preview build, policy, codec capacity, script tests, unit tests at or above the 80%
      coverage threshold, and the Playwright matrix including the timing and offline projects.
- [ ] 6.3 Run the implementation gate the project context defines — a code reviewer reading the diff
      against the default branch, this change directory, `CONSTITUTION.md` and `AGENTS.md`. Fix every
      actionable finding, re-run the affected checks and repeat the review until it reports none.
