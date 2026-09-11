# Agent guide

Nav Beacon — a local-first Angular application carrying tools for Elite
Dangerous. Ship Builder, which plans ship loadouts, is the first of them. An
optional same-origin Commander service supports account features.

## Read first

- [`CONSTITUTION.md`](./CONSTITUTION.md) — the project's non-negotiable
  principles. Everything below is their short form; where the two differ, the
  constitution wins.
- [`openspec/specs/`](./openspec/specs) — four group directories
  (`ship-builder/`, `equipment-builder/`, `commander/`, `platform/`). Each
  capability has one directory and a `spec.md`. Read the capability you touch.

## Non-negotiables

- **Local-first with an optional Commander service.** Anonymous tools need no
  account or server. Their records live in memory, in browser storage or in a
  URL fragment. The browser contacts only its own origin, except for deliberate
  Frontier sign-in navigation. Only accepted Commander records reach the
  same-origin API. Notes, URL fragments, SLEF documents and selected journal
  files stay local. The server contacts only Frontier. No telemetry exists.
- **`@elite-dangerous-almanac/core` is the source of truth** for game data and
  build calculations. Never hand-maintain game data, and never reimplement a
  calculation the package provides. Import leaf subpaths (e.g.
  `@elite-dangerous-almanac/core/ships/ships`), not whole barrels.
