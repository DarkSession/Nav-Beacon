# Results: screen-reader journeys

Protocol: [`screen-reader`](../screen-reader.protocol.md), version 14.

Each row is one observation: one step, in one configuration, and — from
protocol version 14 — at one orientation. Rows are appended, never edited — a
later run is a new row, so the history of a regression stays readable. The
sections written before version 14 carry no orientation column, and are left as
they were rather than backfilled with a value nobody observed.

## Run 1

**Status: not yet executed.**

No screen-reader run has been performed against this build. The rows below
record the runs that are required and are deliberately left without actual
results rather than being filled in from the automated suite, which cannot hear
anything and is a floor rather than a substitute.

The automated coverage that _does_ exist for the same requirements is the axe
scan across every product and preview state in all ten projects, plus the named
semantic assertions in `e2e/accessibility/assertions.ts` — accessible names
matching visible text, exposed state, label/description/error relationships,
landmark and heading structure, live-region urgency and replay, and text
equivalents for every visual carrier.

| Date | OS  | Browser  | Reader   | Build | Viewport | Configuration | Step | Expected                  | Actual | Result  |
| ---- | --- | -------- | -------- | ----- | -------- | ------------- | ---- | ------------------------- | ------ | ------- |
| —    | —   | Firefox  | NVDA     | —     | —        | desktop       | 1–15 | As stated in the protocol | —      | not run |
| —    | —   | Chromium | TalkBack | —     | —        | mobile        | 1–15 | As stated in the protocol | —      | not run |
| —    | —   | Chromium | TalkBack | —     | —        | tablet        | 1–15 | As stated in the protocol | —      | not run |

Capability features append their own rows as they land; the rows above are the
foundation's own and are the ones this feature is accountable for.

## The exchange layers (feature 004)

Step 15 covers the import and export layers. Their composition materially
differs between the desktop dialog and the compact bottom sheet — the format
list moves, the actions wrap — so each is its own observation.

| Date | OS  | Browser  | Reader   | Build | Viewport | Configuration | Step | Expected                  | Actual | Result  |
| ---- | --- | -------- | -------- | ----- | -------- | ------------- | ---- | ------------------------- | ------ | ------- |
| —    | —   | Firefox  | NVDA     | —     | —        | desktop       | 15   | As stated in the protocol | —      | not run |
| —    | —   | Chromium | TalkBack | —     | —        | mobile        | 15   | As stated in the protocol | —      | not run |
| —    | —   | Chromium | TalkBack | —     | —        | tablet        | 15   | As stated in the protocol | —      | not run |

## A newly published version (feature 011, user story 4)

Step 16 covers the two states the shell is in when the version it is running is
no longer the published one. It is the only place the split between the two
outlets is checkable: the visible notice is a `status` for a waiting version and
an `alert` for an unrepairable cached one, and the assertive outlet deliberately
summarises rather than repeating what the alert already said
(`src/app/app.ts`, the version effect in the constructor). A reader disagreeing
on either half sends that decision back rather than recording a failure to fix
elsewhere.

Each configuration is its own observation: the restart is on the command bar
where there is room for it and behind the named action layer where there is not,
so what a reader walks past to reach it differs.

| Date | OS  | Browser  | Reader   | Build | Viewport | Configuration | Step | Expected                  | Actual | Result  |
| ---- | --- | -------- | -------- | ----- | -------- | ------------- | ---- | ------------------------- | ------ | ------- |
| —    | —   | Firefox  | NVDA     | —     | —        | desktop       | 16   | As stated in the protocol | —      | not run |
| —    | —   | Chromium | TalkBack | —     | —        | mobile        | 16   | As stated in the protocol | —      | not run |
| —    | —   | Chromium | TalkBack | —     | —        | tablet        | 16   | As stated in the protocol | —      | not run |

## Help, licences and provenance (feature 012)

Step 17 covers the Help · About modal and the frame entry that opens it. Each
configuration is its own observation, and for the same reason as the exchange
layers: the entry is on the banner row at desktop and inside the named action
layer at compact, so what a reader walks past to reach it differs, and the modal
is a centred dialog at one and a full-width sheet at the other.

The alternate-locale half of the step is run on the desktop configuration only,
because what it is asking — whether a reader switches voice for the Frontier
notice while the interface is in German — is a property of the reader and the
`lang` attribute rather than of the layout.

| Date | OS  | Browser  | Reader   | Build | Viewport | Configuration | Step | Expected                  | Actual | Result  |
| ---- | --- | -------- | -------- | ----- | -------- | ------------- | ---- | ------------------------- | ------ | ------- |
| —    | —   | Firefox  | NVDA     | —     | —        | desktop       | 17   | As stated in the protocol | —      | not run |
| —    | —   | Chromium | TalkBack | —     | —        | mobile        | 17   | As stated in the protocol | —      | not run |
| —    | —   | Chromium | TalkBack | —     | —        | tablet        | 17   | As stated in the protocol | —      | not run |

