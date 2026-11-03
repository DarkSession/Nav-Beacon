import { Injectable, computed, inject } from '@angular/core';
import { getSuitByFamily } from '@elite-dangerous-almanac/core/equipment/suits';
import { getPersonalModification } from '@elite-dangerous-almanac/core/equipment/modifications';
import type {
  PersonalMount,
  PersonalMountKey,
} from '@elite-dangerous-almanac/core/equipment/suits';
import type { EquipmentLoadout } from '../../domain/equipment/loadout-link/equipment-loadout';
import type { EditTarget } from '../../domain/equipment/loadout/loadout-edit';
import { MODIFICATION_SLOT_COUNT } from '../../domain/equipment/loadout/loadout-edit';
import {
  CATALOGUE_MOUNTS,
  mountAvailability,
  mountPosition,
} from '../../domain/equipment/loadout/loadout-mounts';
import { materialRequirement } from '../../domain/equipment/readings/material-requirement';
import { publishedSuitGrades, suitReadings } from '../../domain/equipment/readings/suit-readings';
import { toolReadings } from '../../domain/equipment/readings/tool-readings';
import {
  fittedWeaponReadings,
  publishedWeaponGrades,
  weaponReadings,
} from '../../domain/equipment/readings/weapon-readings';
import { modifiersOf } from '../../domain/equipment/readings/fitted-modifiers';
import { Formatters } from '../../i18n/formatters/formatters';
import { GameTextPresenter, type GameTextPresentation } from '../../i18n/game-text.presenter';
import { MESSAGE_KEYS, type MessageKey } from '../../i18n/locale-registry';
import { MessageService } from '../../i18n/message.service';
import type { Metric } from '../../ui/components/metric-group/metric-group';
import type { MaterialLineView } from '../../ui/outfitting/material-lines';
import { LoadoutStore } from './loadout.store';
import { modificationCandidates, suitCandidates, weaponCandidates } from './candidate-query';

/** One row of the ledger: the suit, or one catalogue mount. */
export interface LedgerRowView {
  readonly target: EditTarget;
  /** The two-character code the canvas draws in the row's leading square. */
  readonly badge: string;
  /** The item's name, or the empty-mount message where there is none. */
  readonly name: GameTextPresentation | null;
  readonly emptyLabel: string | null;
  /** The code line under the name. */
  readonly meta: string;
  /** `G5`, or none for a mount with nothing on it. */
  readonly grade: string | null;
  /** `2/4`, or none for a mount with nothing on it. */
  readonly modifications: string | null;
  /**
   * Whether that count is short of what the grade has opened.
   *
   * Both artboards draw an unfilled count in the alarm ink and a full one in
   * ordinary ink (`used < tot ? 'var(--hot-2)' : 'var(--ink-42)'`): it is the
   * one thing on the ledger that says there is capacity nobody has used. The
   * count itself is what carries it — the colour is the second statement
   * (constitution V).
   */
  readonly modificationsWanting: boolean;
  /** True where the worn suit does not carry this mount (FR-007). */
  readonly held: boolean;
  /** The whole row as one sentence, for a reader who cannot see the dimming. */
  readonly accessibleName: string;
}

/** One suit tool the worn suit carries. Stated, never chosen (FR-005a). */
export interface ToolRowView {
  readonly badge: string;
  readonly name: GameTextPresentation;
  readonly accessibleName: string;
}

/** The whole ledger, as every artboard draws it. */
export interface LedgerView {
  readonly suit: LedgerRowView | null;
  readonly weapons: readonly LedgerRowView[];
  readonly tools: readonly ToolRowView[];
  /** The bare figure at each rule's trailing edge — a count, or the canvas's dash. */
  readonly suitCount: string;
  readonly weaponCount: string;
  readonly toolCount: string;
}

/** One of an item's four modification slots. */
export interface ModificationSlotView {
  readonly slot: number;
  readonly number: string;
  readonly locked: boolean;
  readonly name: GameTextPresentation | null;
  /** The placeholder where the slot holds nothing. */
  readonly emptyLabel: string | null;
  /** The status line: fitted, held, or the grade the slot wants. */
  readonly status: string;
  readonly accessibleName: string;
}

/** The selected item, as the middle column draws it. */
export interface ItemView {
  readonly target: EditTarget;
  readonly name: GameTextPresentation;
  readonly subtitle: string;
  /** Every grade the item publishes, lowest first, for the shared ladder. */
  readonly grades: readonly number[];
  readonly grade: number;
  /** The attribute grid, as the design system's own metric cells. */
  readonly attributes: readonly Metric[];
  readonly slotsHeading: string;
  /** `null` where the item unlocks no slot at any grade — the Flight Suit. */
  readonly slots: readonly ModificationSlotView[] | null;
  /** Said in place of four unexplained locked slots (spec Edge Cases). */
  readonly noUpgradeNotice: string | null;
  /** What the weapon chooser this item opens is called. */
  readonly chooserTitle: string;
}

