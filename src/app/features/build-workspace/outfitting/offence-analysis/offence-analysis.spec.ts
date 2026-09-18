import { TestBed } from '@angular/core/testing';
import { afterEach, vi } from 'vitest';
import { BuildMetrics } from '@elite-dangerous-almanac/core/ships/build-metrics';
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
  everyStateBuild,
  idleZeroCapacityBuild,
  noWeaponsBuild,
  partlyDisabledBuild,
  populatedBuild,
  zeroCapacityBuild,
} from '../../../../domain/ships/offence/offence.fixtures';
import { TARGET_RANGE } from '../../../../domain/ships/offence/convergence';
import englishMessages from '../../../../i18n/locales/en.json';
import { provideLocalization } from '../../../../i18n/i18n.providers';
import { provideIsolatedLocaleEnvironment } from '../../../../i18n/testing/localization-harness';
import { OffenceAnalysis } from './offence-analysis';
import { suppliedFit } from '../../../../domain/ships/build/supplied-fit';

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

    it('neither merges nor de-duplicates two mounts carrying the same module', () => {
      const loadout = populatedBuild();
      const symbols = BuildMetrics.of(loadout)
        .weaponMetrics()
        .weapons.map((weapon) => weapon.symbol);
      expect(new Set(symbols).size).toBeLessThan(symbols.length);

      const { component } = render(loadout);

      // Two rows, two distinct slots — the canvas draws duplicates as
      // duplicates, and the identity is the slot rather than the symbol.
      expect(component.weaponRows()).toHaveLength(symbols.length);
      expect(new Set(component.weaponRows().map((row) => row.id)).size).toBe(symbols.length);
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

    it('still draws the code line where the package published no recipe', () => {
      const { component, element } = render(populatedBuild());

      // The stock Anaconda's weapons are unengineered, so no recipe follows the
      // mount — the package published none, and a stock placeholder would be a
      // word this application chose. The line itself is still drawn: the canvas
      // gives every row a code line, and its first two parts are the module's
      // class and rating and its mount, which are published for all of them.
      for (const row of component.weaponRows()) {
        expect(row.engineering).toBeNull();
        expect(row.moduleClass).not.toBeNull();
        expect(row.rating).not.toBeNull();
      }
      for (const cell of element.querySelectorAll('.weapon__module')) {
        expect(cell.querySelector('.identity__code-line')?.textContent?.trim()).toBeTruthy();
      }
    });

    it('reads the code line off the package rather than out of the symbol', () => {
      const loadout = populatedBuild();
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

    it('names the allocation the four figures were read at, once under the block', () => {
      const { component } = render(populatedBuild());

      expect(component.capacitorAllocation()).toContain('2');
    });

    it('restates the allocation when feature 005 moves it', () => {
      const { component, detect } = render(populatedBuild());

      conditions.setPips('weapons', 4);
      detect();

      expect(component.capacitorAllocation()).toContain('4');
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
      expect(render(null).component.capacitorAllocation()).toBeNull();
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
      expect(component.weaponRows()).toHaveLength(
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
