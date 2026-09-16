/**
 * The verification coverage ledger.
 *
 * One machine-readable record joining every surface the suite covers to the
 * requirements it evidences, the journey that exercises it, whether it is
 * scanned by axe, the named assertions that go beyond a scan, and the manual
 * protocol that covers what automation cannot judge.
 *
 * The point of the ledger is that "every" cannot silently drift. The policy
 * checker reconciles it against the route table, the exported UI components,
 * the preview declarations and the Playwright project names, and requires every
 * requirement id declared by a covered feature to appear here at least once,
 * naming the unregistered ids on failure. A new screen, state or component that
 * is not registered fails the build rather than quietly escaping the suite.
 *
 * **Ids are feature-qualified.** The same requirement number means different
 * things in different features, so an entry registers the feature number
 * alongside it and the checker compares per feature. Bare ids would let one
 * feature's coverage silently satisfy another's. Only ids inside a
 * `requirements` array count as registered.
 *
 * Capability features append their own entries and add their directory to
 * `COVERED_FEATURES` as they land. Adding a feature there immediately requires
 * every id its specification declares, so the list is the one deliberate place
 * where the scope of "every" is stated.
 */

/**
 * The feature directories whose requirements this ledger must account for.
 *
 * Feature 011 is the interface foundation; capability features join as they are
 * implemented. This is not a way to defer coverage for a feature that exists —
 * a feature with product code and no entry here is the drift the ledger is for.
 */
export const COVERED_FEATURES: readonly string[] = [
  '011-interface-foundations',
  '001-ship-selection-and-loading',
  '002-module-outfitting',
  '009-cost-and-materials',
  '003-ship-statistics',
  '010-hull-anatomy',
  '004-slef',
  '005-power-and-heat',
  '006-defence-profile',
  '007-offence-profile',
  '008-mobility-and-jump',
  '012-help-and-licences',
  '014-start-page',
  '015-prerendered-documents',
  '016-journal-import',
  '017-tool-bar-navigation',
  '018-navigation-loading-overlay',
  '019-first-frame-typefaces',
  '020-held-grade-ladder',
  '023-served-document-held',
  '022-published-link-restated',
  '024-default-build-not-autosaved',
];

/** The five layout profiles, each run in both engines. */
export const LAYOUT_PROFILES = [
  'desktop',
  'tablet-portrait',
  'tablet-landscape',
  'mobile-portrait',
  'mobile-landscape',
] as const;

export type LayoutProfile = (typeof LAYOUT_PROFILES)[number];

/** The two engines every profile runs in. CI may shard this; it may not reduce it. */
export const ENGINES = ['chromium', 'firefox'] as const;

export type Engine = (typeof ENGINES)[number];

/**
 * The one measurement project outside the matrix.
 *
 * A first-frame or keystroke budget is measured under Chromium's CPU
 * throttling, which is a DevTools Protocol capability Firefox does not have.
 * Rather than a test that skips itself in five of the ten projects — which the
 * constitution forbids — each measurement lives in its own file and they share
 * this project, and the behaviour each of them measures is separately covered
 * in all ten (module-catalogue contract, "Verification").
 */
export const TIMING_PROJECT = 'chromium-mobile-timing';

/**
 * The files that project runs, and the only ones it runs.
 *
 * Two, since feature 012: feature 002's SC-002 keystroke budget and feature
 * 012's SC-005 first-frame budget. They share the project rather than each
 * declaring one, because what makes a measurement honest here is that nothing
 * else is running beside it, and one serial project is what guarantees that.
 */
export const TIMING_SPECS: readonly string[] = [
  '**/outfitting-timing.spec.ts',
  '**/help-timing.spec.ts',
];

/** Every Playwright project name the matrix generates, plus the timing project. */
export const PROJECT_NAMES: readonly string[] = [
  ...ENGINES.flatMap((engine) => LAYOUT_PROFILES.map((profile) => `${engine}-${profile}`)),
  TIMING_PROJECT,
];

/** One covered surface and state. */
export interface CoverageEntry {
  /** Stable address: a product route and state, or a preview component state. */
  readonly surfaceId: string;
  /** Nonempty traceability set of requirement and success-criteria ids. */
  readonly requirements: readonly string[];
  /** The journey that exercises it. Primary journeys run in all ten projects. */
  readonly journey: string;
  /** True for every rendered product or preview state. */
  readonly axe: boolean;
  /** Named semantic and responsive checks that state expected meaning beyond axe. */
  readonly assertions: readonly string[];
  /** Protocol id for primary assistive-technology and actual-zoom coverage. */
  readonly manualRecord: string | null;
}

/**
 * The cross-cutting entries owned by the interface foundation itself.
 *
 * These evidence the design-system requirements (FR-001–FR-005) and the
 * verification requirements (FR-021–FR-024), which describe the system as a
 * whole rather than any one user story's surface.
 */