/** One resistance, as a signed figure beside a bar the figure does not need. */
export interface ResistanceView {
  readonly key: string;
  readonly label: string;
  readonly value: string;
  /** The bar's own length, as a fraction of full. Decoration. */
  readonly magnitude: number;
  readonly negative: boolean;
}

/** One weapon's contribution to the firepower block. */
export interface FirepowerRowView {
  readonly mount: string;
  readonly name: GameTextPresentation;
  readonly value: string;
  /**
   * Whether the mount is a primary one.
   *
   * Canvas 1a writes a primary's figure in the accent and a secondary's in
   * ink: the block's own total is the primaries', and the accent is what says
   * which rows it was read from. The mount's `kind` is the package's, so this
   * is a fact about the catalogue rather than a rule the bench invented.
   */
  readonly primary: boolean;
}

/** The commander stats region. */
export interface CommanderStatsView {
  readonly shieldStrength: string;
  readonly shieldRegeneration: string;
  /** The armour's four, which the suit's grade publishes and a grade moves. */
  readonly armourResistances: readonly ResistanceView[];
  /** The shield's four, which the suit publishes and no grade moves. */
  readonly shieldResistances: readonly ResistanceView[];
  readonly firepower: readonly FirepowerRowView[];
}

/** The material requirements region: the list, its summary, and its absence. */
export interface MaterialsView {
  readonly lines: readonly MaterialLineView[];
  readonly summary: string | null;
  readonly emptyLabel: string;
}

/** One weapon a mount's chooser offers. */
export interface WeaponChoiceView {
  readonly symbol: string;
  readonly name: GameTextPresentation;
  readonly meta: string;
  readonly figure: string;
  /** The unit under the figure, which the canvas draws as its own small word. */
  readonly figureUnit: string | null;
  readonly current: boolean;
}

/** One suit the suit chooser offers. */
export interface SuitChoiceView {
  readonly family: string;
  readonly name: GameTextPresentation;
  readonly meta: string;
  /** The unit under the figure, which the canvas draws as its own small word. */
  readonly figureUnit: string | null;
  readonly figure: string;
  readonly current: boolean;
}

/** One recipe a modification slot's chooser offers. */
export interface ModificationChoiceView {
  readonly symbol: string;
  readonly name: GameTextPresentation;
  readonly current: boolean;
}

/**
 * The four damage types, each with the two stats the library publishes for it.
 *
 * Two sets since 0.2.10: the armour's on the suit's grade, the shield's on the
 * suit itself. The bench drew one set in both blocks while only one was
 * published; now each block reads its own.
 */
const RESISTANCES = [
  ['armourKineticResistance', 'shieldKineticResistance', 'kinetic'],
  ['armourThermalResistance', 'shieldThermalResistance', 'thermal'],
  ['armourPlasmaResistance', 'shieldPlasmaResistance', 'plasma'],
  ['armourExplosiveResistance', 'shieldExplosiveResistance', 'explosive'],
] as const;

/**
 * A ledger row's accessible name: the words the row shows, in the order it
 * shows them, so a Commander can say what they see (WCAG 2.5.3 Label in Name).
 * A part the row does not draw goes before or after them, never between.
 */
function rowName(...parts: readonly string[]): string {
  return parts.filter((part) => part.length > 0).join(' · ');
}

/**
 * Everything the bench draws, in one view model.
 *
 * The regions ask this and nothing else: no component reaches
 * `@elite-dangerous-almanac/core`, and no component formats a number or resolves
 * a game noun for itself (constitution II, III and VI). Every figure here comes
 * from `domain/equipment/readings`, every game noun through `GameTextPresenter`,
 * and every owned word through `MessageService`.
 */
@Injectable({ providedIn: 'root' })
export class LoadoutPresenter {
  readonly #store = inject(LoadoutStore);
  readonly #text = inject(GameTextPresenter);
  readonly #messages = inject(MessageService);
  readonly #formatters = inject(Formatters);

