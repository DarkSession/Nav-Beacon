## 1. Scope and the failing tests

- [x] 1.1 Hold the change to what it is: no template, style sheet or component body is touched, and
      no string is added (design.md, Screens). One string changes value — `library.empty.description`,
      in every locale catalogue — because the empty saved screen states a rule this change replaces,
      for the work both tools keep there rather than for a build alone. Responsiveness, touch
      targets, screen-reader semantics and design-system composition therefore have nothing new to
      check, and are verified by the accessibility and responsive journeys passing unchanged in
      `pnpm run check`. Assert the reworded sentence where a journey already stands on that screen,
      in `e2e/build-working-state.spec.ts`, so the one string a Commander reads differently is read
      by a test. Verify against proposal.md — Impact: every changed path is under `src/app/`, `e2e/`
      or `openspec/`, and the only change under `src/app/features/` outside a test is a doc comment
      in `build-library.page.ts`, which is why no screen changes.
- [x] 1.2 Add to `src/app/domain/ships/build/` a failing unit test that the snapshot of
      `ShipLoadout.default(<hull symbol>)` is reported at the hull's package default, that the same
      build with one module replaced is not, that the same build with one mount emptied is not, and
      that the same build with a ship name or an ident is not. The emptied mount is a case of its
      own because it is answered by the module count rather than by the walk over the modules: every
      module that remains is still the one the hull was supplied with. Verify it fails because the
      comparison does not exist yet (024/FR-001).
- [x] 1.3 Add to `src/app/domain/equipment/loadout/` the same failing unit test for the bench: the
      loadout the bench starts for a suit is reported at that suit's default, and the same loadout
      with a weapon fitted, a modification fitted or a raised suit grade is not. Verify it fails for
      the same reason (024/FR-002).
- [x] 1.4 Add to `src/app/application/build-library/autosave.service.spec.ts` the case that a build
      created from the package default writes no record and mints no identity, and that its first
      modelled edit writes one. Verify it fails against the standing autosave, which mints on the
      first tick (024/FR-001).
- [x] 1.5 Add the same pair to `src/app/application/equipment/loadout-autosave.service.spec.ts` for a
      loadout at its suit's default. Verify it fails for the same reason (024/FR-002).

## 2. The comparison, in the domain

- [x] 2.1 Add the ship comparison beside `build-fingerprint.ts`: it answers whether a build snapshot
      carries no ship name, no ident and no choice on any module, and is fitted with exactly what
      `getDefaultLoadout(<hull symbol>)` publishes. Slot keys and module symbols are compared in one
      letter case, because the package spells one identity in more than one. It memoises the
      supplied fit per hull symbol. A hull the package publishes no default for is not at a default,
      because there is none to be at. The comparison itself reaches no package: the fit travels on
      the `BuildCandidate`, read once by whoever constructed it through `getDefaultLoadout`, because
      `ActiveBuildStore` is started with the shell and what it reaches is in the first bundle.
      Verify task 1.2 passes, that the initial bundle stays inside its budget, and that a hull the
      package publishes no default for is answered as not at a default rather than raising
      (024/FR-001).
- [x] 2.2 Add the bench comparison beside `loadout-fingerprint.ts`: it answers whether a loadout
      equals the loadout the bench starts for that suit family — the suit at the lowest grade
      `getSuitByFamily` publishes, no weapon on any mount, no modification fitted — compared by
      `loadoutFingerprint`, memoised per suit family. Verify task 1.3 passes (024/FR-002).
- [x] 2.3 Verify the two comparisons stay tied to what the application actually starts, which is the
      drift design.md names as a risk. Assert in `stock-build.creator.spec.ts` that the build
      `StockBuildCreator` produces is at its default by 2.1's answer, for every installed hull, and
      in `loadout.store.spec.ts` that the loadout the bench starts is at its default by 2.2's, for
      every published suit. The bench comparison is defined as the fingerprint of `newLoadout`'s own
      output, so a domain test of it alone compares that function with itself; state there instead
      what a default loadout holds — the suit at the lowest grade the package publishes, no weapon
      and no modification (024/FR-001, 024/FR-002).