export const COVERAGE_LEDGER: readonly CoverageEntry[] = [
  {
    surfaceId: 'shell/landmarks-and-headings',
    requirements: ['011/FR-008', '011/SC-001'],
    journey: 'product/semantics',
    axe: true,
    assertions: [
      'exactly one banner, one main, and no two navigation landmarks carrying the same name',
      'exactly one visible h1, owned by the route rather than synthesized by the shell',
      'heading levels descend without skipping',
    ],
    manualRecord: 'screen-reader',
  },
  {
    surfaceId: 'equipment/bench-address',
    requirements: ['013/FR-027', '011/FR-028'],
    journey: 'equipment/bench',
    axe: true,
    assertions: [
      'the bench answers /equipment directly, without going through another screen',
      'the shell names both tools and marks the open one',
    ],
    manualRecord: null,
  },
  {
    surfaceId: 'equipment/loadout',
    requirements: [
      '013/FR-001',
      '013/FR-002',
      '013/FR-003',
      '013/FR-005',
      '013/FR-022',
      '020/FR-001',
      '020/FR-002',
    ],
    journey: 'equipment/bench',
    axe: true,
    assertions: [
      'a chosen suit offers the mounts it carries, and the stats state its figures',
      'every resistance bar fills from its midline, towards the edge its sign says',
      'raising the suit’s grade restates the shields',
      'a weapon fitted on a mount is named in the ledger and counted in the firepower',
      'the Flight Suit offers one grade and says it takes no modification',
      'undo and redo are published to the shell rather than drawn a second time',
      'the list stays where it was when a weapon is fitted into an empty mount',
      'the list stays where it was when the first suit is chosen at the empty bench',
      'the list stands in one place whichever item is selected',
      'an empty mount holds the ladder’s track and states nothing in it',
    ],
    manualRecord: 'screen-reader',
  },
  {
    surfaceId: 'equipment/held-mount',
    requirements: ['013/FR-007'],
    journey: 'equipment/bench',
    axe: true,
    assertions: [
      'a mount the worn suit does not carry is unavailable with its weapon still named',
      'the weapon returns intact on a suit that carries the mount again',
      'held is said in the row’s own sentence, not only by dimming',
    ],
    manualRecord: 'screen-reader',
  },
  {
    surfaceId: 'equipment/modifications',
    requirements: ['013/FR-008', '013/FR-009', '013/FR-010', '013/FR-011', '013/FR-012'],
    journey: 'equipment/bench',
    axe: true,
    assertions: [
      'four slots are drawn at every grade, locked ones present and stated',
      'a recipe another slot holds is drawn, marked and refused',
      'each recipe names the engineers who grant it',
      'clearing a slot is a control in the chooser rather than one that appears on hover',
      'a slot the grade no longer opens keeps what is in it and gives it back',
    ],
    manualRecord: 'screen-reader',
  },
  {
    surfaceId: 'equipment/materials',
    requirements: ['013/FR-013', '013/FR-014', '013/FR-015'],
    journey: 'equipment/bench',
    axe: true,
    assertions: [
      'the list is the climb to each selected grade and every fitted, unlocked modification, commonest first',
      'a held modification counts nothing, and neither does a held mount’s weapon',
      'the block says what the total covers, and says when there is nothing to gather',
    ],
    manualRecord: null,
  },
  {
    surfaceId: 'equipment/gate',
    requirements: ['013/FR-001'],
    journey: 'equipment/bench',
    axe: true,
    assertions: [
      'a bench with no suit on it is drawn whole, with the choice that fills it in the detail column',
      'the ledger states every mount locked, and the figures a suit will answer as a dash',
      'the previewed ladder and slots are out of the focus order and the accessibility tree',
    ],
    manualRecord: 'screen-reader',
  },
  {
    surfaceId: 'equipment/library',
    requirements: ['013/FR-016', '013/FR-017', '013/FR-018', '013/FR-019'],
    journey: 'equipment/library',
    axe: false,
    assertions: [
      'a saved loadout reopens onto the bench with the suit and grade it was saved with',
      'one library lists both tools’ records, each row naming the tool that made it',
      'a second save under a taken name asks which version survives, and writes a separate record',
      'a loadout this version cannot rebuild is refused, and its bytes are left alone',
    ],
    manualRecord: null,
  },
  {
    surfaceId: 'equipment/link',
    requirements: ['013/FR-020', '013/FR-021', '013/FR-018a', '024/FR-003'],
    journey: 'equipment/link',
    axe: true,
    assertions: [
      'the address carries the loadout on the bench, published after every choice',
      'a loadout nobody changed is in the address from the moment a suit is chosen, and a fresh load restores it from there and from nothing else',
      'opening that address restores the loadout, held content included',
      'the export layer offers the object, the link and the readable summary',
      'a link this version cannot read says so where the Commander is, naming no journal key',
    ],
    manualRecord: null,
  },
  {
    surfaceId: 'shell/entry-point-mark',
    requirements: ['017/FR-001', '017/FR-002', '017/SC-001'],
    journey: 'shell/tool-bar',
    axe: true,
    assertions: [
      'the mark leads to the entry point from a hull, the workspace and the bench',
      'it carries an address, so a new tab opens it and its address copies',
      'it is named for where it goes rather than announced as a picture',
      'pressing it on the entry point changes neither the screen nor the address',
    ],
    manualRecord: 'screen-reader',
  },
  {
    surfaceId: 'shell/tool-re-entry',
    requirements: ['017/FR-003', '017/FR-004', '017/FR-005', '017/SC-002'],
    journey: 'shell/tool-bar',
    axe: true,
    assertions: [
      'the open tool is a link carrying aria-current, offered as well as named',
      'the ship tool’s tab opens the list of ships from a hull and from the workspace',
      'on the list of ships it changes nothing and adds no history entry',
      'the equipment tool’s tab leaves an empty bench with the suit gate standing',
    ],
    manualRecord: 'screen-reader',
  },
  {
    surfaceId: 'equipment/bench-persistence',
    requirements: [
      '017/FR-006',
      '017/FR-007',
      '017/FR-008',
      '017/FR-009',
      '017/FR-010',
      '017/SC-003',
      '024/FR-002',
    ],
    journey: 'equipment/bench-persistence',
    axe: true,
    assertions: [
      'a loadout assembled on the bench is restored after a reload, unasked for',
      'a loadout still at its suit’s default is in no record, and its first choice takes one',
      'starting an empty bench on an untouched default leaves nothing behind',
      'starting an empty bench keeps a decided loadout that was on it as its own record',
      'a loadout in the address outranks the record the page restored',
      'a store that refuses a write is stated in the bench’s own words, and the loadout stays usable',
      'one unnamed record per tool per page, so a build and a loadout are held at once',
      'deleting the record the bench autosaves into has the bench let go of it, and it stays deleted',
    ],
    manualRecord: null,
  },
  {
    surfaceId: 'shell/tool-navigation',
    requirements: ['011/FR-028', '011/SC-009'],
    journey: 'product/semantics',
    axe: true,
    assertions: [
      'every address the ship tool owns names that tool, at all five layout profiles',
      'the tool region is a navigation landmark named apart from the primary navigation',
      'the current tool is a link carrying aria-current, offered as well as named',
      'the region names exactly the tools the registry carries and nothing else',
    ],
    manualRecord: 'screen-reader',
  },
  {
    surfaceId: 'shell/controls',
    requirements: ['011/FR-006', '011/FR-007'],
    journey: 'product/semantics',
    axe: true,
    assertions: [
      'every control exposes an accessible name containing its visible text',
      'selected, expanded, pressed, checked, invalid, busy and disabled state is exposed',
      'every journey completes by click on desktop and by tap on touch profiles',
      'no meaning is reachable only through hover or a multi-pointer gesture',
    ],
    manualRecord: 'screen-reader',
  },
  {
    surfaceId: 'ui/labelled-fields',
    requirements: ['011/FR-007'],
    journey: 'preview/sweep',
    axe: true,
    assertions: [
      'a visible label is programmatically associated with its control',
      'a description and an error are associated by aria-describedby',
      'a placeholder is never used as a label',
    ],
    manualRecord: 'screen-reader',
  },
  {
    surfaceId: 'ui/values-and-metrics',
    requirements: ['011/FR-007', '011/FR-010'],
    journey: 'preview/sweep',
    axe: true,
    assertions: [
      'a value is related to its unit and measurement condition',
      'an unavailable value is stated in words, never as a zero or a dash',
      'a technical value is bidi-isolated so direction cannot reorder it',
    ],
    manualRecord: 'screen-reader',
  },
  {
    surfaceId: 'shell/announcements',
    requirements: ['011/FR-009'],
    journey: 'product/announcements',
    axe: true,
    assertions: [
      'exactly one assertive and one polite outlet exist and no other region is live',
      'a new blocking error publishes one assertive summary',
      'each outlet is declared with its own urgency and kept out of the visible layout',
      'initial and unaffected content produces no announcement',
      'a filter narrowed three times and then widened puts a new node in the outlet each time',
      'a refusal repeated in identical words puts a new node in the outlet each time',
    ],
    manualRecord: 'screen-reader',
  },
  {
    surfaceId: 'ui/text-equivalence',
    requirements: ['011/FR-010'],
    journey: 'preview/sweep',
    axe: true,
    assertions: [
      'a status tone is named in text, so colour is never the only signal',
      'a selected state has visible text beyond its border and tint',
      'every visual information carrier has a visible or associated text equivalent',
    ],
    manualRecord: 'screen-reader',
  },
  {
    surfaceId: 'ui/layers',
    requirements: ['011/FR-007', '011/FR-008'],
    journey: 'preview/sweep',
    axe: true,
    assertions: [
      'a layer has a visible title associated with it',
      'background content is inert and excluded from the accessibility tree while it is open',
      'dismissal restores the invoking control',
    ],
    manualRecord: 'screen-reader',
  },
  {
    surfaceId: 'preview/component-catalogue',
    requirements: ['011/FR-004', '011/FR-005'],
    journey: 'preview/sweep',
    axe: true,
    assertions: [
      'every exported component declares all five required states',
      'a state that cannot be represented carries a nonempty machine-readable rationale',
      'every rendered state names at least one expectation',
      'a column a caller declares numeric sets heading and figures alike flush to the cell end',
    ],
    manualRecord: null,
  },
  {
    surfaceId: 'system/design-tokens',
    requirements: ['011/FR-001', '011/FR-002', '011/FR-003', '011/SC-004'],
    journey: 'static/design-system',
    axe: false,
    assertions: [
      'every governed visual property resolves to a token',
      'exactly one semantic dark set exists with no theme control or stored preference',
      'every intended semantic pair records contrast evidence',
    ],
    manualRecord: null,
  },
  {
    surfaceId: 'system/design-reference',
    requirements: ['011/FR-002', '011/FR-012', '001/FR-001'],
    journey: 'catalogue/reference-language',
    axe: false,
    assertions: [
      'the command bar is the reference plate closed by the heavy amber rule and opened by the beacon mark the design ships',
      'the insignia is the size the canvas draws it on every screen it leads from, and the press around it is the target baseline',
      'the bar is one height on the shipyard and on a build, and its floor holds the tallest identity it carries',
      'headings are tracked uppercase condensed and numbers are monospace',
      'every row reserves the leading marker and only the current row fills it',
      'no product surface is rounded',
      'no text falls below the lifted ramp floor',
      'the metric grid is ruled by its own one-pixel gaps',
    ],
    manualRecord: null,
  },
  {
    surfaceId: 'system/shared-component-library',
    requirements: ['011/FR-001', '011/FR-004', '011/FR-005'],
    journey: 'static/design-system',
    axe: false,
    assertions: [
      'every exported ui component has exactly one preview declaration',
      'every required state has a fixture or a nonempty N/A rationale',
      'no route recreates a shared primitive',
    ],
    manualRecord: null,
  },
  {
    surfaceId: 'preview/catalogue',
    requirements: ['011/FR-004', '011/FR-022'],
    journey: 'preview/sweep',
    axe: true,
    assertions: [
      'every applicable declaration renders at its stable address',
      'the production tokens and localization providers are in use',
    ],
    manualRecord: null,
  },
  {
    surfaceId: 'shell/composition-modes',
    requirements: ['011/FR-011', '011/SC-003'],
    journey: 'product/responsive',
    axe: true,
    assertions: [
      'every action and datum available on desktop is available on a phone in landscape',
      'exactly one action composition is rendered — the other leaves the accessibility tree',
      'the folded action layer names itself in visible text rather than an ellipsis',
      'the document never scrolls horizontally at any of the five profiles',
    ],
    manualRecord: null,
  },
  {
    surfaceId: 'shell/reflow-and-text-scale',
    requirements: ['011/FR-011', '011/SC-003'],
    journey: 'product/responsive',
    axe: true,
    assertions: [
      'content stays complete at 200% root text size with no horizontal page scroll',
      'content stays complete at the 320x256 CSS-pixel viewport WCAG defines 400% zoom to equal',
      'every action survives with visible text and a reachable target at that viewport',
      'the sticky banner releases and travels with the page in a short viewport',
      'a banner that freezes leaves a viewport under it at a doubled text size',
      'no text is truncated without a bounded scroller to reach the rest',
      'a layer presents at full height rather than as a clipped centred dialog',
      'both conditions hold together: the zoom-equivalent viewport at 200% text',
    ],
    manualRecord: 'zoom-400',
  },
  {
    surfaceId: 'system/target-and-contrast',
    requirements: ['011/FR-012'],
    journey: 'product/responsive',
    axe: true,
    assertions: [
      'every effective target meets the 44 CSS-pixel design baseline',
      'a control and the label that activates it are measured as one target',
      'every visible text run meets 4.5:1, or 3:1 where it is large',
      'every declared visual carrier meets 3:1 against its composited background',
    ],
    manualRecord: null,
  },
  {
    surfaceId: 'shell/reduced-motion',
    requirements: ['011/FR-013'],
    journey: 'product/responsive',
    axe: false,
    assertions: [
      'the preference is reported to the page',
      'no element retains a transition or animation longer than a millisecond',
      'every state, landmark, named action and status region survives without motion',
      'no meaning was carried by the motion that was removed',
    ],
    manualRecord: null,
  },
  {
    surfaceId: 'preview/expanded-and-rtl',
    requirements: ['011/FR-014'],
    journey: 'preview/sweep',
    axe: true,
    assertions: [
      'copy at roughly twice English length does not truncate or overflow the page',
      'reading order is identical under expanded copy and right-to-left',
      'root lang and dir are published for the direction under test',
      'inline edges follow direction, so no physical left/right styling survives the flip',
      'a technical identifier is bidi-isolated and cannot be reordered',
    ],
    manualRecord: null,
  },
  {
    surfaceId: 'ui/adaptive-layer',
    requirements: ['011/FR-011', '011/FR-014'],
    journey: 'preview/sweep',
    axe: true,
    assertions: [
      'one state and intent contract serves dialog, sheet and full-height presentations',
      'the adaptive presentation resolves in CSS, so it follows zoom and text scale',
      'a short viewport promotes a sheet to full height rather than clipping it',
    ],
    manualRecord: 'screen-reader',
  },
  {
    surfaceId: 'shell/locale-startup',
    requirements: ['011/FR-016', '011/FR-017'],
    journey: 'product/locale',
    axe: true,
    assertions: [
      'a matching browser language selects the shipped language on first use',
      'an unsupported browser language selects English and requests no catalogue',
      'the browser setting is the only input: no language control and nothing stored',
      'no application-owned display text is hard-coded outside the catalogues',
    ],
    manualRecord: 'screen-reader',
  },
  {
    surfaceId: 'shell/locale-commit',
    requirements: ['011/FR-016', '011/FR-019'],
    journey: 'product/locale',
    axe: true,
    assertions: [
      'root lang, dir, title and every message change in one committed revision',
      'no frame mixes two languages and no raw key or placeholder is ever visible',
      'the prior complete language stays visible while a candidate loads',
    ],
    manualRecord: 'screen-reader',
  },
  {
    surfaceId: 'shell/locale-fallback',
    requirements: ['011/FR-019'],
    journey: 'product/locale',
    axe: true,
    assertions: [
      'a failed or incomplete catalogue commits complete English exactly once',
      'the fallback is stated as visible text naming what was requested',
      'exactly one polite announcement is published per committed fallback',
    ],
    manualRecord: 'screen-reader',
  },
  {
    surfaceId: 'system/locale-assets-offline',
    requirements: ['011/FR-019', '011/SC-006'],
    journey: 'product/offline',
    axe: false,
    assertions: [
      'catalogues are same-origin static assets under i18n/, relative to the deployment base',
      'complete English is readable with no network at all',
      'a browser-matched catalogue loaded once stays readable offline',
      'exactly one service worker exists and it owns the only cache',
      'English and German declare identical nonblank keys and interpolation variables',
    ],
    manualRecord: null,
  },
  {
    // Two halves with two owners. The policy checker compares `index.html`,
    // `robots.txt`, `sitemap.xml`, the manifest and the route table against one
    // constant, which is the half a browser cannot see all at once; the journey
    // covers the half only a browser can answer, which is whether the head is
    // actually rewritten as a Commander moves and in the language the page is
    // in. Neither half is evidence for the other.
    surfaceId: 'shell/search-metadata',
    requirements: ['011/FR-027', '011/SC-008'],
    journey: 'product/search-visibility',
    axe: false,
    assertions: [
      'each addressable route publishes its own description rather than the product tagline',
      'the canonical address and both card blocks name the route that is on screen',
      'the canonical names the production site rather than wherever the document is served from',
      'an address about one hull names that hull in its title and description, and shows the hull',
      'an address for a symbol the package does not carry publishes the catalogue’s identity',
      'no build payload reaches the canonical address, because a build lives in the fragment',
      'the description and the declared locale are in the language the page is rendered in',
      'the document served before the bundle runs carries the title, description, canonical, card and structured data, with the English wording the catalogue declares, and asks to be indexed',
      'the crawl policy, the map and the manifest are served, permit indexing and name the same site',
      'the map names one address per hull, and the manifest carries the icon sizes installation needs',
    ],
    manualRecord: null,
  },
  {
    // The half a running application cannot answer for. Every assertion here is
    // about a file the build wrote and a status code a crawler would get, which
    // is why it needs the production output rather than the dev server: a head
    // can be perfect in the browser while every address answers 404 with the
    // site's own title on it.
    surfaceId: 'shell/published-addresses',
    requirements: ['011/FR-027', '011/SC-008'],
    journey: 'product/search-published',
    axe: false,
    assertions: [
      'every address the map advertises answers 200, with no redirect and not from the 404 page',
      'each published document carries its own canonical address, title and description in bundled English',
      'a hull address names the hull and carries the hull’s own illustration as its card, described by the title',
      'the page that catches every other address keeps the application’s own identity',
    ],
    manualRecord: null,
  },
  {
    surfaceId: 'shell/newer-version-published',
    requirements: ['011/FR-025', '011/SC-007'],
    journey: 'product/application-update',
    axe: false,
    assertions: [
      'a session already open when a version is published states it without a Commander-initiated reload',
      'the statement is a modal overlay carrying nothing to press: no control, no Escape and no ground',
      'the overlay is a named dialog, and the shell behind it says nothing of its own',
      'the page restarts on the newer version by itself once the overlay has stood',
      'the restarted session states that the update was applied and names the version it is running',
      'that statement carries one named control, goes by itself once it has stood, and does not return on a later navigation',
      'a hand-started reload after the restart is served the published version, announces nothing, and is not restarted again over a window in which a stale one would have been',
    ],
    // **Neither of this mechanism's two layers is swept as a composition, and
    // that is the cost of the 2026-08-28 decision rather than an omission.**
    // The overlay stands for the second before the reload
    // (`UPDATE_OVERLAY_MS`) and the arrival notice for six
    // (`UPDATE_APPLIED_NOTICE_MS`); this repository's own figure for one axe
    // pass is 2.5 s locally and roughly twice that on a runner
    // (`e2e/accessibility.ts`, `SWEEP_BUDGET_MS`), so a scan started on either
    // would as often be scanning the page that replaced it — a green that means
    // nothing, which is worse than a gap that is written down.
    //
    // What still covers them: `Layer` itself is swept in the preview catalogue
    // under every variant, both layers are asserted structurally here — a named
    // dialog with nothing to press, and a named dialog with one control — and
    // the manual screen-reader protocol walks both. Pressing the notice's
    // control is asserted over the port in `app.spec.ts`, because a journey
    // that waited to press it would be pressing a layer that had gone.
    //
    // Lengthening either clock is what would buy the sweep back.

    // No polite announcement is on that list, and its absence is the rule
    // rather than an omission. The overlay is modal, so the outlet inside the
    // frame is inert while it stands and nothing is published there; the one
    // state that does publish is the restart that could not be carried out,
    // which the note below explains no journey can reach. It is asserted over
    // the port in `app.spec.ts` instead.

    // The shell state where the restart could not be carried out — the polite
    // notice and the named control beside it — is not swept by axe as one
    // composition anywhere, and that is a known gap rather than an assumed
    // scan. No journey can hold it open: in a real window `location.reload()`
    // does not fail, so the state exists only where the port can be driven
    // directly, which is `application-update.store.spec.ts` and `app.spec.ts`.
    // Each half is scanned on its own — the preview catalogue's `status-notice`
    // default renders an `info` notice, and the frame's `error` composition
    // renders a shell status beside a primary action carrying its own
    // description — so what is unscanned is the pairing, not the parts.
    manualRecord: 'screen-reader',
  },
  {
    // The worker decides when a cached version becomes unrepairable, so no
    // journey can provoke this state. It is covered where it can be rendered:
    // the frame's error composition in the preview catalogue, built from the
    // shell's own messages, which is the same notice and the same named control
    // the shell puts on screen.
    //
    // What the composition cannot show is the policy that leads to it — that an
    // unrepairable cache supersedes a waiting version and interrupts once. No
    // rendered surface can: it is a sequence of worker reports, and it is
    // asserted over the port in `application-update.store.spec.ts` and over the
    // shell in `app.spec.ts`.
    surfaceId: 'shell/unrepairable-cached-version',
    requirements: ['011/FR-026'],
    journey: 'preview/sweep',
    axe: true,
    assertions: [
      'a cached version the worker cannot repair is stated as a blocking error',
      'the recovery is a named control in the interface, never a cache-clearing reload',
      'the control keeps its visible name while carrying its own description',
      'the blocking error and the control that recovers it are rendered together, before main',
    ],
    manualRecord: 'screen-reader',
  },
  {
    surfaceId: 'ui/formatted-values',
    requirements: ['011/FR-018'],
    journey: 'preview/sweep',
    axe: true,
    assertions: [
      'numbers, percentages and dates follow the active locale',
      'credits and light years resolve through a localized pattern, not a fabricated Intl unit',
      'an absolute timestamp is formatted in UTC rather than the viewer timezone',
      'a value that is not a finite number raises rather than rendering a zero',
    ],
    manualRecord: null,
  },
  {
    surfaceId: 'ui/game-text',
    requirements: ['011/FR-020'],
    journey: 'preview/sweep',
    axe: true,
    assertions: [
      'package text carries the language it is actually in',
      'canonical text is shown and disclosed as untranslated, with the disclosure associated',
      'an absent package value is stated as unavailable rather than as a raw symbol',
      'the application keeps no private game-text translation',
    ],
    manualRecord: 'screen-reader',
  },
  {
    surfaceId: 'system/browser-matrix',
    requirements: ['011/FR-021', '011/SC-005'],
    journey: 'static/verification',
    axe: false,
    assertions: [
      'ten named projects exist across five profiles and two engines',
      'the four touch profiles declare hasTouch',
      'no project is removed or renamed to pass a run',
    ],
    manualRecord: null,
  },
  {
    surfaceId: 'system/accessibility-gate',
    requirements: ['011/FR-022', '011/SC-002'],
    journey: 'static/verification',
    axe: false,
    assertions: [
      'axe scans WCAG A and AA through 2.2 with no disabled rules',
      'an in-scope violation fails the build with the full result attached',
    ],
    manualRecord: null,
  },
  {
    surfaceId: 'system/conformance-claims',
    requirements: ['011/FR-015'],
    journey: 'static/verification',
    axe: false,
    assertions: [
      'no unqualified WCAG 2.2 AA claim exists in the product source or the project documents',
      'every claim that is made names all eight excluded criteria: 2.1.1, 2.1.2, 2.1.4, 2.2.1, 2.4.1, 2.4.3, 2.4.7, 2.4.11',
    ],
    manualRecord: null,
  },
  {
    surfaceId: 'system/accessibility-tree',
    requirements: ['011/FR-006', '011/FR-008'],
    journey: 'product/semantics',
    axe: false,
    assertions: [
      'the shell presents one banner, one main and one level-1 heading in that order',
      'both announcement outlets are named rather than anonymous live regions',
      'a layer presents as a named dialog that owns its content',
      'a choice group is one named group whose options expose their own state',
      'a field error is associated with its field rather than left as loose text',
    ],
    manualRecord: 'screen-reader',
  },
  {
    surfaceId: 'system/manual-protocols',
    requirements: ['011/FR-023', '011/SC-001'],
    journey: 'manual/protocols',
    axe: false,
    assertions: ['a versioned protocol and result record exists for every primary capability'],
    manualRecord: 'screen-reader',
  },
  // -------------------------------------------------------------------------
  // Feature 001: ship selection and build loading.
  // -------------------------------------------------------------------------
  {
    surfaceId: 'ships/catalogue',
    requirements: ['001/FR-001', '001/FR-002', '001/SC-001'],
    journey: 'product/ship-catalogue',
    axe: true,
    assertions: [
      'every installed hull is listed, with name, manufacturer, size, hardpoints and retail price',
      'search, every facet and both directions of every sort field constrain the list',
      'a missing value is stated in words and never rendered as a zero',
      'ties are broken by the package’s own order, identically in both directions',
      'the wide manifest uses table semantics with named bidirectional sort buttons',
      'the narrow list restates every label as a definition list',
      'the match count precedes the results and is announced once, politely',
      'a rested pointer reads a hull only where the rail that reading appears in is drawn; below it the press opens the hull and the row is named for that',
    ],
    manualRecord: 'screen-reader',
  },
  {
    surfaceId: 'ships/catalogue-session',
    requirements: ['001/FR-003'],
    journey: 'product/ship-catalogue',
    axe: false,
    assertions: [
      'constraints, order and the anchored result survive a trip to hull detail and back',
      'no catalogue state appears in the route path, the query, the fragment or a build record',
    ],
    manualRecord: null,
  },
  {
    surfaceId: 'ships/:hull',
    requirements: ['001/FR-004', '001/FR-005', '001/FR-006', '001/FR-022'],
    journey: 'product/hull-detail',
    axe: true,
    assertions: [
      'every specified hull fact is shown with its unit, or marked as a rating with none',
      'speed and rotation endpoints name the viewing condition they were measured under',
      'the slot layout uses the game’s own keys, including the irregular ones',
      'utility, core, optional and restricted mounts each carry the count of what they hold',
      'the hardpoint rule carries the total of its four class counts, as every other group does',
      'repeated optional sizes are one chip with its own count, largest size first',
      'every restricted group carries one of the restriction names the application owns, and totals only the mounts it states',
      'a hull that restricts nothing it states draws no restricted rule and no empty group',
      'a size chip’s notation is read out as the mounts it stands for, not as the notation',
      'the address carries the hull’s name with an underscore for each space, and no hull symbol',
      'a hull opened from the catalogue lands on that address, and reloading it opens the same hull',
      'an address published as a hull symbol opens the same hull and is replaced by the name form',
      'an address cased differently from the canonical one opens the hull and is replaced by it',
      'an address no hull is named or symbolled is a named error with no facts, no build and no creation action',
      'a missing illustration is explained as temporary and disables nothing',
      'the detail is the inspector at the manifest rail’s width and the sheet at every width below it',
      'the sheet is a bounded column centred in the window, and its illustration follows the column rather than the screen',
    ],
    manualRecord: 'screen-reader',
  },
  {
    // 001/FR-009 moved off this surface on 2026-08-25: it carries no dialog any
    // more, because a build being replaced has a record of its own.
    surfaceId: 'ships/:hull/create-stock-build',
    requirements: ['001/FR-007', '024/FR-001'],
    journey: 'product/hull-detail',
    axe: true,
    assertions: [
      'creation is explicit and produces exactly the package default loadout',
      'every fixed mount is populated before the build becomes active',
      'creation is unavailable, and says so, when the package has no default loadout',
      'a second creation replaces the build on screen without asking, and neither is stored',
    ],
    manualRecord: 'screen-reader',
  },
  {
    surfaceId: 'build',
    requirements: ['001/FR-008', '001/FR-010', '001/FR-014', '024/FR-001'],
    journey: 'product/build-working-state',
    axe: true,
    assertions: [
      'the build this page is autosaving into is restored after a reload',
      'a build still at its hull’s package default is in no record, and its first edit takes one',
      'four builds in a row, each one decided, leave four records, and no ingress asks anything',
      'opening a saved build writes nothing to it; the first edit forks an unnamed record',
      'naming a build consumes the record it was already in, and replacing one returns the count',
      'persistence status is visible text with an icon, never colour alone',
      'every persistence failure leaves the build editable',
      'a stored record is migrated losslessly or left byte-for-byte unchanged',
    ],
    manualRecord: 'screen-reader',
  },
  {
    // Its own entry since 2026-08-27, the way `build/share-link` is: the save
    // layer left the library that used to draw it, and the journeys that reach
    // it are round trips — open a saved build in the workspace, save it, and
    // read what the library is holding afterwards — so they are written where
    // that listing is asserted rather than beside the autosave arithmetic.
    surfaceId: 'build/save',
    requirements: ['001/FR-009', '001/FR-011', '001/FR-012'],
    journey: 'product/build-library',
    axe: true,
    assertions: [
      'one save names, renames and duplicates: the mode is chosen before one commit, never guessed',
      'the save of a build opened from a save offers replacing it first, and says when it was saved',
      'a name already in use warns only where saving would create a record, and then proceeds',
      'a name typed and then dismissed is not what the next build’s save opens with',
      'the note is written with the build, and never enters a build link or a SLEF export',
      'two pages saving one named record are offered overwrite, keep both and cancel',
      'a save that writes nothing says so and keeps the layer open on what was typed',
      'an answer to the conflict that writes nothing says so too, on the name typed before it',
    ],
    manualRecord: 'screen-reader',
  },
  {
    surfaceId: 'builds',
    requirements: ['001/FR-010', '001/FR-011', '001/FR-013', '001/SC-002'],
    journey: 'product/build-library',
    axe: true,
    assertions: [
      'the surface is a framed layer with a title bar, a header row, column headers and a footer',
      'rows carry the title or what the build calls itself, hull, how long ago it was edited and recorded state',
      'named and unnamed records stand in one list in one order, most recently edited first',
      'the edited column is how long ago, and the instant itself stays as text on the row',
      'the record the workspace holds is marked in words and in aria-current, not only in amber',
      'an unnamed row states its remaining life, and the row the workspace holds is the one chosen first',
      'a recorded issue is a count on its own plate with words beside it, never a colour',
      'the search narrows over the fields a row shows, announces the count and changes no record',
      'nothing matching says so in one sentence, leaving every control reachable',
      'the footer commits two things only: deleting the chosen record and opening it in outfitting',
      'deleting acts on the record identity the row carries, never on a display name',
      'a full quota offers explicit discard and never evicts automatically; expiry is not a way out',
      'notes and record identities never enter a build link or a SLEF export',
    ],
    manualRecord: 'screen-reader',
  },
  {
    surfaceId: 'build/share-link',
    requirements: [
      '001/FR-015',
      '001/FR-016',
      '001/FR-017',
      '001/FR-018',
      '001/FR-019',
      '001/FR-020',
      '001/FR-021',
      '001/SC-003',
      '022/FR-001',
      '024/FR-003',
    ],
    journey: 'product/build-link',
    axe: true,
    assertions: [
      'the payload is entirely in the fragment; the path and query carry no build data',
      'a published value starts “b.” and is at most 500 characters including that prefix',
      'a pasted, navigated or initial fragment all take the same candidate-first path',
      'an invalid, truncated, over-limit or unsupported payload leaves the active build unchanged',
      'editing replaces the fragment without adding a history entry per edit',
      'a build the codec cannot represent is refused with its slot and reason, and offers SLEF',
      'a published link the address loses while the saved builds stand over it is stated again once they close, and opens the same build in a context holding nothing',
      'a build nobody changed is in the address from the moment it becomes active, and a reload restores it from there and from nothing else',
    ],
    manualRecord: null,
  },
  {
    surfaceId: 'system/no-transmission',
    requirements: ['001/SC-004'],
    journey: 'product/build-link',
    axe: false,
    assertions: [
      'no request URL contains build-link payload data',
      'no automatic cross-origin request occurs during catalogue, detail, storage or share flows',
    ],
    manualRecord: null,
  },
  {
    surfaceId: 'ships/unrecognised-path-**',
    requirements: ['001/FR-005'],
    journey: 'product/ship-catalogue',
    axe: false,
    assertions: [
      'an address this application does not serve returns to the shipyard rather than an empty screen',
    ],
    manualRecord: null,
  },
  {
    surfaceId: 'system/cross-route-conformance',
    requirements: ['001/FR-005', '001/FR-010', '001/FR-014'],
    journey: 'product/interface-conformance',
    axe: true,
    assertions: [
      'each of the four product routes has one main, one visible h1 and no skipped heading level',
      'every control’s accessible name is the words on its face, on every route',
      'exactly one polite and one assertive outlet exist, and nothing else is live',
      'one blocking condition raises one prompt, naming both outcomes in its own words',
      'every route survives 200% text, 400% zoom, expanded German copy and a mirrored direction',
      'removing motion removes no state, no feedback and no control',
    ],
    manualRecord: 'zoom-400',
  },
  {
    surfaceId: 'system/performance-budgets',
    requirements: ['001/SC-001', '001/SC-003'],
    journey: 'product/performance',
    axe: false,
    assertions: [
      'search, filter and order constrain the complete installed manifest without a perceptible wait',
      'the workspace restores this tab’s working build before it offers the build’s own actions',
      'a burst of edits coalesces into one record rather than one write each',
      'a build is published as a link inside the codec’s sub-50 ms target',
    ],
    manualRecord: null,
  },
  {
    surfaceId: 'system/offline-capability',
    requirements: ['001/FR-006', '001/FR-014', '001/SC-004'],
    journey: 'product/offline-privacy',
    axe: false,
    assertions: [
      'the shell and bundled English read with no network at all',
      'an illustration seen once stays available offline',
      'an illustration that cannot be fetched blocks nothing, and recovers on retry without a reload',
      'nothing of another origin, and nothing of a build, is ever cached',
    ],
    manualRecord: null,
  },
  {
    surfaceId: 'system/policy-checker',
    requirements: ['011/FR-024', '011/SC-004'],
    journey: 'static/verification',
    axe: false,
    assertions: [
      'literal application display text fails the build',
      'a governed visual literal outside the token sources fails the build',
      'a missing component-state preview fails the build',
      'every requirement and success-criteria id is registered in this ledger',
    ],
    manualRecord: null,
  },
  {
    surfaceId: 'build/cost-block',
    requirements: ['009/FR-001', '009/FR-002', '009/FR-003', '009/SC-001', '009/SC-003'],
    journey: 'cost-and-materials/cost',
    axe: true,
    assertions: [
      'the canvas’s four rows appear in its order: hull, modules, total, rebuy',
      'hull, modules, total and rebuy equal one buildCost().credits result',
      'every row is labelled, so neither the accent nor the faint treatment carries meaning alone',
      'each figure is associated with its label by description-list semantics',
      'no unpriced evidence, lower-bound qualification or slot action appears (ruling F)',
      'at a doubled text size, in German and at 400% zoom, no reading overflows its own box',
      'right to left mirrors the two blocks without reordering them',
      'no figure of this block reaches a build link or any address the session visits',
    ],
    manualRecord: 'screen-reader',
  },
  {
    surfaceId: 'build/materials-block',
    requirements: [
      '009/FR-007',
      '009/FR-008',
      '009/FR-009',
      '009/FR-010',
      '009/SC-002',
      '009/SC-003',
    ],
    journey: 'cost-and-materials/materials',
    axe: true,
    assertions: [
      'the whole block is absent for a build that crafts nothing',
      'every consolidated row is listed, with no truncation or top-N cut',
      'rows are ordered commonest rarity first (ruling G)',
      'the material-type count equals the drawn rows and the unit total their counts',
      'the blueprint count is stated once, opposite the heading',
      'no trace disclosure or contributing-selection list exists (ruling F)',
      'rarity uses the package grade, never a cross-origin icon',
      'every name is drawn by the shared game-text primitive, in the language it resolved, and is tagged canonical exactly when it fell back',
      'the longest name a build reaches through this journey fits its row at a doubled text size',
      'the block appears and follows an edit with the network gone',
      'no material, list or count of one reaches a SLEF export',
      'the Merc-Coin row is swept for accessibility, a state no other suite reaches',
    ],
    manualRecord: 'screen-reader',
  },
  {
    surfaceId: 'build/validation-issues',
    requirements: [
      '003/FR-001',
      '003/FR-002',
      '003/FR-003',
      '003/FR-004',
      '003/FR-005',
      '003/FR-007',
      '003/FR-013',
      '003/FR-014',
      '003/FR-015',
      '003/FR-022',
      '003/SC-001',
    ],
    journey: 'ship-status/build-status',
    axe: true,
    assertions: [
      'the rail opens with the canvas’s own BUILD STATUS heading, and the region is named by it',
      'one block per package issue, in package order, each drawn exactly once',
      'each block names its severity in words, unseen as the canvas draws none, so colour carries nothing alone',
      'a package warning is drawn in its own tier on a build the package still calls valid, and reads clean there',
      'the sentence is the package’s, unparsed, with no second sentence composed from its parameters',
      'a locale the package has no diagnostic for reads canonically, with the untranslated disclosure',
      'a build the package reports nothing about draws nothing: no all-clear line and no count',
      'no issue offers an action, and no control opens a wide Status capability (rulings A and B)',
      'no condition draft, load control or hardpoint toggle appears in the rail (ruling C); feature 005’s pips are its own',
      'a package-defaulted fixed mount raises nothing and creates no provenance region',
    ],
    manualRecord: 'screen-reader',
  },
  {
    surfaceId: 'build/capacity-cells',
    requirements: ['003/FR-023', '003/FR-024', '003/SC-007'],
    journey: 'ship-status/capacity',
    axe: true,
    assertions: [
      'the rail states a cargo capacity and a passenger capacity, each as one cell of its own band',
      'both figures are the package’s own for the build in memory, compared against it rather than written down',
      'a build carrying both a hold and berths reads each into its own cell, neither crossed nor nought',
      'a build with no cabin draws that cell at zero rather than dropping it',
      'the cells are the last two of the rail’s band, after the six the other features own',
      'the band is drawn wherever the rail is, so the compact STATUS segment carries every cell the column does',
      'the compact key-figures strip stands down while STATUS is open, so no figure is on one screen twice',
    ],
    manualRecord: null,
  },
  {
    surfaceId: 'build/merc-coin-row',
    requirements: ['009/FR-004', '009/FR-005', '009/FR-006', '009/SC-004'],
    journey: 'cost-and-materials/materials',
    axe: true,
    assertions: [
      'the row exists only when the package build-cost total is non-zero',
      'a zero package total means no row and no zero in its place',
      'the figure is the build total, moving past what one article costs alone',
      'the row closes the materials block, after every material row',
      'the figure is excluded from the material-type and unit counts',
      'the row is named as well as coloured',
    ],
    manualRecord: 'screen-reader',
  },
  {
    surfaceId: 'build/outfitting-ledger',
    requirements: ['002/FR-001', '002/FR-002', '002/FR-003', '002/FR-009', '002/SC-001'],
    journey: 'outfitting/ledger',
    axe: true,
    assertions: [
      'every package mount but one is listed by its exact game slot key, including the cargo hatch',
      'the planetary approach mount is the one mount no row is drawn for',
      'the cargo hatch closes the core internals rather than the whole list',
      'a pointer resting on an unchosen mount washes it, and a touch profile is given no wash',
      'a slot key is never visible text; it is the hidden identity beside the drawn label',
      'a fact the Almanac does not publish reads as unavailable rather than as a zero',
      'the cargo hatch offers power and nothing else, with the Almanac’s reason',
    ],
    manualRecord: 'screen-reader',
  },
  {
    surfaceId: 'build/outfitting-chooser',
    requirements: [
      '002/FR-004',
      '002/FR-005',
      '002/FR-006',
      '002/FR-007',
      '002/FR-008',
      '002/FR-025',
      '002/SC-002',
      '002/SC-004',
    ],
    journey: 'outfitting/replacement',
    axe: true,
    assertions: [
      'the chooser offers exactly what the package offers for the mount, stock and variants',
      'search matches name, class, rating and mount, and never a package symbol',
      'acquisition and entitlement labels come from the package record',
      'a variant is recognised only through preEngineeredVariant',
      'a pointer resting on a choosable module row washes it',
      'the fitted row and the picked row carry different marks, each of them in text as well',
      'the list settles within the published bound at the mobile viewport',
    ],
    manualRecord: 'screen-reader',
  },
  {
    surfaceId: 'build/outfitting-families',
    requirements: [
      '002/FR-020',
      '002/FR-021',
      '002/FR-022',
      '002/FR-023',
      '002/FR-024',
      '002/SC-006',
      '002/SC-007',
      '002/SC-008',
      '002/SC-009',
    ],
    journey: 'outfitting/families',
    axe: true,
    assertions: [
      'every available choice appears in exactly one Almanac family',
      'the fitted choice’s family is the only one open, and none is open without one',
      'a family control publishes its name, its count and its open state',
      'opening or closing a family moves no revision, no history step and no undo',
      'a search opens every family it matched and drops the families it did not',
      'a search matching more than a screenful leaves every family closed and counted',
      'clearing the search restores the fitted-family default',
      'a family the Commander closed stays closed when they fit from another one',
      'a pointer resting on an unrevealed category washes it, and the revealed one keeps its own ground',
      'the revealed category is measured at the one profile with a hovering pointer, which draws the rail',
      'a unique reward keeps its labels on its own row, inside its base module’s family',
      'a family name changes with the reading language and membership does not',
      'a revealed family is inside the rail’s own box, and a pressed one does not move',
      'a family’s rows fall by class and then by price, with the unpriced last',
      'the manifest scrolls inside its own box rather than over the panel below it',
      'the control clears 44 CSS px under touch and the document never scrolls sideways',
    ],
    manualRecord: 'screen-reader',
  },
  {
    surfaceId: 'build/outfitting-fixed-mounts',
    requirements: ['002/FR-010', '002/FR-011'],
    journey: 'outfitting/ledger',
    axe: true,
    assertions: [
      'every fixed mount arrives fitted before any calculation is read',
      'package defaulting carries no provenance into what the build is saved or shared as',
      'package defaulting creates no history frame',
      'outfitting-accessibility.spec.ts owns the cargo-hatch refusal and unavailable-engineering scan',
    ],
    manualRecord: null,
  },
  {
    surfaceId: 'build/outfitting-engineering',
    requirements: ['002/FR-012', '002/FR-013', '002/FR-014', '002/SC-005'],
    journey: 'outfitting/engineering',
    axe: true,
    assertions: [
      'recipe, grade and effect confirmed together are one decision',
      'an effect-only change keeps the recipe, the grade and a purchased identity',
      'clearing is the blueprint list’s first option and there is no second control',
      'a known-zero cost and an unavailable one read as different things',
      'no material rarity is fetched from another origin',
      'a supported partial roll is completed to quality 1 and said out loud',
      'the editor is a column beside the manifest where the bench holds three, and under it where it does not',
      'the engineering card keeps one height as a recipe fills it, with the details under it',
      'the three-column bench ends where the window does, and the list and the attributes take what is left',
      'step ③ is numbered only where the chooser numbers steps ① and ②',
      'a mount with no chooser keeps the whole bench and no numbered step',
      'every grade cell names its grade, and a cell past the choice is unfilled and dimmed',
      'the effect menu the application draws passes an accessibility scan with its list open, every option at the target baseline',
      'the effect menu keeps the option it is on inside the box its list scrolls in',
      'a pointer resting on an unchosen effect washes it, measured on the menu the wide width draws',
    ],
    manualRecord: 'screen-reader',
  },
  {
    surfaceId: 'build/outfitting-power',
    requirements: ['002/FR-015'],
    journey: 'outfitting/ledger',
    axe: true,
    assertions: [
      'the package’s zero-based group is presented one-based, as the game shows it',
      'an absent group stays absent rather than being drawn as group 1',
      'a power change leaves the module fitted, with its mass and cost in the build',
      'both controls name the module and the mount they act on',
      'replacing the module keeps the mount’s group and its off state',
    ],
    manualRecord: 'screen-reader',
  },
  {
    surfaceId: 'build/outfitting-history',
    requirements: ['002/FR-016', '002/FR-017', '002/FR-018', '002/SC-003'],
    journey: 'outfitting/history',
    axe: true,
    assertions: [
      'each intermediate state of a mixed sequence is restored exactly',
      'package results are recomputed rather than restored',
      'a new decision after an undo discards the forward branch',
      'exactly one hundred decisions are retained of a hundred and one',
      'looking, searching and opening a field record nothing',
      'outfitting-history.spec.ts owns the stock-build scan with disabled undo and redo',
      'no tape, checkpoint or summary reaches storage, the link or browser history',
    ],
    manualRecord: 'screen-reader',
  },
  {
    surfaceId: 'build/outfitting-identity',
    requirements: ['002/FR-019'],
    journey: 'outfitting/history',
    axe: true,
    assertions: [
      'the ship’s name and ID plate are edited in place on the command bar’s identity line',
      'clearing sets absence rather than an empty string',
      'one confirmed change is one decision, and undo restores the previous value',
    ],
    manualRecord: 'screen-reader',
  },
  {
    surfaceId: 'build/outfitting-composition',
    requirements: ['002/FR-011', '002/FR-009'],
    journey: 'outfitting/responsive',
    axe: true,
    assertions: [
      'the composition follows the declared content minimums, never a device label',
      'every capability is offered at every width',
      '400% zoom and a short viewport select the compact composition',
      'the document never scrolls horizontally and no text is cut off',
      'every side-by-side column runs its seam to the foot of the screen',
      'a frozen column clears the bar that is drawn, not the one the token declares',
    ],
    manualRecord: 'actual-zoom',
  },
  {
    surfaceId: 'build/hull-anatomy-plates',
    requirements: ['010/FR-001', '010/FR-002', '010/FR-003', '010/FR-009', '010/SC-001'],
    journey: 'anatomy/plates',
    axe: true,
    assertions: [
      'both plates draw the installed package document at the package viewBox',
      'the schematics are served from same-origin build assets produced from the installed package',
      'the package SVG is never fetched: a plate asks for its PNG and its extract, and nothing else',
      'only a package annotation resolving to a hardpoint or utility slot becomes a mount',
      'no coordinate is measured: no getBBox, no getScreenCTM and no stored geometry',
      'every drawn mount resolves to the exact package slot key on every hull',
      'the pair is drawn only where the workspace composes more than one region, the container has the room for two plates at the width one plate is drawn at, and the window is not short; a container short of that room draws one side and its selector, doubled text included',
    ],
    manualRecord: 'screen-reader',
  },
  {
    surfaceId: 'build/hull-anatomy-mount-state',
    requirements: ['010/FR-005', '010/FR-007', '010/SC-003'],
    journey: 'anatomy/plates',
    axe: true,
    assertions: [
      'every mount names its slot, kind, side, fitted state and engineering in words',
      'a utility is presented as a utility, never as a hardpoint',
      'a selected utility fills differently from a selected hardpoint: the fill says selected, the hue says which kind',
      'a mount drawn on both sides is one build identity in one state',
      'the legend is the five entries the reference draws, and only those',
      'no state is carried by colour, dash, fill or position alone',
    ],
    manualRecord: 'screen-reader',
  },
  {
    surfaceId: 'build/hull-anatomy-selection',
    requirements: ['010/FR-006', '010/FR-008', '010/SC-002'],
    journey: 'anatomy/selection',
    axe: true,
    assertions: [
      'activating a mount selects its exact outfitting slot in one interaction',
      'selecting a slot in the ledger marks every occurrence of it on the plates',
      'the mount detail stays the outfitting row and bench; the plates publish no second one',
      'a side change and a selection create no build or history revision',
      'nothing about the shown side or the selection reaches the link or storage',
    ],
    manualRecord: 'screen-reader',
  },
  {
    surfaceId: 'build/hull-anatomy-unavailable',
    requirements: ['010/FR-004', '010/FR-010', '010/SC-004'],
    journey: 'anatomy/unavailable',
    axe: true,
    assertions: [
      'a side that did not arrive is stated as temporarily unavailable, with a retry',
      'an unsafe or invalid document is stated as a package defect and never injected',
      'a ready peer, the complete ledger and the editor are unchanged by either',
      'no core, optional, armour or cargo-hatch slot receives geometry',
      'every slot stays reachable and editable when neither schematic arrives',
      'a side asks again by itself when connectivity returns; a defect does not',
      'a failure and a recovery are one polite announcement each, and initial state is silent',
      'a schematic seen once returns from the versioned cache with no network at all',
      'only the opened hull’s two files are cached, never the package’s ninety-six',
    ],
    manualRecord: 'screen-reader',
  },
  {
    surfaceId: 'build/hull-anatomy-targets',
    requirements: ['010/FR-011', '010/FR-012'],
    journey: 'anatomy/plates',
    axe: true,
    assertions: [
      'every mount is activated on its own from the keyboard, at every layout profile',
      'a mark that would touch its neighbour steps aside and is tied back to its own mount by a leader',
      'no mark loses more than half of itself under a neighbour, at doubled text, on either plate',
      'the mark being worked with is raised above the ones it overlaps, so package geometry never moves',
      'every drawn mount has a full-baseline equivalent in the ledger, which is what SC 2.5.8’s Equivalent exception requires',
      'the capability publishes no provenance control of its own; help owns it',
      'the plate holds its whole hull at doubled text and 400% zoom, and never scrolls',
      'the plate reserves its box in every state, so a late schematic moves nothing below it',
      'the plates ask for the height their hulls need; the bench takes the rest',
      'a mirrored direction mirrors the layout, never the hull or a mount identity',
      'removing motion removes no mount, no state and no announcement',
    ],
    manualRecord: 'actual-zoom',
  },
  {
    surfaceId: 'shell/journal-import-layer',
    requirements: [
      '004/FR-007',
      '004/FR-008',
      '004/FR-009',
      '004/FR-011',
      '004/FR-014',
      '004/SC-003',
      '016/FR-007',
    ],
    journey: 'product/slef-import',
    axe: true,
    assertions: [
      'Import opens from ship selection, hull detail, the workspace and the library, with no active build',
      'the exact draft survives every refusal, cancellation and supersession',
      'an over-limit draft names the actual and limit bytes and never reaches the inspector',
      'zero, two and mixed observed entries are refused whole, naming the exactly-one rule',
      'every package diagnostic keeps its own index, path, code, constraint and reason',
      'no application parser, trim, repair or heuristic decode runs on the draft',
      'no state is carried by colour alone, and the draft JSON is never announced',
      'the pasted-entry bound is the paste box’s own, and a chosen journal file is bounded by its size instead',
    ],
    manualRecord: 'screen-reader',
  },
  {
    surfaceId: 'shell/journal-scan',
    requirements: [
      '016/FR-001',
      '016/FR-002',
      '016/FR-003',
      '016/FR-004',
      '016/FR-005',
      '016/FR-006',
      '016/SC-001',
      '016/SC-002',
    ],
    journey: 'product/journal-import',
    axe: true,
    assertions: [
      'several journal files are chosen at once, by the control and by dropping them',
      'a file over the stated bound is refused by name, and the rest of the selection is still read',
      'what was read is stated: the files by name, and how many events they hold',
      'a build two files both hold is listed once, and the list is newest first',
      'a file at the bound is scanned within the budget, measured as a domain operation in the reference environment',
      'a scan says how it ended and not only that it started, in one polite announcement',
      'nothing is sent anywhere and nothing of a journal is cached',
    ],
    manualRecord: 'screen-reader',
  },
  {
    surfaceId: 'shell/journal-selection',
    requirements: [
      '016/FR-008',
      '016/FR-009',
      '016/FR-010',
      '016/FR-011',
      '016/SC-003',
      '024/FR-001',
    ],
    journey: 'product/journal-import',
    axe: true,
    assertions: [
      'every event a journal holds is offered, and loading is refused with none chosen',
      'one chosen build replaces the active build and lands on the workspace',
      'one chosen build is named in no record, and is in the address as any active build is',
      'several chosen builds are saved, none is opened, and the saved builds open on the count',
      'a batch stores one named record per event selected, beside the record the open build already held',
      'a refused entry names itself with the package’s own answer and costs the others nothing',
    ],
    manualRecord: 'screen-reader',
  },
  {
    surfaceId: 'library/journal-records',
    requirements: ['016/FR-012', '016/FR-013'],
    journey: 'product/journal-import',
    axe: true,
    assertions: [
      'a saved build takes its ship name, its ident where it has none, and its hull where it has neither',
      'a name already taken is kept beside the one that has it, without a question',
    ],
    manualRecord: null,
  },
  {
    surfaceId: 'equipment/journal-import',
    requirements: ['016/FR-014', '016/FR-015', '016/FR-016', '016/FR-017', '016/SC-004'],
    journey: 'equipment/journal-import',
    axe: true,
    assertions: [
      'the bench reads suit loadouts from the same files, newest first',
      'what the package left out is named as the package reported it, and nothing is substituted',
      'a pasted log holding several loadouts is listed rather than narrowed to the newest',
      'a batch that saved a loadout the package could not fit whole says so before it goes anywhere',
      'one chosen loadout opens on the bench, and several are saved with the bench left empty',
      'a saved loadout is named by the journal’s own loadout name, and carries the journal note',
    ],
    manualRecord: 'screen-reader',
  },
  {
    surfaceId: 'shell/slef-import-replacement',
    requirements: ['004/FR-010'],
    journey: 'product/slef-import',
    axe: true,
    assertions: [
      'a ready candidate replaces unsaved work without asking',
      'a refusal leaves the active build, its revision, records, fragment and history identical',
      'a superseded candidate cannot commit after a newer submit, close or route change',
      'a successful import is exactly one replacement, one autosave and one link synchronization',
    ],
    manualRecord: 'screen-reader',
  },
  {
    surfaceId: 'build/slef-import-aftermath',
    requirements: [
      '004/FR-006',
      '004/FR-010',
      '004/FR-012',
      '004/FR-013',
      '004/SC-002',
      '024/FR-001',
    ],
    journey: 'product/slef-import',
    axe: true,
    assertions: [
      'an imported completed partial roll is named by feature 002’s own completion notice, with its slot, article and source quality',
      'a retained incomplete or invalid verdict is the build-status rail’s, unchanged by where the build came from',
      'feature 004 draws no second report of either: each fact appears exactly once on the workspace',
      'a package-defaulted fixed mount is ordinary build state with no provenance of its own',
      'an imported build carries the package’s own hull identity, so feature 010 draws its schematics',
      'a later revision retires the completion notice and changes nothing about the build',
      'a refused import leaves the workspace, the rail and the notice exactly as they were',
      'an imported build still at its hull’s package default takes no record, and the address is the whole of what holds it',
    ],
    manualRecord: 'screen-reader',
  },
  {
    surfaceId: 'build/slef-export-layer',
    requirements: [
      '004/FR-001',
      '004/FR-002',
      '004/FR-003',
      '004/FR-005',
      '004/FR-006',
      '004/FR-013',
      '004/SC-001',
    ],
    journey: 'product/slef-export',
    axe: true,
    assertions: [
      'the layer generates one entry for the exact active revision and shows its metadata',
      'an invalid or incomplete build still exports, with the package verdict stated in words',
      'the exact-revision canonical link is included, and its omission is explained rather than failing',
      'credit figures are the package catalogue retail values, never a captured purchase',
      'a modelled edit invalidates the artifact before any delivery is attempted',
      'the Share Link and SLEF modes are the only two, and the selected one is exposed as such',
      'the formats stand beside the payload where there is room and above it where there is not',
      'one amber hairline divides the two regions, and the layer takes the width step it is drawn at',
      'the chosen format is told apart by more than its tint, and both formats meet the target baseline',
      'the width step bounds the centred layer, and the screen bounds it where that is narrower',
      'the flush body hands its padding to the two regions, so the rule between them runs its height',
    ],
    manualRecord: 'screen-reader',
  },
  {
    surfaceId: 'build/slef-export-delivery',
    requirements: ['004/FR-004', '004/FR-014'],
    journey: 'product/slef-export',
    axe: true,
    assertions: [
      'the payload stays selectable and Download stays available through every failure',
      'Copy reports copied only after the clipboard promise resolves',
      'Download reports dispatched, never saved',
      'Share appears only where the platform provides it, and a cancellation is neutral',
      'no application request leaves the origin during generation or delivery',
    ],
    manualRecord: 'screen-reader',
  },
  {
    // No panel: the canvas draws none, so with no build to pass on the Export
    // action is simply not published. The workspace's own empty state says what
    // to do next and the shell's Import action is always one control away
    // (`openspec/changes/archive/004-slef/design/reference-review.md`, "Rejected").
    surfaceId: 'build/slef-export-unavailable',
    requirements: ['004/FR-001'],
    journey: 'product/slef-export',
    axe: true,
    assertions: [
      'with no active build the Export action is not offered and the layer cannot open',
      'the workspace’s own empty state is the recovery, and the shell Import action is present',
      'no stale payload survives a build being cleared',
    ],
    manualRecord: 'screen-reader',
  },
  {
    surfaceId: 'product/slef-interchange-performance',
    requirements: ['004/SC-004'],
    journey: 'product/slef-export',
    axe: false,
    assertions: [
      'the package maximum-slot hull, fully fitted, imports and exports in under 500 ms each',
      'the measurement runs as a domain operation with no application network request',
    ],
    manualRecord: null,
  },
  {
    surfaceId: 'preview/technical-text-field',
    requirements: ['004/FR-008', '004/FR-009'],
    journey: 'preview/sweep',
    axe: true,
    assertions: [
      'a monospaced payload field keeps its visible label, description and error relationship',
      'a readonly payload stays selectable and owns its own wrapping and overflow',
      'byte and limit metadata is associated with the control rather than only drawn beside it',
    ],
    manualRecord: 'screen-reader',
  },
  {
    surfaceId: 'preview/diagnostic-list',
    requirements: ['004/FR-011'],
    journey: 'preview/sweep',
    axe: true,
    assertions: [
      'every diagnostic renders as a list item carrying index, path, code, constraint and reason',
      'a long identity or path wraps or scrolls inside the list rather than widening the page',
      'paths, codes and identities are direction-isolated',
    ],
    manualRecord: null,
  },
  {
    surfaceId: 'preview/hull-schematic',
    requirements: ['010/FR-005', '010/FR-010'],
    journey: 'preview/sweep',
    axe: true,
    assertions: [
      'every treatment the legend explains renders at once in the default state',
      'a pending, unavailable and defective side each state themselves in text',
      'the synthetic catalogue diagram is not package geometry, so no private copy is kept',
    ],
    manualRecord: null,
  },
  {
    surfaceId: 'build/power-and-thermals-dashboard',
    requirements: [
      '005/FR-001',
      '005/FR-002',
      '005/FR-004',
      '005/FR-005',
      '005/FR-006',
      '005/SC-001',
    ],
    journey: 'power/dashboard',
    axe: true,
    assertions: [
      'the POWER mode retitles the region, marks the plates and draws the dashboard under them',
      'every priority band the package returns is drawn, each stating its own powered verdict in words',
      'the cumulative draw of the last band is the figure the summary and the rail also carry',
      'one row per returned consumer at every width, with no aggregation and no top-five truncation',
      'a disabled or deployed-only row stays visible and carries the draw the package returned',
      'a module row reaches its exact package slot in feature 002’s ledger in one interaction',
      'every distributor figure is set flush to the end of its own column',
    ],
    manualRecord: 'screen-reader',
  },
  {
    surfaceId: 'build/power-and-thermals-conditions',
    requirements: ['005/FR-003', '005/FR-007', '005/SC-002'],
    journey: 'power/conditions',
    axe: true,
    assertions: [
      'deployed is selected until a Commander chooses otherwise, and the choice takes effect in place',
      'stowing the hardpoints moves every band figure and removes the three deployed-only summaries',
      'the three that are gone are named in a sentence: nothing blank, dashed or zeroed stands in',
      'a bank takes a whole pip and the other two pay half of it each, or one pays all of it',
      'capacity and rated recharge are properties of the fitted distributor and do not move',
      'there is no draft, no apply, no reset and no error state',
      'neither condition reaches the route, the fragment, history, storage or the active build',
    ],
    manualRecord: 'screen-reader',
  },
  {
    surfaceId: 'build/power-and-thermals-heat',
    requirements: ['005/FR-009', '005/FR-011'],
    journey: 'power/dashboard',
    axe: true,
    assertions: [
      'the five returned scenarios are drawn in the package’s own order, with all five of their fields',
      'the three profile definitions are stated, and no tile repeats a scenario or counts a module',
      'an infinite heat level or gauge reads as a load that never settles, never as a number',
      'a null time to overheat reads as a scenario that never gets there',
      'each sentinel is read off its own field: neither is inferred from the other',
    ],
    manualRecord: 'screen-reader',
  },
  {
    surfaceId: 'build/power-and-thermals-unavailable',
    requirements: ['005/FR-008', '005/FR-010', '005/SC-003'],
    journey: 'power/unavailable',
    axe: true,
    assertions: [
      'a null distributor result is one unavailable group, with no capacitor figure in its place',
      'a null heat result is one unavailable group, with no hull or catalogue figure in its place',
      'neither states which of the package’s reasons it was, because the package does not say',
      'power, the conditions and the remaining group stay usable while either is unavailable',
      'an infinite utilisation reads as drawing with zero available plant output',
    ],
    manualRecord: 'screen-reader',
  },
  {
    surfaceId: 'build/power-and-thermals-rail',
    requirements: ['005/FR-013', '005/FR-014', '005/SC-004'],
    journey: 'power/rail',
    axe: true,
    assertions: [
      'one statement per band the package reports unpowered with hardpoints deployed',
      'the statement is drawn in the BUILD STATUS block under the package’s issues, and nowhere else',
      'no sentence the canvas does not print, and no severity word beside it',
      'the POWER line states the lit draw against plant output, and the remainder after it',
      'the bar under it is named in words rather than left a shape to guess at',
      'the statement, the POWER line and the bar hold no control between them',
      'the three pip groups under the bar edit the same allocation the distributor cell edits',
      'the pip control stays on screen in anatomy modes the distributor table is not drawn in',
      'the block carries no inset of its own: the figures start where the cells they head start',
      'the compact strip’s power badge is drawn only where the plant leaves a priority group dark',
      'the six key figures reach the strip’s own trailing edge on a build that draws no badge',
      'the badge names each dark group, and holds no control',
      'the badge states the lit share of plant output rather than the share of the whole demand',
      'the badge stands beside the six figures, never over one of them',
    ],
    manualRecord: 'screen-reader',
  },
  {
    surfaceId: 'build/power-and-thermals-reflow',
    requirements: ['005/FR-002', '005/FR-005', '005/FR-007'],
    journey: 'power/reflow',
    axe: true,
    assertions: [
      'every band, consumer, scenario and capacitor field is drawn at every width',
      '400% zoom and a short viewport select the stacked arrangement rather than scrolling sideways',
      'a doubled text size loses no figure and never scrolls the document horizontally',
      'an expanded translation keeps every figure, and formatting never alters a package number',
      'a mirrored direction mirrors the layout, never a figure or its unit',
      'removing motion removes no state: every condition is still reported by its own control',
    ],
    manualRecord: 'actual-zoom',
  },
  {
    surfaceId: 'build/defence-analysis-shields',
    requirements: ['006/FR-001', '006/FR-002', '006/SC-001', '006/SC-002'],
    journey: 'defence/analysis',
    axe: true,
    assertions: [
      'the DEFENCE mode retitles the region and replaces the plates with the two cards',
      'the shield headline is the package strength, named by the generator the package resolved',
      'each of the four damage types pairs its own resistance with its own effective pool',
      'the RESIST and MJ columns are the bare shield, and a pip moving leaves every figure in them',
      'the fifth column is that pool at the standing allocation, headed with the count it was read at',
      'a bar is decoration over a stated scale: every figure it draws is set beside it in text',
      'each row reads type, bar, resistance, pool and the pool at pips, and every block is ruled off',
      'every figure is set flush to the end of its own column, so a column reads down its length',
      'a weakness keeps the danger ink on its figures as well as the hatch on its bar',
      'a weakness runs back from the zero mark of the scale its own table states',
      'the scale is the bar column own width, and names zero at the mark on a signed table',
      'the metric cells are set apart by their gaps, with no box drawn around the grid',
    ],
    manualRecord: 'screen-reader',
  },
  {
    surfaceId: 'build/defence-analysis-unavailable',
    requirements: ['006/FR-003', '006/SC-002'],
    journey: 'defence/unavailable',
    axe: true,
    assertions: [
      'a refused shield states the reason the package gave for it',
      'one reason refusing the strength and the recovery alike is stated once, not under both',
      'a generator that is not fitted and one switched off read as two different reasons',
      'no damage table, no source rows and no headline figure stand in for a refused result',
      'the armour card stays complete while the shield card is unavailable',
    ],
    manualRecord: 'screen-reader',
  },
  {
    surfaceId: 'build/defence-analysis-recovery',
    requirements: ['006/FR-004', '006/FR-005', '006/SC-002'],
    journey: 'defence/analysis',
    axe: true,
    assertions: [
      'the recharge rate and both recovery durations are three separate readings',
      'the allocation the power dashboard is set to is the allocation the recovery is read at',
      'a phase that never finishes is said in words, never drawn as a very large duration',
      'an unbounded effective pool is said in words, never clamped to a number',
      'recovery is refused on its own terms: a complete shield keeps its figures either way',
    ],
    manualRecord: 'screen-reader',
  },
  {
    surfaceId: 'build/defence-analysis-banks',
    requirements: ['006/FR-006'],
    journey: 'defence/analysis',
    axe: true,
    assertions: [
      'no bank fitted draws no reserve line at all, rather than a zero',
      'the reserve figure is the package total, with every bank aboard listed under it',
      'banks differing in module, cells, reinforcement or power are listed apart from each other',
      'banks with nothing switched on keep the line and say unpowered in words',
      'the reserve and every bank under it share one scale and one set of columns',
    ],
    manualRecord: 'screen-reader',
  },
  {
    surfaceId: 'build/defence-analysis-armour',
    requirements: ['006/FR-007', '006/FR-008', '006/SC-001'],
    journey: 'defence/analysis',
    axe: true,
    assertions: [
      'the hull headline is the package hit points, named by the bulkhead the package resolved',
      'the four armour damage rows read in hull points rather than megajoules',
      'hardness, module protection and module armour are three facts and no fourth',
      'the hull card stays whole when the shield result is unavailable',
      'every hull figure is set flush to the end of its own column',
    ],
    manualRecord: 'screen-reader',
  },
  {
    surfaceId: 'build/defence-analysis-sources',
    requirements: ['006/FR-009', '006/SC-003'],
    journey: 'defence/analysis',
    axe: true,
    assertions: [
      'each source row is named by the package identity of what it stands for, and counted',
      'a group of unlike modules is named by its role rather than by one of its members',
      'the aggregate the package published closes the row and is never divided among slots',
      'no source row is a control, because the canvas draws no action in this block',
    ],
    manualRecord: 'screen-reader',
  },
  {
    surfaceId: 'build/defence-analysis-rail',
    requirements: ['006/FR-002', '006/FR-007'],
    journey: 'defence/rail',
    axe: true,
    assertions: [
      'the block carries the same two pools the cards carry, and no third figure',
      'a refused result reads as unavailable rather than as a blank or a zero',
      'the block holds no control',
    ],
    manualRecord: 'screen-reader',
  },
  {
    surfaceId: 'build/defence-analysis-reflow',
    requirements: ['006/FR-002', '006/FR-005', '006/FR-007'],
    journey: 'defence/reflow',
    axe: true,
    assertions: [
      'both cards are complete at every width: no field is dropped for a narrow one',
      '400% zoom and a short viewport stack the pair rather than scrolling sideways',
      'a doubled text size loses no figure and never scrolls the document horizontally',
      'an expanded translation keeps every figure, and formatting never alters a package number',
      'a mirrored direction mirrors the layout, never a figure or its unit',
      'removing motion removes no state: every reading is still there in text',
    ],
    manualRecord: 'actual-zoom',
  },
  {
    surfaceId: 'build/offence-analysis-damage',
    requirements: ['007/FR-001', '007/FR-002', '007/FR-003', '007/FR-009', '007/SC-001'],
    journey: 'offence/damage',
    axe: true,
    assertions: [
      'the OFFENCE mode retitles the region and draws the panel where the plates were',
      'burst and sustained damage per second are named in full, neither left to be inferred',
      'a conventional type the build does not deal takes no segment, no line and no stated zero',
      'the stacked bar carries one segment per conventional type the build deals, and anti-xeno none',
      'every segment’s own amount and share are written in the legend beside the bar',
      'no combined anti-xeno total, resistance result or target figure appears anywhere on the panel',
    ],
    manualRecord: 'screen-reader',
  },
  {
    surfaceId: 'build/offence-analysis-weapons',
    requirements: ['007/FR-002', '007/FR-004', '007/FR-005', '007/FR-008', '007/SC-002'],
    journey: 'offence/weapons',
    axe: true,
    assertions: [
      'one row per returned weapon in exact package order, with no sort and no duplicate-symbol merge',
      'the canvas’s six columns carry the module, its burst and sustained damage per second, its piercing, its maximum range and its falloff',
      'the aligned table divides its width between all six columns, so no figure column is squeezed to its digits beside an empty module track',
      'the table is promoted only where every column head fits its own column, in either language, and the module name is never squeezed to make room',
      'an absent piercing, maximum range or falloff reads as field-specific not-stated text, never as a zero',
      'a disabled weapon keeps its row and its own metrics while the package totals leave it out',
      'the row is inert as the canvas draws it: no disclosure, no action and no control inside it',
      'two mounts carrying the same module stay two rows, neither merged nor de-duplicated',
      'the four range bands weaken with distance, each stated in words as well as filled',
      'a confirmed-empty build says so in words, rather than by an empty list nobody explained',
    ],
    manualRecord: 'screen-reader',
  },
  {
    surfaceId: 'build/offence-analysis-capacitor',
    requirements: ['007/FR-006', '007/FR-007', '007/FR-009', '007/SC-003'],
    journey: 'offence/capacitor',
    axe: true,
    assertions: [
      'the two rates are shown in the package’s own megajoules per second, and the capacity in the game’s megawatts',
      'the WEP allocation the figures were read at is named beside them, and no pip control appears',
      'moving the allocation in POWER moves the recharge and the endurance and nothing else',
      'a recharge that keeps pace draws the symbol, with what it stands for said beside it',
      'an immediate drain and a zero capacity are stated with no cause attached to either',
      'the draw and the recharge share one scale and carry a bar; the capacity and the endurance do not',
    ],
    manualRecord: 'screen-reader',
  },
  {
    surfaceId: 'build/offence-rail',
    requirements: ['007/FR-002', '007/SC-004'],
    journey: 'offence/rail',
    axe: true,
    assertions: [
      'the DPS cell carries sustained damage per second, identical to the panel’s own figure',
      'a label and a bare figure: no unit, no second figure and no condition, as the canvas draws it',
      'the cell holds no control, and stands in the rail whichever mode the region has open',
      'an exact zero stands in the cell unqualified, because zero is an answer',
    ],
    manualRecord: 'screen-reader',
  },
  {
    surfaceId: 'build/offence-analysis-convergence',
    requirements: ['007/FR-010', '007/FR-011', '007/FR-012', '007/FR-013', '007/SC-004'],
    journey: 'offence/convergence',
    axe: true,
    assertions: [
      'the gunsight plate is hidden from assistive technology, and every mark is a sentence beside it',
      'each of the hull’s mounts is one dot where its shot lands, and the plate carries no text at all',
      'a hardpoint the build has not filled is drawn in the empty mount’s own ink and named as empty in words',
      'the mount the workspace has selected takes the plate’s third ink and is named as selected in its own sentence, and follows the ledger’s selection',
      'a shot beyond the plate’s field of view is left off the drawing rather than pinned to the frame, and is stated in words — at its true offset and angle — at that range exactly as at any other',
      'moving the target range moves every shot, and every sentence beside the plate with it',
      'the range control announces the distance as a Commander reads it, not as a bare number',
      'the block stops at the canvas’s own width instead of running the panel row, and nothing stands beneath the plate but the range',
      'a hull the gunsight catalogue does not place says so, rather than drawing part of its mounts',
    ],
    manualRecord: 'screen-reader',
  },
  {
    surfaceId: 'build/offence-analysis-reflow',
    requirements: ['007/FR-004', '007/FR-006', '007/SC-004'],
    journey: 'offence/reflow',
    axe: true,
    assertions: [
      'every total, damage type, weapon row, range band, capacitor field and convergence fact is drawn at every width',
      '400% zoom and a short viewport select the stacked arrangement rather than scrolling sideways',
      'a doubled text size loses no figure and never scrolls the document horizontally',
      'an expanded translation keeps every figure, and formatting never alters a package number',
      'a mirrored direction mirrors the layout, never a figure or its unit',
      'nothing user-facing appears that the canvas contract does not sanction',
    ],
    manualRecord: 'actual-zoom',
  },
  {
    surfaceId: 'build/drives-and-mass-cards',
    requirements: ['008/FR-001', '008/FR-002', '008/FR-003', '008/FR-008', '008/SC-001'],
    journey: 'drives/cards',
    axe: true,
    assertions: [
      'the DRIVES mode opens the two cards canvas 1c draws, each named by its own heading',
      'leaving the mode gives every mount back with its slot and accessible name unchanged',
      'the three loads the package publishes are drawn once each, never a fourth CURRENT row',
      'every load row carries the one figure the canvas puts on it: what this build jumps on it',
      'the whole tank and the jumps it makes are drawn once, in the legend under the ranges',
      'the card opens with the canvas’s own three cells: jump laden, jump unladen and mass lock',
      'the two jump cells are the ends of the list below them, so the head never disagrees with it',
      'the drive’s optimal mass and fuel per jump are drawn as package facts, with the whole tank',
      'the legend under the ranges is the canvas’s three rows, whatever else the build carries',
      'each card names the fitted module by its class and blueprint, and never repeats its name',
      'the SCO badge stands on the card’s own rule beside the words it qualifies, not on a line of its own',
      'both cards rule their blocks off each other with the canvas’s own hairlines',
    ],
    manualRecord: 'screen-reader',
  },
  {
    surfaceId: 'build/drives-and-mass-mass-split',
    requirements: ['008/FR-007', '008/SC-002', '008/SC-004'],
    journey: 'drives/mass-split',
    axe: true,
    assertions: [
      'the headline mass is the package’s own total for the load the card names, never a local sum',
      'the position on the thruster curve is stated beside it, as a share of the module’s optimal mass',
      'each of the three legend rows carries its own package figure and its own bar segment',
      'the bar is additive: the three parts are laid end to end on one track that ends at the maximum',
      'the optimal mass is marked on that same track, and both marks are written out under the bar',
      'each mark is written under the position it marks: the optimal on its tick, the maximum at the end',
      'each legend row runs the canvas’s qualifier in beside its name, with the figure at the row’s end',
      'the modules segment is the package’s split, never a total summed from the fitted modules (FR-007)',
      'the SCO badge is drawn only for a drive the catalogue marks, and never inferred from a symbol',
      'a translated page states the same package digits under different words',
    ],
    manualRecord: 'screen-reader',
  },
  {
    surfaceId: 'build/drives-and-mass-mobility',
    requirements: ['008/FR-004', '008/FR-005', '008/FR-006', '008/SC-003'],
    journey: 'drives/mobility',
    axe: true,
    assertions: [
      'the five readings the canvas draws come from one mobility result, each with its own unit',
      'the readings follow the ENG allocation, and are re-read from the package when it moves',
      'boost does not follow the allocation: neither result borrows a figure the other publishes',
      'an unavailable reading draws the package’s own issues and no hull catalogue speed',
      'a switched-off mount reads as off rather than as absent, and keeps its curve marks',
      'every bar is aria-hidden decoration with the package’s number beside it in text',
    ],
    manualRecord: 'screen-reader',
  },
  {
    surfaceId: 'build/drives-rail',
    requirements: ['008/FR-009', '008/SC-001'],
    journey: 'drives/rail',
    axe: true,
    assertions: [
      'the JUMP, SPEED and MASS cells follow DPS in the rail’s cell grid, in the canvas’s order',
      'the cells are one grid two columns wide, so DPS and JUMP share the row the canvas puts them on',
      'the amber ground reaches exactly as far as the cells do, ruling them off through its gaps and nowhere else',
      'each cell carries the figure the DRIVES cards carry, at the same load and the same precision',
      'each figure is named with its own unit, and the cells hold no control',
      'the cells stand in the rail whichever mode the anatomy region has open',
      'an unavailable reading states so rather than standing the cell at zero',
    ],
    manualRecord: 'screen-reader',
  },
  {
    surfaceId: 'build/drives-and-mass-offline',
    requirements: ['008/FR-001', '008/SC-001'],
    journey: 'product/offline-privacy',
    axe: false,
    assertions: [
      'both cards draw every reading with no network at all, from the loadout already in memory',
      'changing the ENG allocation and coming back re-reads the envelope with the network still gone',
    ],
    manualRecord: null,
  },
  {
    surfaceId: 'build/drives-and-mass-reflow',
    requirements: ['008/SC-001'],
    journey: 'drives/reflow',
    axe: true,
    assertions: [
      'every mass row, envelope row, range row and drive fact is drawn at every width',
      '400% zoom and a phone select the stacked arrangement rather than scrolling sideways',
      'a doubled text size loses no reading and never scrolls the document horizontally',
      'the mass bar’s optimal and maximum marks stay on one line and never paint over each other',
      'an expanded translation keeps every reading, and formatting never moves a package digit',
      'a mirrored direction mirrors the layout, never a figure or its unit',
      'removing motion removes no reading: nothing was only reachable through a transition',
    ],
    manualRecord: 'actual-zoom',
  },
  // -------------------------------------------------------------------------
  // Feature 012: help, licences and provenance
  //
  // One modal and one frame entry, so the surfaces are few and the evidence is
  // mostly about content being true rather than about a screen being present.
  // The exhaustive per-capability route set FR-011 requires is not here — it is
  // `helpRouteCoverage` below, which is a different shape because it answers a
  // different question.
  // -------------------------------------------------------------------------
  {
    surfaceId: 'frame/help-entry',
    requirements: ['012/FR-001', '012/FR-002', '012/FR-011'],
    journey: 'product/help',
    axe: true,
    assertions: [
      'the frame carries the entry in the wide banner row and in the folded action layer, and nowhere else',
      'no capability, package-backed surface or layer offers a help control or a legal body of its own',
      'opening and closing leaves the route, fragment, history length, build and stored records unchanged',
      'opening fetches nothing: no route chunk, no document, nothing off this origin',
      'every row of the release coverage ledger reaches the modal, an obscured one from the capability beneath',
      'the wide bar draws the entry as the reference’s mark and the folded layer draws it in words, both named the same',
      'every entry of the folded action layer stays inside the viewport at 200% text',
    ],
    manualRecord: 'screen-reader',
  },
  {
    surfaceId: 'help/about',
    requirements: ['012/FR-007', '012/FR-008', '012/SC-002'],
    journey: 'product/help',
    axe: true,
    assertions: [
      'the two versions equal the shipped root and installed manifests exactly',
      'they are two separately labelled facts with distinct terms, never one run-together line',
      'there is no third fact: nothing in the modal names a release classification or a build id',
      'no label calls either value the live game or the live catalogue version',
      'the section reads three sentences before the facts: what this is, who maintains it, and where the source is',
      'the source sentence carries the audited repository address inside its own words, and claims no currency with the live game',
      'long identities wrap within the measure rather than scrolling the modal sideways',
    ],
    manualRecord: 'screen-reader',
  },
  {
    surfaceId: 'help/faq',
    requirements: ['012/FR-010', '012/SC-003'],
    journey: 'product/help',
    axe: true,
    assertions: [
      'both accepted topics are present exactly once, in the declared order',
      'no withdrawn topic returns: nothing asks about share links, accounts, offline, hull facts or where values come from',
      'each question is a heading over its own answer, nested under the FAQ section’s own heading',
      'no answer carries a raw key, a blank value, an unresolved interpolation or markup',
      'neither reference claim this application cannot support appears: no import promise, no retained partial roll',
      'no governing requirement or principle id reaches the browser',
    ],
    manualRecord: 'screen-reader',
  },
  {
    surfaceId: 'help/licence',
    requirements: ['012/FR-003', '012/FR-004', '012/FR-005', '012/FR-006', '012/SC-001'],
    journey: 'product/help',
    axe: true,
    assertions: [
      'the rendered disclaimer is byte-identical to a fresh generator extraction of root LICENSE',
      'it is text content inside a region carrying its own lang, never innerHTML, Markdown or a frame',
      'the four-line summary of what covers what opens the section, localised',
      'one legal body and no other: no MIT text, no Almanac licence, no third-party notices',
      'the modal draws exactly the three audited links, no popup and nothing else that navigates out of the application',
      'the excerpt wraps within the measure and is never clipped or truncated',
    ],
    manualRecord: 'screen-reader',
  },
  {
    surfaceId: 'help/offline',
    requirements: ['012/FR-001', '012/SC-004'],
    journey: 'product/help-offline',
    axe: false,
    assertions: [
      'after one completed online load and with the network disabled, the modal opens complete',
      'all three ABOUT sentences, both version facts, both topics in order and the exact disclaimer are all present',
      'no request is made and there is no loading, missing or stale state to be in',
    ],
    manualRecord: null,
  },
  {
    surfaceId: 'help/reflow-and-motion',
    requirements: ['012/FR-001', '012/SC-005'],
    journey: 'product/help',
    axe: true,
    assertions: [
      'the closed background and every open state pass an accessibility scan in all ten projects',
      'the other shipped locale translates every owned string and leaves the excerpt in its own language',
      'at 200% text and actual 400% zoom every section stays reachable and the document never scrolls sideways',
      'removing motion removes no reading, and open and closed stay textual facts rather than appearances',
      'the modal’s only control is its close, and nothing depends on colour, icon, shape or placement',
      'the first complete frame is presented within 100 ms on a fourfold-throttled phone',
    ],
    manualRecord: 'actual-zoom',
  },
  // ---------------------------------------------------------------------------
  // 014 — the start page. The product's own address, which used to be a
  // redirect into the ship tool.
  // ---------------------------------------------------------------------------
  {
    surfaceId: 'start/tool-selector',
    requirements: [
      '014/FR-001',
      '014/FR-002',
      '014/FR-003',
      '014/FR-004',
      '014/FR-005',
      '014/FR-006',
      '014/SC-001',
      '014/SC-002',
      '014/SC-004',
    ],
    journey: 'start/choose-a-tool',
    axe: true,
    assertions: [
      'the product address answers with a choice of tools rather than with one of them',
      'the masthead names the product and the line beneath says what it is for',
      'every tool the registry holds is offered, and each states its subjects and what it does',
      'a tool entry is a link carrying its own address, so it opens in a new tab and copies',
      'the entry point and the tool bar are drawn from one registry, so neither can gain a tool alone',
    ],
    manualRecord: 'screen-reader',
  },
  {
    surfaceId: 'start/address',
    requirements: ['014/FR-007', '014/FR-008', '014/FR-009', '014/FR-016', '014/SC-007'],
    journey: 'start/choose-a-tool',
    axe: true,
    assertions: [
      'opening a tool leaves the entry point in history, so back returns to the choice',
      'an address that resolves to nothing lands at the entry point, not inside a tool',
      'every address that did resolve still opens directly, a link fragment included',
      'the root publishes a document title and a description of its own, in the committed language',
    ],
    manualRecord: null,
  },
  {
    surfaceId: 'start/no-current-tool',
    requirements: ['014/FR-010', '014/FR-011'],
    journey: 'start/choose-a-tool',
    axe: true,
    assertions: [
      'the bar marks no tool as current, because a Commander here is in none of them',
      'the shell actions carry over unchanged, and the screen publishes none of its own',
    ],
    manualRecord: 'screen-reader',
  },
  {
    surfaceId: 'start/tool-card-composition',
    requirements: ['014/FR-017', '014/FR-018', '014/FR-019', '014/SC-003', '014/SC-008'],
    journey: 'start/choose-a-tool',
    axe: true,
    assertions: [
      'exactly one of a tool’s two descriptions is on screen at every viewport, never both and never neither',
      'the subject list travels with the fuller form and the go mark with the shorter one',
      'which form is shown follows the composition modes the application already names',
      'the choice of tools is reachable without scrolling at desktop and tablet, and the first tool on a phone',
    ],
    manualRecord: 'screen-reader',
  },
  {
    surfaceId: 'start/attribution',
    requirements: ['014/FR-012'],
    journey: 'start/choose-a-tool',
    axe: true,
    assertions: [
      'the notice is the help manifest’s exact text, ending in the words the licence file ends in',
      'it is marked in the language it was written in rather than the interface’s',
      'it takes the width the band has rather than a prose measure, and fits on one line where there is room',
    ],
    manualRecord: 'screen-reader',
  },
  {
    surfaceId: 'start/responsive-and-localised',
    requirements: ['014/FR-013', '014/FR-014', '014/FR-015', '014/SC-005', '014/SC-006'],
    journey: 'start/choose-a-tool',
    axe: true,
    assertions: [
      'the document never scrolls sideways, at 200% text and at actual 400% zoom',
      'every owned string resolves in the other shipped locale, with no key and no placeholder on screen',
      'text expansion and a right-to-left script leave nothing truncated to ambiguity',
      'the accessibility scan reports no in-scope violation in any of the ten projects',
    ],
    manualRecord: 'actual-zoom',
  },
  // ---------------------------------------------------------------------------
  // 015 — prerendered documents. No screen of its own: it changes *when* three
  // existing screens are rendered, so its rows are those screens' first frames
  // and the gates that hold them to the package.
  // ---------------------------------------------------------------------------
  {
    surfaceId: 'prerendered/advertised-address',
    requirements: [
      '015/FR-001',
      '015/FR-002',
      '015/FR-003',
      '015/FR-004',
      '015/FR-005',
      '015/FR-018',
      '015/SC-001',
      '015/SC-002',
    ],
    journey: 'product/published-address',
    axe: false,
    assertions: [
      'every advertised address answers from its own file, with no redirect and no directory',
      'a hull’s document states its manufacturer, speed, shield, mass, crew, mass lock and mounts, with no script run',
      'each figure is the pinned package’s own value, presented rather than re-derived',
      'the head every address had before this feature — title, description, canonical, card — is unchanged',
      'the two benches are advertised, keep their head, and state nothing, which is a ruling rather than an oversight',
    ],
    manualRecord: null,
  },
  {
    surfaceId: 'prerendered/first-frame',
    requirements: [
      '015/FR-008',
      '015/FR-009',
      '015/FR-009a',
      '015/FR-010',
      '015/FR-011',
      '015/FR-011a',
      '015/FR-012',
      '015/SC-003',
      '015/SC-004',
      // The last journey opens the address the build wrote no document for, and
      // reads the screen the application resolves it into.
      '015/FR-015',
      '015/FR-016',
      // What the address served is held until a screen replaces it, read on the
      // same failure this journey holds for the statement beside it.
      '023/FR-001',
    ],
    journey: 'product/prerendered-first-frame',
    axe: true,
    assertions: [
      'the document states its subject to a reader that runs no script at all',
      'it states it in a frame the application has not reached yet, which is the whole of what changed',
      'no frame between the document arriving and the takeover holds less than the frame before it',
      'the boxes content is laid out inside do not move across the takeover, on either engine',
      'a stored catalogue view lands in the takeover frame itself, and a Commander with none sees no change at all',
      'a German Commander’s words are replaced without anything being reordered or removed',
      'the one thing German adds is the note beside each name English has nothing to disclose about',
      'a Commander whose bundle never arrives is left with the readable document',
      'a Commander whose first screen never arrives is left on the document that address served, with the failure stated beside it and nothing moved',
      'held content stays in the bundled English it was served in, with no translation and no disclosure written into it',
      'held content states the language it is in, which is not the one the running application presents',
      'held content stands in the box it was served in, at the catalogue and at the entry point, where the screen fills the window',
      'the failure is stated where it can be read, over nothing the Commander was given',
      'a document with no rendered body is not taken over until the application has drawn the screen',
    ],
    manualRecord: 'screen-reader',
  },
  {
    surfaceId: 'prerendered/first-frame-accessibility',
    requirements: ['015/FR-019', '015/SC-005'],
    journey: 'product/prerendered-first-frame',
    axe: true,
    assertions: [
      'the generated frame is scanned before the application has touched it, across all ten projects',
      'exactly one h1 is rendered and it names the address’s subject, with no CSS and no script',
      'html[lang] and dir are correct for bundled English before any locale is committed',
    ],
    manualRecord: 'screen-reader',
  },
  {
    surfaceId: 'prerendered/returning-and-unmatched',
    requirements: [
      '015/FR-013',
      '015/FR-014',
      '015/FR-015',
      '015/FR-016',
      '015/SC-006',
      '015/SC-007',
    ],
    journey: 'product/offline',
    axe: false,
    assertions: [
      'a returning Commander with a network is served the address they asked for, never the start page',
      'an address no document was generated for is resolved by the application, offline included',
      'the navigation fallback states nothing, so no address is ever answered with another’s content',
      'every offline journey that passed before this feature passes unchanged',
    ],
    manualRecord: null,
  },
  {
    surfaceId: 'prerendered/what-a-document-may-not-carry',
    requirements: [
      '015/FR-006',
      '015/FR-007',
      '015/FR-017',
      '015/FR-020',
      '015/FR-021',
      '015/SC-008',
      '015/SC-009',
    ],
    journey: 'product/published-address',
    axe: false,
    assertions: [
      'no document carries a build, a saved record, a browsing session, a machine’s address or the application version',
      'a build stays in the fragment, so no part of one is in a path or a query',
      'every generated document is checked against the pinned package by a gate that has been watched to fail',
      'which addresses are content-bearing is recorded once and reconciled against what the builder was told to render',
      'a pin move that changes the hull set changes the generated set with no hand edit',
    ],
    manualRecord: null,
  },
  {
    surfaceId: 'shell/navigation-waiting',
    requirements: ['018/FR-001', '018/FR-002', '018/FR-003', '018/FR-004', '018/FR-005'],
    journey: 'shell/navigation-waiting',
    axe: true,
    assertions: [
      'a navigation that has to fetch its screen states that it is waiting, over the screen it was pressed from',
      'the mark is centred in the viewport on a translucent ground, at every profile',
      'it holds up at 200% text and 400% zoom, read in the reflow journey',
      'the statement is a modal dialog, so the screen behind takes no press and no focus and is absent from the accessibility tree',
      'it carries no control',
      'it states no proportion, percentage, remaining time or step count, and refuses the native cancel, read in the component tests',
      'the same statement answers every address, and one stands at a time',
      'a statement passes to the navigation taking over from the one it replaced, drawn once across both',
      'it comes down when what takes over is answered without navigating, where nothing else would',
      'the drawn statement carries no transition and no animation, read from a real engine',
      'a screen whose code the browser already holds changes the screen with nothing drawn',
      'it stands in front of a layer the Commander already had open',
      'it comes down when the screen arrives and when the code never does',
      'it comes down for a navigation cancelled with nothing taking over, read in the store tests',
    ],
    manualRecord: 'screen-reader',
  },
  {
    surfaceId: 'shell/navigation-waiting-spoken',
    requirements: ['018/FR-006', '011/FR-010', '011/FR-013'],
    journey: 'shell/navigation-waiting',
    axe: true,
    assertions: [
      'the statement is named by a sentence saying the application is waiting, in the reading language',
      'the mark is exposed as decoration rather than announced as a picture, read in the component tests',
      'the mark carries its own reduced-motion rule, which a policy rule holds in the asset',
    ],
    manualRecord: 'screen-reader',
  },
  {
    surfaceId: 'shell/navigation-failed',
    requirements: ['018/FR-007', '011/FR-009'],
    journey: 'shell/navigation-waiting',
    axe: true,
    assertions: [
      'a screen whose code cannot be fetched is stated, and the words stay on the page to be re-read',
      'it is announced once, politely, because nothing is blocked',
      'a second failure changes the region carrying it, though it says the same sentence as the first',
      'no reason is stated that the application does not have',
      'a cancelled or redirected navigation is stated as nothing',
      'the Commander is left on a screen they can use, and the next screen that opens takes the notice down',
      'a version notice and a failed navigation stand together, the version notice first, read in the shell tests and drawn as a preview state',
    ],
    manualRecord: 'screen-reader',
  },
  {
    surfaceId: 'system/first-frame-typefaces',
    requirements: ['019/FR-001'],
    journey: 'product/published-address',
    axe: false,
    assertions: [
      'each address this journey serves applies its stylesheet before it paints, with no media query holding it back',
      'each of them asks for a face of every family that stylesheet declares, relatively and in anonymous mode',
      'every face one of them asks for is a face the same deployment serves',
      'each of them, opened with the bundle held, is drawn in no face it did not ask for',
    ],
    manualRecord: null,
  },
  {
    surfaceId: 'shell/navigation-waiting-first-frame',
    requirements: ['018/FR-008'],
    journey: 'product/published-address',
    axe: false,
    assertions: [
      'no generated document carries the overlay or the sentence it would speak',
      'no statement is drawn over the first presentation of a session, at any address',
      'a first navigation that fails is stated like any other, with nothing drawn over the presentation it failed on',
      'the watch that reads all of the above is shown reading, on a generated document, where the statement does stand',
    ],
    manualRecord: null,
  },
];