  /** The ledger: the suit, one row per catalogue mount, and the suit's tools. */
  readonly ledger = computed<LedgerView>(() => {
    const loadout = this.#store.loadout();
    // Canvas 2a's gate: the ledger is drawn and inert rather than absent, so a
    // Commander can see what choosing a suit will fill in. Every mount the
    // catalogue offers is a locked row, and the counts are the canvas's dash
    // rather than a zero for something that is not yet countable.
    if (loadout === null) {
      return {
        suit: this.#emptySuitRow(),
        weapons: CATALOGUE_MOUNTS.map((mount) => this.#lockedMountRow(mount)),
        // Carriage is a property of a suit. With none worn the package
        // publishes no tool list, so none is drawn (013
        // design/reference-review.md).
        tools: [],
        suitCount: this.#formatters.integer(0),
        weaponCount: this.#message('equipment.count.none'),
        toolCount: this.#message('equipment.count.none'),
      };
    }
    const tools = toolReadings(loadout.suitFamily).map((tool) => this.#toolRow(tool.id));
    return {
      suit: this.#suitRow(loadout),
      weapons: this.#mountRows(loadout),
      tools,
      suitCount: this.#formatters.integer(1),
      weaponCount: this.#formatters.integer(
        getSuitByFamily(loadout.suitFamily)?.mounts.length ?? 0,
      ),
      toolCount: this.#formatters.integer(tools.length),
    };
  });

  /** The selected item, or nothing where the bench is empty or nothing is chosen. */
  readonly item = computed<ItemView | null>(() => {
    const loadout = this.#store.loadout();
    const target = this.#store.selected();
    if (loadout === null || target === null) return null;
    if (target === 'suit') return this.#suitItem(loadout);

    // The mount a Commander was reading can stop being one the suit carries, by
    // their choosing another suit. Its row is gone from the ledger, so the
    // column falls back to the suit rather than standing on a mount nothing
    // points at — which is what the canvas does
    // (`if (!isSuit && !enabled(i)) { st.sel = 'suit'; return renderDetail(); }`).
    const position = CATALOGUE_MOUNTS.findIndex((mount) => mount.key === target);
    if (position < 0 || mountAvailability(loadout)[position] !== 'offered') {
      return this.#suitItem(loadout);
    }
    return this.#weaponItem(loadout, target);
  });

  /** The commander stats, or nothing where no suit is worn. */
  readonly stats = computed<CommanderStatsView | null>(() => {
    const loadout = this.#store.loadout();
    // The gate draws the region with the canvas's dash in every figure, so the
    // reader can see which figures a suit answers rather than an empty panel.
    if (loadout === null) {
      const dash = this.#message('equipment.count.none');
      return {
        shieldStrength: dash,
        shieldRegeneration: dash,
        armourResistances: this.#dashedResistances(dash),
        shieldResistances: this.#dashedResistances(dash),
        // Canvas 2a keeps `FIREPOWER` on an empty bench with a dash against
        // every mount the catalogue offers. The mounts are the package's own,
        // so nothing here is a figure this bench invented — the dash is the
        // statement that none of them is carrying anything yet.
        firepower: CATALOGUE_MOUNTS.map((mount) => ({
          mount: mount.key,
          name: this.#text.personalMountName(mount),
          value: dash,
          primary: mount.kind === 'primary',
        })),
      };
    }
    const suit = suitReadings(loadout);
    if (suit === null) return null;

    return {
      shieldStrength: this.#formatters.decimal(suit.shieldStrength, 1),
      shieldRegeneration: this.#formatters.decimal(suit.shieldRegeneration, 2),
      armourResistances: RESISTANCES.map(([armour, , damage]) =>
        this.#resistance(damage, suit[armour]),
      ),
      shieldResistances: RESISTANCES.map(([, shield, damage]) =>
        this.#resistance(damage, suit[shield]),
      ),
      // Every mount the catalogue offers, in its order, whether or not a weapon
      // is on it. The block used to draw only the weapons that were fitted, so
      // a suit with nothing carried rendered a heading over nothing — the same
      // state the empty bench answers with a dash on every row, given two
      // different answers by one block (Commander request 2026-09-04).
      firepower: this.#firepower(loadout),
    };
  });

  /**
   * One row per mount the worn suit carries, with the weapon on it or a dash.
   *
   * A mount the suit does not carry draws no row, as the canvas draws none
   * (`st.w.map((sl, i) => { if (!enabled(i)) return ''; … })`). What is held on
   * it is still kept — FR-007 is about the loadout, not about the block — and
   * its row comes back with a suit that carries the mount (Commander request
   * 2026-09-04).
   */
  #firepower(loadout: EquipmentLoadout): readonly FirepowerRowView[] {
    const fitted = fittedWeaponReadings(loadout);
    const dash = this.#message('equipment.count.none');
    const availability = mountAvailability(loadout);

    return CATALOGUE_MOUNTS.filter((_, position) => availability[position] === 'offered').map(
      (mount) => {
        const weapon = fitted.find((reading) => reading.mount === mount.key) ?? null;
        return {
          mount: mount.key,
          name:
            weapon === null
              ? this.#text.personalMountName(mount)
              : this.#text.personalWeaponName(weapon.symbol),
          value:
            weapon === null
              ? dash
              : this.#messages.message('equipment.stats.dps', {
                  value: this.#formatters.decimal(weapon.metrics.damagePerSecond, 1),
                }),
          primary: mount.kind === 'primary',
        };
      },
    );
  }

  /** One signed bar, the way both blocks draw one. */
  #resistance(damage: string, value: number): ResistanceView {
    return {
      key: damage,
      label: this.#message(`equipment.damage.${damage}`),
      value: this.#formatters.signedPercent(value),
      magnitude: Math.min(1, Math.abs(value)),
      negative: value < 0,
    };
  }

  /** The same four with the canvas's dash, for a bench with no suit on it. */
  #dashedResistances(dash: string): readonly ResistanceView[] {
    return RESISTANCES.map(([, , damage]) => ({
      key: damage,
      label: this.#message(`equipment.damage.${damage}`),
      value: dash,
      magnitude: 0,
      negative: false,
    }));
  }

  /** The micro resources the loadout requires: each climb, and each modification. */
  readonly materials = computed<MaterialsView>(() => {
    const loadout = this.#store.loadout();
    const requirement =
      loadout === null ? { ingredients: [], types: 0, units: 0 } : materialRequirement(loadout);

    // Commonest first, as the canvas orders the block. The package sums in
    // first-seen order, which is the order recipes were fitted rather than
    // anything a Commander gathering a list would recognise.
    const collator = this.#formatters.collator();
    const ordered = [...requirement.ingredients].sort(
      (one, other) =>
        other.count - one.count ||
        collator.compare(this.#resourceName(one.symbol), this.#resourceName(other.symbol)),
    );

    return {
      lines: ordered.map((ingredient) => ({
        symbol: ingredient.symbol,
        name: this.#text.microResourceName(ingredient.symbol),
        // The package publishes a category for a micro resource and no rarity,
        // so the shared line carries none rather than an invented one.
        grade: null,
        count: this.#formatters.integer(ingredient.count),
      })),
      summary:
        requirement.types === 0
          ? // Canvas 2a writes `NONE` at the rule's trailing edge while the
            // bench is empty, where a loaded bench with nothing fitted writes
            // nothing there.
            loadout === null
            ? this.#message('equipment.materials.none')
            : null
          : this.#messages.message('equipment.materials.summary', {
              types: this.#formatters.integer(requirement.types),
              units: this.#formatters.integer(requirement.units),
            }),
      emptyLabel: this.#message(
        loadout === null ? 'equipment.materials.pending' : 'equipment.materials.empty',
      ),
    };
  });

  /**
   * The ladder canvas 2a previews while the bench is empty.
   *
   * The longest ladder any suit publishes, rather than a drawn number of cells:
   * a preview of a control states what the package offers, and the Flight Suit's
   * one grade would understate it (013 design/reference-review.md).
   */
  gradeLadder(): readonly number[] {
    return suitCandidates().reduce<readonly number[]>((longest, family) => {
      const grades = publishedSuitGrades(family);
      return grades.length > longest.length ? grades : longest;
    }, []);
  }

  /** The suits the suit chooser offers, each with the shield it would give. */
  suitChoices(): readonly SuitChoiceView[] {
    const loadout = this.#store.loadout();
    return suitCandidates().map((family) => {
      const grades = publishedSuitGrades(family);
      const grade = Math.min(loadout?.suitGrade ?? 1, grades[grades.length - 1] ?? 1);
      const readings = suitReadings({
        suitFamily: family,
        suitGrade: grade,
        suitModifications: [null, null, null, null],
        weapons: [],
      });
      return {
        family,
        name: this.#text.suitName(family),
        meta: this.#suitMounts(family),
        figure: readings === null ? '' : this.#formatters.decimal(readings.shieldStrength, 1),
        figureUnit: readings === null ? null : this.#message('equipment.suit.figure.unit'),
        current: loadout?.suitFamily === family,
      };
    });
  }

  /** The weapons one mount's chooser offers, each with the damage it would do. */
  weaponChoices(mount: PersonalMountKey): readonly WeaponChoiceView[] {
    const loadout = this.#store.loadout();
    const fitted = loadout?.weapons[mountPosition(mount)] ?? null;
    return weaponCandidates(mount).map((symbol) => {
      const grades = publishedWeaponGrades(symbol);
      const grade =
        fitted !== null && grades.includes(fitted.grade) ? fitted.grade : (grades[0] ?? 1);
      const readings = weaponReadings(
        mount,
        { symbol, grade, modifications: [null, null, null, null] },
        [],
      );
      return {
        symbol,
        name: this.#text.personalWeaponName(symbol),
        // Canvas 1a's swap card ends its code line with the effective range
        // rather than the firing mode the ledger row carries: the row states
        // what is fitted, and the card is a decision about what to fit instead.
        meta:
          readings === null
            ? ''
            : this.#messages.message('equipment.weapon.candidate', {
                class: this.#message(`equipment.class.${readings.weapon.class}`),
                damage: this.#message(`equipment.damage.${readings.weapon.damageType}`),
                range: this.#formatters.metres(readings.effectiveRange),
              }),
        figure:
          readings === null ? '' : this.#formatters.decimal(readings.metrics.damagePerSecond, 1),
        figureUnit: readings === null ? null : this.#message('equipment.weapon.figure.unit'),
        current: fitted?.symbol === symbol,
      };
    });
  }

  /**
   * The recipes one slot's chooser offers.
   *
   * The recipe's name and nothing else, which is the whole of the canvas's own
   * picker row (`'<div …>' + m[0] + '</div>'`). The package names the engineers
   * who grant each recipe and the canvas never draws one — its only mention of
   * them is a feature caption — so the bench does not either (Commander request
   * 2026-09-04).
   */
  modificationChoices(target: EditTarget, slot: number): readonly ModificationChoiceView[] {
    const loadout = this.#store.loadout();
    if (loadout === null) return [];
    const held = this.#slots(loadout, target)?.[slot] ?? null;
    return modificationCandidates(loadout, target, slot).map((candidate) => ({
      symbol: candidate.symbol,
      name: this.#text.personalModificationName(candidate.symbol),
      current: held === candidate.symbol,
    }));
  }

  /** What one modification chooser is called. */
  modificationChooserTitle(slot: number): string {
    return this.#messages.message('equipment.chooser.modification', {
      slot: this.#formatters.integer(slot + 1),
    });
  }

  /**
   * The suit row of an empty bench: the one row that is a choice.
   *
   * Canvas 2a draws it selected, with a `+` where a badge goes and `SELECT →`
   * at its trailing edge — the only live row on the gate, because every other
   * row belongs to a suit that has not been chosen yet.
   */
  #emptySuitRow(): LedgerRowView {
    const choose = this.#message('equipment.suit.choose');
    const required = this.#message('equipment.suit.required');
    const select = this.#message('equipment.suit.select');
    return {
      target: 'suit',
      badge: this.#message('equipment.badge.empty'),
      name: null,
      emptyLabel: choose,
      meta: required,
      grade: null,
      modifications: select,
      modificationsWanting: false,
      held: false,
      // The `+` is left out: it is not a word, and it reads as one.
      accessibleName: rowName(choose, required, select),
    };
  }

  /** A mount with no suit to offer it: drawn, named, and locked. */
  #lockedMountRow(mount: PersonalMount): LedgerRowView {
    const mountName = this.#text.personalMountName(mount).text ?? mount.key;
    const locked = this.#message('equipment.mount.locked');
    const badge = this.#mountBadge(mount.key);
    return {
      target: mount.key,
      badge,
      name: null,
      emptyLabel: mountName,
      meta: locked,
      grade: null,
      modifications: null,
      modificationsWanting: false,
      held: true,
      accessibleName: rowName(badge, mountName, locked),
    };
  }

  #suitRow(loadout: EquipmentLoadout): LedgerRowView | null {
    const readings = suitReadings(loadout);
    if (readings === null) return null;
    const name = this.#text.suitName(loadout.suitFamily);
    const meta = this.#suitMounts(loadout.suitFamily);
    const used = readings.unlocked.length;
    const badge = this.#message('equipment.badge.suit');
    const grade = this.#grade(loadout.suitGrade);
    const modifications = this.#modificationCount(used, readings.modificationSlots);
    return {
      target: 'suit',
      badge,
      name,
      emptyLabel: null,
      meta,
      grade,
      modifications,
      modificationsWanting: used < readings.modificationSlots,
      held: false,
      accessibleName: rowName(
        badge,
        name.text ?? '',
        meta,
        grade,
        modifications,
        this.#modificationSummary(used, readings.modificationSlots),
      ),
    };
  }

  #mountRows(loadout: EquipmentLoadout): readonly LedgerRowView[] {
    const availability = mountAvailability(loadout);
    const suitModifiers = modifiersOf(suitReadings(loadout)?.unlocked ?? []);
    return CATALOGUE_MOUNTS.flatMap((mount, position): LedgerRowView[] => {
      // A mount the worn suit does not carry draws no row at all. What is on it
      // is retained and comes back with a suit that carries the mount (FR-007 is
      // about the loadout, not about the ledger) — but a bench that lists mounts
      // a Commander cannot use is listing the catalogue rather than the suit
      // (Commander request 2026-09-04). The canvas draws a dimmed
      // `Slot unavailable` row here; this is the divergence recorded in
      // 013 design/reference-review.md.
      if (availability[position] !== 'offered') return [];
      const fitted = loadout.weapons[position] ?? null;
      const mountName = this.#text.personalMountName(mount).text ?? mount.key;
      const badge = this.#mountBadge(mount.key);

      if (fitted === null) {
        const empty = this.#message('equipment.mount.empty');
        const choose = this.#message('equipment.mount.choose');
        return [
          {
            target: mount.key,
            badge,
            name: null,
            emptyLabel: empty,
            meta: choose,
            grade: null,
            modifications: null,
            modificationsWanting: false,
            held: false,
            // The mount's name comes first: the row shows only its code.
            accessibleName: rowName(mountName, badge, empty, choose),
          },
        ];
      }

      const readings = weaponReadings(mount.key, fitted, suitModifiers);
      const name = this.#text.personalWeaponName(fitted.symbol);
      // Every row that survives the filter above is a mount the worn suit
      // carries, so there is no unavailable state left to draw here.
      const meta = readings === null ? '' : this.#weaponMeta(readings.weapon);
      const used = readings?.unlocked.length ?? 0;
      const total = readings?.modificationSlots ?? 0;
      const grade = this.#grade(fitted.grade);
      const modifications = this.#modificationCount(used, total);
      return [
        {
          target: mount.key,
          badge,
          name,
          emptyLabel: null,
          meta,
          grade,
          modifications,
          modificationsWanting: used < total,
          held: false,
          accessibleName: rowName(
            mountName,
            badge,
            name.text ?? fitted.symbol,
            meta,
            grade,
            modifications,
            this.#modificationSummary(used, total),
          ),
        },
      ];
    });
  }

  #toolRow(id: string): ToolRowView {
    const name = this.#text.personalToolName(id);
    return {
      badge: this.#message('equipment.badge.tool'),
      name,
      // The dimming is not the only thing that says a tool cannot be swapped.
      accessibleName: this.#messages.message('equipment.tool.carried', {
        tool: name.text ?? id,
      }),
    };
  }

  #suitItem(loadout: EquipmentLoadout): ItemView | null {
    const readings = suitReadings(loadout);
    const suit = getSuitByFamily(loadout.suitFamily);
    if (readings === null || suit === null) return null;
    const grades = publishedSuitGrades(loadout.suitFamily);
    const everUnlocks = grades.some(
      (grade) => (suit.grades[String(grade) as '1']?.modificationSlots ?? 0) > 0,
    );

    return {
      target: 'suit',
      name: this.#text.suitName(loadout.suitFamily),
      subtitle: this.#suitMounts(loadout.suitFamily),
      grades,
      grade: loadout.suitGrade,
      attributes: [
        this.#attribute(
          'shieldStrength',
          'equipment.attribute.shieldStrength',
          this.#formatters.decimal(readings.shieldStrength, 1),
        ),
        this.#attribute(
          'shieldRegen',
          'equipment.attribute.shieldRegen',
          this.#messages.message('equipment.value.perSecond', {
            value: this.#formatters.decimal(readings.shieldRegeneration, 2),
          }),
        ),
        // Canvas 1a pairs the grid across: an `ARMOUR · KINETIC` cell beside a
        // `SHIELD · KINETIC` cell, and so on down the four damage types. Each
        // cell reads its own published stat — the armour's from the suit's grade
        // and the shield's from the suit — which is what Almanac 0.2.10 split
        // apart.
        ...RESISTANCES.flatMap(([armour, shield, damage]) => {
          const name = this.#message(`equipment.damage.${damage}`);
          return [
            {
              id: `armour-${damage}`,
              label: this.#messages.message('equipment.attribute.resistance.armour', {
                damage: name,
              }),
              value: this.#formatters.signedPercent(readings[armour]),
            },
            {
              id: `shield-${damage}`,
              label: this.#messages.message('equipment.attribute.resistance.shield', {
                damage: name,
              }),
              value: this.#formatters.signedPercent(readings[shield]),
            },
          ];
        }),
      ],
      slotsHeading: this.#slotsHeading(readings.unlocked.length, readings.modificationSlots),
      slots: everUnlocks
        ? this.#slotViews(loadout.suitModifications, readings.modificationSlots, grades, suit)
        : null,
      noUpgradeNotice: everUnlocks ? null : this.#message('equipment.item.noUpgrade'),
      chooserTitle: this.#message('equipment.chooser.suit'),
    };
  }

  #weaponItem(loadout: EquipmentLoadout, mount: PersonalMountKey): ItemView | null {
    const position = mountPosition(mount);
    const fitted = position < 0 ? null : (loadout.weapons[position] ?? null);
    // An empty mount is still an item: it is the one place a Commander opens
    // the chooser that fills it, so it states what the mount is and offers the
    // choice, with no grade ladder and no figure of its own to state.
    if (fitted === null) {
      const catalogue = CATALOGUE_MOUNTS[position];
      if (catalogue === undefined) return null;
      return {
        target: mount,
        name: this.#text.personalMountName(catalogue),
        subtitle: this.#message('equipment.mount.empty'),
        grades: [],
        grade: 0,
        attributes: [],
        slotsHeading: '',
        slots: null,
        noUpgradeNotice: null,
        chooserTitle: this.#message('equipment.mount.choose'),
      };
    }
    const suitModifiers = modifiersOf(suitReadings(loadout)?.unlocked ?? []);
    const readings = weaponReadings(mount, fitted, suitModifiers);
    if (readings === null) return null;
    const weapon = readings.weapon;
    const grades = publishedWeaponGrades(fitted.symbol);
    const metrics = readings.metrics;

    return {
      target: mount,
      name: this.#text.personalWeaponName(fitted.symbol),
      // Canvas 1a's subtitle says what kind of weapon it is and which mount it
      // is on — not the code line, which the ledger row beside it already
      // carries. The canvas's manufacturer word is not published for a weapon
      // and is left out (013 design/reference-review.md).
      subtitle: this.#messages.message('equipment.weapon.mounted', {
        class: this.#message(`equipment.class.${weapon.class}`),
        mount: this.#mountName(position) ?? mount,
      }),
      grades,
      grade: fitted.grade,
      attributes: [
        this.#attribute(
          'damagePerShot',
          'equipment.attribute.damagePerShot',
          this.#formatters.figure(metrics.damagePerShot, 3),
        ),
        this.#attribute(
          'rateOfFire',
          'equipment.attribute.rateOfFire',
          this.#messages.message('equipment.value.perSecond', {
            value: this.#formatters.figure(metrics.rateOfFire, 2),
          }),
        ),
        this.#attribute(
          'sustainedDps',
          'equipment.attribute.sustainedDps',
          this.#formatters.decimal(metrics.sustainedDamagePerSecond, 1),
        ),
        this.#attribute(
          'headshotDamage',
          'equipment.attribute.headshotDamage',
          this.#formatters.figure(metrics.headshotDamagePerShot, 3),
        ),
        this.#attribute(
          'magazine',
          'equipment.attribute.magazine',
          this.#formatters.integer(readings.magazineSize),
        ),
        this.#attribute(
          'reserveAmmo',
          'equipment.attribute.reserveAmmo',
          this.#formatters.integer(readings.reserveAmmo),
        ),
        this.#attribute(
          'effectiveRange',
          'equipment.attribute.effectiveRange',
          this.#formatters.metres(readings.effectiveRange),
        ),
        this.#attribute(
          'dps',
          'equipment.attribute.dps',
          this.#formatters.decimal(metrics.damagePerSecond, 1),
        ),
      ],
      slotsHeading: this.#slotsHeading(readings.unlocked.length, readings.modificationSlots),
      slots: this.#slotViews(fitted.modifications, readings.modificationSlots, grades, weapon),
      noUpgradeNotice: null,
      chooserTitle: this.#message(
        weapon.slot === 'primary'
          ? 'equipment.chooser.weapon.primary'
          : 'equipment.chooser.weapon.secondary',
      ),
    };
  }

  #slotViews(
    slots: readonly (string | null)[],
    unlocked: number,
    grades: readonly number[],
    item: { readonly grades: Readonly<Record<string, { readonly modificationSlots: number }>> },
  ): readonly ModificationSlotView[] {
    return Array.from({ length: MODIFICATION_SLOT_COUNT }, (_, slot) => {
      const symbol = slots[slot] ?? null;
      const locked = slot >= unlocked;
      const number = this.#formatters.integer(slot + 1);
      const name = symbol === null ? null : this.#text.personalModificationName(symbol);
      // The lowest grade that opens this slot, asked of the item's own grades
      // rather than assumed to be the slot number plus one.
      const needed = grades.find(
        (grade) => (item.grades[String(grade)]?.modificationSlots ?? 0) > slot,
      );
      const status = locked
        ? needed === undefined
          ? this.#message('equipment.slot.locked')
          : this.#messages.message(
              symbol === null ? 'equipment.slot.requires' : 'equipment.slot.heldRequires',
              { grade: this.#formatters.integer(needed) },
            )
        : symbol === null
          ? this.#message('equipment.slot.choose')
          : this.#noChange(symbol);

      return {
        slot,
        number,
        locked,
        name,
        emptyLabel:
          symbol === null
            ? this.#message(locked ? 'equipment.slot.locked' : 'equipment.slot.empty')
            : null,
        status,
        accessibleName: [
          this.#messages.message('equipment.slot.number', { slot: number }),
          name?.text ?? this.#message(locked ? 'equipment.slot.locked' : 'equipment.slot.empty'),
          status,
        ].join(' · '),
      };
    });
  }

  /**
   * A recipe with no published magnitude is stated as fitted with no numeric
   * change — never as a zero, a dash meaning zero, or an invented figure
   * (constitution IV).
   */
  #noChange(symbol: string): string {
    const modifiers = getPersonalModification(symbol)?.modifiers ?? [];
    return this.#message(
      modifiers.length === 0 ? 'equipment.slot.noChange' : 'equipment.slot.fitted',
    );
  }

  #attribute(id: string, label: MessageKey, value: string): Metric {
    return { id, label: this.#message(label), value };
  }

  #slots(loadout: EquipmentLoadout, target: EditTarget): readonly (string | null)[] | null {
    if (target === 'suit') return loadout.suitModifications;
    const position = mountPosition(target);
    return position < 0 ? null : (loadout.weapons[position]?.modifications ?? null);
  }

  #suitMounts(family: string): string {
    const suit = getSuitByFamily(family);
    const primary = suit?.mounts.filter((mount) => mount.kind === 'primary').length ?? 0;
    const secondary = (suit?.mounts.length ?? 0) - primary;
    return this.#messages.message('equipment.suit.mounts', {
      primary: this.#formatters.integer(primary),
      secondary: this.#formatters.integer(secondary),
    });
  }

  /** The catalogue's own word for one mount position, where it has one. */
  #mountName(position: number): string | null {
    const catalogue = CATALOGUE_MOUNTS[position];
    return catalogue === undefined ? null : this.#text.personalMountName(catalogue).text;
  }

  #weaponMeta(weapon: {
    readonly class: string;
    readonly damageType: string;
    readonly fireMode: string;
  }): string {
    return this.#messages.message('equipment.weapon.meta', {
      class: this.#message(`equipment.class.${weapon.class}`),
      damage: this.#message(`equipment.damage.${weapon.damageType}`),
      fireMode: this.#message(`equipment.fireMode.${weapon.fireMode}`),
    });
  }

  /**
   * The two-character code the canvas draws in a row's leading square.
   *
   * Keyed by the mount's own journal `SlotName`, so a mount the catalogue gains
   * simply has no code until one is written for it — a square with a guessed
   * code in it would be this application inventing a name for a mount.
   */
  #mountBadge(key: string): string {
    const message = `equipment.badge.${key}`;
    return MESSAGE_KEYS.includes(message as MessageKey)
      ? this.#messages.message(message as MessageKey)
      : '';
  }

  #grade(grade: number): string {
    return this.#messages.message('equipment.grade.short', {
      grade: this.#formatters.integer(grade),
    });
  }

  #modificationCount(used: number, total: number): string {
    return this.#messages.message('equipment.modifications.count', {
      used: this.#formatters.integer(used),
      total: this.#formatters.integer(total),
    });
  }

  #modificationSummary(used: number, total: number): string {
    return this.#messages.message('equipment.modifications.summary', {
      used: this.#formatters.integer(used),
      total: this.#formatters.integer(total),
    });
  }

  #slotsHeading(used: number, total: number): string {
    return this.#messages.message('equipment.slots.heading', {
      used: this.#formatters.integer(used),
      total: this.#formatters.integer(total),
    });
  }

  #resourceName(symbol: string): string {
    return this.#text.microResourceName(symbol).text ?? symbol;
  }

  #message(key: string): string {
    return this.#messages.message(key as MessageKey);
  }
}