## 3. The gate, in autosave

- [x] 3.1 Add the fact to `WorkingRecordSubject` in
      `src/app/application/build-library/working-record.port.ts` — a signal saying whether the work
      is at its default — and answer it in `ActiveBuildStore` and `LoadoutStore`
      from the comparisons of task 2. Verify by typecheck and by each store's own suite, which
      already stands a subject up for both tools.
- [x] 3.2 Add the branch to `WorkingRecordAutosave.#writeNow`: while the subject holds no record and
      is at its default, nothing is owed and it returns `true`, as the clean-subject branch does.
      Place it before `#allocate`, so no record is minted and none taken over. Verify tasks 1.4 and
      1.5 pass, and that an unnamed record already holding the default state is left alone rather
      than taken over. Verify too that a resume after another page's deletion writes the work back
      into the record this tool still holds, at its default or not: the branch reads work that holds
      no record, and a resume is offered only while a record is held. Have the branch say `ready` on
      the status as well as answer `true`: a named record refused as a target leaves `write-failed`
      standing and draws a retry control, and every retry from here would decline in the same
      silence — a control that does nothing, under a notice about a record the work is no longer in.
      Verify in `autosave.service.spec.ts` that a build left in no record by a named target clears
      that notice at the next write and still stores nothing (024/FR-001, 024/FR-002, 001/FR-014).
- [x] 3.3 Skip the coalescing timer in `#schedule` under the same condition, so an untouched build
      wakes no timeout while it is open. Read the condition outside the watcher's subscription: the
      watcher is woken by an edit, and which record the tool holds is an answer to the gate rather
      than an edit — subscribed to, minting a record wakes the watcher and arms a second timer that
      stores the bytes the first one has just stored. Verify with a fake timer that no write is
      attempted across repeated revisions of an untouched build, that the first edit schedules one,
      and that one edit leaves one write and no armed timer behind it, in both tools.
- [x] 3.4 Verify the record a tool already holds is unaffected: a build edited back to the package
      default keeps its record, and that record is written with the default state. Add the case to
      `src/app/application/build-library/autosave.service.spec.ts` and to
      `src/app/application/equipment/loadout-autosave.service.spec.ts` (024/FR-001, 024/FR-002).

## 4. What follows from holding no record

- [x] 4.1 Make `TabOwnershipCoordinator.track` claim nothing for a tool whose work is in no record,
      and leave the other tool's claim untouched. `track` announces the record a tool holds, and
      releases that tool's claim where the record becomes null and this page announced one — on a
      page that has announced nothing, the claim in the tab is the one a reload is about to read.
      Release only work that is in no record at all. Autosave has no path to a named record, so a
      tool holds no autosave target while its work is in one — after a save, and after an open from
      the saved list. Read the claim from where the work is rather than from how it got there: the
      record autosave holds, or failing that the record `sourceNamed` names while `dirty` is false.
      Reading both as signals is what wakes the watcher when the work moves, which this change makes
      necessary: a default build mints no record, so no later allocation corrects a claim left
      standing. Release a claim this page did not write once the tool holds work, for the same
      reason: the restore that reads such a claim runs only while the tool holds nothing, so from
      there it describes nothing on this page. Verify in `tab-ownership.coordinator.spec.ts`: a page holding a record that commits a
      default build claims nothing afterwards and says so on the channel; a page that has announced
      nothing leaves the claim a reload reads where it is until it takes up work of its own; a page
      that saves under a name claims the
      record the save produced, including where the save minted a record of its own; a page that
      opens a named record claims it and announces nothing; a page that edits after a save claims
      nothing until it holds the forked record; a page that creates a default build after a save
      claims nothing; a duplicated tab forks nothing for a tool holding no record; and two pages
      holding the same default work each take a record of their own at their own first edit. Verify
      the save journey end to end in `e2e/build-working-state.spec.ts`: after a save and a reload,
      one record, still claimed (001/FR-008, 017/FR-007, 024/FR-001, 024/FR-002).
