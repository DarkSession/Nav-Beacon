## Context

See [proposal.md](./proposal.md) for the reason for this change. The engineering draft already asks
the active `ShipLoadout` for its available experimental effects. Almanac 0.2.12 returns an empty
effect menu for a Mercenary hardpoint whose experimental state is fixed.

The engineering editor draws the application design system's blueprint, grade, effect and attribute
parts. The selected module and its current engineering summary remain visible beside the editor in
the inline composition. A full-screen layer replaces that surrounding summary in the compact
composition.

## Goals / Non-Goals

**Goals:**

- Keep the package effect menu as the only source of effect edit choices.
- Make a package-owned fixed effect visible without presenting an invalid edit route.
- Preserve the same result at desktop, tablet and mobile sizes.

**Non-Goals:**

- Add application-owned engineering rules or effect data.
- Change blueprint or grade restrictions.
- Change a fixed experimental effect or its package identity.

## Decisions

### Treat the package menu as an edit capability

The engineering draft imports `ShipLoadout` from
`@elite-dangerous-almanac/core/ships/ship-loadout`. It passes
`ShipLoadout.availableExperimentalEffects(slotKey)` to presentation without adding choices. An
empty result means that the editor draws no experimental-effect control, including no
application-owned `None` choice.

The alternative is to filter known fixed variants in application code. That duplicates a game rule
and can differ from later package releases.

### Present fixed state in every composition

When the fitted module carries an effect and the package effect menu is empty, the engineering card
draws a non-interactive fixed-effect fact where the effect control otherwise appears. It names the
effect and states in text that the effect is fixed and cannot be changed. The same card is present
in the inline editor and the compact full-screen layer. It composes the existing game-text and card
parts from the design system and carries no colour-only meaning. This state satisfies 002/FR-012.

The fact reads the `ShipLoadout.fittedModuleAt(slotKey).engineering.ExperimentalEffect` value. It
imports `getExperimentalEffectName` from
`@elite-dangerous-almanac/core/i18n/experimental-effects`. The existing game-text presenter requests
the active locale first. If that returns `null`, it requests canonical text, states its actual
language, and associates the untranslated disclosure. If canonical text is also `null`, it states
that the value is unavailable. The fixed-state label and explanation are application strings in
every shipped locale.

The alternative is a disabled effect menu. A disabled menu still presents entries that are not in
the package result and makes the absence of an edit route less clear.

### Use package symbols as Frontier identities

The loadout API names blueprint and experimental-effect values as symbols. These values are the
Frontier `fdname` identities required by the constitution and capability specification. Persisted
formats keep their existing `fdname` field names. This resolves the terminology difference without
converting or maintaining an application-owned identity.

### Extend the existing engineering journey

The existing package-parity and purchased-article tests cover the restriction. The end-to-end test
fits a Mercenary hardpoint, confirms its carried effect, opens engineering, and confirms that no
effect control exists before and after a permitted grade change. It confirms the fixed fact inside
both engineering compositions. The existing ten-project matrix checks both browser engines, all
layout profiles, accessibility, touch targets, and page overflow.
The versioned screen-reader and actual 400% browser-zoom protocols confirm that the fixed state is
understandable and usable in real assistive technology and browser chrome. The automated reflow
suite confirms 200% text size. The screen-reader protocol adds module-engineering requirement
002/FR-012 and a fixed-effect step before the result is recorded.

## Risks / Trade-offs

- **Risk:** A package release changes which variants have fixed effects. **Mitigation:** Tests derive
  the restriction and current state from the installed package instead of copying a variant rule.
- **Risk:** Removing the effect control can hide the carried effect. **Mitigation:** The journey
  checks the module's visible engineering summary and the editor's absence of effect choices.
- **Risk:** The dependency update changes unrelated package data. **Mitigation:** Run the complete
  repository check after the affected engineering checks pass.

## Migration Plan

Update the exact dependency and lockfile together. No persisted build format changes. A rollback
restores the earlier dependency and lockfile.
