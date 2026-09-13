import { getBlueprintName } from '@elite-dangerous-almanac/core/i18n/blueprints';
import { getExperimentalEffectName } from '@elite-dangerous-almanac/core/i18n/experimental-effects';
import { getMaterialName } from '@elite-dangerous-almanac/core/i18n/materials';
import {
  getLoadoutSlotName,
  getSlotRestrictionLabel,
} from '@elite-dangerous-almanac/core/i18n/slots';
import { CORE_MODULES } from '@elite-dangerous-almanac/core/ships/modules-core';
import { HARDPOINT_MODULES } from '@elite-dangerous-almanac/core/ships/modules-hardpoint';
import { INTERNAL_MODULES } from '@elite-dangerous-almanac/core/ships/modules-internal';
import { UTILITY_MODULES } from '@elite-dangerous-almanac/core/ships/modules-utility';
import { getLoadoutEditErrorMessage } from '@elite-dangerous-almanac/core/i18n/diagnostics';
import { getModuleName } from '@elite-dangerous-almanac/core/i18n/modules';
import { ShipLoadout } from '@elite-dangerous-almanac/core/ships/ship-loadout';
import { SHIPS } from '@elite-dangerous-almanac/core/ships/ships';
import { getMicroResourceName } from '@elite-dangerous-almanac/core/i18n/micro-resources';
import { getPersonalModificationName } from '@elite-dangerous-almanac/core/i18n/personal-modifications';
import { getPersonalToolName } from '@elite-dangerous-almanac/core/i18n/personal-tools';
import { getPersonalMountName, getSuitName } from '@elite-dangerous-almanac/core/i18n/suits';
import { PERSONAL_MODIFICATIONS } from '@elite-dangerous-almanac/core/equipment/modifications';
import { PERSONAL_TOOLS } from '@elite-dangerous-almanac/core/equipment/tools';
import { PERSONAL_WEAPONS } from '@elite-dangerous-almanac/core/equipment/weapons';
import { SUITS } from '@elite-dangerous-almanac/core/equipment/suits';
import { getPersonalModificationCost } from '@elite-dangerous-almanac/core/equipment/modification-costs';
import {
  personalWeaponNameLookup,
  presentGameText,
  shipManufacturerLookup,
  shipNameLookup,
} from './game-text.presenter';
import germanCatalogue from './locales/de.json';
import { BUNDLED_ENGLISH } from './locale-registry';

/**
 * Game text comes from the installed package, and from nowhere else.
 *
 * A hull's name, its manufacturer and the package's own diagnostics are the
 * Almanac's nouns. This application resolves them through the package — the
 * ships catalogue for the two proper nouns the game does not translate, the
 * i18n leaves for everything it does — renders the canonical text with a
 * disclosure when a translation is missing, and says so plainly when the
 * package has nothing. It never invents a string, never echoes a raw symbol as
 * a display name, and keeps no private catalogue of translated game text
 * (FR-020, constitution II).
 */

/** A locale the package certainly does not translate into. */
const UNTRANSLATED_LOCALE = 'qps-ploc';