The record feature 012 is accountable for, including what the automated suite
does cover in its place, is
[`openspec/changes/archive/012-help-and-licences/design/screen-reader-record.md`](../../../openspec/changes/archive/012-help-and-licences/design/screen-reader-record.md).

## Drives & Mass (feature 008)

Step 18 covers the anatomy region's `DRIVES` mode and the three status-rail
cells that repeat three of its figures. Two states are separate observations
rather than one: the ready cards, and the same region with the thrusters
switched off, which replaces the speed envelope with the package's own reasons.
They are a different DOM from each other, and what a reader makes of "the
package declined to say how this ship moves" is the judgment FR-005 turns on.

Each configuration is its own observation for the usual reason: the two cards
stand side by side where the region has the width and stack where it does not,
so what a reader walks past between the thruster figures and the drive figures
differs between desktop and a phone.

The automated coverage that does exist for the same requirements is
`e2e/mobility-and-jump.spec.ts` — every figure read back out of the page and
compared against another part of the same page that has to agree with it, the
rail cells compared field for field against the cards, every bar asserted as
`aria-hidden` with its number in text beside it, and an axe sweep over the
ready, unavailable and stacked states in all ten projects.

| Date | OS  | Browser  | Reader   | Build | Viewport | Configuration | Step | Expected                  | Actual | Result  |
| ---- | --- | -------- | -------- | ----- | -------- | ------------- | ---- | ------------------------- | ------ | ------- |
| —    | —   | Firefox  | NVDA     | —     | —        | desktop       | 18   | As stated in the protocol | —      | not run |
| —    | —   | Chromium | TalkBack | —     | —        | mobile        | 18   | As stated in the protocol | —      | not run |
| —    | —   | Chromium | TalkBack | —     | —        | tablet        | 18   | As stated in the protocol | —      | not run |

## The equipment bench (feature 013)

Step 19 covers `/equipment` end to end. Three states are separate observations
rather than one: the bench with no suit on it, where every region is drawn and
exactly one control is live; the bench with a suit on it, where held mounts and
grade-locked slots have to carry their reason in words; and an address that
arrived unreadable, where the announcement has to say the bench did not change.

Each configuration is its own observation for the usual reason: the bench draws
four regions side by side where there is room and one tabbed region where there
is not, so what a reader walks between the ledger and the figures is a different
screen at each width.

The automated coverage that does exist for the same requirements is
`e2e/equipment-builder.spec.ts`, `e2e/equipment-library.spec.ts`,
`e2e/equipment-link.spec.ts` and `e2e/equipment-accessibility.spec.ts` — every
control resolved by its accessible name rather than its class, every held and
grade-locked state asserted to carry its reason as text, the gate's two previews
asserted to be out of the accessibility tree entirely, and an axe pass, heading
walk, target measurement, overflow check and clipping check over the empty
bench, the fitted bench, both choosers and the export layer in all ten
projects.

| Date | OS  | Browser  | Reader   | Build | Viewport | Configuration | Step | Expected                  | Actual | Result  |
| ---- | --- | -------- | -------- | ----- | -------- | ------------- | ---- | ------------------------- | ------ | ------- |
| —    | —   | Firefox  | NVDA     | —     | —        | desktop       | 19   | As stated in the protocol | —      | not run |
| —    | —   | Chromium | TalkBack | —     | —        | mobile        | 19   | As stated in the protocol | —      | not run |
| —    | —   | Chromium | TalkBack | —     | —        | tablet        | 19   | As stated in the protocol | —      | not run |

## The tool bar's own controls (feature 017)

Step 20 covers the mark and the tool tabs. Two of the five activations it
walks are deliberately silent — the mark on the entry point, the open tool's
tab where its re-entry already stands — and whether silence reads as "nothing
to do here" or as "this control is broken" is the judgment no snapshot of the
accessibility tree can make.

Each configuration is its own observation for the usual reason: the deck folds
between the wide and compact modes, so what a reader walks between the mark and
the tabs is a different bar at each width.

The automated coverage that does exist for the same requirements is
`e2e/tool-bar-navigation.spec.ts` and `e2e/interface-foundations.spec.ts` —
the mark asserted to carry an address and an accessible name on every screen,
the open tool asserted to be a link carrying `aria-current`, every re-entry
followed to the screen it leads to, an activation that must change neither the
screen nor the address, and an axe scan of the bar and of the emptied bench in
all ten projects.