- **Library defects are fixed in the library.** Raise them against
  [Elite-Dangerous-Almanac](https://github.com/DarkSession/Elite-Dangerous-Almanac)
  with a minimal reproduction and consume the released fix. Never correct,
  clamp, re-derive or special-case a library result here, not even temporarily.
  A blocked feature waits on the upstream fix.
- **Never fabricate values.** Where the package reports a value as unavailable,
  or a build as invalid or incomplete, surface that. Never substitute zero or an
  estimate.
- **Identities come from the package**: `symbol` for hulls, modules, blueprints
  and experimental effects, and the game's own slot keys — never positional
  indices.
- **Desktop, tablet and mobile are all first-class.** Every feature must be
  fully usable on all three, by touch as well as pointer, in portrait and
  landscape, with no horizontal page scrolling.
- **Accessible to WCAG 2.2 AA, except success criteria 2.1.1, 2.1.2, 2.1.4,
  2.2.1, 2.4.1, 2.4.3, 2.4.7 and 2.4.11** — principle V names them. Seven are
  the keyboard-operation criteria; the eighth, 2.2.1 Timing Adjustable, is
  excluded for applying a published update and nothing else. **That is the only
  mechanism the application puts a time limit on**, and a limit anywhere else
  needs an amendment rather than a reading of this one. Name all eight wherever
  conformance is stated; the policy checker rejects an unqualified claim. In
  scope from the start, not a later pass: screen-reader navigable, legible at
  200% text and 400% zoom, AA contrast, AA touch targets,
  `prefers-reduced-motion` honoured, and nothing carried by colour alone.
- **Nothing ships untranslatable.** Every string the application owns resolves
  through the localisation layer — never hard-coded in a component, template or
  formatter — and numbers, credits and dates are formatted for the active
  locale. Translations are static assets. Game text — ship, module, blueprint,
  effect and material names, and the package's own diagnostics — belongs to
  `@elite-dangerous-almanac/core`: ask for a locale there, never keep a private
  translation of game data here.
- **One design system, one dark theme.** Screens compose the component library
  in `src/app/ui/` and never invent a visual language of their own. Design
  tokens are the only source of colour, type, spacing, radius, elevation and
  motion; no file outside the token layer may carry a colour literal. There is
  no light theme and no theme preference, and no requirement anywhere may depend
  on a theme being chosen or changed. A screen that needs something the system
  lacks extends the system. This repository is
  the source of truth for any design tool it syncs with.
- **Domain logic lives outside components** — in framework-agnostic services and
  signal-based stores that are testable without rendering.
- **Tests gate the build.** Angular unit coverage stays at or above 80%
  (statements, branches, functions and lines). .NET coverage, over the unit and
  integration suites together, stays at or above 80% (lines, branches and
  methods). Never lower a threshold to get green.
  Never skip, quarantine or delete a test either. `pnpm run policy` fails a
  build containing a skipped, focused or quarantined interface test.

## Using the Almanac

`ShipLoadout` holds and edits a build. **Every calculation is on
`BuildMetrics`**, which reads the build it is handed:
`BuildMetrics.of(build).powerBudget()`. A property is a fact the build already
carries; anything that does work is a call, so `validation()` is a call too.

A metric that can be unavailable is offered **only** as its `…Result` form —
`heatMetricsResult()`, not `heatMetrics()` — whose `value` is the figure or
`null` and whose `issues` say why. Read `.value` where a screen states only the
absence, the issues where it states the reason.

The leaves also export **standalone calculators** taking inputs rather than a
build. They are not the call you want: assembling their inputs here would be
this application deciding what a figure is made of. The power-and-heat, defence
and mobility ownership policies refuse them by name. Where the two names
coincide — `powerBudget`, `armourMetrics` — only the capability's specification
holds you to it, and nothing mechanical can.

The persisted formats — build snapshots and the build-link codec — say `fdname`
where the package says `blueprintSymbol` and `experimentalEffectSymbol`. Leave
them: renaming them would change bytes a Commander has already saved.

## Working in this repo

- Angular is standalone and zoneless; prefer signals for state.
- The server targets .NET 10 LTS. One ASP.NET Core application uses EF Core and
  PostgreSQL. API instances keep no required process-local Commander state.
- **The deployment applies migrations; a starting instance never does.** Several
  instances start together, so a server whose schema is behind refuses to start
  rather than serve a schema it does not know. Run `pnpm run server:migrate`
  after adding a migration; the dev container runs it on create.
  [`docs/commander-service-deployment.md`](./docs/commander-service-deployment.md)
  carries the settings a production instance requires, the routing the browser's
  base-relative `api/` address needs, key-ring backup and the rollback order.
- Package manager is **pnpm**. `pnpm-lock.yaml` is committed; CI installs with
  `--frozen-lockfile`.
- Run `pnpm run check` before proposing a change: format, typecheck, build, unit
  tests with coverage, Playwright.
- During fixes, use the README's targeted-check procedure: reproduce the failing
  test and project, then run the affected capability across the matrix.
  Store full output under `dist/verification/` and read concise failure summaries.
  The complete merge gate remains required before proposing merge.
- Unit tests live beside their source in `src/`; end-to-end tests in `e2e/`. A
  new user journey needs both.
- **Nothing the application asks for at runtime may be a root-absolute path.** A
  pull request is published as a preview, built a second time with a sub-path
  `<base href>` and pushed to the separate `Nav-Beacon-Preview` repository,
  because this repository's own Pages site is production (`public/CNAME` →
  `navbeacon.app`). A leading `/` therefore looks past the deployment base and
  misses the file — invisible at the root of a domain, fatal one directory down.
  `fetch` paths resolve against the base href for free (see `hullArtworkPath`
  and the locale registry's `assetPath`); `@font-face` sources in
  `src/styles/_fonts.scss` need `externalDependencies: ["fonts/*"]` in
  `angular.json`, or the bundler resolves them before the emitted CSS sees them.
- **`package.json` declares `major.minor.0`; CI supplies the patch.** Major and
  minor are advanced by hand in a normal reviewed commit.
  `scripts/resolve-build-version.mjs` counts the commits since that major.minor
  was declared and stamps the result into the manifest just before
  `pnpm run build` in CI, so the deployed bundle — and the `appVersion` its SLEF
  exports carry — is versioned without anything being committed back to `main`.
  The count is a property of the commit, so a re-run and the manual republish in
  `deploy.yml` ship the same number. A committed patch other than `0` fails the
  resolver. A version is not release evidence: a
  release is declared only by `SHIP_BUILDER_RELEASE_TAG` matching the shipped
  version exactly
  (`openspec/changes/archive/012-help-and-licences/contracts/distribution-artifacts.md`).

### The end-to-end matrix

`playwright.config.ts` generates **ten projects** from `ENGINES ×
LAYOUT_PROFILES` in `e2e/coverage-ledger.ts` — five layout profiles (desktop,
tablet portrait and landscape, mobile portrait and landscape) in Chromium and in
Firefox. Every rendered product and preview state is scanned with
`@axe-core/playwright` against WCAG 2.0/2.1/2.2 A and AA with no disabled rules.

- CI may shard the matrix; it may not reduce it, and no browser may be dropped
  to get a build green.
- The coverage ledger shares that file, and the policy checker reconciles the
  two, so a project cannot be renamed or dropped without the build noticing.
- The ledger registers which test evidences which requirement id. A capability
  requirement declares its id on a trailing `Source: 002/FR-014.` line — write
  that line on any requirement you add or move, or its coverage stops being
  checked. `pnpm run policy:specs` is what reconciles the two.
- If a preinstalled browser does not match the version Playwright pins, point at
  its executable (`E2E_CHROMIUM_PATH`, `E2E_FIREFOX_PATH`) rather than editing
  the config.
- Automation is a floor, not the gate. The versioned manual protocols in
  `e2e/manual/` — screen-reader journeys and actual 400% browser zoom — cover
  what no scan can judge, and their result records live beside them.

### Installing a dependency

**A release waits seven days before this project may install it.**
`pnpm-workspace.yaml` sets `minimumReleaseAge` to 10080 minutes, giving a
compromised or withdrawn release time to be pulled before this project can reach
it. It applies only when a person resolves a new version.

- Nothing tells you what the delay holds — `pnpm outdated` hides a held-back
  version. Run `pnpm view <name> time` and work it out. A too-young exact
  version fails with `ERR_PNPM_NO_MATURE_MATCHING_VERSION` rather than
  resolving an older release.
- `minimumReleaseAgeExclude` takes a bare name or pattern, which exempts every
  release of a package now and later, or `name@version`, which exempts one
  release and keeps the delay over the next. `@elite-dangerous-almanac/*` is the
  only standing bare exclusion; a second needs a reason in the commit that adds
  it.
  **A security fix does not wait.** To take one younger than the delay:

1. Add the release to `minimumReleaseAgeExclude` as `<name>@<version>`.
2. Run `pnpm update <name>`.
3. Commit `pnpm-workspace.yaml` and the lockfile, naming the advisory in the
   commit message.
4. Delete the entry once the release is seven days old.

Step 1 is what holds the fix. Resolve it without the entry and the next
`pnpm update` silently takes the older version back. `pnpm audit` does not catch
that: an advisory published in the last few days is not in its feed yet.

NuGet packages follow the same seven-day delay. Pin every NuGet package to an
exact version. Before restore, read its publication time from NuGet registration
metadata and confirm that it is at least seven days old. Run the NuGet audit.
A younger security fix needs an advisory-named exact-version exception in the
project dependency policy. Remove the exception after seven days.

### Who owns which region

The outfitting workspace is assembled from several capabilities. Each one's
boundary, its ruled exceptions, the package fields it deliberately does not read
and what it leaves out of scope are in its own specification — not here.

| Region                                       | Capability                        |
| -------------------------------------------- | --------------------------------- |
| Slot ledger and fitting bench                | `ship-builder/module-outfitting`  |
| Engineering surface                          | `ship-builder/module-engineering` |
| Status rail: heading, issues, capacity cells | `ship-builder/build-status`       |
| Anatomy region, `POWER` mode + rail power    | `ship-builder/power-and-heat`     |
| Anatomy region, `DEFENCE` mode + rail cells  | `ship-builder/defence-profile`    |
| Anatomy region, `OFFENCE` mode + rail cell   | `ship-builder/offence-profile`    |
| Anatomy region, `DRIVES` mode + rail cells   | `ship-builder/mobility-and-jump`  |
| Status rail: `COST` and `MATERIALS`          | `ship-builder/cost-and-materials` |
| Anatomy region, `MOUNTS` mode and its plates | `ship-builder/hull-anatomy`       |
| `Help · About` modal and its frame action    | `platform/help-and-licences`      |

The anatomy region's five-mode strip is one control with **five different
owners**, so a change to it crosses five boundaries; the status rail's cell band
is one grid with **four**. Several of these capabilities are fenced by a
`scripts/policy/*-ownership.mjs` script — read the script before crossing the
boundary it guards, because it will fail the build rather than argue.

## Spec-driven development

This repository plans with [OpenSpec](https://github.com/Fission-AI/OpenSpec),
installed for Claude Code (`.claude/skills` and `.claude/commands/opsx`) and
Codex CLI (`.agents/skills`). The CLI is a devDependency, and the dev container
puts `node_modules/.bin` on the path, so `openspec …` resolves without a global
install. The Claude Code flow is `/opsx:explore` (optional) → `/opsx:propose` →
`/opsx:apply` → `/opsx:archive`; Codex reads the same work as the skills
`openspec-explore`, `openspec-propose`, `openspec-apply-change` and
`openspec-archive-change`, with `openspec-update-change` and
`openspec-sync-specs` beside them.

- **A capability specification** — `openspec/specs/<capability-path>/spec.md` —
  states what the application does. `## Purpose`, then `## Requirements`, each
  `### Requirement:` written with MUST, MUST NOT and MAY and carrying at least
  one `#### Scenario:` in WHEN/THEN form. It is the standing record.
- **A change** — `openspec/changes/<change-id>/` — states the difference one
  piece of work makes: a proposal, delta specifications naming the requirements
  it adds, modifies, removes or renames, a design where one is needed, and a
  task list. Archiving folds the deltas into the capability specifications.
- **A specification is scoped to a capability and names no screen.** It
  constrains behaviour and the information a screen must convey. Screens are
  defined in the design of the change that introduces them — what each composes,
  the states it handles, the requirements it satisfies — before task breakdown.
  Finished visuals may follow. The screen definitions of what is already built
  are in `openspec/changes/archive/<NNN>-<short-name>/design/`.
- **Specify what must be built, not what must not.** A prohibition earns its
  place only where someone would otherwise build the thing.
- Write an unresolved question down in the change that found it and answer it
  before building the tasks that depend on it. If code and an accepted
  specification disagree, resolve the mismatch deliberately.
- `openspec/changes/archive/<NNN>-<short-name>/` holds the design and contract
  documents of the features already built. Source files, tests and
  specifications cite them by path. Read them; do not extend them.
- **Two reviews run inside the flow**, by two different subagents, and neither
  waits to be asked. A specification reviewer reads the planning artefacts when
  the task list is written, before you present them. A code reviewer reads the
  diff when the last task is done. Fix every actionable finding and run the gate
  again, until none remains. [`openspec/config.yaml`](./openspec/config.yaml)
  carries both gates and says what each subagent reads.
- **One script reads the record.** `scripts/check-specification-record.mjs`
  (`pnpm run policy:specs`) holds every rule that opens a file under
  `openspec/`: that a declared requirement is registered in the coverage ledger,
  that a help topic answers from a requirement or principle something still
  declares, that a conformance claim in the record names its excluded criteria,
  and that `helpRouteCoverage` transcribes the screen inventory. Nothing in the
  build or the suites opens a file under `openspec/` — not the interface-policy
  checker, not the generated help artifacts, not a test. A source file may cite
  a document by path in a comment; it may not open one. One other script reaches
  the record, and it writes: `slef:corpus` regenerates feature 004's reference
  corpus on demand, and no gate runs it.
- **That is why a specification change is cheap.** A pull request whose every
  changed path is under `openspec/` runs the formatter and that one script, and
  skips the build, the unit tests, the end-to-end matrix and the preview
  (`.github/workflows/ci.yml`, the `Scope` job). Add a rule that reads a
  specification from the product pipeline and the split becomes a hole in the
  gate rather than a saving.

## How to write

Everything you author — code, comments, documentation, specifications, commit
messages, pull requests and replies to the operator — follows these rules. For
anything addressed to the operator they are
[ASD-STE-100](https://www.asd-ste100.org/) (Simplified Technical English).

- **Plain, common words a contributor can skim.** Name a thing what it is. No
  metaphor, no idiom, no rhetorical build-up, no marketing adjectives, no emoji:
  "add a tooltip to the heat glosses" beats "the glosses find their voice at
  last". Identifiers, test names and headings follow the same rule.
- **One idea per sentence.** Active voice, present tense, concrete nouns.
  Instructions to 20 words, descriptions to 25, paragraphs to six sentences.
- **One word, one meaning.** Choose a term and keep it. Use the simplest verb
  that is correct, and no jargon the operator did not use first.
- **Say it once.** Drop throat-clearing openers, self-assessment
  ("comprehensive", "robust", "seamless") and hedging. If deleting a sentence
  loses nothing, delete it.
- **Write a procedure as numbered steps**, condition before action: "If the
  build fails, read the policy output."
- **Describe the current state, not the change that produced it.** Git records
  what moved. No "previously", "now", "was changed to", "new", "updated", "as of
  <date>", no diff narration, no dated superseded notes. Write the rule and the
  reason it holds, in the present tense, as though it had always been so.
- **Delete rather than annotate.** Commented-out code, "kept for reference"
  blocks and "(deprecated)" markers all go; git holds the old version.
- **One deliberate exception.** Where a decision cannot be understood without
  its history — a persisted format keeping an old field name, a workaround for a
  known upstream defect — record the reason rather than the chronology, in the
  one sentence that stops someone undoing it.

## Commit identity — no personal data in git metadata

**Commit as whoever git is already configured as. Never set an identity
yourself.** The environment configures `user.name`, `user.email` and any signing
key before you start. Do not pass `-c user.name=…` to `git commit`, do not
`git config` a different one, and do not use `--reset-author`. An identity that
no longer matches the signing key produces commits GitHub marks **Unverified**.

**An identity you did not get from git config is a personal detail, and commit
metadata publishes it.** A maintainer's address may be in front of you — in the
conversation, an issue, a profile, an earlier commit — and none of that is
permission to write it into this history. A wrong address cannot be taken back:
force-pushing removes the reference, but the old commit object survives on the
remote and stays fetchable by its SHA, and only GitHub Support can purge it.
Getting it right the first time is the only fix that works. Before pushing,
confirm the branch carries one identity:

```bash
git log --format='%an <%ae> | %cn <%ce>' origin/<default-branch>..HEAD | sort -u
```

Everything else you author — commit messages, PR titles and bodies, comments,
data files, fixtures, documentation — carries **no personal data**: no
addresses, no real names, no handles, no machine or account names, nothing
identifying a private individual.

## Pull requests

A pull request describes the change, not the process that produced it. Write for
a reviewer who has not seen the conversation.
[`.github/pull_request_template.md`](./.github/pull_request_template.md) is the
layout.

- **The title says what changed**, in one plain line — no wordplay, no subtitle
  after a dash.
- **What and why, in that order.** What behaviour, screen or capability is
  different, and what problem that solves. Name the capability, link the issue.
- **Confirm what was validated.** Say `pnpm run check` passed, or name the
  commands run and what was left out and why. "Tests pass" is not evidence. For
  a visual change or a new journey, say which viewports and engines were
  exercised, and attach the manual protocol record when one was required.
- **Leave the making-of out.** No review-and-fix log, no commit-by-commit
  walkthrough, no self-assessment, no wishlist. A finding that mattered is fixed
  in the diff; one that still matters is a follow-up issue.
- **Length follows the change.** Do not inflate a small change into a report,
  and do not compress a large one into a headline.

**Before opening any PR, a subagent reviews the complete change.** Address every
actionable finding, then run the gate again. Repeat until it reports no
actionable findings; only then may the PR be opened. The apply phase's
implementation gate is this review: where it passed and the code has not changed
since, open the PR without repeating it. Any later change to the code needs a
new review. The cycle is how the change gets good; it is not material for the
description.
