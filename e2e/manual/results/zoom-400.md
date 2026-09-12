# Results: actual 400% browser zoom

Protocol: [`zoom-400`](../zoom-400.protocol.md), version 4.

Each row is one observation: one capability and state, in one engine, on one device, at one
orientation. Rows are appended, never edited — a later run is a new row, so the history of a
regression stays readable. The sections written before protocol version 4 carry no device column,
and are left as they were rather than backfilled with a value nobody observed.

## Run 1

**Status: not yet executed.**

No actual-zoom run has been performed against this build. The rows below are deliberately left
without a result rather than being filled in from the automated suite.

What that automated suite covers is not a proxy: `e2e/reflow.spec.ts` runs the **320x256 CSS-pixel
viewport that WCAG 1.4.10 defines 400% zoom on a 1280x1024 window to be equivalent to**, in both
engines across all ten projects, asserting no horizontal page scroll, every landmark, every action
present with visible text, every target reachable, the banner released and travelling with the page,
no clipped text, a layer at full height, an axe scan, and the same viewport again at 200% root text.

What remains for a person is what that cannot reach: actual browser zoom cannot be driven by any
Playwright or CDP API in either engine, real zoom brings browser and operating-system chrome that no
viewport setting reproduces, and whether the result is still _usable_ is a judgment rather than a
measurement. These rows record that confirmation.

| Date | OS  | Browser  | Build | Viewport | Orientation | Capability / state | Expected                                                                                                          | Actual | Result  |
| ---- | --- | -------- | ----- | -------- | ----------- | ------------------ | ----------------------------------------------------------------------------------------------------------------- | ------ | ------- |
| —    | —   | Chromium | —     | —        | landscape   | shell / default    | No horizontal page scrolling; every action present with visible text; banner releases; layer presents full height | —      | not run |
| —    | —   | Chromium | —     | —        | portrait    | shell / default    | As above                                                                                                          | —      | not run |
| —    | —   | Firefox  | —     | —        | landscape   | shell / default    | As above                                                                                                          | —      | not run |
| —    | —   | Firefox  | —     | —        | portrait    | shell / default    | As above                                                                                                          | —      | not run |

Capability features add their own rows as they land; the shell rows above are the foundation's own
and are the ones this feature is accountable for.

## The exchange layers (feature 004)

Both layers carry a monospaced field that can hold more than the viewport, which is exactly the
composition step 6 is about. Each is its own observation.

| Date | OS  | Browser  | Build | Viewport | Orientation | Capability / state           | Expected                                                                        | Actual | Result  |
| ---- | --- | -------- | ----- | -------- | ----------- | ---------------------------- | ------------------------------------------------------------------------------- | ------ | ------- |
| —    | —   | Chromium | —     | —        | landscape   | import layer / diagnostics   | Full height; field scrolls inside itself; no sideways page scroll; actions kept | —      | not run |
| —    | —   | Chromium | —     | —        | portrait    | export layer / whole payload | As above                                                                        | —      | not run |
| —    | —   | Firefox  | —     | —        | landscape   | import layer / diagnostics   | As above                                                                        | —      | not run |
| —    | —   | Firefox  | —     | —        | portrait    | export layer / whole payload | As above                                                                        | —      | not run |

## Help · About (feature 012)

The modal is the longest text this application draws in one column — three `ABOUT` sentences, two
facts, two question-and-answer pairs, four summary lines and a legal notice that must not be
truncated —
and at 400% zoom on a phone the viewport has room for about one section of it at a time. So the
observation is not whether it fits, which it will not: it is whether every section is still
_reachable_, whether the header and its close stay put while the body alone scrolls, and whether the
disclaimer wraps rather than being clipped.

The compact entry is part of the same observation. At this zoom the frame's Help action is inside
the named action layer, and that layer's own panel is bounded to the viewport with its own scroller
— which is the fix a 200%-text run at the mobile profile forced, and is exactly the kind of thing a
real zoom can contradict.

