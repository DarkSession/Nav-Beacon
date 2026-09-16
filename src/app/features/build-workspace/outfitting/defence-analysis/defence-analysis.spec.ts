import { TestBed } from '@angular/core/testing';
import { BuildMetrics } from '@elite-dangerous-almanac/core/ships/build-metrics';
import type { CalculationIssue } from '@elite-dangerous-almanac/core/ships/loadout-calculations';
import { getModuleBySymbol } from '@elite-dangerous-almanac/core/ships/modules';
import type { ShipLoadout } from '@elite-dangerous-almanac/core/ships/ship-loadout';
import type { BuildCandidate } from '../../../../application/active-build/active-build.models';
import { ActiveBuildStore } from '../../../../application/active-build/active-build.store';
import { PowerConditionsStore } from '../../../../application/power-heat/power-conditions.store';
import {
  bankedBuild,
  DEFENCE_FIXTURE_HULL,
  disabledGeneratorBuild,
  disabledPlantBuild,
  fullyFittedBuild,
  resistantBuild,
  noGeneratorBuild,
  readyBuild,
  shedGeneratorBuild,
  unpoweredBanksBuild,
} from '../../../../domain/ships/defence/defence.fixtures';
import { provideLocalization } from '../../../../i18n/i18n.providers';
import { provideIsolatedLocaleEnvironment } from '../../../../i18n/testing/localization-harness';
import { DefenceAnalysis } from './defence-analysis';
import { suppliedFit } from '../../../../domain/ships/build/supplied-fit';

/**
 * The two cards, from the outside.
 *
 * Every assertion is against the package's own answer for the same build,
 * never against a number written here: a suite that pinned `1,842 MJ` would
 * pass a release that changed what the Almanac says and fail one that did not.
 *
 * The other half of the suite is about meaning carried in words. The canvas
 * says a weakness with a red figure and a hatch, an unbounded pool with `∞` and
 * a bank with nothing switched on by dimming it; a reader who can see none of
 * that has to get the same facts, so the tests read text wherever the fact is
 * the point.
 */
