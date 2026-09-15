## Why

Creating a build writes a record before the Commander has changed anything. A Commander who opens
four hulls to compare them leaves four records, each holding the package default loadout and nothing
else, each stating seven days of life left in the library. The same holds on the bench: choosing a suit
writes a record of that suit at its lowest grade, with no weapon and no modification.

None of those records holds a decision. Every one of them is the state
`ShipLoadout.default(<hull symbol>)` or the bench's own starting loadout for a suit, which a
Commander reaches again by selecting the hull or the suit. What they cost is a library holding
entries a Commander has to sort through to find the builds they made, and a seven-day notice on each
of those entries that says something is about to be lost when nothing is.

A record is worth keeping at the first state the package default does not already describe. Until
then there is nothing to keep.

## What Changes

- A build whose modelled state is exactly the package default for its hull takes no record. Autosave
  mints or takes over a record at the first state that differs from that default, and from then on
  the record is written on the terms that already govern it.
- A loadout whose stored state is exactly the bench's starting loadout for its suit takes no record,
  on the same terms.
- The test is the state, not the route. A default build that arrives in a link, in a SLEF import or
  from a journal event is the same state as one a Commander created, and is kept the same way — by
  selecting the hull again. Nothing has to know where the state came from.
- A record a tool already holds is kept and keeps being written. Editing a build back to the package
  default does not delete its record. Records are removed by a confirmed deletion, by the manual save
  that consumes one, or by the seven-day expiry, and by nothing else.
- A tool holding an unrecorded default claims no record for this tab. A duplicated tab therefore has
  nothing to fork for that tool, and the other tool's claim is untouched.
- An untouched default is restored from the fragment. A build's link is published from the moment
  the build becomes active, and the bench's fragment carries the loadout from the moment it reaches
  the bench. The ship tool's requirement states this for edits alone, and the bench states when its
  address is read but never when it is written, so both are stated. At an address whose fragment
  carries nothing, the workspace opens on the no-build state and the bench on the suit gate, because
  nothing was stored.
- Starting an empty bench on an untouched default clears it and leaves nothing in the saved list.
  The bench still refuses to clear a loadout that carries a choice and is in no record, which is the
  store refusing writes rather than a state with nothing to keep.
- Naming an untouched default still saves it. A save with no unnamed record to consume writes a
  named record, as a save already does where the record was deleted in another tab.
- No wording changes. Persistence is `ready` rather than `saved` while no record is owed, and both
  draw nothing. The help topic on browser storage answers where work is kept, not when a record is
  minted, so it stands as written. No new words, so no catalogue keys.

The change declares three requirements:

- **FR-001** (Ship Builder) A build takes no record while its modelled state is the package default
  loadout for its hull, with no ship name and no ident. A record is taken at the first state that
  differs, and a record already held is kept.
- **FR-002** (Equipment Builder) A loadout takes no record while its stored state is its suit at the
  lowest grade the package publishes, with no weapon on any mount and no modification fitted. A
  record is taken at the first state that differs, and a record already held is kept.
- **FR-003** (Both tools) A build's link is published from the moment the build becomes active, and
  the fragment carries the loadout from the moment it reaches the bench. Neither waits for the first
  edit. Each change replaces the fragment without adding a history entry. Where there is nothing to
  publish, because the bench holds no loadout or the codec refused the build, nothing is published
  and a fragment carrying an earlier build's link is removed. The path and the query never carry any
  part of either. This is what an untouched default is recovered from.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `ship-builder/build-lifecycle`: "Autosave of the active build" states that a record is taken from
  the moment a build becomes active. It is restated so that a build at the package default takes
  none, says what a reload restores from while none is held, and says that a record already held is
  kept when the build returns to the default. "Build creation from the package default loadout"
  drops the claim that the earlier build always stays in a record of its own. "Naming, saving and
  removing a record" gains the save that has no unnamed record to consume, and restates why
  replacing the active build is not confirmed. "Concurrent pages and records" gains the tool that
  claims nothing — the requirement that carries the claim for both tools.