| Date | OS  | Browser  | Reader   | Build | Viewport | Configuration | Step | Expected                  | Actual | Result  |
| ---- | --- | -------- | -------- | ----- | -------- | ------------- | ---- | ------------------------- | ------ | ------- |
| —    | —   | Firefox  | NVDA     | —     | —        | desktop       | 20   | As stated in the protocol | —      | not run |
| —    | —   | Chromium | TalkBack | —     | —        | mobile        | 20   | As stated in the protocol | —      | not run |
| —    | —   | Chromium | TalkBack | —     | —        | tablet        | 20   | As stated in the protocol | —      | not run |

## A screen that is on its way (feature 018)

Step 21 covers what a Commander is told between asking for a screen and getting
it, what they are told when one never arrives, whether the same failure a second
time is said again, and whether the mark stands still under the platform's
reduced-motion preference. Four of those are judgments no capture can make:
whether a still mark reads as working rather than as stopped, whether the
softened ground leaves enough of the screen behind visible to say which screen is
being waited on, whether a running navigation is distinguishable from a failed one
by ear alone, and whether two failures in a row are heard as two — the words do
not move between them, so the only thing separating them is that the second was
said at all.

The reduced-motion half is observed in both engines, because the mark is drawn
through `<img>` — a separate document — and whether an engine honours a media
query inside one is the thing being confirmed. A policy rule holds the block in
the asset; only a person can say the drawing stopped.

Each configuration is its own observation for the usual reason: the statement is
the same at every width, but what a reader walks past to reach the screen it
covers is not.

The automated coverage that does exist for the same requirements is
`e2e/navigation-waiting.spec.ts` — the statement asserted to be a modal dialog
named by its sentence, the screen behind unreachable by pointer and by focus,
the ground asserted translucent, the failure asserted both as words that stay on
the page and as one polite announcement, and a second failure asserted to
replace the node the polite region holds rather than to write the same sentence
over itself — together with an axe pass over both states in all ten projects,
the readings at 200% text and 400% zoom in `e2e/reflow.spec.ts`, and the mark
asserted to be exposed as decoration in
`src/app/ui/components/waiting-overlay/waiting-overlay.spec.ts`, which is where a
reading of one element's own markup belongs.

| Date | OS  | Browser  | Reader   | Build | Viewport | Configuration | Step | Expected                  | Actual | Result  |
| ---- | --- | -------- | -------- | ----- | -------- | ------------- | ---- | ------------------------- | ------ | ------- |
| —    | —   | Firefox  | NVDA     | —     | —        | desktop       | 21   | As stated in the protocol | —      | not run |
| —    | —   | Chromium | TalkBack | —     | —        | mobile        | 21   | As stated in the protocol | —      | not run |
| —    | —   | Chromium | TalkBack | —     | —        | tablet        | 21   | As stated in the protocol | —      | not run |

## The second time something happens (change 021)

Step 22 covers the reading no capture can take: a second event spoken in the
same words as the first. Both halves of it — a filter narrowed twice and then
widened, and a refusal repeated without anything changing between the presses —
are cases where the announcement policy used to stay silent, and where what is
in question now is not whether something is said but whether hearing it again
helps.

**Status: not yet executed.** No screen-reader run has been performed against
this build. The rows below are deliberately left without actual results rather
than filled in from the automated suite, which cannot hear anything.

The automated coverage that does exist for the same requirement is
`e2e/announcements.spec.ts` — a filter narrowed three times and then widened
asserted to put a new node in the polite outlet each time, and a refusal
repeated in identical words asserted to do the same — together with the unit
suite beside each announcing file, which reads what that file publishes, and the
three rules in `scripts/check-interface-foundations.mjs` that hold the shape
every announcing effect is built in.

None of it is a reader hearing anything, which is the whole of what these rows
are for. A scan reads the node the outlet took; whether a reader is told about
it, through an open modal layer in particular, is what a person has to answer.

| Date | OS  | Browser  | Reader   | Build | Viewport | Configuration | Step | Expected                  | Actual | Result  |
| ---- | --- | -------- | -------- | ----- | -------- | ------------- | ---- | ------------------------- | ------ | ------- |
| —    | —   | Firefox  | NVDA     | —     | —        | desktop       | 22   | As stated in the protocol | —      | not run |
| —    | —   | Chromium | TalkBack | —     | —        | mobile        | 22   | As stated in the protocol | —      | not run |
| —    | —   | Chromium | TalkBack | —     | —        | tablet        | 22   | As stated in the protocol | —      | not run |

## The Commander account (feature 020)