- [x] 4.2 Verify a manual save from a build or a loadout holding no record writes a named record.
      `NamedRecordService` already mints where there is nothing to consume; add the case to
      `src/app/application/build-library/named-record.service.spec.ts` and to
      `src/app/application/equipment/loadout.store.spec.ts`, and verify the saved list holds one
      record afterwards (024/FR-001, 024/FR-002).
- [x] 4.3 Verify `EmptyBenchService.start()` clears a bench holding a loadout at its suit's default
      and in no record, and still refuses to clear a loadout that carries a choice where the store
      refused a write, the store is full, a write failed or autosave is paused. Add both to
      `src/app/application/equipment/empty-bench.spec.ts` (024/FR-002).
- [x] 4.4 Verify restoring after a reload: a tab holding a build or a loadout at its default restores
      it from the address, and a page built at an address carrying no fragment opens on the no-build
      state or the empty bench. Drive it in
      `src/app/features/build-workspace/build-workspace.page.spec.ts` and
      `src/app/application/equipment/loadout.store.spec.ts` (024/FR-001, 024/FR-002).
- [x] 4.5 Verify the work is published from the moment it opens, which is what 4.4 restores from.
      `FragmentPublisher` publishes for a build that becomes active and is not edited, and
      `LoadoutLinkCoordinator` for a suit chosen and nothing else done. Both start effects already
      run on the first revision, so add the cases to
      `src/app/application/build-link/build-link.spec.ts` and
      `src/app/application/equipment/loadout-link.spec.ts`, and verify they pass against the code as
      it stands (024/FR-003).
- [x] 4.6 Verify the rest of what the bench's added requirement states: each change replaces the
      fragment without adding a history entry, and the path and the query carry no part of the
      loadout. Add both to `src/app/application/equipment/loadout-link.spec.ts` (024/FR-003).
- [x] 4.7 Verify a build the codec refuses publishes no link and removes a fragment carrying an
      earlier build's link, as the feature 001 link contract requires. Add the case to
      `src/app/application/build-link/build-link.spec.ts` (024/FR-003).
- [x] 4.8 Verify the bench case the restated storing requirement adds: delete the record the bench
      autosaves into, return to the bench at an address carrying a loadout at its suit's default, and
      verify it opens into no record and the deleted record stays deleted. Add it to
      `src/app/application/equipment/loadout-autosave.service.spec.ts` (024/FR-002).
- [x] 4.9 Verify the bench's import routes against the two scenarios that declare them: a loadout at
      its suit's default arriving from a link or a single journal event takes no record, and a batch
      still stores one named record for every loadout selected. Add both to
      `src/app/application/equipment/loadout-import.coordinator.spec.ts` (024/FR-002).
- [x] 4.10 Verify the ship tool's ingress routes against the scenario that declares them: a build at
      the package default takes no record when it arrives by a build link and when it arrives by a
      SLEF paste. Add the cases to `src/app/application/build-link/build-link.spec.ts` and
      `src/app/application/slef/slef-import.coordinator.spec.ts` (024/FR-001).
- [x] 4.11 Verify a replacement is not confirmed where a store failure leaves the build on screen in
      no record, which the restated requirement adds. Add the case to
      `src/app/application/build-library/autosave.service.spec.ts` (024/FR-001).
- [x] 4.12 Verify the help topic on browser storage still agrees with the requirement it cites. Read
      `help.topic.browserPersistence.answer` in `src/app/i18n/locales/en.json` against the restated
      "Autosave of the active build". Verify the answer still agrees, because it says where work is
      kept rather than when a record is taken, and record that it needs no edit. Where it turns out
      to claim otherwise, stop and raise it: a catalogue edit is outside this change. Verify
      `pnpm run help:artifacts:check` and `pnpm run policy:specs` pass.

