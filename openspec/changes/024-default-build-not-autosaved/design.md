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
manual save does, and it is the one case in autosave's own path where a tool at its default takes
one. A manual save is the other, and it does not come through this branch. `true` is the
honest answer: `flush()` asks whether letting go of the work loses anything, and it does not.
`EmptyBenchService` reads that answer before clearing the bench, which is how a default loadout is
cleared while a loadout the store refused to write still holds the bench.

The branch is placed before `#allocate`, so a default build neither mints a record nor takes an
existing one over. An unnamed record that already holds the default state — stored by an earlier
version, or left by a build since edited back — stays where it is and runs out its seven days.

`#schedule` also skips the timer in the same condition, so an untouched build does not wake a
timeout every 400 ms for as long as it is open.

The condition is read outside the watcher's subscription. The watcher subscribes to the revision and
the fingerprint, which is what an edit changes; the gate asks two more questions of the subject, and
the answer to neither is an edit. Subscribed to, minting a record at the first edit wakes the watcher
a second time and arms a second timer, which stores the bytes the first one has just stored under a
fresh revision and a later `modifiedAt`. So one edit writes once.

### What each store answers

Both stores gain one computed signal, and `WorkingRecordSubject` gains it as a member beside
`dirty` and `fingerprint`:

- `ActiveBuildStore`: the snapshot names no ship and carries no ident, every module carries no
  choice — on, in the first power group, no pre-engineered article and no engineering — and the
  fitted slots and modules are the ones `getDefaultLoadout(<hull symbol>)` publishes. The name and
  the ident are in the snapshot, so a named ship is not at the default without a branch of its own.
  The case is still unit tested, as task 1.2 asks.
- `LoadoutStore`: the loadout's fingerprint equals the fingerprint of the bench's starting loadout
  for its suit family — that suit at the lowest grade `getSuitByFamily` publishes, no weapon on any
  mount, no modification fitted.

Each comparison lives in the domain beside the fingerprint it is made of, is pure, and is unit
tested without rendering.

**Where the hull's supplied fit is read.** `ActiveBuildStore` is started with the shell, so
whatever its comparison reaches is in the first bundle a Commander downloads. Reaching
`ShipLoadout.default` from there puts the whole outfitting catalogue in that bundle — 744 kB,
measured — and `getDefaultLoadout` alone still puts 50 kB of default loadouts there, over the
project's 1 MB initial-bundle budget.

So the store reads no package. The fit the hull is supplied with travels on the `BuildCandidate`,
resolved by whoever constructed it, exactly as the hull's name already does and for the same
reason. All four routes into a build — stock creation, opening a record, a link, a SLEF or journal
import — have asked the package for the build already, so the fit costs them nothing, and the field
is required, so a fifth route cannot be written without one. `getDefaultLoadout` is what they ask:
it publishes the supplied identities alone, which is the division the package states in its own
documentation.

This is not the rejected flag. The fit is a fact about the hull, not about the build: it is never
cleared, no edit path touches it, and the comparison still runs over the whole state on every
revision, so a build edited back to the default reads as at the default again. What is compared is
stated field by field rather than as one fingerprint: the fit, and that no module carries a choice.
Task 2.3 is what holds the two together — it asserts that the build `StockBuildCreator` actually
produces reads as at its default.

**What a journal states and a build assembled here leaves out.** One build reaches the ship
comparison in two shapes. A journal writes `On` and `Priority` on every module and `ShipName` and
`ShipIdent` on every ship, blank for a ship that carries neither; a build assembled in the
application writes none of that, and the snapshot records each absent field as nothing. So the
comparison reads what the state says rather than whether it was written: a module on and in the
first power group carries no choice, and a blank name and a blank ident are an absent name and an
absent ident, which is how a build's title already reads them. A module switched off, a module in
another power group, and a name a Commander gave are each a decision in either shape.

Read the other way, a build imported from a game journal would be the one default build that takes
a record, and the rule "the test is the state, not the route" would hold for every route but the
one a Commander is most likely to use. The bench needs none of this: an `EquipmentLoadout` carries
no name and no power state, so a loadout from a journal and one assembled here reach the
fingerprint in the same shape.

**Letter case.** The ship comparison reads the hull symbol, every slot key and every module symbol
by identity rather than by spelling. One identity reaches it in more than one case: the supplied fit
the package publishes for the Anaconda names `Int_SuperCruiseAssist` beside
`int_planetapproachsuite_advanced`, and the same modules in a build name them differently again.
Each identity is unique case-insensitively, and the package says so itself — `getModuleBySymbol`
answers every spelling of a symbol it knows with one module, which
`almanac-identity-contract.spec.ts` holds it to over every hull it supplies a fit for. So the
comparison agrees with the package rather than correcting it: nothing is altered and nothing is
handed back. Letter case is not a decision a Commander made, and a hull's default reached through a
link is the hull's default.

