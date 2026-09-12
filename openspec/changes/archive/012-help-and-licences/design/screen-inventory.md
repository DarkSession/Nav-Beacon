# Screen Inventory: Help, Licences and Provenance

Feature 012 adds one modal layer and one entry action on the application frame. It adds no route, no
standalone page and no per-surface control. Both compose the shared feature 011 design system.

## Inventory

| Surface                      | Kind                   | Appears in                                                            | Purpose                                                   |
| ---------------------------- | ---------------------- | --------------------------------------------------------------------- | --------------------------------------------------------- |
| Application-frame Help entry | persistent embedded UI | every capability and no-build state, wide row and folded action layer | opens the shared modal without navigation                 |
| Help · About modal           | shared modal layer     | above the current capability                                          | presents ABOUT, FAQ and LICENCE, and no other destination |

The application frame owns the single modal instance and the single entry. A capability may not embed
a private modal, legal copy, help destination or entry control of its own.

**No contextual entry exists.** The design reference draws a `?` control in the wide command bar and
a spelled-out item in the narrow action menu — both of which ship as drawn — and draws no help
control on any other surface across all four of its canvases — including the outfitting ledger, the anatomy plates and the status rail.
The frame surrounds every capability, so the frame's action is the route from all of them.

## Requirement mapping

| Requirement | Application-frame entry | Help · About modal                                                                | Build/source-distribution gate   |
| ----------- | ----------------------- | --------------------------------------------------------------------------------- | -------------------------------- |
| FR-001      | global/no-build access  | in-place, eager, offline dialog                                                   | initial-bundle assertion         |
| FR-002      | the single access route | common provenance/legal destination; no surface owns a copy                       | —                                |
| FR-003      | —                       | the five-line summary above one exact excerpt                                     | URL/text verification            |
| FR-004      | —                       | clearly separates MIT from package/Frontier rights                                | package-mirror equality          |
| FR-005      | —                       | renders the generated exact excerpt                                               | release fails on source mismatch |
| FR-006      | —                       | localised labels; excerpt marked in its own language                              | byte/hash verification           |
| FR-007      | —                       | separate application and Almanac versions in `ABOUT`                              | manifest identity checks         |
| FR-008      | —                       | no currency claim; who maintains it and where the source is, each once in `ABOUT` | wording/manifest tests           |
| FR-009      | —                       | _withdrawn — no package-defect action is rendered_                                | —                                |
| FR-010      | opens complete help     | both accepted topics in `FAQ`                                                     | catalogue completeness           |
| FR-011      | universal route         | complete common destination                                                       | inventory coverage check         |

Every live FR has at least one user-facing owner or release-gate owner. No requirement depends on a
standalone help page or on a per-surface control.

## Shared states

| Surface     | Required states                                                                             |
| ----------- | ------------------------------------------------------------------------------------------- |
| Frame entry | wide row action, folded action-layer item, no-build, active-build, translated/expanded, RTL |
| Modal       | offline, alternate locale, RTL, expanded text, reduced motion, 200% text, 400% zoom         |

There is no runtime loading, missing-disclaimer, destination-error or stale-artifact state. Those
conditions fail generation/release. There is no release/non-release state either: the generator
still classifies the build, but FR-007's display half is withdrawn and the modal says nothing about
it.

## Accessibility, responsive and localisation baseline

These are inherited obligations, not new requirements. They are governed by feature 011's accepted
FR-011 (available on desktop, tablet and mobile in portrait and landscape), FR-012 (in-scope
contrast and target size), FR-015 (conformance statements name the excluded criteria) and FR-021
(every primary journey runs at three viewports in Chromium and Firefox), and by constitution
principles V, VI and VII. They are listed here so every task that exists to satisfy them maps to an
accepted requirement rather than to nothing.

- One `dialog` with modal semantics, a visible accessible name and an always-available close.
  **Corrected 2026-08-25:** the layer is a native `dialog` opened with `showModal()`, so the modality is the element's own `:modal` state. The attribute is not set and should not be: it would duplicate what the platform already says.

  The dialog is a nested landmark over the capability, never a replacement `main`.

- Semantic order is title, then `ABOUT`, `FAQ` and `LICENCE` — the reference's own order, the same at
  every viewport and in every locale.
- Wide viewports use a centered bounded modal; narrow viewports use a full-width sheet. Both
  are responsive states of one surface. The header stays pinned over a vertically scrolling body.
- At 200% text, actual 400% zoom and landscape phones every section and action stays reachable and
  the document has no horizontal overflow. The disclaimer wraps; it is never clipped or truncated.
- Every action meets feature 011's target-size token. Nothing essential depends on hover, motion,
  colour, icon, shape, dimming or placement; open and closed state is textual.
