## Context

See proposal.md — Why. The requirements are in this change's delta specifications.

One class keeps both tools recoverable. `WorkingRecordAutosave` watches a `WorkingRecordSubject` —
`ActiveBuildStore` for the ship tool, `LoadoutStore` for the bench — and on every revision it
either writes, mints a record, takes an identical unnamed record over, or decides nothing is owed.
Three facts shape the approach:

- **Nothing is owed while the subject is clean.** `dirty()` compares the current fingerprint with
  the baseline the last store or open set. A build arriving from creation, a link or an import
  carries `baseline: null`, so it is dirty from its first tick and a record is minted for it.
- **A fingerprint is the serialised state.** `baselineFingerprint` is `JSON.stringify` of the
  build snapshot; `loadoutFingerprint` is the same over the stored loadout. Both change when, and
  only when, a Commander changed something, and both are already the value the take-over rule
  compares.
- **The address already carries the work.** `FragmentPublisher` and `LoadoutLinkCoordinator`
  publish from the moment a build is active or a loadout is on the bench, and replace the fragment
  on every revision after that. The fragment outranks a restored record on arrival, so a reload of
  the address restores a build that is in no record. The ship tool's requirement ties publication to
  edits, and the bench states when its address is read but never when it is written, which is why
  this change states the address requirement.

## Goals / Non-Goals

**Goals:**

- One gate, in one place, that both tools reach by every route into a build or a loadout.
- The comparison is against the package, so a release that changes a hull's default loadout moves
  what counts as default with it.
- No change to what a Commander reads, and no new catalogue keys.

**Non-Goals:**

- No new screen, and no change to an existing one. Persistence states `ready`, `saving` and
  `saved` all draw nothing, so a build that is in no record and one that is saved look the same.
- No removal of a record that already exists. Editing back to the default keeps the record.
- No change to the seven-day expiry, to the take-over rule, or to what a manual save does.
- No edit to `openspec/changes/archive/001-ship-selection-and-loading/contracts/persistence.md`.
  It records what feature 001 built.

## Decisions

### The gate is on state, not on provenance

**Decision.** A tool takes no record while it holds no record _and_ its state equals the default
for the hull or the suit it names. The check is a fingerprint comparison, and it runs on the state
alone.

**Why not mark the candidate at creation?** `StockBuildCreator` could hand the commit a flag saying
"this is untouched stock", cleared by the first edit. It is less code, and it is wrong in two
directions. A default build decoded from a build link, reconstructed from a SLEF paste or read from
a journal event would carry no flag and would take a record, although it is the same state and is
recovered the same way. And the flag has to be cleared by whoever edits, so every ingress and every
edit path becomes a place the rule can be forgotten. The state answers the question by itself.

**Alternative rejected: compare inside the store.** Each store could expose `atDefault()` computed
from its own domain and autosave could read it. That is what happens, but the _decision_ stays in
autosave: the store answers a fact about its work, and autosave decides what that fact means for a
record. Putting the "write nothing" branch in two stores would be two places for one rule.

### Where the branch goes

`WorkingRecordAutosave.#writeNow` gains one early return, beside the `dirty()` one it already has:

- the subject holds no record (`autosaveRecordId() === null`), and
- the subject reports its work at its default,

then nothing is owed. It returns `true`, exactly as the clean-subject branch does.

The branch governs autosave's own writes alone. An explicit resume writes past it, exactly as it
already writes past the `dirty()` early return, because a Commander who resumes has asked for the
work to be kept. That is what the restated concurrency rules mean by resuming taking a record as a
manual save does, and it is the one case where a tool at its default takes one. `true` is the
honest answer: `flush()` asks whether letting go of the work loses anything, and it does not.
`EmptyBenchService` reads that answer before clearing the bench, which is how a default loadout is
cleared while a loadout the store refused to write still holds the bench.

The branch is placed before `#allocate`, so a default build neither mints a record nor takes an
existing one over. An unnamed record that already holds the default state — stored by an earlier
version, or left by a build since edited back — stays where it is and runs out its seven days.

`#schedule` also skips the timer in the same condition, so an untouched build does not wake a
timeout every 400 ms for as long as it is open.

### What each store answers

Both stores gain one computed signal, and `WorkingRecordSubject` gains it as a member beside
`dirty` and `fingerprint`:

- `ActiveBuildStore`: the snapshot's fingerprint equals the fingerprint of the snapshot of
  `ShipLoadout.default(<hull symbol>)`. Ship name and ident are in the snapshot, so a named ship is
  not at the default without a branch of its own. The case is still unit tested, as task 1.2 asks.