Where the bench can drift is the store rather than the comparison: `atSuitDefault` is the
fingerprint of `newLoadout`'s own output, so it agrees with that function by construction, and what
is worth asserting is that the bench hands a Commander that loadout and not another one.
`loadout.store.spec.ts` walks every published suit for it, as `stock-build.creator.spec.ts` walks
every hull.

Only this comparison folds the case. `baselineFingerprint` stays as it is, because it answers
whether the stored state moved, and a build whose stored spelling changed did move. The bench
comparison folds nothing either: the loadout codec carries one spelling for every suit, weapon and
modification, so there is no drift to fold. The bench comparison is a fingerprint comparison, and
stays one: `newLoadout` is the store's own starting loadout and reaches no catalogue.

**Cost.** Looking the hull's supplied fit up on every tick would be work repeated for no reason, so
it is memoised per hull symbol, and the default fingerprint per suit family on the bench. The
comparison runs only while the tool holds no record, which lasts until the first edit.

**A package release that changes a default.** The memo is per process, so an upgrade that changes a
hull's default loadout takes effect on the next load, which is when the upgraded package arrives. A
build open across that upgrade keeps whatever record it already holds; the comparison is over
stored state, so nothing the package recomputes moves it.

### Letting go of a claim

A tab writes down which record each tool is autosaving into, so a reload restores what the page was
working from and a duplicated tab can see that two pages are writing to one record.
`TabOwnershipCoordinator.track` announces the record a tool holds, and releases its claim where that
record becomes null and this page announced one. A claim that only ever changed to another record
needs no release, because the new record overwrites it within the coalescing window.

Work that is in no record needs one. A Commander autosaving into a record who creates a build from
the hull catalogue holds a build that is stored nowhere, and without the release the claim on the
record before it stands for as long as the page runs: a reload restores the record the Commander stepped
off, and a duplicated tab forks it. So a tool whose record becomes nothing lets go of its claim
where it announced one, which is what "a tool that holds no record claims none" asks for.

Holding no autosave target is not the same as being in no record. Autosave has no path to a named
record, so a tool whose work is in one holds no target while the work is stored all the same — after
a save, and after opening a record from the saved list. Both are records a reload should restore
from. So the claim is read from where the work is rather than from how it got there: the record
autosave holds, or failing that the named record the work is in and matches. `sourceNamed` says
which record, and `dirty` says whether the work is still the one that record holds; an edit puts the
work somewhere the record cannot be opened to, and the unnamed record minted for it is claimed
instead.

Read as signals, so the watcher wakes when either moves. That is what this change makes necessary:
before it, a claim left standing was corrected by the next allocation, and a default build allocates
nothing. Without it, saving and then creating a build from the hull catalogue leaves the saved
record claimed for as long as the page runs, and a reload opens a build the Commander moved on from.

Asking instead whether a _save_ wrote the claim would answer the save and miss the open, and it
would have to be remembered rather than derived — a second copy of where the work is, in the one
place it must not disagree.

**Where it announced one** is the other half of the guard. The claim in the tab outlives the page that
wrote it — that is what makes it readable after a reload — and every page registers its tools before
it has restored anything, holding no record at that moment. A release read off that first moment
would be the page erasing its own way back. What the page has announced in this run is the honest
difference between a tool that has let go of something and a tool that has not yet picked anything
up.

Released rather than merely written down, so a sibling page stops protecting a record nobody is
writing to. The record itself is untouched: what is released is the claim, and the record runs out
its own seven days.

`EmptyBenchService` releases the bench's claim without that guard, because emptying the bench is a
Commander asking for it rather than a watcher reading a signal. There is no first moment to be
confused by: the request cannot arrive before the page has drawn a loadout to empty.

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
differs is which entries the two lists hold. Responsiveness, touch and accessibility are therefore
unchanged, and are verified by the journeys already scanned across the ten-project matrix rather
than by new surfaces.

One sentence changes. The empty saved screen states when work starts being kept, and it is the
screen a Commander reaches right after creating a build or choosing a suit, which the journeys here
drive on purpose. `library.empty.description` states the rule that holds: work is kept from the
first change to it. It speaks of work rather than of a build, because the screen lists what both
tools saved and 024/FR-002 makes the same rule true on the bench. The key is the same one, in every
locale catalogue, so nothing is added and nothing is left untranslated.

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