- `ship-builder/build-link`: "Link validation and history" ties fragment publication to build edits.
  It is restated so that a build's link is published from the moment the build becomes active, which
  is what a default build is recovered from (024/FR-003). It is scoped to publication, so what the
  address holds afterwards is left to "The address keeps the published link" (022/FR-001). A build
  the codec refuses publishes nothing, and a fragment carrying an earlier build's link is removed.
- `ship-builder/slef-exchange`: "One selected event replaces the active build" gives autosave
  holding the import as the reason it is not also written to a named record. That reason is restated
  to cover the import that takes no record, and the batch that stores one named record per event is
  untouched.
- `equipment-builder/loadout-persistence`: "Autosave of the open loadout" states that a record is
  taken from the moment a loadout is on the bench. It is restated on the ship tool's terms.
  "Naming, saving, reopening and deleting a loadout" gains the save that has no unnamed record to
  consume. "What the bench says about storing" covers the loadout that owes no write. A requirement
  is added for the fragment carrying the loadout on the bench (024/FR-003).
- `equipment-builder/loadout-assembly`: "Starting an empty bench" rests on the loadout always being
  in a record. It is restated so that a loadout at its suit's default is cleared without being kept,
  and so that the states where the bench refuses to clear are the store's failures alone.

## Impact

- `src/app/application/build-library/working-record.autosave.ts` gains the one gate: while the tool
  holds no record and the work is at its default, nothing is owed. It is the single base class both
  tools' autosave services extend, so both follow the same rule and every route into a build reaches
  it. Its two service specifications, `autosave.service.spec.ts` and
  `loadout-autosave.service.spec.ts`, each cover the gate for their own tool.
- `src/app/application/build-library/working-record.port.ts` gains the fact the gate reads, and
  `ActiveBuildStore` and `LoadoutStore` answer it from their own state.
- `src/app/domain/ships/build/` and `src/app/domain/equipment/loadout/` each gain the comparison
  against the package default, beside the fingerprint the comparison is made of.
- The four routes into a build — `stock-build.creator.ts`, `record-open.service.ts`,
  `build-link.coordinator.ts` and `slef-import.coordinator.ts` — each supply the hull's published
  fit on the candidate they build, because the store that asks the question is started with the
  shell and must reach no catalogue. None of them marks its own output: the comparison is made on
  state alone, so the catalogue, a link, a paste and a journal event get one answer for one build.
- `src/app/application/build-library/tab-ownership.coordinator.ts` lets go of the record a tool
  held once that tool takes up work that is in none, which is new: before this change autosave
  always minted a record to claim instead.
- `src/app/application/equipment/empty-bench.service.ts` clears a bench holding an unrecorded
  default. Its flush already answers "nothing owed" rather than "write failed", which is the
  difference the requirement turns on.
- `e2e/build-working-state.spec.ts` carries the ship tool's journey, `e2e/tool-bar-navigation.spec.ts`
  the bench's, `e2e/hull-detail.spec.ts` the second creation, `e2e/slef-import.spec.ts` the journal
  routes, and `e2e/build-link.spec.ts` and `e2e/equipment-link.spec.ts` the address each tool
  publishes. `e2e/coverage-ledger.ts` registers the three requirement ids and this change's
  directory.
- `openspec/changes/archive/001-ship-selection-and-loading/contracts/persistence.md` and
  `contracts/build-link.md` are not edited. They record what feature 001 built; the capability
  specification is the standing record. This change cites the link contract's rule that a refusal
  removes a stale fragment. It departs from three of their rules: the persistence contract's, that
  stock creation, a decoded link and a SLEF import each mint a record before the Commander changes
  anything; the link contract's step 6, which mints one for every decoded link; and the reason
  neither gives for not confirming a replacement, which the restated requirement states afresh. The
  link contract also encodes after a modelled edit, where 024/FR-003 publishes from activation. The
  code already publishes there, so that one is a restatement rather than a change of behaviour.
- This change is archived after `022-published-link-restated`. The restated link requirement defers
  to 022/FR-001 for what the address holds, and an untouched default is the build 022's restoration
  keeps recoverable. A lost fragment costs a build that holds a record nothing, and costs an
  untouched default the build.