/** Every requirement id the ledger currently evidences. */
export function registeredRequirementIds(
  ledger: readonly CoverageEntry[] = COVERAGE_LEDGER,
): ReadonlySet<string> {
  return new Set(ledger.flatMap((entry) => entry.requirements));
}

// ---------------------------------------------------------------------------
// Feature 012: the release coverage ledger for the Help · About route
// ---------------------------------------------------------------------------

/**
 * How FR-001's route presents itself while a surface is on screen.
 *
 * `obscured` is not a gap. A layer that covers the frame is dismissible, and
 * help is reached from the capability beneath once it is dismissed — which is
 * what 012/FR-011 requires there, rather than a second route inside the layer.
 */
export type HelpFrameEntry = 'visible' | 'obscured';

/** One row of feature 012's release coverage ledger. */
export interface HelpRouteRow {
  /** Stable identity, used by the journey to name what it is opening. */
  readonly id: string;
  /** The surface as the screen inventory names it. */
  readonly surface: string;
  /** The feature that owns the surface, not the one that owns this ledger. */
  readonly owner: string;
  readonly frameEntry: HelpFrameEntry;
  readonly requirements: readonly string[];
}

/**
 * Every capability, package-backed surface and obscuring layer this
 * application currently ships.
 *
 * Transcribed one row at a time from the Release coverage ledger in
 * `openspec/changes/archive/012-help-and-licences/design/screen-inventory.md`; it is not
 * re-derived here. `scripts/check-specification-record.mjs` reconciles the two
 * in both directions, so the suite below reads these rows and never the
 * document. A row is added whenever a feature adds a capability, a
 * package-backed surface or a layer that covers the frame.
 *
 * This export is the only part of this file feature 012 owns. Feature 011's
 * preview-catalogue entries are the single recorded exclusion from the Release
 * coverage ledger, which is why they appear elsewhere in this file and not
 * here; entries other features seeded describe their own requirements and are
 * neither expected in that ledger nor a finding when absent from it.
 */
