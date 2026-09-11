<!--
Sync Impact Report (11.0.0)
- Version change: 10.0.0 -> 11.0.0 (MAJOR)
- Modified principles: I. Local-First with Optional Commander Services — permits an
  optional same-origin API, Frontier authentication and selected remote persistence while
  anonymous planning stays local and offline-capable. V. Works on Desktop, Tablet and
  Mobile — permits security credentials to expire without adding a user-interface time
  limit. VIII. Tested Before It Ships — applies an 80% line, branch and method coverage
  floor to the .NET unit and integration suites together.
- Modified sections: Technology Constraints and Development Workflow — add .NET 10,
  ASP.NET Core, EF Core, PostgreSQL, NuGet maturity checks and a separate same-origin API.
- Rationale: optional Commander accounts let Commanders synchronise selected planning
  records and read a feature-specific fleet projection across devices. The anonymous tools
  remain local-first and do not depend on the service.
- Invalidated-spec review: eight capability specifications need the accepted deltas in
  change 020: `ship-builder/build-lifecycle`,
  `equipment-builder/loadout-persistence`, `equipment-builder/loadout-assembly`,
  `ship-builder/build-link`, `ship-builder/slef-exchange`, `platform/journal-files`,
  `platform/published-addresses` and `platform/application-delivery`.
- Follow-up TODOs: apply and archive the eight delta specifications with change 020.
-->

# Nav Beacon Constitution

Nav Beacon is a browser application carrying tools for Elite Dangerous. Ship Builder
is the first of them: pick a hull, fit and engineer modules, read the resulting
build metrics, and hand the build to other tools as SLEF.

## Core Principles

### I. Local-First with Optional Commander Services (NON-NEGOTIABLE)

Every anonymous planning capability runs in the browser and remains independent
of the optional Commander service. A same-origin application API MAY provide
Frontier authentication, cross-device records and other accepted Commander
capabilities. A Commander MUST NOT need an account to use a planning tool.

Consequences that follow from this and MUST be honoured:

- Anonymous build state lives in the browser (in-memory, `localStorage`) or in a
  URL. **In a URL it lives in the fragment, and nowhere else.** A
  fragment is not sent with the request; a path or query is. So a build in a
  query would be written to the access log of whatever host serves the files, and
  sent to third parties in the `Referer` header of any link a Commander follows —
  which is uploading it, whoever owns the log. This holds whether or not the
  document at that address was prerendered: prerendering renders addresses, and a
  build is not one. Moving build state out of the fragment requires amending this
  principle rather than reading an exception into it. A valid reconstructed
  record MAY enter the separate same-origin synchronisation flow after the
  browser stores it.
- The Angular application MUST build as static files. Production MAY serve those
  files beside a separate same-origin API.
- Every non-Commander capability MUST remain usable offline after first load.
  Cached Commander records MUST remain readable offline. **Assets the
  application serves from its own origin MAY be fetched at runtime** rather than
  bundled into the initial load — hull illustrations, schematics and anything
  else whose weight would make the first load pay for artwork the Commander has
  not asked to see. What is available offline is then what the Commander has
  already opened, not the whole catalogue. An asset that has not been fetched
  MUST NOT block or degrade any capability, MUST show its absence as a temporary
  one rather than as a fault or a permanent gap, and MUST arrive once the network
  returns without the Commander reloading the application.
- Remote persistence MUST store only fields named by an accepted requirement.
  Notes, URL fragments, SLEF documents and selected journal files MUST NOT enter
  remote storage.
- Browser code MUST make programmatic requests only to its own origin. A
  Commander MAY deliberately navigate to Frontier for authentication or to
  identified external documentation or an issue tracker. Such navigation MUST
  identify the destination and MUST NOT include build, loadout or note data.
- The server MAY contact only Frontier, and only for accepted Commander
  capabilities the Commander requests. Any other outbound request needs an
  amendment to this constitution.
- Telemetry, analytics and third-party network beacons remain prohibited.

### II. The Almanac Is the Source of Truth (NON-NEGOTIABLE)