- `LoadoutStore`: the loadout's fingerprint equals the fingerprint of the bench's starting loadout
  for its suit family — that suit at the lowest grade `getSuitByFamily` publishes, no weapon on any
  mount, no modification fitted.

Each comparison lives in the domain beside the fingerprint it is made of, is pure, and is unit
tested without rendering.

**Cost.** Building `ShipLoadout.default(symbol)` on every tick would be work repeated for no
reason, so the default fingerprint is memoised per hull symbol, and per suit family on the bench.
The comparison runs only while the tool holds no record, which lasts until the first edit.

**A package release that changes a default.** The memo is per process, so an upgrade that changes a
hull's default loadout takes effect on the next load, which is when the upgraded package arrives. A
build open across that upgrade keeps whatever record it already holds; the fingerprint is over
stored state, so nothing the package recomputes moves it.

### Restoring an untouched default

Nothing is stored, so a reload restores it from the address, which carries the build link for as
long as a build is active. Two consequences are accepted rather than worked around:

- At an address with no fragment, the workspace opens on the no-build state and the bench on the
  suit gate. The Commander reaches the same default by selecting the hull or the suit.
- A default build open in a tab that is closed is gone. It was the package's own default, and the
  hull catalogue is how it comes back.

**Alternative rejected: keep a record and hide the entry.** The record could be written and left
out of the library listing. It would restore a closed tab, and it would cost a write on every
default build, a stored entry that the storage quota counts and the Commander cannot see, and an
expiry sweep running over entries nobody was shown. `ship-builder/build-lifecycle`, "Stored entry
facts and listing", requires every stored entry to state its facts and to be one the Commander can
choose to discard, which a hidden record is not.

### The address requirement is stated here

**Decision.** This change states, in both tools' specifications, that the address carries the open
work from the moment it opens rather than from its first edit. `ship-builder/build-link` restates
"Link validation and history" for the ship tool, and `equipment-builder/loadout-persistence` adds
the requirement for the bench.

**Why it is needed.** A default build is in no record, so the address is the only thing that holds
it. A requirement that ties publication to edits would leave an untouched default recoverable by
nothing, and the bench states no address requirement at all. The code already publishes on
activation — both coordinators' start effects run on the first revision — so this states what is
built rather than asking for behaviour to change.

**Why not lean on change 022.** Change 022 adds "The address keeps the published link", which says
the address must carry a link that is published and must put it back when something removes it. It
starts from a published link and does not say when publication starts, so it does not cover the
build that has published nothing yet. It also touches the ship tool alone. The two changes edit the
same capability file and no shared requirement: 022 adds a requirement, this change restates an
accepted one. The restated requirement is scoped to publication for the same reason — what the
address holds after a link is published is 022's to state, so the two do not answer the refused link
or the foreign fragment differently.

**022 lands first.** The requirement here says a link is published; 022 is what keeps that link in
the address when something else moves it. An untouched default has nothing else holding it, so the
defect 022 fixes costs a Commander the build rather than only the link. Losing the fragment is
harmless for a build that holds a record, which autosave restores under 001/FR-008. It costs an
untouched default the build, because nothing else holds one.

### Screens

This change introduces no screen and changes no screen's composition or states. The workspace, the
bench, the saved-builds library and the saved-loadouts list draw what they already draw; what
differs is which entries the two lists hold. Responsiveness, touch, accessibility and localisation
are therefore unchanged, and are verified by the journeys already scanned across the ten-project
matrix rather than by new surfaces.

## Risks / Trade-offs

- **A Commander loses an untouched default by closing the tab.** → It is the package's default for
  a hull or a suit, reached again by selecting that hull or suit. Nothing a Commander decided is in
  it. The proposal states this as the point rather than the cost.
- **The equality test drifts from what the bench actually starts.** A change to the starting loadout
  that does not change the comparison would make every new loadout take a record again, silently.
  → A unit test asserts that the loadout the bench starts is at its default by the comparison's own
  answer, and the same for the build the creator produces.
- **A serialisation change moves the fingerprint on one side only.** → The comparison is between
  two fingerprints taken by the same function over the same shape, so a change to the serialiser
  moves both. The unit test that pins "a freshly created build is at its default" is what catches a
  change that moves only one.
- **A record left by an older version still holds a default build.** → It is an ordinary unnamed
  record. It is not taken over, it is listed, and it expires after seven days. No migration.
- **A page reads `flush()` as "the work is stored".** → The one caller that acts on it is
  `EmptyBenchService`, and what it needs is exactly what the gate answers: clear a bench whose
  loadout costs nothing to let go of. The task list verifies the other states it refuses on are
  unchanged.

## Migration Plan

None. No stored format changes, and no record is read, rewritten or removed by this change. A
record written by an older version is an ordinary unnamed record afterwards.