export const helpRouteCoverage: readonly HelpRouteRow[] = [
  {
    id: 'hull-catalogue',
    surface: 'Hull catalogue /ships',
    owner: '001',
    frameEntry: 'visible',
    requirements: ['012/FR-001', '012/FR-002', '012/FR-011'],
  },
  {
    id: 'hull-detail',
    surface: 'Hull detail /ships/:hull',
    owner: '001',
    frameEntry: 'visible',
    requirements: ['012/FR-001', '012/FR-002', '012/FR-011'],
  },
  {
    id: 'build-workspace',
    surface: 'Build workspace /outfitting, including no-build',
    owner: '001',
    frameEntry: 'visible',
    requirements: ['012/FR-001', '012/FR-011'],
  },
  {
    // Obscured since 2026-08-25: the library is drawn as the reference draws it,
    // a framed layer over the screen it was opened from, so help is reached
    // from the capability beneath once the layer is dismissed.
    id: 'build-library',
    surface: 'Build library layer',
    owner: '001',
    frameEntry: 'obscured',
    requirements: ['012/FR-001', '012/FR-011'],
  },
  {
    id: 'save-build-layer',
    surface: 'Save-build layer',
    owner: '001',
    frameEntry: 'obscured',
    requirements: ['012/FR-011'],
  },
  {
    id: 'library-delete-confirmation',
    surface: 'Build-library delete confirmation',
    owner: '001',
    frameEntry: 'obscured',
    requirements: ['012/FR-011'],
  },
  {
    id: 'outfitting-ledger',
    surface: 'Outfitting workspace ledger',
    owner: '002',
    frameEntry: 'visible',
    requirements: ['012/FR-002'],
  },
  {
    id: 'module-replacement-layer',
    surface: 'Module replacement layer',
    owner: '002',
    frameEntry: 'obscured',
    requirements: ['012/FR-002', '012/FR-011'],
  },
  {
    id: 'engineering-editor-layer',
    surface: 'Engineering editor layer',
    owner: '002',
    frameEntry: 'obscured',
    requirements: ['012/FR-002', '012/FR-011'],
  },
  {
    // Reported inside the layer the payload was pasted into: a refusal is a
    // whole-candidate outcome, so there is no workspace state to report it on.
    id: 'normalisation-refusal',
    surface: 'Incoming-build normalisation refusal',
    owner: '002',
    frameEntry: 'obscured',
    requirements: ['012/FR-011'],
  },
  {
    id: 'status-rail',
    surface: 'Status rail',
    owner: '003',
    frameEntry: 'visible',
    requirements: ['012/FR-002', '012/FR-008'],
  },
  {
    id: 'import-layer',
    surface: 'Import Build layer',
    owner: '004',
    frameEntry: 'obscured',
    requirements: ['012/FR-011'],
  },
  {
    id: 'export-layer',
    surface: 'Export Build layer',
    owner: '004',
    frameEntry: 'obscured',
    requirements: ['012/FR-011'],
  },
  {
    id: 'import-outcome',
    surface: 'Import Outcome disclosure',
    owner: '004',
    frameEntry: 'visible',
    requirements: ['012/FR-011'],
  },
  {
    id: 'power-and-thermals',
    surface: 'Power and Thermals',
    owner: '005',
    frameEntry: 'visible',
    requirements: ['012/FR-002', '012/FR-008'],
  },
  {
    id: 'defence-analysis',
    surface: 'Defence Analysis',
    owner: '006',
    frameEntry: 'visible',
    requirements: ['012/FR-002', '012/FR-008'],
  },
  {
    id: 'offence-analysis',
    surface: 'Offence Analysis',
    owner: '007',
    frameEntry: 'visible',
    requirements: ['012/FR-002', '012/FR-008'],
  },
  {
    id: 'drives-and-mass',
    surface: 'Drives and Mass',
    owner: '008',
    frameEntry: 'visible',
    requirements: ['012/FR-002', '012/FR-008'],
  },
  {
    id: 'cost-and-materials',
    surface: 'Cost and Materials blocks',
    owner: '009',
    frameEntry: 'visible',
    requirements: ['012/FR-002', '012/FR-008'],
  },
  {
    id: 'hull-anatomy',
    surface: 'Hull Anatomy plates and mount facts',
    owner: '010',
    frameEntry: 'visible',
    requirements: ['012/FR-002', '012/FR-008'],
  },
  {
    id: 'hull-anatomy-side-state',
    surface: 'Hull Anatomy side availability/defect state',
    owner: '010',
    frameEntry: 'visible',
    requirements: ['012/FR-011'],
  },
  {
    id: 'application-frame',
    surface: 'Application frame',
    owner: '011',
    frameEntry: 'visible',
    requirements: ['012/FR-001'],
  },
  {
    id: 'feedback-host',
    surface: 'Global feedback/announcement host',
    owner: '011',
    frameEntry: 'visible',
    requirements: ['012/FR-011'],
  },
];