Step 23 covers the three layers an account adds to the shell. Each is its own
observation rather than one walk of the step: the account dialog is where a
Commander learns what an account holds and asks for it to be deleted, the
conflict layer is the one place in this application where a reader is asked to
choose between two copies of their own work, and the owned-ships view is a list
of something the application only knows second hand. What a reader makes of
"the account no longer holds this" is the judgment 020/FR-010 turns on, and it
is not the same judgment as "this fleet is as much as the journal has said so
far".

Each configuration is its own observation for the usual reason: the account
entry is on the banner row where there is room for it and inside the named
action layer where there is not, and the three layers are centred dialogs at
desktop and full-width sheets at the compact widths. Each orientation is its
own observation for the same reason one step further: the shell chooses its
composition from the width it is given, so a tablet turned on its side is a
different screen to walk rather than the same one again.

The automated coverage that does exist for the same requirements is
`e2e/commander-account.spec.ts`, `e2e/commander-fleet.spec.ts` and
`e2e/fleet-copy.spec.ts` — the account stubbed at the network boundary and
every rendered state scanned by axe, every control a Commander acts on resolved
by its accessible name, the three conflict answers asserted present with the
layer dismissible without answering, and a held refresh and a failed one
asserted to state themselves without emptying the list, in all ten projects.
Two structural assertions are the exception and read a class: that the footer
which opens, renames and deletes a stored record is not rendered over the fleet
at all, and that the fleet carries exactly the two actions it carries. Neither
is about a control a Commander reaches, and an element asserted absent has no
accessible name to be reached by.

| Date | OS  | Browser  | Reader   | Build | Viewport | Configuration | Orientation | Step | Capability / state | Expected                                                                                                                                                | Actual | Result  |
| ---- | --- | -------- | -------- | ----- | -------- | ------------- | ----------- | ---- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ------- |
| —    | —   | Firefox  | NVDA     | —     | —        | desktop       | landscape   | 23   | account dialog     | Signed-out and signed-in states, the data-use list read before the sign-in, and the deletion question announced as a layer of its own                   | —      | not run |
| —    | —   | Firefox  | NVDA     | —     | —        | desktop       | portrait    | 23   | account dialog     | As above                                                                                                                                                | —      | not run |
| —    | —   | Chromium | TalkBack | —     | —        | tablet        | landscape   | 23   | account dialog     | As above                                                                                                                                                | —      | not run |
| —    | —   | Chromium | TalkBack | —     | —        | tablet        | portrait    | 23   | account dialog     | As above                                                                                                                                                | —      | not run |
| —    | —   | Chromium | TalkBack | —     | —        | mobile        | landscape   | 23   | account dialog     | As above                                                                                                                                                | —      | not run |
| —    | —   | Chromium | TalkBack | —     | —        | mobile        | portrait    | 23   | account dialog     | As above                                                                                                                                                | —      | not run |
| —    | —   | Firefox  | NVDA     | —     | —        | desktop       | landscape   | 23   | record conflict    | The record named, three answers as three named controls, and leaving the layer announced as answering none of them                                      | —      | not run |
| —    | —   | Firefox  | NVDA     | —     | —        | desktop       | portrait    | 23   | record conflict    | As above                                                                                                                                                | —      | not run |
| —    | —   | Chromium | TalkBack | —     | —        | tablet        | landscape   | 23   | record conflict    | As above                                                                                                                                                | —      | not run |
| —    | —   | Chromium | TalkBack | —     | —        | tablet        | portrait    | 23   | record conflict    | As above                                                                                                                                                | —      | not run |
| —    | —   | Chromium | TalkBack | —     | —        | mobile        | landscape   | 23   | record conflict    | As above                                                                                                                                                | —      | not run |
| —    | —   | Chromium | TalkBack | —     | —        | mobile        | portrait    | 23   | record conflict    | As above                                                                                                                                                | —      | not run |
| —    | —   | Firefox  | NVDA     | —     | —        | desktop       | landscape   | 23   | owned ships        | Every ship announced with its model, name and plate; the journal interval read with the list; a held or stopped refresh said in words and the list kept | —      | not run |
| —    | —   | Firefox  | NVDA     | —     | —        | desktop       | portrait    | 23   | owned ships        | As above                                                                                                                                                | —      | not run |
| —    | —   | Chromium | TalkBack | —     | —        | tablet        | landscape   | 23   | owned ships        | As above                                                                                                                                                | —      | not run |
| —    | —   | Chromium | TalkBack | —     | —        | tablet        | portrait    | 23   | owned ships        | As above                                                                                                                                                | —      | not run |
| —    | —   | Chromium | TalkBack | —     | —        | mobile        | landscape   | 23   | owned ships        | As above                                                                                                                                                | —      | not run |
| —    | —   | Chromium | TalkBack | —     | —        | mobile        | portrait    | 23   | owned ships        | As above                                                                                                                                                | —      | not run |