| Date | OS  | Browser  | Build | Viewport | Orientation | Capability / state  | Expected                                                                                         | Actual | Result  |
| ---- | --- | -------- | ----- | -------- | ----------- | ------------------- | ------------------------------------------------------------------------------------------------ | ------ | ------- |
| —    | —   | Chromium | —     | —        | portrait    | help · about / open | Entry reachable in the action layer; every section reachable; header and close kept; no clipping | —      | not run |
| —    | —   | Chromium | —     | —        | landscape   | help · about / open | As above                                                                                         | —      | not run |
| —    | —   | Firefox  | —     | —        | portrait    | help · about / open | As above                                                                                         | —      | not run |
| —    | —   | Firefox  | —     | —        | landscape   | help · about / open | As above                                                                                         | —      | not run |

## Drives & Mass (feature 008)

The two cards choose their arrangement from a container query on the region
rather than from the viewport, which is the whole point: at 400% the region is
narrow for the same reason a phone's is, so real zoom must select the stacked
pair. The observation is whether it actually does in a real window, and whether
the mass bar's two marks — the optimal tick and the maximum at the end of the
track — stay on one line and off each other once the browser's own chrome has
taken its share. Both are asserted under emulated zoom; neither is a judgment
the emulation can finish.

| Date | OS  | Browser  | Build | Viewport | Orientation | Capability / state            | Expected                                                                                             | Actual | Result  |
| ---- | --- | -------- | ----- | -------- | ----------- | ----------------------------- | ---------------------------------------------------------------------------------------------------- | ------ | ------- |
| —    | —   | Chromium | —     | —        | landscape   | drives & mass / ready         | Cards stacked; every reading kept; bar marks on one line and clear of each other; no sideways scroll | —      | not run |
| —    | —   | Chromium | —     | —        | portrait    | drives & mass / thrusters off | As above, with the package’s reasons in place of the envelope                                        | —      | not run |
| —    | —   | Firefox  | —     | —        | landscape   | drives & mass / ready         | As above                                                                                             | —      | not run |
| —    | —   | Firefox  | —     | —        | portrait    | drives & mass / thrusters off | As above                                                                                             | —      | not run |

## The Commander account (feature 020)

Step 9 covers the three layers an account adds to the shell, and each is its own observation. All
three are drawn over a capability rather than beside it, and each loses something different first in
a short viewport: the account dialog is the longest of them and ends in its actions, so its foot is
what a centred dialog cuts off; the conflict layer offers three answers where every other question in
this application offers two; and the owned-ships view is a list whose every entry carries three facts and
whose heading carries a sentence about the interval the fleet was read over.

Every device and orientation is a row of its own because the shell chooses its composition from the
width it is given. At 400% zoom a desktop window is already as narrow as a phone in CSS pixels, so
what the three devices actually separate is the browser and operating-system chrome each one takes
out of the viewport — which is the one thing the emulated reading cannot reproduce, and the reason
this protocol exists.

The automated coverage that does exist for the same requirements is `e2e/reflow.spec.ts`, which runs
the WCAG-equivalent viewport at a device scale factor of 4 in all ten projects, together with
`e2e/commander-account.spec.ts`, `e2e/commander-fleet.spec.ts` and `e2e/fleet-copy.spec.ts`, which
scan every one of these three layers with axe at all five layout profiles in both engines.

