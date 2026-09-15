## Why

Creating a build writes a record before the Commander has changed anything. A Commander who opens
four hulls to compare them leaves four records, each holding the package default loadout and nothing
else, each counting down seven days in the library. The same holds on the bench: choosing a suit
writes a record of that suit at its lowest grade, with no weapon and no modification.

None of those records holds a decision. Every one of them is the state
`ShipLoadout.default(<hull symbol>)` or the bench's own starting loadout for a suit, which a
Commander reaches again by selecting the hull or the suit. What they cost is a library that a
Commander has to read past to find the builds they did make, and the seven-day notice on each entry
that says something is about to be lost when nothing is.

The record earns its place at the first state the package default does not already describe. Until
then there is nothing to keep.

## What Changes

- A build whose modelled state is exactly the package default for its hull takes no record. Autosave
  mints or takes over a record at the first state that differs from that default, and from then on
  the record is written as it is today.
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
- An untouched default is restored from the address, which already carries the open build or loadout
  after every edit. At an address carrying no fragment the workspace opens on the no-build state and
  the bench on the suit gate, because nothing was stored.
- Starting an empty bench on an untouched default clears it and leaves nothing in the saved list.
  The bench still refuses to clear a loadout that carries a choice and is in no record, which is the
  store refusing writes rather than a state with nothing to keep.
- Naming an untouched default still saves it. A save with no unnamed record to consume writes a
  named record, as a save already does where the record was deleted in another tab.
- Nothing a Commander reads changes. Persistence is `ready` rather than `saved` while no record is
  owed, and both draw nothing. No new words, so no catalogue keys.

The change declares two requirements:

- **FR-001** (Ship Builder) A build takes no record while its modelled state is the package default
  loadout for its hull, with no ship name and no ident. A record is taken at the first state that
  differs, and a record already held is kept.
- **FR-002** (Equipment Builder) A loadout takes no record while its stored state is its suit at the
  lowest grade the package publishes, with no weapon on any mount and no modification fitted. A
  record is taken at the first state that differs, and a record already held is kept.

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
- `equipment-builder/loadout-persistence`: "Autosave of the open loadout" states that a record is
  taken from the moment a loadout is on the bench. It is restated on the same terms, and
  "Naming, saving, reopening and deleting a loadout" gains the save that has no unnamed record to
  consume.
- `equipment-builder/loadout-assembly`: "Starting an empty bench" rests on the loadout always being
  in a record. It is restated so that a loadout at its suit's default is cleared without being kept,
  and so that the states where the bench refuses to clear are the store's failures alone.

## Impact

- `src/app/application/build-library/working-record.autosave.ts` gains the one gate: while the tool
  holds no record and the work is at its default, nothing is owed. One place, so both tools follow
  the same rule and every route into a build reaches it.
- `src/app/application/build-library/working-record.port.ts` gains the fact the gate reads, and
  `ActiveBuildStore` and `LoadoutStore` answer it from their own state.
- `src/app/domain/ships/build/` and `src/app/domain/equipment/loadout/` each gain the comparison
  against the package default, beside the fingerprint the comparison is made of.
- `src/app/application/active-build/stock-build.creator.ts` and the equipment bench are unchanged.
  A creator that marked its own output would leave the same state arriving in a link unmarked.
- `src/app/application/equipment/empty-bench.service.ts` clears a bench holding an unrecorded
  default. Its flush already answers "nothing owed" rather than "write failed", which is the
  difference the requirement turns on.
- `e2e/build-working-state.spec.ts`, `e2e/equipment-builder.spec.ts` and `e2e/hull-detail.spec.ts`
  carry the journeys, and `e2e/coverage-ledger.ts` registers the two requirement ids and this
  change's directory.
- `openspec/changes/archive/001-ship-selection-and-loading/contracts/persistence.md` is not edited.
  It records what feature 001 built; the capability specification is the standing record.
