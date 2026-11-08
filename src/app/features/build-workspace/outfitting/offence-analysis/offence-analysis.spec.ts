import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { afterEach, vi } from 'vitest';
import { BuildMetrics } from '@elite-dangerous-almanac/core/ships/build-metrics';
import type { FittedWeaponMetrics } from '@elite-dangerous-almanac/core/ships/build-metrics';
import type { ShipLoadout } from '@elite-dangerous-almanac/core/ships/ship-loadout';
import type { BuildCandidate } from '../../../../application/active-build/active-build.models';
import { ActiveBuildStore } from '../../../../application/active-build/active-build.store';
import { OutfittingStore } from '../../../../application/outfitting/outfitting.store';
import { PowerConditionsStore } from '../../../../application/power-heat/power-conditions.store';
import {
  OFFENCE_DEFAULT_SLOTS,
  OFFENCE_FIXTURE_HULL,
  OFFENCE_STATE_SLOTS,
  allDisabledBuild,
  drainingBuild,
  engineeredPairBuild,
  everyStateBuild,
  idleZeroCapacityBuild,
  mixedMountPairBuild,
  noWeaponsBuild,
  partlyDisabledBuild,
  populatedBuild,
  zeroCapacityBuild,
} from '../../../../domain/ships/offence/offence.fixtures';
import { TARGET_RANGE } from '../../../../domain/ships/offence/convergence';
import { lockedArticleBuild } from '../../../../domain/ships/outfitting/outfitting.fixtures';
import { GameTextPresenter } from '../../../../i18n/game-text.presenter';
import englishMessages from '../../../../i18n/locales/en.json';
import { provideLocalization } from '../../../../i18n/i18n.providers';
import { provideIsolatedLocaleEnvironment } from '../../../../i18n/testing/localization-harness';
import { ModuleIdentityBadge } from '../../../../ui/outfitting/module-identity-badge';
import { OFFENCE_ROW_MIN_REM, OffenceAnalysis } from './offence-analysis';
import { suppliedFit } from '../../../../domain/ships/build/supplied-fit';
import { groupIdenticalWeapons } from '../../../../domain/ships/offence/offence';
import { Formatters } from '../../../../i18n/formatters/formatters';
import germanMessages from '../../../../i18n/locales/de.json';
import type { MessageCatalogue } from '../../../../i18n/locale-registry';
import { LocaleStore } from '../../../../i18n/locale.store';

/**
 * The offence panel, from the outside.
 *
 * Every assertion below is against the package's own answer for the same build,
 * never against a number written here: a suite that pinned `248.6` would pass a
 * release that changed what the Almanac says and fail one that did not.
 *
 * The other half of the suite is about what must never appear. The canvas draws
 * shares, percentages, range bands and a target result; none of them is a
 * package field, and a test that only checked the figures that are there would
 * not notice one of them coming back.
 */