- `prefers-reduced-motion` makes the open and close transitions immediate without removing content.
- Owned labels and the licence summary resolve through feature 011 localisation and survive
  expansion and RTL. The Frontier excerpt stays in a `lang="en"` region and is never mirrored or
  translated.
- Conformance is reported qualified, naming excluded criteria 2.1.1, 2.1.2, 2.1.4, 2.2.1, 2.4.1, 2.4.3,
  2.4.7 and 2.4.11. An unqualified WCAG 2.2 AA claim is prohibited (feature 011 FR-015).
- The automated axe sweep is a floor. The manual assistive-technology protocol is the proof, and it
  is release-blocking until recorded.

## Cross-feature placement

- Feature 011's application frame contains the visible Help action and hosts the modal instance.
- Features 001–011 change nothing. There is no `ContextHelpLink` and no template of theirs is
  touched — the reciprocal-entry set an earlier revision of this document required is withdrawn.
- **One exception, 2026-08-25**, and it is a defect fix rather than an addition: feature 011's
  folded action layer hangs its panel off a trigger inside a sticky banner, so the panel cannot be
  scrolled into view — the document scrolls the screen underneath while the banner and everything
  anchored to it stay put. At 200% text on a phone the panel grew taller than the space below the
  banner, which put this feature's Help entry at y 873 in an 844-pixel viewport with no way to reach
  it. FR-001's only route was unavailable in a state a Commander can actually be in. The panel is now
  bounded to the viewport with its own scroller in `action-layer.scss`. No template changed and no
  help control was added anywhere; what changed is that every entry in that layer, this one included,
  can be pressed.
- **A second exception, 2026-08-25**, and it is a policy fix rather than a change of behaviour:
  `main`'s own fix for the sticky command bar (`3f9b574`) zeroes `--ednb-layout-bar-height` for a
  released frame, and it declared that token inside `app-frame.scss`. The constitution has tokens
  defined once and only in the token layer, and `check-interface-foundations.mjs` enforces it as
  `token-outside-source`; the rule turned `pnpm run policy` red the moment this branch rebased onto
  it. The declaration moved verbatim to `styles/tokens/_semantic.scss`, beside the token's own, as
  `ednb-app-frame.frame--released` — the frame already marks that state on its host element, so the
  selector reaches exactly what `:host(.frame--released)` reached. Nothing in the frame's behaviour
  changed and its end-to-end assertion still holds; what changed is that the layout decision lives
  in one place again.
- Feature 012 owns the entry action, the modal composition, the presenter, the topic catalogue and
  the artifact manifest.
- Feature 011 owns primitive dialog semantics, visible-name actions, tokens, localisation, previews
  and the cross-browser accessibility harness.

## Release coverage ledger

This is the exhaustive set required by FR-011. The `helpRouteCoverage` export inside feature 011's
shared `e2e/coverage-ledger.ts` transcribes it; it does not re-derive it, and it is the only part of
that file this feature owns. Every row is a current shipped capability, a package-backed artwork or
value surface named by an accepted screen contract, or a state that obscures the application frame.
The rows below 011 are entered by the features that ship them: this table is the register every
shipped surface is recorded in, which is why it is the one archived table a later change writes
into (`AGENTS.md`, Development Workflow). **Frame entry** records whether FR-001's route is visible in that
state; where a dismissible layer covers the frame, help is reached from the capability beneath once
the layer is dismissed, which is what FR-011 now requires in place of a substitute route. A missing
capability or applicable surface is a release failure; representative sampling is not sufficient.