describe('DefenceAnalysis', () => {
  let active: ActiveBuildStore;
  let conditions: PowerConditionsStore;

  function candidateFor(loadout: ShipLoadout): BuildCandidate {
    return {
      loadout,
      suppliedFit: suppliedFit(loadout.shipSymbol),
      hullName: DEFENCE_FIXTURE_HULL,
      provenance: 'stock',
      sourceNamed: null,
      autosaveRecordId: null,
      baseline: null,
    };
  }

  function render(loadout: ShipLoadout | null) {
    if (loadout !== null) {
      active.commit(candidateFor(loadout));
    }
    const fixture = TestBed.createComponent(DefenceAnalysis);
    fixture.detectChanges();
    return {
      element: fixture.nativeElement as HTMLElement,
      component: fixture.componentInstance,
      detect: () => fixture.detectChanges(),
    };
  }

  /**
   * Every body row of one card's damage table, cell by cell.
   *
   * The bar's cell is left out: it holds no text at all, by design, and a
   * reader who cannot see it is owed the same three readings without it.
   */
  function damageCells(element: HTMLElement, card: string): string[][] {
    return [...element.querySelectorAll(`.${card} .damage tbody tr`)].map((row) =>
      [...row.querySelectorAll('th, td:not(.damage__bar)')].map((cell) =>
        (cell.textContent ?? '').trim(),
      ),
    );
  }

  function text(element: HTMLElement, selector: string): string {
    return (element.querySelector(selector)?.textContent ?? '').replace(/\s+/g, ' ').trim();
  }

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideLocalization(), ...provideIsolatedLocaleEnvironment()],
    });
    active = TestBed.inject(ActiveBuildStore);
    conditions = TestBed.inject(PowerConditionsStore);
  });

  // The calculations live on `BuildMetrics`, so the seam a test reaches for is
  // its prototype. A prototype stays mocked for every later test in this file
  // unless it is put back.
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('draws nothing at all without a build', () => {
    expect(render(null).element.textContent?.trim()).toBe('');
  });

  it('has nothing to say about a workspace with no build in it', () => {
    // The template asks once and draws nothing, so every group is checked here
    // instead: an absent build is an empty list rather than a zero, an
    // exception or a row of dashes.
    const { component } = render(null);

    expect(component.shown()).toBe(false);
    expect(component.shieldPool()).toBeNull();
    expect(component.armourPool()).toBeNull();
    expect(component.shieldDamage().rows).toEqual([]);
    expect(component.armourDamage().rows).toEqual([]);
    expect(component.recoveryFacts()).toEqual([]);
    expect(component.armourFacts()).toEqual([]);
    expect(component.shieldSources()).toEqual([]);
    expect(component.armourSources()).toEqual([]);
    expect(component.bankRow()).toBeNull();
  });

  describe('the shield card', () => {
    it('heads the pool with the package strength, which no allocation moves', () => {
      const build = fullyFittedBuild();
      const { component } = render(build);
      const expected = BuildMetrics.of(build).shieldMetricsResult().value!;

      expect(component.shieldPool()).toBe(
        new Intl.NumberFormat('en', { maximumFractionDigits: 0 }).format(expected.strength),
      );
    });

    it('names the fitted generator and its code beside the heading', () => {
      const { component } = render(fullyFittedBuild());
      const identity = component.shieldIdentity();

      expect(identity?.name.text).toBe('Shield Generator');
      expect(identity?.code).toBe('6E');
    });

    it('holds the bare resistances still and moves only the pip column', () => {
      // FR-002, as the 2026-08-25 revision settles it: `RESIST` and `MJ` are
      // the bare shield, which no allocation moves — the package's call for
      // them takes none — and the allocation is a second package call that
      // shows up in the fifth column alone.
      const build = fullyFittedBuild();
      const { component, detect } = render(build);
      const before = component.shieldDamage();

      conditions.setPips('systems', 4);
      detect();
      const after = component.shieldDamage();

      expect(after.rows.map((row) => row.resistance)).toEqual(
        before.rows.map((row) => row.resistance),
      );
      expect(after.rows.map((row) => row.pool)).toEqual(before.rows.map((row) => row.pool));
      expect(after.rows.map((row) => row.poolAtPips)).not.toEqual(
        before.rows.map((row) => row.poolAtPips),
      );
    });

    it('heads the fifth column with the allocation it was read at', () => {
      const { component, element, detect } = render(fullyFittedBuild());

      conditions.setPips('systems', 4);
      detect();
      // Two lines of one heading: the unit, and the allocation under it. A
      // reader is given both, because the condition is part of what the column
      // states.
      expect(component.shieldDamage().pipColumn).toEqual({
        unit: 'MJ',
        atPips: '× 4 SYS PIPS',
      });
      const heading = element.querySelector('.card--shield .damage__cell--at-pips');
      expect(heading?.textContent?.replace(/\s+/gu, ' ').trim()).toBe('MJ × 4 SYS PIPS');
      expect(heading?.querySelector('.damage__at-pips')?.textContent?.trim()).toBe('× 4 SYS PIPS');

      // A bank lands on a half pip by paying for another one, which is the only
      // way it can: a Commander assigns whole pips and the other two split the
      // cost. Two pips into engines from an even allocation leaves systems on
      // one and a half, and the column reads what it stands at.
      conditions.setPips('systems', 2);
      conditions.setPips('engines', 3);
      detect();
      expect(component.shieldDamage().pipColumn?.atPips).toBe('× 1.5 SYS PIPS');
    });

    it('repeats the bare pool in the fifth column at no pips', () => {
      // The package's own guarantee: at no pips the effective figures are the
      // bare ones. It is what makes the column safe to draw at any allocation.
      const { component, detect } = render(fullyFittedBuild());

      conditions.setPips('systems', 0);
      detect();
      const rows = component.shieldDamage().rows;

      expect(rows.map((row) => row.poolAtPips)).toEqual(rows.map((row) => row.pool));
    });

    it('gives the hull no such column, because pips do not reach it', () => {
      const { component } = render(fullyFittedBuild());

      expect(component.armourDamage().pipColumn).toBeNull();
      expect(component.armourDamage().rows.every((row) => row.poolAtPips === undefined)).toBe(true);
    });

    it('withdraws the fifth column when the capacitor is refused, and stands nothing in for it', () => {
      // The bare shield and the capacitor are two package results, and neither
      // borrows the other's figure. A capacitor the package declines takes its
      // column with it: repeating the bare pool under a heading naming an
      // allocation nobody read would be this application answering in the
      // package's place (FR-001, FR-002).
      //
      // The distributor is what the capacitor reading needs and the bare shield
      // does not, so an unresolved one is the state where the two results
      // actually diverge.
      const bare = render(fullyFittedBuild()).component.shieldDamage();
      vi.spyOn(BuildMetrics.prototype, 'shieldCapacitorMetricsResult').mockReturnValue({
        value: null,
        complete: false,
        issues: [
          {
            field: 'powerDistributor',
            reason: 'unresolved',
            message: 'The fitted power distributor could not be resolved.',
          },
        ],
      });
      const { component } = render(fullyFittedBuild());
      const table = component.shieldDamage();

      expect(table.pipColumn).toBeNull();
      expect(table.rows.every((row) => row.poolAtPips === undefined)).toBe(true);
      // Everything but the fifth column is untouched — the type, both figures
      // and the bar, which is drawn from the bare resistance and would be the
      // first thing to move if a refused capacitor were quietly stood in for.
      const exceptPipColumn = ({ poolAtPips: _drop, ...rest }: (typeof bare.rows)[number]) => rest;
      expect(table.rows.map(exceptPipColumn)).toEqual(bare.rows.map(exceptPipColumn));
      expect(table.rows).toHaveLength(4);
    });

    it('draws no table at all when the bare shield is refused, capacitor or no', () => {
      // The other direction of the same rule, which the contract states and
      // nothing proved: a shield the package declined is not answered with the
      // capacitor's figures, even though that result stands. There is nothing
      // for a fifth column to sit beside, so there is no column and no row.
      const build = fullyFittedBuild();
      // The premise, asserted rather than assumed: without this the test could
      // pass because the capacitor was refused too, which proves nothing.
      expect(
        BuildMetrics.of(build).shieldCapacitorMetricsResult({
          systemsPips: conditions.pips().systems,
        }).complete,
      ).toBe(true);
      vi.spyOn(BuildMetrics.prototype, 'shieldMetricsResult').mockReturnValue({
        value: null,
        complete: false,
        issues: [
          {
            field: 'shieldGenerator',
            reason: 'missing',
            message: 'No shield generator is fitted.',
          },
        ],
      });
      const { component } = render(build);
      const table = component.shieldDamage();

      expect(table.rows).toHaveLength(0);
      expect(table.pipColumn).toBeNull();
      // And the refusal is stated in the package's own terms rather than drawn
      // as an empty table nobody explained.
      expect(component.shieldIssues().length).toBeGreaterThan(0);
    });

    it('pairs every damage type with the package resistance and both pools it returned', () => {
      const build = fullyFittedBuild();
      const { element } = render(build);
      const bare = BuildMetrics.of(build).shieldMetricsResult().value!;
      const atPips = BuildMetrics.of(build).shieldCapacitorMetricsResult({
        systemsPips: conditions.pips().systems,
      }).value!;
      const percent = new Intl.NumberFormat('en', {
        style: 'percent',
        maximumFractionDigits: 0,
      });
      const whole = new Intl.NumberFormat('en', { maximumFractionDigits: 0 });
      const weakness = (resistance: number) => (resistance < 0 ? ' Weakness' : '');

      expect(damageCells(element, 'card--shield')).toEqual(
        (['kinetic', 'thermal', 'explosive', 'caustic'] as const).map((type) => [
          `${type[0]!.toUpperCase()}${type.slice(1)}`,
          `${percent.format(bare.resistances[type])}${weakness(bare.resistances[type])}`,
          whole.format(bare.effectiveHitPoints[type]),
          whole.format(atPips.effectiveHitPoints[type]),
        ]),
      );
    });

    it('says why there is no shield, once per reason the package gave', () => {
      const build = noGeneratorBuild();
      const { component, element } = render(build);
      const issues = BuildMetrics.of(build).shieldMetricsResult().issues;

      expect(component.shieldAvailable()).toBe(false);
      expect(component.shieldPool()).toBeNull();
      expect(component.shieldIssues()).toHaveLength(issues.length);
      expect(text(element, '.card--shield .issue')).toBe('No shield generator is fitted.');
    });

    it('keeps the package’s own words for a diagnosis it does not word itself', () => {
      // `powerDistributor` / `unresolved` has no entry in the card's own table,
      // so the package's sentence reaches the screen. Under this suite's `en`
      // locale it needs no disclosure; under any other the shared presenter
      // frames it as canonical. That fallback is what keeps a release adding a
      // new reason from drawing a blank.
      vi.spyOn(BuildMetrics.prototype, 'shieldMetricsResult').mockReturnValue({
        value: null,
        complete: false,
        issues: [
          {
            field: 'powerDistributor',
            reason: 'unresolved',
            message: 'The fitted power distributor could not be resolved.',
          },
        ],
      });
      const { element } = render(readyBuild());

      expect(text(element, '.card--shield .issue')).toBe(
        'The fitted power distributor could not be resolved.',
      );
    });

    it('draws no damage table and no source rows for a shield the package refused', () => {
      const { component, element } = render(disabledGeneratorBuild());

      expect(component.shieldDamage().rows).toEqual([]);
      expect(component.shieldSources()).toEqual([]);
      expect(element.querySelector('.card--shield .damage')).toBeNull();
    });

    it('keeps the hull card whole while the shield is unavailable', () => {
      const { component } = render(disabledGeneratorBuild());

      expect(component.armourPool()).not.toBeNull();
      expect(component.armourDamage().rows).toHaveLength(4);
      expect(component.armourSources().length).toBeGreaterThan(0);
    });
  });

  describe('recovery', () => {
    it('draws the recharge rate and both durations the package returned', () => {
      const build = fullyFittedBuild();
      const { component } = render(build);
      const expected = BuildMetrics.of(build).shieldRecoveryResult({
        systemsPips: conditions.pips().systems,
      }).value!;

      const facts = component.recoveryFacts();
      expect(facts.map((fact) => fact.id)).toEqual(['rate', 'regen', 'broken']);
      expect(facts[0]?.value).toContain(
        new Intl.NumberFormat('en', {
          minimumFractionDigits: 1,
          maximumFractionDigits: 1,
        }).format(expected.regenRate),
      );
      expect(facts[1]?.value).not.toBeNull();
      expect(facts[2]?.value).not.toBeNull();
    });

    it('states a phase that never finishes rather than drawing it as seconds', () => {
      // With nothing in the SYS capacitor the package answers `Infinity`, which
      // is a phase that does not complete rather than a very large number.
      const { component, detect } = render(readyBuild());
      conditions.setPips('systems', 0);
      detect();

      const facts = component.recoveryFacts();
      expect(facts[1]?.value).toBeNull();
      expect(facts[1]?.unavailableLabel).toBe('∞');
      expect(facts[1]?.description).toBe('Does not finish at this systems allocation');
      expect(facts[2]?.value).toBeNull();
    });

    it('is diagnosed on its own when the package refuses it and not the strength', () => {
      // The recovery reads everything the strength reads and more. After the
      // same generator and retracted power state it reads the generator's
      // distributor draw and its two regeneration rates, then resolves the
      // systems capacitor, which refuses with `powerDistributor` / `unresolved`.
      // That is the pair mocked here; the package reaches it only with a
      // resolved module, so its own issue would carry a slot and a symbol this
      // one leaves out.
      //
      // It is mocked rather than built because every fixture fits real package
      // modules, which carry those stats and a distributor the package
      // resolves. The card states the reason under the recovery, beside a
      // strength that stands.
      vi.spyOn(BuildMetrics.prototype, 'shieldRecoveryResult').mockReturnValue({
        value: null,
        complete: false,
        issues: [
          {
            field: 'powerDistributor',
            reason: 'unresolved',
            message: 'The fitted power distributor could not be resolved.',
          },
        ],
      });
      const { component, element } = render(fullyFittedBuild());

      expect(component.shieldAvailable()).toBe(true);
      expect(component.recoveryFacts()).toEqual([]);
      expect(component.recoveryShown()).toBe(true);
      expect(component.recoveryIssues()).toHaveLength(1);
      expect(text(element, '.card--shield .issue')).toBe(
        'The fitted power distributor could not be resolved.',
      );
    });
  });

  /**
   * Everything that refuses the strength refuses the recovery too.
   *
   * Both calls resolve the same generator and the same retracted power state
   * first, so whatever stops the strength returns as the same issue from the
   * recovery. A Commander is given that reason once (FR-003). The four builds
   * below are the ones the fixtures reach, not the whole of that set.
   */
  describe('a reason that refuses both readings', () => {
    const cases: readonly [string, () => ShipLoadout, string][] = [
      ['a generator that is not fitted', noGeneratorBuild, 'No shield generator is fitted.'],
      ['a generator switched off', disabledGeneratorBuild, 'The shield generator is switched off.'],
      [
        'a generator the plant sheds',
        shedGeneratorBuild,
        'Insufficient power for the shield generator.',
      ],
      ['a plant switched off', disabledPlantBuild, 'Insufficient power for the shield generator.'],
    ];

    it.each(cases)('states %s once rather than under both headings', (_name, make, worded) => {
      const build = make();
      const { component, element } = render(build);
      const refused = BuildMetrics.of(build).shieldMetricsResult().issues;

      // The premise: the package refuses both readings for the same thing.
      expect(refused).toHaveLength(1);
      expect(
        BuildMetrics.of(build).shieldRecoveryResult({ systemsPips: conditions.pips().systems })
          .issues,
      ).toEqual(refused);

      // The strength states it, and the recovery block is removed with it: one
      // unavailable state, one reason, in the Commander's own language.
      expect(component.shieldIssues()).toHaveLength(1);
      expect(component.recoveryIssues()).toEqual([]);
      expect(component.recoveryShown()).toBe(false);
      expect(element.querySelectorAll('.card--shield .issue')).toHaveLength(1);
      // The reason states the absence, so nothing says "Unavailable" beside it.
      expect(element.querySelectorAll('.card--shield ednb-unavailable-value')).toHaveLength(0);
      expect(text(element, '.card--shield .issue')).toBe(worded);
      // The card states the package's diagnosis, not a reading of its prose.
      expect(text(element, '.card--shield .issue')).not.toBe(refused[0]!.message);
    });

    it('tells a fitted generator, a switched-off one and an unfed one apart', () => {
      // Three sentences for four builds. Nothing fitted, switched off and
      // unfed are three different things to do about it, and FR-003 keeps them
      // apart; the two ways the plant leaves the generator unfed are one thing
      // to do about it and read alike, which is the whole point of the shared
      // message.
      const drawn = cases.map(([, make]) => {
        const { element } = render(make());
        return text(element, '.card--shield .issue');
      });

      expect(new Set(drawn).size).toBe(3);
      expect(drawn[2]).toBe(drawn[3]);
      expect(drawn.every((reason) => reason.length > 0)).toBe(true);
    });

    it('draws a repeated reason once and a reason only the recovery has as well', () => {
      // The strength is the package's own refusal, unmocked. The recovery is
      // given that same issue and a second one — a shape Almanac 0.2.10 does
      // not return, because every incomplete result it builds carries exactly
      // one issue and a refused strength is handed back to the recovery
      // unchanged.
      //
      // It is mocked to prove the rule is per issue rather than per result. The
      // per-result shortcut passes every reachable state today, and loses a
      // diagnosis the first time a release returns two.
      const build = noGeneratorBuild();
      const shared = BuildMetrics.of(build).shieldMetricsResult().issues[0]!;
      const extra: CalculationIssue = {
        field: 'powerDistributor',
        reason: 'unresolved',
        message: 'The fitted power distributor could not be resolved.',
      };
      vi.spyOn(BuildMetrics.prototype, 'shieldRecoveryResult').mockReturnValue({
        value: null,
        complete: false,
        issues: [shared, extra],
      });
      const { component, element } = render(build);

      expect(component.shieldIssues()).toHaveLength(1);
      expect(component.recoveryIssues()).toHaveLength(1);
      expect(component.recoveryShown()).toBe(true);
      expect(
        [...element.querySelectorAll('.card--shield .issue')].map((node) =>
          (node.textContent ?? '').replace(/\s+/gu, ' ').trim(),
        ),
      ).toEqual(['No shield generator is fitted.', extra.message]);
    });

    /**
     * The five things {@link issueKey} compares, on one issue.
     *
     * The `params` here is not a shape the package returns. Its own `params`
     * mirrors `field`, `reason`, `slot` and `symbol`, so a row moving one of
     * those would move `params` with it and would still pass with that identity
     * dropped from the key. An unrelated key holds `params` still while each of
     * the other four moves alone.
     *
     * The message is left out of the comparison: it is derived from the rest,
     * and comparing it would be reading the English text.
     */
    const stated: CalculationIssue = {
      field: 'shieldGenerator',
      reason: 'disabled',
      slot: 'Slot03_Size6',
      symbol: 'Int_ShieldGenerator_Size6_Class1',
      message: 'the mount is switched off',
      params: { available: '4.2' },
    };

    /**
     * The same issue, one stated thing different, once for each of them.
     *
     * Two issues alike in all five are one reason and are drawn once, so each
     * of the five has to be part of what tells them apart. Exactly one thing
     * moves per row, and the message does not move at all: a row that changed
     * two would still pass with either of them dropped from the key, and one
     * that changed the message would pass on the text rather than the identity.
     */
    const identities: readonly [string, CalculationIssue][] = [
      ['the input field', { ...stated, field: 'powerCapacity' }],
      ['the reason', { ...stated, reason: 'shed' }],
      ['the mount', { ...stated, slot: 'Slot04_Size6' }],
      ['the module', { ...stated, symbol: 'Int_ShieldGenerator_Size6_Class3' }],
      ['the interpolated values', { ...stated, params: { available: '5.8' } }],
    ];

    it.each(identities)('tells two issues apart by %s', (_name, second) => {
      vi.spyOn(BuildMetrics.prototype, 'shieldMetricsResult').mockReturnValue({
        value: null,
        complete: false,
        issues: [stated],
      });
      vi.spyOn(BuildMetrics.prototype, 'shieldRecoveryResult').mockReturnValue({
        value: null,
        complete: false,
        issues: [second],
      });
      const { component } = render(disabledGeneratorBuild());

      expect(component.shieldIssues()).toHaveLength(1);
      expect(component.recoveryIssues()).toHaveLength(1);
    });
  });

  describe('the armour card', () => {
    it('heads the pool with the package hull points and names the bulkhead', () => {
      const build = fullyFittedBuild();
      const { component } = render(build);

      expect(component.armourPool()).toBe(
        new Intl.NumberFormat('en', { maximumFractionDigits: 0 }).format(
          BuildMetrics.of(build).armourMetrics().hitPoints,
        ),
      );
      expect(component.armourIdentity()?.name.text).toBe('Military Grade Composite');
      // A bulkhead has no size or rating a Commander outfits by, and the canvas
      // draws none beside the heading.
      expect(component.armourIdentity()?.code).toBeNull();
    });

    it('carries a negative resistance as a signed figure and as a word', () => {
      // The stock lightweight alloy is kinetically weak, and the package says so
      // with a resistance below zero.
      const { component } = render(readyBuild());
      const kinetic = component.armourDamage().rows[0]!;

      expect(BuildMetrics.of(readyBuild()).armourMetrics().resistances.kinetic).toBeLessThan(0);
      expect(kinetic.weakness).toBe(true);
      expect(kinetic.weaknessLabel).toBe('Weakness');
      expect(kinetic.resistance).toContain('-');
    });

    it('draws a weakness back from the zero mark and a resistance on from it', () => {
      // The bar is decoration over a figure that is stated anyway, but it has to
      // be honest decoration: a scale that drew a weakness rightwards from the
      // leading edge would say the hull resists what it is worst against.
      const { component } = render(readyBuild());
      const table = component.armourDamage();
      const weak = table.rows.filter((row) => row.weakness);
      const strong = table.rows.filter((row) => !row.weakness);

      expect(table.signed).toBe(true);
      expect(table.zeroAt).toBeGreaterThan(0);
      expect(weak.length).toBeGreaterThan(0);
      for (const row of weak) {
        expect(row.barStart + row.barLength).toBeCloseTo(table.zeroAt, 6);
      }
      for (const row of strong) {
        expect(row.barStart).toBeCloseTo(table.zeroAt, 6);
      }
    });

    it('names the far end of the scale the bars are drawn on', () => {
      const { component, element } = render(readyBuild());
      const table = component.armourDamage();
      const ceiling = element.querySelector<HTMLElement>('.card--armour .scale__mark--ceiling');

      // The package stops publishing a bound at `100%`, so that is where the
      // track ends and the name stands at the end of it.
      expect(table.ceiling).toBe(new Intl.NumberFormat('en', { style: 'percent' }).format(1));
      expect(ceiling?.textContent?.trim()).toBe(table.ceiling);
    });

    it('prints zero at the mark on a table that reaches below it', () => {
      const { component, element } = render(readyBuild());
      const zero = element.querySelector<HTMLElement>('.card--armour .scale__mark--zero');

      // The point the bars are measured from is the one that says which of them
      // are resistances and which are weaknesses, and on a signed table it
      // stands inside the track rather than at either end.
      expect(component.armourDamage().zero).toBe('0%');
      expect(component.armourDamage().zeroAt).toBeGreaterThan(0);
      expect(zero?.textContent?.trim()).toBe('0%');
      expect(zero?.style.insetInlineStart).toBe(`${component.armourDamage().zeroAt * 100}%`);
    });

    it('starts every bar at the leading edge on a table with no weakness in it', () => {
      // Every stock generator is weak to thermal, so the unsigned table is an
      // engineered one. Both branches of the scale are covered: this, and the
      // signed hull table above it.
      const { component, element } = render(resistantBuild());
      const table = component.shieldDamage();

      expect(table.rows.every((row) => row.resistance.startsWith('-'))).toBe(false);
      expect(table.signed).toBe(false);
      expect(table.zeroAt).toBe(0);
      expect(table.rows.every((row) => row.barStart === 0)).toBe(true);
      // Zero is the start of the scale here, which is where the canvas prints
      // its own `0%`: one mark, standing wherever zero happens to be.
      const zero = element.querySelector<HTMLElement>('.card--shield .scale__mark--zero');
      expect(zero?.textContent?.trim()).toBe(table.zero);
      expect(zero?.style.insetInlineStart).toBe('0%');
    });

    it('draws hardness, module protection and integrity as three separate facts', () => {
      const build = fullyFittedBuild();
      const { component } = render(build);
      const facts = component.armourFacts();
      const metrics = BuildMetrics.of(build).armourMetrics();

      expect(facts.map((fact) => fact.label)).toEqual(['Hardness', 'Module prot.', 'Integrity']);
      expect(facts[1]?.value).toBe(
        new Intl.NumberFormat('en', { style: 'percent', maximumFractionDigits: 0 }).format(
          metrics.moduleProtection,
        ),
      );
      expect(facts[2]?.value).toBe(
        new Intl.NumberFormat('en', { maximumFractionDigits: 0 }).format(metrics.moduleArmour),
      );
    });
  });

  describe('the source rows', () => {
    it('carries the package aggregate for each role, the first without a sign', () => {
      const build = fullyFittedBuild();
      const { component } = render(build);
      const shield = BuildMetrics.of(build).shieldMetricsResult().value!;
      const whole = new Intl.NumberFormat('en', { maximumFractionDigits: 0 });

      const rows = component.shieldSources();
      expect(rows.map((row) => row.id)).toEqual([
        'shieldGenerator',
        'shieldBooster',
        'shieldReinforcement',
      ]);
      expect(rows[0]?.contribution).toBe(`${whole.format(shield.generator)} MJ`);
      expect(rows[1]?.contribution).toBe(`+${whole.format(shield.boosters)} MJ`);
    });

    it('names a row after the module every mount in it holds, and counts them', () => {
      const booster = getModuleBySymbol('Hpt_ShieldBooster_Size0_Class1')!;
      const { component } = render(
        readyBuild().setModule('TinyHardpoint1', booster).setModule('TinyHardpoint2', booster),
      );
      const boosters = component.shieldSources().find((row) => row.id === 'shieldBooster');

      expect(boosters?.name?.text).toBe('Shield Booster');
      expect(boosters?.count).toBe('×2');
      expect(boosters?.roleLabel).toBeNull();
    });

    it('names a row after the role when its mounts hold different modules', () => {
      // Two boosters of different ratings: no one module names the row, so what
      // the row does names it instead.
      const { component } = render(fullyFittedBuild());
      const boosters = component.shieldSources().find((row) => row.id === 'shieldBooster');

      expect(boosters?.name).toBeNull();
      expect(boosters?.roleLabel).toBe('Shield boosters');
      expect(boosters?.count).toBe('×2');
    });

    it('draws no size or rating on the bulkhead row', () => {
      const { component } = render(fullyFittedBuild());
      const bulkhead = component.armourSources().find((row) => row.id === 'bulkhead');

      expect(bulkhead?.moduleClass).toBeNull();
      expect(bulkhead?.rating).toBeNull();
    });

    it('gathers Guardian and ordinary hull reinforcement into the package aggregate', () => {
      const build = fullyFittedBuild();
      const { component } = render(build);
      const reinforcement = component.armourSources().find((row) => row.id === 'hullReinforcement');

      expect(reinforcement?.contribution).toBe(
        `+${new Intl.NumberFormat('en', { maximumFractionDigits: 0 }).format(
          BuildMetrics.of(build).armourMetrics().reinforcement,
        )} HP`,
      );
    });
  });

  describe('the cell bank reserve', () => {
    it('draws no line at all when no bank is aboard', () => {
      expect(render(readyBuild()).component.bankRow()).toBeNull();
    });

    it('states the package total and names every bank aboard', () => {
      const build = bankedBuild();
      const { component } = render(build);
      const summary = BuildMetrics.of(build).cellBanks();
      const row = component.bankRow();

      expect(row?.restorable).toBe(
        `${new Intl.NumberFormat('en', { maximumFractionDigits: 0 }).format(
          summary.totalRestorable,
        )} MJ`,
      );
      expect(row?.unpowered).toBe(false);
      // Three banks aboard, two of them the same module in the same state: the
      // pair is one line carrying the canvas's `×2`, and the odd one is its own.
      expect(summary.banks).toHaveLength(3);
      expect(row?.banks).toHaveLength(2);
      expect(row?.banks.map((bank) => bank.count)).toEqual([null, '×2']);
    });

    it('lists banks of different sizes apart from each other', () => {
      const { component } = render(bankedBuild());
      const banks = component.bankRow()?.banks ?? [];

      // A size-4 bank and a size-6 bank restore different amounts, and a line
      // summing them would state neither.
      expect(banks.map((bank) => bank.moduleClass).sort()).toEqual([4, 6]);
      expect(new Set(banks.map((bank) => bank.detail)).size).toBe(banks.length);
    });

    it('lists a bank the plant does not feed apart from an identical one it does', () => {
      const { component } = render(bankedBuild().setModuleEnabled('Slot09_Size4', false));
      const banks = component.bankRow()?.banks ?? [];

      // The two size-4 banks are the same module, so only their power tells
      // them apart — and it has to, because one of them restores nothing.
      expect(banks).toHaveLength(3);
      expect(banks.filter((bank) => bank.detail.endsWith('Unpowered'))).toHaveLength(1);
      expect(banks.every((bank) => bank.count === null)).toBe(true);
    });

    it('draws every bar in the block on the block’s own scale', () => {
      const build = bankedBuild();
      const { component } = render(build);
      const reserve = component.bankRow()!;
      const summary = BuildMetrics.of(build).cellBanks();
      const largest = Math.max(...summary.banks.map((bank) => bank.reinforcement));

      // The reserve is the largest figure in the block, so it fills the track
      // and every bank is the share of it one activation puts back — the rule
      // the source rows above already follow.
      expect(reserve.fill).toBe(1);
      for (const bank of reserve.banks) {
        expect(bank.fill).toBeGreaterThan(0);
        expect(bank.fill).toBeLessThan(1);
      }
      expect(Math.max(...reserve.banks.map((bank) => bank.fill ?? 0))).toBeCloseTo(
        largest / summary.totalRestorable,
        6,
      );
    });

    it('states the figure every bank bar was drawn from beside it', () => {
      const build = bankedBuild();
      const { component } = render(build);
      const banks = component.bankRow()?.banks ?? [];
      const restored = BuildMetrics.of(build)
        .cellBanks()
        .banks.map((bank) => `${new Intl.NumberFormat('en').format(bank.reinforcement)} MJ`);

      // A bar carries no reading of its own, so what it was drawn from is on
      // the same row as a figure.
      for (const bank of banks) {
        expect(restored).toContain(bank.reinforcement);
      }
    });

    it('hatches the bar of a bank the plant does not feed', () => {
      const { element } = render(bankedBuild().setModuleEnabled('Slot09_Size4', false));
      const rows = [...element.querySelectorAll('.reserve__banks .source')];

      // The hatch is supplemental: the same row says the word in its code line.
      expect(rows).toHaveLength(3);
      expect(rows.filter((row) => row.classList.contains('source--off'))).toHaveLength(1);
    });

    it('keeps the line and says so in a word when nothing aboard is switched on', () => {
      // Fitted banks with both totals at zero are not the same state as no banks
      // fitted, and the line has to keep saying which one this is.
      const { component } = render(unpoweredBanksBuild());
      const row = component.bankRow();

      expect(row).not.toBeNull();
      expect(row?.unpowered).toBe(true);
      expect(row?.banks.length).toBeGreaterThan(0);
      expect(row?.banks.every((bank) => bank.detail.endsWith('Unpowered'))).toBe(true);
    });
  });
});