## 5. Journeys and the coverage record

- [x] 5.1 Edit each of the four builds in the four-in-a-row journey of
      `e2e/build-working-state.spec.ts`. Verify the library holds four records (024/FR-001).
- [x] 5.2 Add a journey to the same file: create a build and change nothing. Verify the library
      holds no entry for it (024/FR-001).
- [x] 5.3 Extend that journey with the first modelled edit. Verify one entry appears (024/FR-001).
- [x] 5.4 Update the second-creation journey of `e2e/hull-detail.spec.ts` to assert what is true:
      no record is stored for either creation, and the second replaces the first on screen without
      asking (024/FR-001).
- [x] 5.5 Update the bench persistence journey in `e2e/tool-bar-navigation.spec.ts`, which carries
      the `equipment/bench-persistence` surface: choosing a suit and doing nothing else leaves the
      saved list with no entry, the first change makes one appear, and starting an empty bench on an
      untouched default leaves nothing behind. That surface already carries `017/FR-006`, so it is
      where the restated empty-bench requirement is evidenced. Verify in the matrix (024/FR-002).
- [x] 5.6 Extend the address journeys: in `e2e/build-link.spec.ts`, a build that becomes active and
      is not edited has its link in the address, and a reload of that address restores it; in
      `e2e/equipment-link.spec.ts`, the same for a suit chosen and nothing else done. Verify both in
      the matrix (024/FR-003).
- [x] 5.7 Verify the import journeys against the restated requirement. `e2e/slef-import.spec.ts`
      asserts that an entry holding a build at the package default stores no record, and that the
      address still shows the build. `e2e/journal-import.spec.ts` holds the two selection halves,
      because that is where the journey that selects events lives: one selected event replaces the
      active build and writes no named record, and a batch still stores one named record per event
      selected. Assert that no named record was written by opening the saved list and counting the
      named cards in it. Count the named cards rather than every card, because the list draws the
      derived rows too, and a list that is closed asserts nothing at all (024/FR-001).
- [x] 5.8 Register `024/FR-001`, `024/FR-002` and `024/FR-003` in `e2e/coverage-ledger.ts`, on every
      surface a task writes an assertion on: `build` and `equipment/bench-persistence` for the first
      two, `ships/:hull/create-stock-build` for task 5.4, `shell/journal-selection` for task 5.7,
      `build/slef-import-aftermath` for task 5.7, and `build/share-link` and `equipment/link` for
      the third. Restate the assertions those surfaces claim about records and the fragment, to what
      each journey checks — `shell/slef-import-replacement` said the work being replaced has a record
      of its own, and its journey asks no question whatever the work is stored in. Add
      `024-default-build-not-autosaved` to
      `COVERED_FEATURES`. Verify `pnpm run policy:specs` passes and names no unregistered id.

## 6. The gate

- [ ] 6.1 Run the targeted checks the README defines for every capability touched — the ship
      workspace, the build library, the build link, the SLEF exchange, the bench, the equipment link
      and the saved loadouts — across the matrix, storing full output under `dist/verification/`.
      Verify no journey outside this change's scope changed its result.
- [ ] 6.2 Run `pnpm run check` and verify it passes: format, help artifacts, sitemap, typecheck,
      build, preview build, policy, codec capacity, script tests, unit tests at or above the 80%
      coverage threshold, and the Playwright matrix including the timing and offline projects.
- [ ] 6.3 Run the implementation gate the project context defines — a code reviewer reading the diff
      against the default branch, this change directory, `CONSTITUTION.md` and `AGENTS.md`. Fix every
      actionable finding, re-run the affected checks and repeat the review until it reports none.