| Capability / surface                              | Owner | Frame entry           | Applies                |
| ------------------------------------------------- | ----- | --------------------- | ---------------------- |
| Hull catalogue `/ships`                           | 001   | visible               | FR-001, FR-002, FR-011 |
| Hull detail `/ships/:hull`                        | 001   | visible               | FR-001, FR-002, FR-011 |
| Build workspace `/outfitting`, including no-build | 001   | visible               | FR-001, FR-011         |
| Build library layer                               | 001   | obscured, dismissible | FR-001, FR-011         |
| Save-build layer                                  | 001   | obscured, dismissible | FR-011                 |
| Build-library delete confirmation                 | 001   | obscured, dismissible | FR-011                 |
| Outfitting workspace ledger                       | 002   | visible               | FR-002                 |
| Module replacement layer                          | 002   | obscured, dismissible | FR-002, FR-011         |
| Engineering editor layer                          | 002   | obscured, dismissible | FR-002, FR-011         |
| Incoming-build normalisation refusal              | 002   | obscured, dismissible | FR-011                 |
| Status rail                                       | 003   | visible               | FR-002, FR-008         |
| Import Build layer                                | 004   | obscured, dismissible | FR-011                 |
| Export Build layer                                | 004   | obscured, dismissible | FR-011                 |
| Import Outcome disclosure                         | 004   | visible               | FR-011                 |
| Power and Thermals                                | 005   | visible               | FR-002, FR-008         |
| Defence Analysis                                  | 006   | visible               | FR-002, FR-008         |
| Offence Analysis                                  | 007   | visible               | FR-002, FR-008         |
| Drives and Mass                                   | 008   | visible               | FR-002, FR-008         |
| Cost and Materials blocks                         | 009   | visible               | FR-002, FR-008         |
| Hull Anatomy plates and mount facts               | 010   | visible               | FR-002, FR-008         |
| Hull Anatomy side availability/defect state       | 010   | visible               | FR-011                 |
| Application frame                                 | 011   | visible               | FR-001                 |
| Global feedback/announcement host                 | 011   | visible               | FR-011                 |
| Commander account dialog                          | 020   | obscured, dismissible | FR-001, FR-011         |
| Account-deletion confirmation                     | 020   | obscured, dismissible | FR-011                 |
| Owned ships layer                                 | 020   | obscured, dismissible | FR-011                 |
| Record conflict layer                             | 020   | obscured, dismissible | FR-011                 |

The four rows owned by feature 020 are the optional Commander account's own surfaces: the modal the
frame's account action raises, the question asked before an account is deleted, the ships a
Commander owns inside the stored-build layer, and the layer that asks what happens to a record the
account and this browser disagree about. Each covers the frame while it stands and each is
dismissible, so help is reached from the capability beneath — the route FR-011 requires there. The
account is not a behaviour topic: the fixed two-topic FAQ does not change, and what the account holds
is stated in the account dialog itself.

The **Applies** column carries this feature's requirement IDs; **Owner** carries the feature that
owns the surface. The application frame's own row records `visible` like any
other: it is the surface that draws the action, which the Owner column already says, and a third
frame-entry value describing the same availability would be one the transcription could not carry.

**Two rows corrected 2026-08-25**, by the two-way reconciliation rather than by reading: the
incoming-build normalisation refusal is reported inside the layer the payload was pasted into, so
the frame is obscured there and help is reached from the workspace once that layer is dismissed; and
the application frame's own entry was written as `owns the action`, which is the Owner column's
fact rather than this column's.

**Rows removed 2026-08-25**, each because the surface does not exist in the shipped application and a
ledger row for a surface nobody ships is drift in the other direction:

- ~~_Drives & Mass_ — feature 008 is unimplemented. The row is re-added with that feature.~~ **Re-added 2026-08-25**, when feature 008 landed on `main`: the anatomy region's `DRIVES` mode is a shipped surface, and it is in the ledger above.
- _Language selector layer_ — there is no such layer. The active locale is negotiated from the
  browser and a fallback is reported as ordinary frame status, so there is nothing to enumerate.
- _Exact-slot layer (narrow)_ — the narrow slot flow is the module-replacement layer already listed;
  a second row named it twice.

Three rows previously carried an FR-010 topic hint in a contextual-entry column. Topic hints and that
column are withdrawn with the contextual entry, so those rows now carry the frame route like every
other row and apply FR-011.

**Excluded, deliberately**: feature 011's component preview application. Feature 011 registers its
own preview-catalogue entries in the shared `e2e/coverage-ledger.ts`; those entries are outside
`helpRouteCoverage` and their absence here is this exclusion, not a reconciliation failure. It is
tooling-only, never appears in product navigation or production output, and is therefore not a
Commander-facing capability. It is the only exclusion, and it is recorded here so its absence from
the ledger reads as a decision rather than an omission.

A row is added whenever a feature adds a capability, package-backed surface or obscuring layer. This
table and the `helpRouteCoverage` export of `e2e/coverage-ledger.ts` are checked against each other
before release.

## Verification inventory

Automated journeys open the modal from every row of the [Release coverage
ledger](#release-coverage-ledger) and include at least:

1. a no-build hull-catalogue capability through the wide frame action;
2. an active workspace through the folded action-layer item;
3. a package artwork capability — hull detail, whose artwork region the frame surrounds; and
4. a package value capability — the outfitting ledger and status rail.

Each journey asserts one dialog instance, unchanged URL/build state, complete content, a working
close return, no automatic network request, that the modal itself offers only its three audited
destinations, and — FR-002's prohibition — that the row's own surface embeds no legal body and
offers no help or legal destination of its own. For an obscured row the
journey dismisses the layer first and then opens help from the capability beneath, which is the route
FR-011 requires there. The four classes above do not cap the ledger. All open states receive axe,
semantic and overflow checks in the complete Chromium/Firefox viewport-orientation matrix.
