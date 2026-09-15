## 1. Scope and the failing test

- [x] 1.1 Nothing is drawn and no string is added, so responsiveness, touch targets, screen-reader
      semantics, localisation and design-system composition have nothing to check in this change
      (design.md, Screens). The only surface it touches is the address bar, which is not composed
      from the design system. Verify by holding the change to it: no template, style sheet or
      catalogue file is touched, and `pnpm run check` passes the accessibility and responsive
      journeys unchanged.
- [x] 1.2 Add to `src/app/application/build-link/fragment-publisher.spec.ts` the case where a
      publication lands while the address is on another history entry, and the workspace's entry is
      left without the link. Drive it through the injectable `encode`, holding the encode open
      while the fragment moves, so the window is opened deliberately rather than raced. Verify it
      fails against the standing publisher (022/FR-001).
- [x] 1.3 Add the case where the saved builds are opened before the build's link is published, and
      the address carries that link once the layer closes, in
      `src/app/features/build-workspace/build-workspace.page.spec.ts`, which is where `raise()` and
      `lower()` are already driven together — `LibraryPresence` has no suite of its own. Verify it
      fails for the same reason: `raise()` pushes at the same document, so the publication's
      document guard passes and the fragment lands on the layer's entry (022/FR-001).

## 2. Restoring a lost link

- [x] 2.1 Add the watcher to `FragmentPublisher`, inside `start()` so it lives exactly as long as
      the publication effect does. Publication records the document a fragment was written onto in
      a private field beside `#token`, and not on `link()`: that model is what the application says
      about the build, and where the fragment was written is bookkeeping. The watcher reads that
      record and states the published link again when the address comes back empty at the same
      document. `markPublished` comes
      before `replaceFragment`, as publication does. Verify tasks 1.2 and 1.3 pass, that a
      refusal leaves nothing to restore, and that the restoration adds no history entry
      (022/FR-001).
- [x] 2.2 Verify a restoration leaves the open build untouched: the build is not replaced, and no
      replacement is offered for it. This is what `markPublished` is for, and it is the one part
      of task 2.1 the address does not show (022/FR-001).
- [x] 2.3 Verify the watcher leaves a fragment that is not a build link exactly as it stands:
      neither restored over nor cleared. Use a loadout link as the fixture, at the document the
      build link was published onto, so the case gates the alternative design.md rejects — a
      fragment this application owns and did write, which ownership would have licensed the ship
      builder to overwrite. At any other document the document bound would carry the test and the
      emptiness test would go unverified. `recognizeBuildLinkFragment`
      answers `unrelated` for an empty fragment and for any other fragment alike, so emptiness is
      tested here and the recogniser is asked only to tell a build link from everything else. This
      is the line `FragmentPublisher.#clearBuildFragment` already holds (022/FR-001).
- [x] 2.4 Make the fragment signal the address. Add to
      `src/app/platform/browser/history-location.adapter.spec.ts` the case where the router rewrites
      the address through Angular's `Location` and drops a fragment written with
      `history.replaceState`, driven over the window's own history so both write the address the
      adapter reads. Verify it fails, then have the adapter read the address back on
      `Location.onUrlChange` as well as on `hashchange`. Without this the watcher of task 2.1 states
      the link again, the router writes the address without it a moment later, and no event tells
      the adapter — so the signal reads `b.…` at an address carrying nothing and the watcher never
      runs again (022/FR-001).

## 3. Leaving alone what is not ours to state

- [x] 3.1 Verify in the publisher suite named in task 1.2 that an address carrying a build link
      other than the published one is left alone: assert the fragment is not written back, and
      that the coordinator's ingest still reaches the incoming link. This is the case that would
      make navigation by link impossible if the trigger were widened, so it is stated as its own
      test
      rather than folded into 2.1 (022/FR-001).
- [x] 3.2 Verify the publication's own bound still holds: a Commander who leaves the workspace
      while a publication is in flight arrives at an address with no build link on it. Drive it by
      moving `currentDocument()` between the encode and its resolution, which makes the
      publication discard itself, so there is nothing recorded to restore (022/FR-001).
- [x] 3.3 Verify the restoration's own bound, which is the one this change adds: publish a link
      onto the workspace document, move `currentDocument()` after the publication has landed,
      empty the fragment, and assert nothing is stated. The watcher reads the document it recorded
      in task 2.1 and does nothing where it differs, so a Commander who published a link and then
      walked away does not find it on the screen they walked to (022/FR-001).
- [x] 3.4 Verify nothing is stated where no link is published, for all three ways there can be no
      link: no build has been opened, a build was opened and then cleared, and a refused encode.
      Drive the second by publishing a link and then deleting the record the workspace autosaves
      into, which clears the active build to the no-build state under
      `ship-builder/build-lifecycle`, "Naming, saving and removing a record" (001/FR-009). The
      publisher clears the fragment, the address goes empty at the same document, and the watcher
      must not put the stale link back: an address naming a build the workspace no longer holds is
      the failure this case guards. For the third, a refusal removes a stale fragment with
      `replaceState`, under
      `openspec/changes/archive/001-ship-selection-and-loading/contracts/build-link.md`,
      "Active-edit synchronization", and the watcher must not undo that either (022/FR-001).

## 4. Reading it end to end

- [x] 4.1 Add a journey to `e2e/build-link.spec.ts`, beside the other journeys the
      `build/share-link` ledger entry covers: open a build, open the saved builds before the
      address carries the link, close the layer, and read that the address carries the build link.
      Then open that address in a fresh browser context, which holds no stored build, and read
      that it opens the same build. A reload in the same context would not discriminate for a
      build that holds a record: it is autosaved and restored under 001/FR-008 whether the fragment
      came back or not. Hold the window open by delaying the lazily
      imported codec chunk, as design.md sets out under "The journey holds the window open by
      delaying the codec chunk". The two existing library journeys stay as they are: they read the
      two ways out of the layer rather than this race, and they wait for the address deliberately
      (022/FR-001).
- [x] 4.2 Register the change in `e2e/coverage-ledger.ts`: add `022-published-link-restated` to
      `COVERED_FEATURES`, add `022/FR-001` to the `requirements` array of the `build/share-link`
      entry, and add the journey's assertion to that entry's `assertions` array. The ledger keys
      evidence by id, so the new requirement needs its own id there to be gated at all — sharing
      `001/FR-020` would let the standing requirement's assertions stand in for it. Verify with
      `pnpm run policy:specs`, which fails naming any declared id that is not registered. It reads
      `openspec/specs/` alone, so it accepts the registration now and starts requiring it when the
      delta is archived into the capability specification.
- [x] 4.3 Run `pnpm run check`. Verify unit coverage stays at or above 80% on all four counters,
      and report what passed, including which Playwright projects this container could run and
      which it could not.
