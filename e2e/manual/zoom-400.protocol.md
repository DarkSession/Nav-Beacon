# Manual protocol: actual 400% browser zoom

**Protocol id**: `zoom-400`
**Covers**: 011 FR-011, FR-012, SC-003; 020 FR-005, FR-011, FR-016, FR-022
**Version**: 4

## What is automated, and what is left

WCAG 1.4.10 defines 400% zoom by equivalence: content at 1280x1024 zoomed to 400% is content at a
**320x256 CSS-pixel viewport**. `e2e/reflow.spec.ts` runs that viewport at a **device scale factor
of 4**, in both engines across all ten projects — so `devicePixelRatio` is 4, resolution media
queries report a high-density surface, and images resolve as they would on a zoomed page. It asserts
no horizontal page scroll, every landmark, every action present with visible text, every target
reachable, the banner released and travelling with the page, nothing clipped, a layer at full
height, an axe scan, and the same condition again at 200% root text.

That is not a proxy for zoom; it is zoom, minus one thing: the browser's own chrome and the
operating system's toolbars, which take physical space and therefore a little more of the viewport
than the emulation gives away.

What is left for a person is a judgment rather than a measurement — whether a Commander can still
_get the job done_ in what remains at 400%. A run confirms the automated result in a real window and
records that judgment. It does not re-derive numbers the suite already has.

## Environment to record

Every run records all of it. A result without versions cannot be reproduced or trusted later.

| Field                | Example                         |
| -------------------- | ------------------------------- |
| Operating system     | Windows 11 24H2                 |
| Browser and version  | Firefox 141.0                   |
| Application build    | git SHA of the build under test |
| Physical display     | 1920×1080 at 100% OS scaling    |
| Viewport before zoom | 1280×800 CSS pixels             |
| Device               | desktop, tablet or phone        |
| Orientation          | landscape                       |
| Date                 | ISO date of the run             |

Run the full protocol in **both Chromium and Firefox**, on a **desktop, a tablet and a phone**, and
in **both orientations** on each. Rotating a desktop window means resizing it to a portrait aspect.
The shell chooses its composition from the width it is given, so a device and an orientation are two
halves of one reading rather than a repetition of it.

## Setup

1. Build and serve the production build (`pnpm run build && pnpm run e2e:offline` serves it, or
   `node scripts/serve-production.mjs`). Zoom behaviour differs between a dev server and a
   production build only if the styles differ; use the production build so the record matches what
   ships.
2. Open the application at 100% zoom and confirm the capability under test renders.
3. Apply **browser zoom** — `Ctrl`/`Cmd` and `+` until the indicator reads 400%. Do not use the
   operating-system magnifier, and do not change the root font size: that is the separate 200%
   text-scale gate.

## Steps, for each capability and state

Every step below is already asserted under emulated zoom. Confirm rather than re-derive them, and
record a row only where a real browser disagrees with the automated result or where the capability is
technically intact but practically unusable.

1. **No horizontal page scrolling.** Scroll to the block end of the page. The document must not
   scroll sideways at any point. A component may own a labelled, bounded scroller; the page may not.
2. **Nothing is lost.** Every action, datum and status available at 100% is still present. An action
   that has moved into the folded action layer counts as present; an action that has disappeared
   does not.
3. **Every action still carries visible text.** No control collapses to an unlabelled glyph or
   ellipsis at any zoom level.
4. **Nothing is truncated without a way to read it.** Text may wrap; it may not be clipped with no
   scroller and no disclosure to reach the rest.
5. **Sticky regions release.** The banner must not occupy a large share of the viewport. At 400%
   the viewport is short, so the banner is expected to scroll away with the page.
6. **Layers stay usable.** Open a layer. It must present full height rather than as a centred
   dialog whose content is cut off, and dismissing it must return to the invoking control. Include
   the two exchange layers: the import layer with a refusal and a full diagnostic list on screen,
   and the export layer with its format list and a whole SLEF payload. In both, the monospaced
   field may scroll inside itself; the page may not scroll sideways, and the actions must stay
   present with visible text.
7. **Targets stay reachable.** Every control can be activated by pointer, and by a single touch on
   a touch device, without a hover step and without a two-finger gesture.
8. **Focus stays visible.** The focus ring is visible against the surface under it and is not
   clipped by an ancestor's overflow.
9. **The Commander account's three layers.** Each one is drawn over a capability rather than beside
   it, and each carries something a short viewport is the first to lose.

   Open the account dialog. Every state it has is text: whether there is an account, the Commander's
   name where there is one, what the account holds, and the sentence saying which actions need a
   network. Expect all of it still present and still reading as words, expect the actions to keep
   their labels rather than collapsing to marks, and expect the panel to present full height rather
   than as a centred dialog with its foot cut off. Ask to delete the account and expect the question
   that stands over it to keep both of its answers on screen with their text, with neither pushed
   below a fold that has no scroller.

   Open the record conflict. It asks about one record and offers three answers, and at this viewport
   the three answers are what a centred dialog loses first. Expect the record it is about to stay
   named, expect all three answers reachable with visible text, and expect the layer to be
   dismissible without answering.

   Open the ships the Commander owns. Expect the list to stay a list — one entry per ship, each
   keeping its model, its name and its plate rather than eliding one of them — expect the sentence
   about what journal the fleet was read from to wrap rather than be clipped, expect the refresh to
   keep its text, and expect the status of the last refresh to stay on screen beside the ships it
   describes. The page must not scroll sideways in any of it; the list may scroll inside itself.

## Recording the result

Append one row per capability/state/engine/device/orientation to `results/zoom-400.md`, with the
expected behaviour, what actually happened, and pass or fail. A failure records what was observed, not a
diagnosis. Do not summarise several runs into one row; a row is one observation.