describe('package text', () => {
  it('resolves every installed hull’s name and manufacturer through the package', () => {
    let renamed = 0;

    for (const ship of SHIPS) {
      const name = presentGameText(shipNameLookup, ship.symbol, 'en');
      const manufacturer = presentGameText(shipManufacturerLookup, ship.symbol, 'en');

      expect(name.translationState, ship.symbol).toBe('localized');
      expect(name.text, ship.symbol).toBe(shipNameLookup(ship.symbol, 'en'));
      expect(manufacturer.translationState, ship.symbol).toBe('localized');
      expect(manufacturer.text, ship.symbol).toBe(shipManufacturerLookup(ship.symbol, 'en'));

      if (name.text !== ship.symbol) {
        renamed += 1;
      }
    }

    // Some symbols happen to read as their own name — an Eagle is an "Eagle" —
    // so the guarantee is not that every name differs. It is that the names
    // come from the package: if they were symbols echoed as display text, none
    // would differ.
    expect(renamed).toBeGreaterThan(SHIPS.length / 2);
  });

  it('renders canonical package text with an untranslated disclosure', () => {
    const presented = presentGameText(shipNameLookup, SHIPS[0]!.symbol, UNTRANSLATED_LOCALE);

    expect(presented.text).toBe(shipNameLookup(SHIPS[0]!.symbol, 'en'));
    expect(presented.language).toBe('en');
    expect(presented.translationState).toBe('canonical');
    expect(presented.disclosureKey).toBe('game-text.untranslated.description');
  });

  it('states an absence rather than echoing the identity', () => {
    const presented = presentGameText(shipNameLookup, 'No_Such_Hull', 'en');

    expect(presented).toEqual({
      text: null,
      language: null,
      translationState: 'unavailable',
      disclosureKey: 'game-text.unavailable',
    });
  });

  it('resolves package diagnostics through the package too', () => {
    // A real diagnostic, refused by the package itself rather than a shape
    // invented here: a power plant does not go in a hardpoint.
    const loadout = ShipLoadout.default('Anaconda');
    const plant = loadout.modulesForSlot('PowerPlant')[0];
    expect(plant).toBeDefined();

    let refusal: unknown = null;
    try {
      loadout.setModule('SmallHardpoint1', plant!);
    } catch (error) {
      refusal = error;
    }
    expect(refusal).not.toBeNull();

    const issue = refusal as Parameters<typeof getLoadoutEditErrorMessage>[0];
    const presented = presentGameText(getLoadoutEditErrorMessage, issue, 'en');

    // Whatever the package says is what is presented. No application sentence
    // is substituted for a diagnostic.
    expect(presented.text).toBe(getLoadoutEditErrorMessage(issue, 'en'));
    expect(presented.translationState).toBe('localized');
  });

  it('adds no private translation of a game noun', () => {
    // Every application message key is application framing. A hull name, a
    // module name or a manufacturer appearing as a value here would be a second
    // catalogue that the package could contradict on its next release.
    const nouns = new Set<string>();
    for (const ship of SHIPS) {
      for (const text of [
        shipNameLookup(ship.symbol, 'en'),
        shipManufacturerLookup(ship.symbol, 'en'),
      ]) {
        if (text !== null && text.length > 0) {
          nouns.add(text.toLowerCase());
        }
      }
    }
    nouns.add((getModuleName('Int_Powerplant_Size8_Class1', 'en') ?? '').toLowerCase());

    const catalogues: readonly Record<string, string>[] = [
      BUNDLED_ENGLISH as Record<string, string>,
      germanCatalogue as Record<string, string>,
    ];

    for (const catalogue of catalogues) {
      for (const [key, value] of Object.entries(catalogue)) {
        expect(nouns.has(value.trim().toLowerCase()), `${key} restates a package noun`).toBe(false);
      }
    }
  });

  it('keeps no private table of entitlement names', () => {
    // An entitlement is an opaque Frontier token — `ELITE_HORIZONS_V_METAHULL`
    // — and the package publishes no name for one. The application explains
    // what an entitlement *means* and discloses the token as data; a catalogue
    // entry keyed or valued by a token would be a private game-data table
    // wearing a message key (FR-006, module-catalogue contract).
    const tokens = new Set<string>();
    for (const module of [
      ...CORE_MODULES,
      ...INTERNAL_MODULES,
      ...HARDPOINT_MODULES,
      ...UTILITY_MODULES,
    ]) {
      if (module.entitlement !== undefined) {
        tokens.add(module.entitlement);
      }
    }
    expect(tokens.size).toBeGreaterThan(0);

    const catalogues: readonly Record<string, string>[] = [
      BUNDLED_ENGLISH as Record<string, string>,
      germanCatalogue as Record<string, string>,
    ];

    // Every pair is checked and the offenders are collected, rather than
    // asserted one pair at a time: the catalogues and the module tables are
    // both long, and an assertion per pair costs more than the reading does.
    const offenders: string[] = [];
    for (const catalogue of catalogues) {
      for (const [key, value] of Object.entries(catalogue)) {
        for (const token of tokens) {
          if (key.includes(token)) {
            offenders.push(`${key} is keyed by an entitlement token`);
          }
          if (value.includes(token)) {
            offenders.push(`${key} hard-codes an entitlement token`);
          }
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('resolves every package leaf this feature needs through one rule', () => {
    // Each family feature 002 renders — slot label, restriction, blueprint,
    // effect, material — goes through the same presenter, so
    // the untranslated disclosure and the unavailable answer are the same rule
    // everywhere rather than six near-copies of it (FR-020).
    const build = ShipLoadout.default('Anaconda');
    const slot = build.slots('core')[0]!;

    expect(presentGameText(getLoadoutSlotName, slot, 'en').translationState).toBe('localized');
    expect(presentGameText(getSlotRestrictionLabel, 'military', 'en').translationState).toBe(
      'localized',
    );
    expect(presentGameText(getBlueprintName, 'Engine_Dirty', 'en').translationState).toBe(
      'localized',
    );
    expect(
      presentGameText(getExperimentalEffectName, 'special_engine_cooled', 'en').translationState,
    ).toBe('localized');
    expect(presentGameText(getMaterialName, 'Iron', 'en').translationState).toBe('localized');

    // The same rule at an untranslated locale: canonical text, disclosed.
    const disclosed = presentGameText(getBlueprintName, 'Engine_Dirty', UNTRANSLATED_LOCALE);
    expect(disclosed.text).toBe(getBlueprintName('Engine_Dirty', 'en'));
    expect(disclosed.disclosureKey).toBe('game-text.untranslated.description');
  });
});

/**
 * The equipment bench's nouns, on the same terms as the ship tool's.
 *
 * Suits, modifications, tools and micro resources are translated by the
 * library; weapon names and mount names are not, and both present as canonical
 * with their provenance stated rather than as gaps.
 */
describe('equipment package text', () => {
  const GERMAN = 'de';

  it('resolves every suit’s name in the locales the library carries', () => {
    for (const suit of SUITS) {
      const presented = presentGameText(getSuitName, suit.family, GERMAN);

      expect(presented.translationState, suit.family).toBe('localized');
      expect(presented.text, suit.family).toBe(getSuitName(suit.family, GERMAN));
    }
  });

  it('resolves every modification and every tool name the same way', () => {
    for (const symbol of Object.keys(PERSONAL_MODIFICATIONS)) {
      expect(presentGameText(getPersonalModificationName, symbol, GERMAN).translationState).toBe(
        'localized',
      );
    }
    for (const tool of PERSONAL_TOOLS) {
      expect(presentGameText(getPersonalToolName, tool.id, GERMAN).translationState).toBe(
        'localized',
      );
    }
  });

  it('resolves every micro resource a modification costs', () => {
    const symbols = new Set(
      Object.keys(PERSONAL_MODIFICATIONS).flatMap((symbol) =>
        (getPersonalModificationCost(symbol) ?? []).map((ingredient) => ingredient.symbol),
      ),
    );

    expect(symbols.size).toBeGreaterThan(0);
    for (const symbol of symbols) {
      expect(presentGameText(getMicroResourceName, symbol, GERMAN).translationState, symbol).toBe(
        'localized',
      );
    }
  });

  it('states a weapon’s name as canonical, because the game does not translate it', () => {
    // A Manticore Oppressor is a product name and every locale spells it the
    // same, so the catalogue answers for English and for no other locale.
    for (const weapon of PERSONAL_WEAPONS) {
      const presented = presentGameText(personalWeaponNameLookup, weapon.symbol, GERMAN);

      expect(presented.text, weapon.symbol).toBe(weapon.name);
      expect(presented.translationState, weapon.symbol).toBe('canonical');
      expect(presented.disclosureKey).toBe('game-text.untranslated.description');
    }
    expect(
      presentGameText(personalWeaponNameLookup, PERSONAL_WEAPONS[0]!.symbol, 'en').translationState,
    ).toBe('localized');
  });

  it('states a mount’s name as canonical in this release, and never as a gap', () => {
    // `getPersonalMountName` carries `en-GB` alone in Almanac 0.2.9
    // (DarkSession/Elite-Dangerous-Almanac#26). It presents as canonical English
    // with its provenance stated, and no check here asserts a translated mount
    // name. It becomes localized on the release that carries the other five
    // values, with no change in this application.
    for (const suit of SUITS) {
      for (const mount of suit.mounts) {
        const presented = presentGameText(getPersonalMountName, mount, GERMAN);

        expect(presented.text, mount.key).toBe(getPersonalMountName(mount, 'en'));
        expect(presented.text, mount.key).not.toBeNull();
        expect(presented.translationState, mount.key).toBe('canonical');
        expect(presented.disclosureKey).toBe('game-text.untranslated.description');
      }
    }
  });

  it('keeps no private translation of an equipment noun', () => {
    // Every equipment name a Commander reads comes from the library. A German
    // catalogue entry naming a suit, a weapon or a modification would be game
    // data owned outside the package (constitution II, FR-020).
    const owned = Object.values(germanCatalogue as Record<string, string>);
    const gameText = [
      ...SUITS.map((suit) => suit.name),
      ...PERSONAL_WEAPONS.map((weapon) => weapon.name),
      ...PERSONAL_TOOLS.map((tool) => tool.name),
      ...Object.values(PERSONAL_MODIFICATIONS).map((recipe) => recipe.name),
    ];

    for (const name of gameText) {
      expect(owned, name).not.toContain(name);
    }
  });
});