describe('OffenceAnalysis', () => {
  // The calculations moved onto `BuildMetrics` in Almanac 0.2.0, so the seam
  // is its prototype rather than one build. A prototype stays mocked for
  // every later test in this file unless it is put back.
  afterEach(() => {
    vi.restoreAllMocks();
  });

  let active: ActiveBuildStore;
  let conditions: PowerConditionsStore;
  let outfitting: OutfittingStore;

  function candidateFor(loadout: ShipLoadout): BuildCandidate {
    return {
      loadout,
      suppliedFit: suppliedFit(loadout.shipSymbol),
      hullName: OFFENCE_FIXTURE_HULL,
      provenance: 'stock',
      sourceNamed: null,
      autosaveRecordId: null,
      baseline: null,
    };
  }

  /**
   * Whether a drawn figure is a zero, rather than merely containing one.
   *
   * Every digit in it, and at least one: `"204.1"` contains a zero and is not
   * one, and a locale's own grouping and decimal marks are not digits, so this
   * says the same thing in every language the catalogue carries.
   */
  function readsZero(text: string | undefined): boolean {
    const digits = text?.match(/\d/gu) ?? [];
    return digits.length > 0 && digits.every((digit) => digit === '0');
  }

  function render(loadout: ShipLoadout | null) {
    if (loadout !== null) {
      active.commit(candidateFor(loadout));
    }
    const fixture = TestBed.createComponent(OffenceAnalysis);
    fixture.detectChanges();
    return {
      element: fixture.nativeElement as HTMLElement,
      component: fixture.componentInstance,
      detect: () => fixture.detectChanges(),
      fixture,
    };
  }

  /**
   * Every figure the panel draws, beside the word that names it.
   *
   * Read off the three shapes the panel actually uses: the canvas's
   * label-bar-figure rows, its four cells under the gunsight plate, and the
   * weapon table's own cells — whose label is visually hidden in the wide
   * arrangement and present in the accessibility tree either way, which is what
   * this is checking.
   */
  function pairs(element: HTMLElement): [string, string][] {
    const read = (selector: string, label: string, value: string): [string, string][] =>
      [...element.querySelectorAll(selector)].map((row) => [
        (row.querySelector(label)?.textContent ?? '').trim(),
        (row.querySelector(value)?.textContent ?? '').trim(),
      ]);

    return [
      ...read('.bar', '.bar__label', '.bar__value'),
      ...read('.fact', '.fact__label', '.fact__value'),
      ...read('.weapon__figure', '.weapon__figure-label', 'span:last-child'),
    ];
  }

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideLocalization(), ...provideIsolatedLocaleEnvironment()],
    });
    active = TestBed.inject(ActiveBuildStore);
    conditions = TestBed.inject(PowerConditionsStore);
    outfitting = TestBed.inject(OutfittingStore);
  });

  it('draws nothing at all without a build', () => {
    expect(render(null).element.textContent?.trim()).toBe('');
  });

  it('has nothing to say about a workspace with no build in it', () => {
    const { component } = render(null);

    expect(component.shown()).toBe(false);
    expect(component.headline()).toBeNull();
    expect(component.damageSegments()).toEqual([]);
    expect(component.rangeBands()).toEqual([]);
    expect(component.convergenceGeometry()).toBeNull();
    expect(component.mounted()).toBeNull();
    expect(component.collection()).toBeNull();
    expect(component.weaponRows()).toEqual([]);
  });

  describe('the weapon totals', () => {
    it('names both the burst and the sustained figure in full', () => {
      // A build whose two totals actually differ. The stock hull carries two
      // fixed pulse lasers that never reload, so its burst and sustained
      // figures are the same number and this assertion would pass whichever
      // field the component had read — which is the one thing it is for.
      const loadout = everyStateBuild();
      const total = BuildMetrics.of(loadout).weaponMetrics().total;
      expect(total.damagePerSecond).not.toBe(total.sustainedDamagePerSecond);

      const { component } = render(loadout);
      const headline = component.headline();

      // The large figure is the burst total; the line beside it names that
      // figure and carries the sustained one.
      expect(headline?.value).toContain(String(Math.round(total.damagePerSecond * 10) / 10));
      expect(headline?.note).toContain(
        String(Math.round(total.sustainedDamagePerSecond * 10) / 10),
      );
      expect(headline?.note).not.toContain(headline?.value ?? '');
    });

    it('counts the weapons the package returned', () => {
      const loadout = everyStateBuild();
      const returned = BuildMetrics.of(loadout).weaponMetrics().weapons.length;

      const { component } = render(loadout);

      expect(component.mounted()).toContain(String(returned));
    });

    it('counts weapons, not rows, where identical weapons share a row', () => {
      const loadout = populatedBuild();
      const returned = BuildMetrics.of(loadout).weaponMetrics().weapons.length;

      const { component } = render(loadout);

      expect(component.weaponRows().length).toBeLessThan(returned);
      expect(component.mounted()).toBe(
        englishMessages['offence.weapons.mounted'].replace('{{count}}', String(returned)),
      );
    });

    it('shows the package zero for an all-disabled build rather than an absence', () => {
      const { component } = render(allDisabledBuild());

      expect(component.collection()).toBe('populated');
      expect(readsZero(component.headline()?.value)).toBe(true);
      expect(readsZero(component.headline()?.note)).toBe(true);
    });
  });

  describe('the damage types', () => {
    it('states each type only where the canvas states it: in the bar and its legend', () => {
      // No canvas enumerates the damage types with a figure each. Canvas 1c
      // draws one stacked bar and writes the types it has segments for beside
      // it, so a type the build does not deal has no line rather than a zero,
      // and anti-xeno — which no canvas draws at all — is not read.
      const loadout = everyStateBuild();
      const split = BuildMetrics.of(loadout).weaponMetrics().total.damageByType;
      expect(split.antiXeno).toBeDefined();

      const { component } = render(loadout);
      const legend = component.damageSegments().map((segment) => segment.legend);

      expect(component.damageSegments().map((segment) => segment.id)).not.toContain('antiXeno');
      expect(legend.join(' ')).not.toContain('Anti');
    });

    it('draws each conventional type as a segment, with its own amount and share', () => {
      const loadout = everyStateBuild();
      const split = BuildMetrics.of(loadout).weaponMetrics().total.damageByType;

      const { component } = render(loadout);
      const segments = component.damageSegments();

      // Anti-xeno overlays conventional damage rather than dividing it, so it
      // is never a segment however much of it the build deals.
      expect(split.antiXeno).toBeGreaterThan(0);
      expect(segments.map((segment) => segment.id)).not.toContain('antiXeno');

      // Every segment reports its own amount and share in words beside the bar.
      for (const segment of segments) {
        const amount = split[segment.id as keyof typeof split] ?? 0;
        expect(segment.legend).toContain(String(Math.round(amount * 10) / 10));
        expect(segment.legend).toContain('%');
        expect(segment.width).toBeGreaterThan(0);
      }

      // The segments partition the conventional total exactly.
      const widths = segments.reduce((sum, segment) => sum + segment.width, 0);
      expect(widths).toBeCloseTo(1, 6);
    });

    it('names the caustic type in the legend, in the active locale', () => {
      // The legend is the whole reading, so the caustic label reaching it
      // through the localisation layer is what says the type is stated rather
      // than merely projected.
      const loadout = everyStateBuild();
      const split = BuildMetrics.of(loadout).weaponMetrics().total.damageByType;

      const { component } = render(loadout);
      const caustic = component.damageSegments().find((segment) => segment.id === 'caustic');

      expect(split.caustic).toBeGreaterThan(0);
      expect(caustic?.legend).toContain(englishMessages['offence.damage.type.caustic']);
      expect(caustic?.width).toBeGreaterThan(0);
    });

    it('draws no segment at all for a build that deals no conventional damage', () => {
      const { component } = render(allDisabledBuild());

      expect(component.damageSegments()).toEqual([]);
    });
  });

  describe('what the collection means', () => {
    it('says no weapons are fitted only when the hardpoints are confirmed empty', () => {
      const { component, element } = render(noWeaponsBuild());

      expect(component.collection()).toBe('noFittedWeapons');
      expect(element.textContent).toContain(englishMessages['offence.weapons.empty']);
    });

    it('leaves a populated build unqualified', () => {
      const { component } = render(populatedBuild());

      expect(component.collection()).toBe('populated');
    });
  });

  describe('the WEP allocation', () => {
    it('re-reads the projection when feature 005 moves the allocation', () => {
      const { component, detect } = render(populatedBuild());
      const before = component.projection();

      conditions.setPips('weapons', 0);
      detect();

      expect(component.projection()).not.toBe(before);
      expect(component.projection()?.capacitor.allocation).toBe(0);
    });
  });

  describe('the weapon collection', () => {
    it('draws one row per returned weapon, in exact package order', () => {
      const loadout = everyStateBuild();
      const returned = BuildMetrics.of(loadout)
        .weaponMetrics()
        .weapons.map((weapon) => weapon.slot);

      const { component } = render(loadout);

      expect(component.weaponRows().map((row) => row.id)).toEqual(returned);
    });

    it('makes one row per group of identical weapons, where its first weapon stands', () => {
      const loadout = populatedBuild();
      const weapons = BuildMetrics.of(loadout).weaponMetrics().weapons;
      const records = new Map(loadout.fittedModules().map((module) => [module.slot, module]));
      const groups = groupIdenticalWeapons(weapons, records);

      const { component } = render(loadout);

      expect(component.weaponRows().map((row) => row.slots)).toEqual(
        groups.map((group) => group.map((weapon) => weapon.slot)),
      );
      expect(component.weaponRows().map((row) => row.id)).toEqual(
        groups.map(([first]) => first.slot),
      );
      expect(component.weaponRows().map((row) => row.count)).toEqual(
        groups.map((group) => group.length),
      );
    });

    it('carries every member’s slot key on a shared row, and draws none of them', () => {
      const { component, element } = render(populatedBuild());

      const [row] = component.weaponRows();
      expect(component.weaponRows()).toHaveLength(1);
      expect(row?.slots).toEqual([...OFFENCE_DEFAULT_SLOTS]);
      const drawn = element.querySelector('.weapons')?.textContent ?? '';
      for (const slot of OFFENCE_DEFAULT_SLOTS) {
        expect(drawn).not.toContain(slot);
      }
    });

    it('keeps a disabled weapon’s row and its own figures', () => {
      const loadout = partlyDisabledBuild();
      const disabled = BuildMetrics.of(loadout)
        .weaponMetrics()
        .weapons.find((weapon) => weapon.slot === OFFENCE_DEFAULT_SLOTS[0]);

      const { component } = render(loadout);
      const row = component.weaponRows().find((entry) => entry.id === OFFENCE_DEFAULT_SLOTS[0]);

      expect(row?.off).toBe(true);
      expect(row?.offLabel).toBeTruthy();
      expect(row?.damagePerSecond).toContain(
        String(Math.round((disabled?.metrics.damagePerSecond ?? 0) * 10) / 10),
      );
    });

    it('draws the name alone on a row whose name no other row shows', () => {
      const { component, element } = render(populatedBuild());

      for (const row of component.weaponRows()) {
        expect(row.moduleClass).toBeNull();
        expect(row.rating).toBeNull();
        expect(row.mount).toBeNull();
        expect(row.engineering).toBeNull();
      }
      expect(element.querySelector('.weapon__module .identity__code-line')).toBeNull();
    });

    it('draws a code line on both rows of a pair with one name and different engineering', () => {
      const { component, element } = render(engineeredPairBuild());

      const rows = component.weaponRows();
      expect(rows).toHaveLength(2);
      expect(rows[0]?.name.text).toBe(rows[1]?.name.text);
      // The unengineered weapon names no recipe, because the package published
      // none. Its line still states the class, rating and mount.
      expect(rows[0]?.engineering).not.toBeNull();
      expect(rows[1]?.engineering).toBeNull();
      const lines = [...element.querySelectorAll('.weapon__module')].map((cell) =>
        cell.querySelector('.identity__code-line')?.textContent?.trim(),
      );
      expect(lines).toHaveLength(2);
      for (const line of lines) {
        expect(line).toBeTruthy();
      }
      expect(lines[0]).not.toBe(lines[1]);
    });

    it('draws a code line on a fixed and a gimballed weapon that share a name', () => {
      const { component, element } = render(mixedMountPairBuild());

      const rows = component.weaponRows();
      expect(rows).toHaveLength(2);
      expect(rows[0]?.name.text).toBe(rows[1]?.name.text);
      expect(rows[0]?.mount).not.toBe(rows[1]?.mount);
      expect(element.querySelectorAll('.weapon__module .identity__code-line')).toHaveLength(2);
    });

    it('reads the code line off the package rather than out of the symbol', () => {
      const loadout = engineeredPairBuild();
      const { component } = render(loadout);
      const fitted = BuildMetrics.of(loadout).weaponMetrics().weapons[0];
      const article = outfitting.slots().find((slot) => slot.key === fitted?.slot)?.module?.article;

      // Three separate package values. `4A` reads like something that could be
      // parsed back out of `Hpt_MultiCannon_Gimbal_Huge`, and that habit is
      // already wrong on some hulls (constitution II).
      const row = component.weaponRows()[0];
      expect(row?.moduleClass).toBe(article?.class ?? null);
      expect(row?.rating).toBe(article?.rating ?? null);
      expect(row?.mount).toBe(article?.mount ?? null);
    });

    it('states the count of a shared row once, drawn and in words', () => {
      const { element } = render(populatedBuild());

      const cell = element.querySelector('.weapon__module');
      const drawn = cell?.querySelector('.weapon__count');
      expect(drawn?.textContent?.trim()).toBe('×2');
      expect(drawn?.getAttribute('aria-hidden')).toBe('true');
      expect(cell?.querySelector('.visually-hidden')?.textContent?.trim()).toBe(
        '2 identical weapons, figures for each',
      );
    });

    it('draws no count on a row that stands for one weapon', () => {
      const { component, element } = render(everyStateBuild());

      expect(component.weaponRows().every((row) => row.count === 1)).toBe(true);
      expect(component.weaponRows().every((row) => row.countText === null)).toBe(true);
      expect(element.querySelector('.weapon__count')).toBeNull();
    });

    it('draws one weapon’s burst figure on a shared row, not the sum', () => {
      const loadout = populatedBuild();
      const [first] = BuildMetrics.of(loadout).weaponMetrics().weapons;

      const { component } = render(loadout);

      const row = component.weaponRows()[0];
      expect(row?.count).toBe(2);
      expect(row?.damagePerSecond).toBe(
        TestBed.inject(Formatters).decimal(first?.metrics.damagePerSecond ?? NaN, 1),
      );
    });

    it('names a weapon with no module record from its weapon-metrics symbol', () => {
      const loadout = populatedBuild();
      const returned = BuildMetrics.of(loadout).weaponMetrics();
      const [first] = returned.weapons;
      const unrecorded: FittedWeaponMetrics = {
        ...(first as FittedWeaponMetrics),
        slot: 'UnmappedHardpoint',
        symbol: 'Hpt_MultiCannon_Fixed_Large',
      };
      vi.spyOn(BuildMetrics.prototype, 'weaponMetrics').mockReturnValue({
        ...returned,
        weapons: [...returned.weapons, unrecorded],
      });

      const { component } = render(loadout);

      const row = component.weaponRows().find((entry) => entry.id === 'UnmappedHardpoint');
      expect(row?.name.text).toBe(
        TestBed.inject(GameTextPresenter).moduleName('Hpt_MultiCannon_Fixed_Large').text,
      );
      expect(row?.count).toBe(1);
    });

    it('leaves out a class or rating the package does not publish', () => {
      // Two weapons the hull layout does not name: no record and no article, so
      // neither class nor rating is published for them. They show one name, so
      // both rows ask for their code line.
      const loadout = populatedBuild();
      const returned = BuildMetrics.of(loadout).weaponMetrics();
      const [first] = returned.weapons;
      const unplaced = (slot: string, damagePerSecond: number): FittedWeaponMetrics => ({
        ...(first as FittedWeaponMetrics),
        slot,
        metrics: { ...(first as FittedWeaponMetrics).metrics, damagePerSecond },
      });
      vi.spyOn(BuildMetrics.prototype, 'weaponMetrics').mockReturnValue({
        ...returned,
        weapons: [unplaced('UnmappedA', 1), unplaced('UnmappedB', 2)],
      });

      const { component, element } = render(loadout);

      const rows = component.weaponRows();
      expect(rows).toHaveLength(2);
      for (const row of rows) {
        expect(row.moduleClass).toBeNull();
        expect(row.rating).toBeNull();
      }
      const drawn = element.querySelector('.weapons')?.textContent ?? '';
      expect(drawn).not.toMatch(/null|undefined|NaN/u);
    });

    it('names a weapon whose record carries a pre-engineered variant by that variant', () => {
      const { build, slot } = lockedArticleBuild();
      const variant = build.fittedModuleAt(slot)?.preEngineeredVariant;
      expect(variant).toBeTruthy();
      const text = TestBed.inject(GameTextPresenter);

      const { component } = render(build);

      const row = component.weaponRows().find((entry) => entry.id === slot);
      expect(row).toBeDefined();
      expect(row?.name.text).toBe(text.preEngineeredVariantName(variant!).text);
      expect(row?.name.text).not.toBe(text.moduleName(build.fittedModuleAt(slot)!.symbol).text);
    });

    it('draws a complete row for a weapon whose damage is a genuine zero', () => {
      const loadout = everyStateBuild();
      const { component } = render(loadout);

      // The package publishes `0` damage for this article — a statement, not an
      // absence — so its row carries a stated zero in the DPS column rather
      // than the not-stated text a missing field gets, and every other column
      // it does have is drawn beside it (FR-004).
      const zero = component.weaponRows().find((row) => row.id === OFFENCE_STATE_SLOTS.noPiercing);

      expect(zero).toBeDefined();
      expect(BuildMetrics.of(loadout).weaponMetrics().weapons).toContainEqual(
        expect.objectContaining({ slot: OFFENCE_STATE_SLOTS.noPiercing }),
      );
      expect(readsZero(zero?.damagePerSecond)).toBe(true);
      expect(zero?.name).toBeTruthy();

      // And the distinction the row exists to draw: this same article publishes
      // neither sparse field, so those read as not stated while the damage
      // reads as a zero. A row that rendered both the same way would be saying
      // the package answered nothing when it answered nothing three times and
      // zero once.
      expect(zero?.piercing).toBeNull();
      expect(zero?.falloff).toBeNull();
    });

    it('draws the package’s own maximum range as the canvas’s RANGE column', () => {
      const loadout = populatedBuild();
      const { component, element } = render(loadout);
      const fitted = BuildMetrics.of(loadout).weaponMetrics().weapons;

      // The 2026-08-25 canvas revision gave the list a `RANGE` column between
      // `PIERCE` and `FALLOFF`. It is the package's own `maximumRange`, which
      // the projection already carried for `damageFalloff()`: nothing is
      // derived and nothing is capped.
      expect(fitted.some((weapon) => weapon.maximumRange !== undefined)).toBe(true);
      for (const [index, row] of component.weaponRows().entries()) {
        const published = fitted[index]?.maximumRange;
        if (published === undefined) {
          expect(row.maximumRange).toBeNull();
        } else {
          // The digits the package returned, read out of the active locale's
          // own grouping and unit rather than compared as a string.
          expect((row.maximumRange ?? '').replace(/\D/g, '')).toBe(String(Math.round(published)));
        }
      }

      // And the head is drawn in the canvas's own order, with the figure it
      // names carrying that word in its own row.
      const heads = [...element.querySelectorAll('.weapons__column')].map((head) =>
        (head.textContent ?? '').trim(),
      );
      expect(heads).toEqual([
        component.columns().module,
        component.columns().damagePerSecond,
        component.columns().sustainedDamagePerSecond,
        component.columns().piercing,
        component.columns().maximumRange,
        component.columns().falloff,
      ]);
      expect(element.querySelectorAll('.weapon').length).toBeGreaterThan(0);
      for (const row of element.querySelectorAll('.weapon')) {
        expect(row.querySelectorAll('.weapon__figure')).toHaveLength(5);
      }
    });

    it('states an absent maximum range rather than dashing or zeroing it', () => {
      const loadout = everyStateBuild();
      const { component } = render(loadout);
      const fitted = BuildMetrics.of(loadout).weaponMetrics().weapons;

      // A weapon the package gives no maximum range keeps the not-stated text,
      // exactly as an absent falloff does (FR-004).
      for (const [index, row] of component.weaponRows().entries()) {
        expect(row.maximumRange === null).toBe(fitted[index]?.maximumRange === undefined);
      }
    });

    it('states an absent piercing factor or falloff range rather than zeroing it', () => {
      const loadout = everyStateBuild();
      const { component } = render(loadout);

      const noPiercing = component
        .weaponRows()
        .find((row) => row.id === OFFENCE_STATE_SLOTS.noPiercing);
      expect(noPiercing?.piercing).toBeNull();

      const noRange = component
        .weaponRows()
        .find((row) => row.id === OFFENCE_STATE_SLOTS.explosive);
      expect(noRange?.falloff).toBeNull();

      const both = component.weaponRows().find((row) => row.id === OFFENCE_STATE_SLOTS.kinetic);
      expect(both?.piercing).toBeTruthy();
      expect(both?.falloff).toBeTruthy();
    });

    it('draws not-stated text in the cell rather than leaving it blank', () => {
      const { element } = render(everyStateBuild());

      const notStated = [...element.querySelectorAll('.weapon__not-stated')];
      expect(notStated.length).toBeGreaterThan(0);
      for (const cell of notStated) {
        expect((cell.textContent ?? '').trim()).not.toBe('');
        expect((cell.textContent ?? '').trim()).not.toBe('0');
      }
    });
  });

  describe('the weapon rows', () => {
    it('leaves every row inert, as the canvas draws it', () => {
      const { element } = render(everyStateBuild());
      const rows = [...element.querySelectorAll('.weapon')];

      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) {
        expect(row.querySelectorAll('button, a, input, select, [role="button"]')).toHaveLength(0);
        expect(row.getAttribute('tabindex')).toBeNull();
        expect(row.getAttribute('role')).toBeNull();
      }
    });
  });

  describe('the weapon capacitor', () => {
    /** The capacitor block's own rows, by the id order the component builds. */
    function capacitorValues(component: OffenceAnalysis): Record<string, string | null> {
      return Object.fromEntries(component.capacitorRows().map((row) => [row.id, row.value]));
    }

    it('draws the four fields a canvas draws, and only those four', () => {
      const { component } = render(populatedBuild());

      // Canvas 1c's own three rows in its own order, with canvas 1d's
      // `WEP CAP` behind them.
      expect(component.capacitorRows().map((row) => row.id)).toEqual([
        'draw',
        'recharge',
        'endurance',
        'capacity',
      ]);
    });

    it('shows each field as the package returned it, in the unit each one is ruled to take', () => {
      const loadout = populatedBuild();
      const { component } = render(loadout);
      const returned = BuildMetrics.of(loadout).weaponsCapacitorMetrics({ weaponsPips: 2 });
      const drawn = capacitorValues(component);

      // The two rates carry the package's own unit: canvas 1c labels `DRAW`
      // and `RECHARGE` as `MW`, both package fields are MJ/s, and the package
      // wins. The capacity is the one exception and takes neither — it is the
      // game's `MW`, the unit the outfitting panel writes after a capacitor
      // pool, so this block and feature 005's distributor table agree with the
      // panel and with each other (ruled 2026-08-27). The figures themselves
      // are the package's throughout.
      expect(drawn['capacity']).toContain(returned.capacity.toFixed(2));
      expect(drawn['capacity']).toMatch(/ MW$/u);
      expect(drawn['recharge']).toContain(returned.rechargeRate.toFixed(2));
      expect(drawn['recharge']).toMatch(/ MJ\/s$/u);
      expect(drawn['draw']).toContain(returned.sustainedEnergyPerSecond.toFixed(2));
      expect(drawn['draw']).toMatch(/ MJ\/s$/u);
    });

    it('states the WEP pips in the heading, read from the shared conditions', () => {
      const { component, element, detect } = render(populatedBuild());

      conditions.setPips('weapons', 3);
      detect();

      expect(component.capacitorPips()).toBe('@ 3 pips');
      const heading = element.querySelector('.bars--capacitor .bars__label');
      expect(heading?.querySelector('.bars__pips')?.textContent?.trim()).toBe('@ 3 pips');
      expect(heading?.textContent?.replace(/\s+/gu, ' ').trim()).toBe(
        `${englishMessages['offence.capacitor.heading']} @ 3 pips`,
      );
    });

    it('follows the pip control when it changes', () => {
      const { element, detect } = render(populatedBuild());

      conditions.setPips('weapons', 4);
      detect();

      expect(element.querySelector('.bars__pips')?.textContent?.trim()).toBe('@ 4 pips');
    });

    it('never reads the pips the package echoes back', () => {
      const loadout = populatedBuild();
      const metrics = BuildMetrics.of(loadout).weaponsCapacitorMetrics({ weaponsPips: 1 });
      vi.spyOn(BuildMetrics.prototype, 'weaponsCapacitorMetrics').mockReturnValue(metrics);

      const { component, detect } = render(loadout);
      conditions.setPips('weapons', 3);
      detect();

      expect(component.capacitorPips()).toBe('@ 3 pips');
    });

    it('states its pips exactly once, and draws no condition line', () => {
      const { element, detect } = render(populatedBuild());
      conditions.setPips('weapons', 3);
      detect();

      const block = element.querySelector('.bars--capacitor');
      expect(block?.querySelectorAll('.bars__pips')).toHaveLength(1);
      expect(block?.textContent?.match(/pips/giu)).toHaveLength(1);
      expect(block?.querySelector('.bars__condition')).toBeNull();
    });

    it('writes a half pip for the active locale', () => {
      const { component, detect } = render(populatedBuild());

      // A whole pip given to systems is paid for half a pip at a time, so the
      // weapons bank lands on a half step.
      conditions.setPips('systems', 1);
      detect();
      expect(conditions.pips().weapons).toBe(2.5);

      expect(component.capacitorPips()).toBe('@ 2.5 pips');

      TestBed.inject(LocaleStore).commitCandidate(
        {
          requested: 'de',
          catalogue: germanMessages as unknown as MessageCatalogue,
          source: 'asset',
          failure: null,
        },
        'browser',
      );
      detect();

      expect(component.capacitorPips()).toBe('@ 2,5 Pips');
    });

    it('moves the recharge and the endurance with the allocation, and nothing else', () => {
      const { component, detect } = render(drainingBuild());
      conditions.setPips('weapons', 0);
      detect();
      const before = capacitorValues(component);

      conditions.setPips('weapons', 4);
      detect();
      const after = capacitorValues(component);

      // Capacity is a property of the fitted distributor, and the firing load
      // is a property of the weapons: no allocation moves either.
      expect(after['capacity']).toBe(before['capacity']);
      expect(after['draw']).toBe(before['draw']);
      expect(after['recharge']).not.toBe(before['recharge']);
      expect(after['endurance']).not.toBe(before['endurance']);
    });

    it('offers no way to change the allocation from here', () => {
      const { element } = render(populatedBuild());

      const capacitor = element.querySelector('.bars--capacitor');
      expect(capacitor).not.toBeNull();
      expect(capacitor?.querySelectorAll('button, input, select, [role="button"]')).toHaveLength(0);
    });

    it('states a finite endurance as a localized duration', () => {
      const loadout = drainingBuild();
      const { component, detect } = render(loadout);
      conditions.setPips('weapons', 0);
      detect();

      const returned = BuildMetrics.of(loadout).weaponsCapacitorMetrics({
        weaponsPips: 0,
      }).timeToDrain;
      expect(Number.isFinite(returned)).toBe(true);
      expect(capacitorValues(component)['endurance']).toContain(returned.toFixed(1));
    });

    it('draws the symbol for a recharge that keeps pace, and says what it stands for', () => {
      const loadout = populatedBuild();
      const { component, detect } = render(loadout);
      conditions.setPips('weapons', 4);
      detect();

      expect(BuildMetrics.of(loadout).weaponsCapacitorMetrics({ weaponsPips: 4 }).timeToDrain).toBe(
        Infinity,
      );
      const row = component.capacitorRows().find((entry) => entry.id === 'endurance');
      // The symbol is what the block draws; the sentence it stands for goes
      // beside it, out of sight, because a glyph cannot be read aloud.
      expect(row?.value).toBe(englishMessages['offence.capacitor.endurance.sustained']);
      expect(row?.meaning).toBe(englishMessages['offence.capacitor.endurance.sustained.meaning']);
      expect(row?.value).not.toMatch(/infinity/iu);
    });

    it('says an empty capacitor drains immediately rather than lasting no time', () => {
      const loadout = zeroCapacityBuild();
      const { component } = render(loadout);

      expect(BuildMetrics.of(loadout).weaponsCapacitorMetrics({ weaponsPips: 2 }).timeToDrain).toBe(
        0,
      );
      expect(capacitorValues(component)['endurance']).toBe(
        englishMessages['offence.capacitor.endurance.immediate'],
      );
    });

    it('keeps a zero capacity with a draw apart from a zero capacity without one', () => {
      // Read before the second build is committed: both components inject the
      // same store, so committing again would leave the first one projecting
      // the second build and the two readings would agree for the wrong reason.
      const firingValues = capacitorValues(render(zeroCapacityBuild()).component);
      const idleValues = capacitorValues(render(idleZeroCapacityBuild()).component);

      expect(firingValues['capacity']).toBe(idleValues['capacity']);
      // Zero capacity with a draw is an immediate drain; zero capacity with
      // nothing firing never drains at all. Same capacity, different outcome.
      expect(firingValues['endurance']).not.toBe(idleValues['endurance']);
    });

    it('states a zero capacity as the package’s own number, with no cause attached', () => {
      const { component, element } = render(zeroCapacityBuild());

      const capacity = component.capacitorRows().find((row) => row.id === 'capacity');
      expect(readsZero(capacity?.value)).toBe(true);
      // No unavailable substitute, and no explanation: the package documents
      // several ways to reach this result and does not say which applied, so
      // an adjacency a reader would take as the reason is the inference FR-007
      // forbids.
      expect(capacity?.fill).toBeNull();
      const capacitor = (
        element.querySelector('.bars--capacitor')?.textContent ?? ''
      ).toLowerCase();
      for (const cause of ['distributor', 'unpowered', 'priority', 'because']) {
        expect(capacitor).not.toContain(cause);
      }
    });

    it('draws a bar only where two figures share a scale', () => {
      const { component } = render(populatedBuild());
      const fills = Object.fromEntries(component.capacitorRows().map((row) => [row.id, row.fill]));

      // The draw and the recharge are the same quantity in the same unit and
      // are drawn against the larger of the two, so one of them fills its
      // track exactly. A stored pool and a duration have nothing on this screen
      // to be measured against, and get no track at all.
      expect(fills['capacity']).toBeNull();
      expect(fills['endurance']).toBeNull();
      expect(Math.max(fills['draw'] ?? 0, fills['recharge'] ?? 0)).toBeCloseTo(1, 6);
    });

    it('has no capacitor to describe without a build', () => {
      expect(render(null).component.capacitorRows()).toEqual([]);
      // No capacitor figure, so no pips are stated either.
      expect(render(null).component.capacitorPips()).toBeNull();
    });
  });

  describe('coverage the package could not establish', () => {
    /**
     * Feature 002's slot views, emptied.
     *
     * `hardpointCoverage()` answers `unavailable` for an empty view list, and
     * the store computes that list from the active build — so with a build
     * committed the real store never produces it. Stubbing the one input is
     * what renders the branch; the alternative is a template path that ships
     * having never been drawn.
     */
    function withoutSlotViews(): void {
      vi.spyOn(outfitting, 'slots').mockReturnValue([]);
    }

    it('says the coverage could not be established, rather than claiming no weapons', () => {
      withoutSlotViews();
      const { component, element } = render(populatedBuild());

      expect(component.collection()).toBe('coverageUnavailable');
      const drawn = element.querySelector('.offence__statement')?.textContent?.trim();
      expect(drawn).toBe(englishMessages['offence.weapons.unavailable']);
      expect(drawn).not.toBe(englishMessages['offence.weapons.empty']);
    });

    it('keeps the returned weapons and the package totals beside the qualification', () => {
      withoutSlotViews();
      const loadout = populatedBuild();
      const { component } = render(loadout);

      // The qualification says the list may be incomplete. It never truncates
      // the list, and it never blanks a total the package did return.
      // Every returned weapon is in a row's count.
      expect(component.weaponRows().reduce((total, row) => total + row.count, 0)).toBe(
        BuildMetrics.of(loadout).weaponMetrics().weapons.length,
      );
      expect(component.headline()?.value).toBeTruthy();
      expect(component.capacitorRows()).toHaveLength(4);
    });
  });

  describe('damage by range band', () => {
    it('draws the canvas\u2019s four distances, weakening as the target gets further', () => {
      const loadout = everyStateBuild();
      const { component } = render(loadout);
      const bands = component.rangeBands();

      expect(bands.map((band) => band.id)).toEqual(['500', '1000', '2000', '3000']);

      // Damage falls off with range, so no band out-damages a closer one, and
      // the closest fills its own track exactly.
      const figures = bands.map((band) => band.fill ?? 0);
      expect(figures[0]).toBeCloseTo(1, 6);
      for (let index = 1; index < figures.length; index += 1) {
        expect(figures[index]).toBeLessThanOrEqual(figures[index - 1] ?? 0);
      }
    });

    it('agrees with the package at point-blank range', () => {
      const loadout = populatedBuild();
      // Inside every weapon's falloff range nothing is attenuated, so the
      // nearest band has to equal the package's own burst total for the build.
      const total = BuildMetrics.of(loadout).weaponMetrics().total.damagePerSecond;

      const { component } = render(loadout);

      expect(component.rangeBands()[0]?.value).toContain(String(Math.round(total * 10) / 10));
    });

    it('counts only the weapons that are firing', () => {
      const { component } = render(allDisabledBuild());

      for (const band of component.rangeBands()) {
        expect(readsZero(band.value)).toBe(true);
      }
    });
  });

  describe('shot convergence', () => {
    it('re-projects at a new range without asking the package anything again', () => {
      const loadout = populatedBuild();
      const weapons = vi.spyOn(BuildMetrics.prototype, 'weaponMetrics');
      const capacitor = vi.spyOn(BuildMetrics.prototype, 'weaponsCapacitorMetrics');
      const { element, detect } = render(loadout);

      const asked = [weapons.mock.calls.length, capacitor.mock.calls.length] as const;
      const geometry = element.querySelector('ednb-shot-convergence');
      // Where the marks sit is what moves with the range now: the 2026-08-26
      // revision withdrew the ring caption and the four cells alike, so the
      // plate itself is the reading that has to change.
      const marks = () =>
        [...element.querySelectorAll<HTMLElement>('.plate__dot')].map((dot) => dot.style.left);
      const before = marks();

      const slider = element.querySelector<HTMLInputElement>('input[type="range"]');
      slider!.value = String(TARGET_RANGE.max);
      slider!.dispatchEvent(new Event('input', { bubbles: true }));
      detect();

      // The plate really moved, so the counts below are a reading rather than
      // the absence of one.
      expect(before.length).toBeGreaterThan(0);
      expect(marks()).not.toEqual(before);
      expect(geometry).not.toBeNull();
      // The range is the block's own signal and the geometry it projects from
      // is already in hand: what changes with the slider is where the same
      // published offsets land, which is `projectGunsight`'s job. The build's
      // measurement and the hull's offsets are not re-read to do it.
      expect(weapons).toHaveBeenCalledTimes(asked[0]);
      expect(capacitor).toHaveBeenCalledTimes(asked[1]);
      weapons.mockRestore();
      capacitor.mockRestore();
    });

    it('hands the block’s own geometry to the plate, and draws it', () => {
      const { component, element } = render(everyStateBuild());

      // The panel decides whether the hull can be placed at all; the plate and
      // its four cells are the block's own, and are checked where they live.
      expect(component.convergenceGeometry()).not.toBeNull();
      expect(element.querySelector('ednb-shot-convergence')).not.toBeNull();
      expect(element.querySelector('.plate')).not.toBeNull();
    });

    it('still places a hull the build has armed nothing on', () => {
      const { component, element } = render(noWeaponsBuild());

      // The catalogue places this hull whether or not the build armed it.
      // Saying it publishes no geometry would be a claim about the package
      // that is not true.
      const geometry = component.convergenceGeometry();
      expect(geometry).not.toBeNull();
      expect(element.querySelector('.plate')).not.toBeNull();
      // Every one of the hull's mounts is drawn, in the empty ink: where a
      // hardpoint sits is a property of the hull rather than of what is on it,
      // and a Commander with nothing fitted yet is asking exactly that.
      const mounts = geometry?.mounts.length ?? 0;
      expect(mounts).toBeGreaterThan(0);
      expect(element.querySelectorAll('.plate__dot')).toHaveLength(mounts);
      expect(element.querySelectorAll('.plate__dot--empty')).toHaveLength(mounts);
      // One dot a mount and nothing beside it: the hardpoint numerals were
      // withdrawn on 2026-08-27, and each mount's number is in its sentence.
      expect(element.querySelectorAll('.plate__numeral')).toHaveLength(0);
      // Rings and axes stay: they are the plate, not a reading of the build.
      expect(element.querySelectorAll('.plate__ring')).toHaveLength(2);
      // No group of armed mounts, so none of the four figures about one.
      expect(element.querySelectorAll('.fact')).toHaveLength(0);
    });

    it('says so in words when the catalogue does not place the hull at all', () => {
      // The gunsight catalogue carries every player-flyable hull, so this state
      // cannot be reached by choosing a ship. It is reached the only way it can
      // be — by the loadout reporting a hull the catalogue has never heard of,
      // which is what a release that dropped one would look like from here.
      const loadout = populatedBuild();
      vi.spyOn(loadout, 'shipSymbol', 'get').mockReturnValue('not_a_ship');

      const { component, element } = render(loadout);

      expect(component.convergenceGeometry()).toBeNull();
      expect(element.querySelector('ednb-shot-convergence')).toBeNull();
      expect(element.querySelector('.plate')).toBeNull();
      // A sentence rather than an empty plate: a plate with no marks on it
      // reads as a build whose shots all converge, which is a different claim.
      expect(element.querySelector('.offence__statement')?.textContent?.trim()).toBe(
        englishMessages['offence.convergence.unavailable'],
      );
    });
  });

  describe('the labels the three-column step cuts', () => {
    it('draws each label through the fit text, and no figure', () => {
      const { element } = render(populatedBuild());
      const fitted = (selector: string): string[] =>
        [...element.querySelectorAll(`${selector} ednb-fit-text`)].map((node) =>
          (node.textContent ?? '').trim(),
        );

      expect(fitted('.weapons__columns')).toEqual([
        englishMessages['offence.column.module'],
        englishMessages['offence.column.dps'],
        englishMessages['offence.column.sustained'],
        englishMessages['offence.column.pierce'],
        englishMessages['offence.column.range'],
        englishMessages['offence.column.falloff'],
      ]);
      // A range band's label is a distance, which is a figure.
      expect(fitted('.bars--range .bar__label')).toEqual([]);
      expect(element.querySelectorAll('.bars--range .bar__label')).toHaveLength(4);
      expect(fitted('.bars--capacitor .bar__label')).toHaveLength(4);
      expect(fitted('.offence__head')).toEqual([englishMessages['offence.damage.note']]);
      expect(
        element.querySelector(
          ':is(.headline, .bar__value, .weapon__figures, .split, .bars__pips) ednb-fit-text',
        ),
      ).toBeNull();
    });

    it('hands every weapon badge its whole name as the tip for a cut name', () => {
      const { component, fixture } = render(populatedBuild());
      const badges = fixture.debugElement
        .queryAll(By.directive(ModuleIdentityBadge))
        .map((node) => node.componentInstance as ModuleIdentityBadge);

      expect(badges.map((badge) => badge.nameTip())).toEqual(
        component.weaponRows().map((row) => row.name.text),
      );
    });

    it('states the step it turns at on its own host', () => {
      const { fixture } = render(populatedBuild());

      expect(
        (fixture.nativeElement as HTMLElement).style.getPropertyValue('--offence-row-min'),
      ).toBe(`${OFFENCE_ROW_MIN_REM}rem`);
    });
  });

  it('pairs every value it draws with a term', () => {
    const { element } = render(everyStateBuild());

    const drawn = pairs(element);
    expect(drawn.length).toBeGreaterThan(0);
    for (const [label, value] of drawn) {
      expect(label).not.toBe('');
      expect(value).not.toBe('');
    }
  });
});