| Date | OS  | Browser  | Build | Device  | Viewport | Orientation | Capability / state | Expected                                                                                                                                                                         | Actual | Result  |
| ---- | --- | -------- | ----- | ------- | -------- | ----------- | ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ------- |
| —    | —   | Chromium | —     | desktop | —        | landscape   | account dialog     | Full height; every state, the name and the network sentence kept as words; actions keep their labels; the deletion question keeps both answers on screen                         | —      | not run |
| —    | —   | Chromium | —     | desktop | —        | portrait    | account dialog     | As above                                                                                                                                                                         | —      | not run |
| —    | —   | Chromium | —     | tablet  | —        | landscape   | account dialog     | As above                                                                                                                                                                         | —      | not run |
| —    | —   | Chromium | —     | tablet  | —        | portrait    | account dialog     | As above                                                                                                                                                                         | —      | not run |
| —    | —   | Chromium | —     | phone   | —        | landscape   | account dialog     | As above                                                                                                                                                                         | —      | not run |
| —    | —   | Chromium | —     | phone   | —        | portrait    | account dialog     | As above                                                                                                                                                                         | —      | not run |
| —    | —   | Firefox  | —     | desktop | —        | landscape   | account dialog     | As above                                                                                                                                                                         | —      | not run |
| —    | —   | Firefox  | —     | desktop | —        | portrait    | account dialog     | As above                                                                                                                                                                         | —      | not run |
| —    | —   | Firefox  | —     | tablet  | —        | landscape   | account dialog     | As above                                                                                                                                                                         | —      | not run |
| —    | —   | Firefox  | —     | tablet  | —        | portrait    | account dialog     | As above                                                                                                                                                                         | —      | not run |
| —    | —   | Firefox  | —     | phone   | —        | landscape   | account dialog     | As above                                                                                                                                                                         | —      | not run |
| —    | —   | Firefox  | —     | phone   | —        | portrait    | account dialog     | As above                                                                                                                                                                         | —      | not run |
| —    | —   | Chromium | —     | desktop | —        | landscape   | record conflict    | The record stays named; all three answers reachable with visible text; dismissible without answering                                                                             | —      | not run |
| —    | —   | Chromium | —     | desktop | —        | portrait    | record conflict    | As above                                                                                                                                                                         | —      | not run |
| —    | —   | Chromium | —     | tablet  | —        | landscape   | record conflict    | As above                                                                                                                                                                         | —      | not run |
| —    | —   | Chromium | —     | tablet  | —        | portrait    | record conflict    | As above                                                                                                                                                                         | —      | not run |
| —    | —   | Chromium | —     | phone   | —        | landscape   | record conflict    | As above                                                                                                                                                                         | —      | not run |
| —    | —   | Chromium | —     | phone   | —        | portrait    | record conflict    | As above                                                                                                                                                                         | —      | not run |
| —    | —   | Firefox  | —     | desktop | —        | landscape   | record conflict    | As above                                                                                                                                                                         | —      | not run |
| —    | —   | Firefox  | —     | desktop | —        | portrait    | record conflict    | As above                                                                                                                                                                         | —      | not run |
| —    | —   | Firefox  | —     | tablet  | —        | landscape   | record conflict    | As above                                                                                                                                                                         | —      | not run |
| —    | —   | Firefox  | —     | tablet  | —        | portrait    | record conflict    | As above                                                                                                                                                                         | —      | not run |
| —    | —   | Firefox  | —     | phone   | —        | landscape   | record conflict    | As above                                                                                                                                                                         | —      | not run |
| —    | —   | Firefox  | —     | phone   | —        | portrait    | record conflict    | As above                                                                                                                                                                         | —      | not run |
| —    | —   | Chromium | —     | desktop | —        | landscape   | owned ships        | One entry per ship keeping model, name and plate; the journal interval wraps rather than clips; refresh and its status kept; the list may scroll inside itself, the page may not | —      | not run |
| —    | —   | Chromium | —     | desktop | —        | portrait    | owned ships        | As above                                                                                                                                                                         | —      | not run |
| —    | —   | Chromium | —     | tablet  | —        | landscape   | owned ships        | As above                                                                                                                                                                         | —      | not run |
| —    | —   | Chromium | —     | tablet  | —        | portrait    | owned ships        | As above                                                                                                                                                                         | —      | not run |
| —    | —   | Chromium | —     | phone   | —        | landscape   | owned ships        | As above                                                                                                                                                                         | —      | not run |
| —    | —   | Chromium | —     | phone   | —        | portrait    | owned ships        | As above                                                                                                                                                                         | —      | not run |
| —    | —   | Firefox  | —     | desktop | —        | landscape   | owned ships        | As above                                                                                                                                                                         | —      | not run |
| —    | —   | Firefox  | —     | desktop | —        | portrait    | owned ships        | As above                                                                                                                                                                         | —      | not run |
| —    | —   | Firefox  | —     | tablet  | —        | landscape   | owned ships        | As above                                                                                                                                                                         | —      | not run |
| —    | —   | Firefox  | —     | tablet  | —        | portrait    | owned ships        | As above                                                                                                                                                                         | —      | not run |
| —    | —   | Firefox  | —     | phone   | —        | landscape   | owned ships        | As above                                                                                                                                                                         | —      | not run |
| —    | —   | Firefox  | —     | phone   | —        | portrait    | owned ships        | As above                                                                                                                                                                         | —      | not run |