Elite Dangerous game data and derived calculations come from
`@elite-dangerous-almanac/core`. Ship hulls, slots, modules, blueprints,
experimental effects, jump range, power, shields, armour, weapon metrics and
SLEF parsing/serialisation MUST be taken from that package.

- The application MUST NOT hand-maintain a parallel copy of game data, and MUST
  NOT reimplement a calculation the package already provides.
- Domain identities are the package's identities: `symbol` for hulls and
  modules, `fdname` for blueprints, experimental effects and decorative
  modifications, and the game's own slot keys (never positional indices).
- Import the package's leaf subpaths (e.g.
  `@elite-dangerous-almanac/core/ships/ships`) rather than pulling in
  catalogues a screen does not need.

**Defects and gaps in the library are fixed in the library.** When the package
returns a wrong value, is missing a datum or calculation, or has an awkward API,
Nav Beacon does not paper over it:

- The problem MUST be called out and raised against
  [Elite-Dangerous-Almanac](https://github.com/DarkSession/Elite-Dangerous-Almanac),
  with a minimal reproduction.
- The fix MUST land in the library, and Nav Beacon MUST then consume the
  released version. Correcting, patching, clamping, re-deriving or
  special-casing a library result inside this application is prohibited —
  including "just this once" adjustments buried in a component or a formatter.
- A blocked feature waits on the upstream fix. Shipping a workaround to save
  time is not an available trade: it forks the source of truth, and every
  consumer of the library keeps the bug.
- The only sanctioned local code is presentation of what the library returns
  (formatting, ordering, labelling) — never a different value from the one it
  computed.
- If a workaround is ever unavoidable, it requires an explicit amendment to this
  constitution naming the upstream issue and the removal condition. It is a
  constitutional exception, not an implementation detail.

### III. Domain Logic Outside the UI

Build state and the rules that govern it live in framework-agnostic TypeScript
services and state stores. Components render state and dispatch intent; they do
not own outfitting rules.

- A build's behaviour MUST be testable without rendering a component.
- Presentation concerns MUST NOT leak into domain code, and domain state MUST
  NOT be duplicated inside component fields.
- Feature work adds domain capability first, UI second.

### IV. Lossless, Honest Builds

A build is round-trippable and never silently wrong.

- Import → edit → export MUST preserve everything the application understands
  and MUST NOT invent values the source did not contain. Absent data stays
  absent; it is never substituted with zero or a guess. The two normalization
  bullets below are the **only** exceptions. Each is a deliberate product rule
  rather than a convenience, each is reported to the Commander rather than
  applied silently, and each substitutes something a Commander could reproduce
  in the game — not a plausible-looking value. A third exception requires
  amending this principle.
- **Engineering quality is deliberately outside the application model.** A
  selected blueprint grade always represents a completed (100% quality) grade.
  When `@elite-dangerous-almanac/core` resolves the fitted module and engineering
  identity, imports carrying a partial engineering quality MUST be normalised
  through the package to 100%, and exports report 100%. The source quality MAY be
  shown in transient normalisation/refusal feedback, but MUST NOT remain build
  state, an editable control or the represented active quality. When the package
  cannot resolve that identity or cannot complete it losslessly, the incoming
  build MUST be refused atomically before activation, the current build MUST
  remain intact, and the Commander MUST be told which slot and identity could not
  be normalised.
  The application MUST NOT accept the candidate by changing only its quality
  scalar, stripping its engineering, retaining the partial roll or fabricating
  modifiers. This quality rule applies only after the package has resolved the
  fitted module. Unknown module identities are outside the supported import contract. A
  build is shared so that another Commander can build it, and a partial roll
  cannot be reproduced at an engineer, so a plan quoting one would describe a
  ship its reader cannot make.
- **Unknown hulls are refused and fixed mounts are always populated.** An incoming hull symbol that
  `@elite-dangerous-almanac/core` cannot resolve MUST be refused atomically before activation. The
  current build MUST remain intact, the Commander MUST be told which hull was refused, and the
  application MUST NOT select a replacement hull. Unknown module identities are not a supported
  compatibility surface and no application-owned migration, placeholder, normalisation notice or
  retained unknown-module state may be introduced for them.

  Armour, the seven core internals and the built-in cargo hatch are fixed mounts. Every package
  construction and ingress path populates an absent or unusable fixed mount with that hull's
  package-defined stock module before returning the build. The application MUST consume that result
  directly: it MUST NOT perform a second repair pass, choose a default, preserve empty-fixed-mount
  provenance or model a `default unavailable` branch. Outfitting offers the package's permitted
  swaps and no route to a ship missing a fixed module. Emptying a fixed mount MUST NOT be offered,
  which the application reaches by surfacing the package's own removability result (principle II).

- Where the package reports a value as unavailable or a build as invalid or
  incomplete (`validation`, the nullable aggregates and their `*Result`
  counterparts), the application MUST surface that state rather than hide it
  behind a plausible-looking number.
- Malformed or hostile input (a tampered URL, a pasted SLEF file) MUST fail
  visibly and safely, leaving any existing build intact.

### V. Works on Desktop, Tablet and Mobile (NON-NEGOTIABLE)

Commanders plan builds at a desk, on the sofa with a tablet, and on a phone
while reading Discord. All three are first-class targets; none is a degraded
fallback.

- Every feature MUST be fully usable on desktop, tablet and mobile. A capability
  that exists on one form factor and not another is incomplete, not "desktop
  first".
- Layouts MUST be responsive and fluid rather than pinned to fixed widths. The
  page MUST NOT scroll horizontally at any supported viewport; wide content
  (statistics tables, module lists) scrolls within its own container.
- All interactions MUST work by touch as well as by pointer. Interactive targets
  MUST be large enough to hit reliably on a phone, and nothing essential may
  depend on hover.
- Portrait and landscape orientations MUST both work on tablet and mobile.
- The application MUST meet **WCAG 2.2 level AA** on every form factor, with two
  exclusions. The first is the keyboard-operation criteria — 2.1.1 Keyboard,
  2.1.2 No Keyboard Trap, 2.1.4 Character Key Shortcuts, 2.4.1 Bypass Blocks,
  2.4.3 Focus Order, 2.4.7 Focus Visible and 2.4.11 Focus Not Obscured (Minimum)
  — which are out of scope, and no requirement in this repository may demand
  them. The second is **2.2.1 Timing Adjustable**, and it is narrower: it is
  excluded for the application-update mechanism — the restart and the notice on
  the other side of it — and for nothing else. The rest of
  the standard is not an aspiration: every capability MUST be navigable by
  screen reader with correct roles, names and state, legible at 200% text size
  and at 400% zoom without loss of content or function, and free of any
  information carried by colour, shape or position alone. Contrast MUST meet the
  AA ratios for text and for the non-text elements that carry meaning; touch
  targets MUST meet the AA target-size rule; motion MUST respect
  `prefers-reduced-motion`.
- **The two user-interface time limits, and why they are excluded.** When a newer version has
  been published, the application announces a restart and then carries it out.
  The announcement offers nothing that calls the restart off, so a Commander who
  needs longer than the announcement stands cannot have it. The session that
  comes up says the update was applied and names the version, and that notice
  takes itself down after a few seconds; it keeps a named control, so nothing
  has to be waited out, but a Commander who does not press it cannot hold it
  either. Neither meets any of 2.2.1's conditions, and both are stated rather
  than claimed. **Applying an update is the application's only mechanism that
  imposes a time limit.** Introducing one anywhere else MUST amend this
  principle rather than read itself into this exclusion, and no other capability
  MUST impose a limit on how long a Commander has to act. Frontier OAuth state
  MUST be invalid at ten minutes from sign-in start. Sessions and access
  credentials MAY expire for security. A security expiry MUST NOT discard local
  work, close a local interaction or add another WCAG 2.2.1 exclusion. The
  application MUST request authentication again only when a protected network
  action needs it.
- Because criteria at level A and AA are excluded, the application MUST NOT claim
  unqualified WCAG 2.2 AA conformance. Wherever conformance is stated — in the
  interface, in documentation or in a specification — all eight excluded criteria
  MUST be named alongside it: 2.1.1, 2.1.2, 2.1.4, 2.2.1, 2.4.1, 2.4.3, 2.4.7 and
  2.4.11.
- Accessibility is verified, not assumed: an automated accessibility check MUST
  run over every screen as part of the end-to-end suite, and a failure of an
  in-scope criterion MUST fail the build. An automated pass is a floor rather
  than a proof — a capability that cannot be understood by screen reader is
  incomplete however the checker scores it.
- End-to-end tests MUST cover desktop, tablet and mobile viewports in every
  browser engine principle VIII names. A feature is not done until it passes on
  all of them.

### VI. Speaks the Commander's Language (NON-NEGOTIABLE)

Elite Dangerous is played in many languages, and a loadout planner that reads
only in English excludes Commanders for no reason other than how it was built.

What this principle binds is the architecture, not a catalogue of languages.
Shipping with a single language is acceptable; making a string untranslatable,
or formatting a figure for one locale only, is not.

- Every user-facing string the application owns MUST be translatable and
  resolved through the localisation layer. Display text MUST NOT be hard-coded
  in a component, a template or a formatter.
- The Commander MUST be able to choose a language, and the choice MUST persist
  in the browser (principle I) rather than being inferred once and forgotten.
- Numbers, percentages, credits, distances and dates MUST be formatted for the
  active locale. Translated labels wrapped around English-formatted figures do
  not satisfy this principle.
- Translations MUST ship as the application's own static assets. No runtime
  translation service, no request to any other origin, and no server-side
  rendering of translated text (principle I). A locale's messages MAY be fetched
  from the application's own origin under principle I's runtime-asset clause —
  but text is not artwork: a Commander MUST NOT be left unable to read the
  interface because a locale did not arrive, so the fallback language the next
  clause requires MUST be present without a network.
- A missing translation MUST fall back to a language the Commander can read. A
  raw message key, an empty string or a placeholder MUST NOT reach the screen.
- Layouts MUST survive translation. Text expansion and right-to-left scripts are
  held to principle V's requirements: no horizontal page scrolling, nothing
  truncated to the point of ambiguity, at every supported viewport.

**Game text belongs to the library.** Ship, module, blueprint, experimental
effect and material names, and the package's own diagnostic messages, are text
`@elite-dangerous-almanac/core` owns.

- Translating them is a capability of that package, requested and delivered
  there under principle II.
- This application MUST NOT hand-maintain a private translation of game data. A
  local translation table forks the source of truth exactly as a private
  catalogue would, and every consumer of the library keeps the gap.
- Until the package carries a locale, game nouns appear in the language it
  provides, and the application says so rather than presenting an untranslated
  name as a translation.

### VII. One Design System (NON-NEGOTIABLE)

Every screen a Commander sees is composed from one design system. Visual design
is defined in this repository, alongside the behaviour it presents — not
improvised screen by screen, and not deferred until the domain is finished.

- There is exactly **one** design system. A screen composes it; a screen MUST NOT
  invent a visual language of its own.
- Design tokens — colour, type scale, spacing, radius, elevation, motion — are
  defined once and are the only source of visual values. No component and no
  screen may hard-code a colour, size, spacing or duration.
- The application ships **one theme** — the dark one the design system defines.
  It is not a Commander preference, no light theme is offered, and no
  requirement anywhere in this repository may depend on a theme being chosen or
  changed. Theming remains a matter of tokens: were a second theme ever added it
  would be a second set of token values, never an edit to a component.
- Components are presentation only. They render the state they are handed and
  dispatch intent; they MUST NOT reach into domain services or hold build state
  (principle III).
- Every component ships with a preview of the states it must handle — default,
  populated, empty, loading, error, disabled — at desktop, tablet and mobile
  widths (principle V).
- Accessibility belongs to the component, not to the screen that uses it.
  Contrast, touch target size and semantic labelling are part of a component's
  definition (principle V).
- Every string a component renders resolves through the localisation layer, and
  every component survives text expansion (principle VI).
- The library is versioned in this repository, and this repository is the source
  of truth for any external design tool it synchronises with. A visual change
  lands here; a design tool is a working surface and a preview, never the record.
- A screen that needs something the system does not have MUST extend the system
  rather than work around it locally. Extending it is ordinary work; a one-off
  style inside a screen is the drift this principle exists to prevent.

### VIII. Tested Before It Ships (NON-NEGOTIABLE)

Correctness is enforced by the build, not by inspection.

- Angular unit test coverage MUST be at least **80%** — statements, branches,
  functions and lines. .NET coverage, over the unit and integration suites
  together, MUST be at least **80%** — lines, branches and methods. A
  database-backed boundary is covered by the suite that exercises it, so the
  server floor reads both suites rather than one. The thresholds are enforced by
  the test runners, and a build that falls below them fails. Lowering a
  threshold to make a build pass is prohibited.
- Coverage is a floor, not a goal. Domain logic — build state, engineering,
  persistence, import and export — is expected to sit well above it, and
  coverage MUST NOT be manufactured with tests that assert nothing.
- End-to-end tests are written with **Playwright** and MUST run as part of the
  build. Every user story's primary journey MUST have an end-to-end test, run
  against desktop, tablet and mobile viewports in **both Chromium and Firefox**.
  Two engines is the minimum that catches an engine-specific defect at all; a
  suite that passes in one browser only proves the application works in that
  browser. A journey is not covered until it passes in both.
- The end-to-end suite MUST include an automated accessibility check over every
  screen, under principle V. A violation fails the build like any other test.
- `pnpm run check` — format, typecheck, build, unit tests with coverage, server
  restore, format, build and tests, and the Playwright suite — MUST pass before a
  change is proposed for merge, and MUST pass in CI.
- A bug fix starts with a failing test that reproduces the bug.
- Tests MUST NOT be skipped, quarantined or deleted to get a build green. A
  genuinely flaky test is a defect to fix, not to mute.

### IX. Specification Before Implementation

Behaviour is agreed in writing before it is built. A specification describes
what a Commander can do and how the result is verified; it does not prescribe
an implementation.

- **A capability specification is the standing record of behaviour.** It lives
  in `openspec/specs/<capability-path>/spec.md`, states its purpose, and holds
  requirements written with MUST, MUST NOT and MAY. Every requirement carries at
  least one scenario, and a scenario is an observable case a test can check.
- **A change proposes the difference.** Work in flight lives in
  `openspec/changes/<change-id>/` and carries a proposal, delta specifications
  naming the requirements it adds, modifies, removes or renames, a design where
  the change needs one, and a task list. Archiving a change applies its deltas
  to the capability specifications, so the specifications describe what the
  application does rather than what any one change did to it.
- **Ambiguity is recorded, not assumed away.** An unresolved question is written
  down in the change that found it and answered before the tasks that depend on
  it are built.
- Code that contradicts an accepted specification is a defect in one of the two;
  the mismatch is resolved deliberately, not left standing.

## Technology Constraints

- **Framework**: Angular (standalone, zoneless, signal-based state), TypeScript
  in strict mode.
- **Package manager**: pnpm. `pnpm-lock.yaml` is committed, and installs in CI
  use `--frozen-lockfile`.
- **Runtime**: Node.js per `.nvmrc` / `package.json#engines` for tooling; .NET 10
  LTS for the server; modern evergreen browsers for the app itself, on desktop,
  tablet and mobile. The dev container in `.devcontainer/` is the reference
  environment.
- **Server**: one ASP.NET Core application with EF Core and PostgreSQL. API
  instances hold no required process-local Commander state.
- **Data dependency**: `@elite-dangerous-almanac/core`, which is ESM-only and
  side-effect free.
- **Testing**: Vitest via the Angular unit-test builder, with coverage
  thresholds configured in `angular.json`; Playwright for end-to-end, with
  desktop, tablet portrait, tablet landscape, mobile portrait and mobile
  landscape projects configured in `playwright.config.ts`, each run in Chromium
  and in Firefox — ten projects, covering the three viewport classes in both
  orientations principle V requires; .NET unit and PostgreSQL integration tests
  for the server, with their combined line, branch and method coverage enforced
  at 80%.
- **Design system**: one component library under `src/app/ui/`, with design
  tokens defined in the global stylesheet layer and one dark theme built from
  them. It is versioned in this repository, and this repository is the source of
  truth for any external design tool it synchronises with (principle VII).
- **Build output**: static Angular assets and a separate same-origin server. A
  prerendered document is one of the static assets.
  The build MAY render a route to HTML at build time; it MUST NOT render one per
  request. The distinction is where the rendering happens, not what it produces: a
  prerendered document is written by `pnpm run build` from the pinned
  `@elite-dangerous-almanac/core`, is served as a file by any static host, and is
  identical for every Commander who asks for that address. The server MUST NOT
  render an Angular document per request. Commander data MUST NOT be prerendered.
  A prerendered document MUST NOT embed Commander data, and it MUST NOT carry
  runtime environment configuration baked into the bundle. What it may state is
  what the address is about, which is game data the package already owns.
  The rendered HTML is a starting frame, never the source of truth: the running
  application MUST reach the same state on its own from the same address, so an
  address whose document was never generated still works.

## Development Workflow

- Capability specifications live in `openspec/specs/<capability-path>/spec.md`
  and changes in flight in `openspec/changes/<change-id>/`. The constitution
  governs them all. `openspec/changes/archive/<NNN>-<short-name>/` holds the
  design and contract documents of the features already built. They are read,
  not extended.
- `pnpm run check` — format check, typecheck, build, unit tests with coverage,
  server restore, format, build and tests, and the Playwright suite — MUST pass
  before a change is proposed for merge.
- NuGet package versions MUST be exact. A release MUST be at least seven days
  old when selected. Its publication time MUST be verified through NuGet
  registration metadata. A younger security fix MAY be selected only with an
  advisory-named exact-version exception that is removed after seven days.
- Tests accompany domain logic, and each user story's primary journey gets an
  end-to-end test across the three form factors.
- **Functionality is specified per capability, never per screen.** A capability
  specification describes what a Commander can do and the information a screen
  must convey. It names no screen and pins no component. One capability appears on
  several screens and one screen serves several capabilities, so binding a
  requirement to a screen would invalidate the spec every time the layout
  changed. Behaviour is the durable half; screens are not.
- **Screens are defined at plan time**, in the design of the change that
  introduces them. A screen definition records what the screen composes from the
  design system, the states it must handle, and the requirements it satisfies —
  so that every requirement lands on a screen and every screen justifies itself
  against a requirement. The screen definitions of features already built are in
  `openspec/changes/archive/<NNN>-<short-name>/design/`, and code and
  specifications cite them by that path.
- The screen inventory and its requirement mapping MUST exist before a feature's
  tasks are broken down. Finished visuals may follow: domain work waits on the
  mapping, never on the pixels.
- Responsiveness, touch support and accessibility (principle V), translatability
  (principle VI) and composition from the design system (principle VII) are
  behavioural requirements, not design choices, and are in scope from the start.
- A defect traced to `@elite-dangerous-almanac/core` is raised and fixed
  upstream (principle II). Nav Beacon tracks the released fix; it does not
  route around it.

## Governance

This constitution supersedes other practices. Amendments require a documented
rationale in the amending change, a version bump under the policy below, and
review of any spec the change invalidates.

- **MAJOR**: a principle is removed or redefined in a way that invalidates
  existing specs (for example, introducing a server).
- **MINOR**: a principle or section is added, or materially expanded.
- **PATCH**: clarification and wording that does not change obligations.

Every review MUST verify compliance with these principles. Added complexity has
to justify itself against them; when it cannot, the simpler option wins. An
amendment's rationale is recorded in the change that makes it; this document
states the principles as they stand now, not the history of how they got here.

**Version**: 11.0.0 | **Ratified**: 2026-08-12 | **Last Amended**: 2026-09-11
