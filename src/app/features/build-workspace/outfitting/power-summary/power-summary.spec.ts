import { TestBed } from '@angular/core/testing';
import { BuildMetrics } from '@elite-dangerous-almanac/core/ships/build-metrics';
import type { ShipLoadout } from '@elite-dangerous-almanac/core/ships/ship-loadout';
import type { BuildCandidate } from '../../../../application/active-build/active-build.models';
import { ActiveBuildStore } from '../../../../application/active-build/active-build.store';
import { PowerConditionsStore } from '../../../../application/power-heat/power-conditions.store';
import {
  distributorOffBuild,
  shedBandBuild,
  withinBudgetBuild,
} from '../../../../domain/ships/power-heat/power-heat.fixtures';
import { provideLocalization } from '../../../../i18n/i18n.providers';
import { provideIsolatedLocaleEnvironment } from '../../../../i18n/testing/localization-harness';
import { PowerSummary } from './power-summary';
import { suppliedFit } from '../../../../domain/ships/build/supplied-fit';

/**
 * This feature's own rail block, from the outside.
 *
 * The `POWER` line, the bar of the same figures, and the three pip groups under
 * them. The sentence about a shed group is not here — it is drawn a block
 * higher, with feature 003's issues, and `power-shed-statements.spec.ts` is
 * where it is proven — so this suite asserts its absence as well.
 *
 * The pips are the one control here, added by the 2026-08-25 canvas revision
 * and built as T074. They edit the same single viewing condition the
 * distributor table's cell edits, which is what the two-surface assertions
 * below are for: one allocation, drawn twice, never a second state.
 */
describe('PowerSummary', () => {
  let active: ActiveBuildStore;

  function candidateFor(loadout: ShipLoadout): BuildCandidate {
    return {
      loadout,
      suppliedFit: suppliedFit(loadout.shipSymbol),
      hullName: 'Anaconda',
      provenance: 'stock',
      sourceNamed: null,
      autosaveRecordId: null,
      baseline: null,
    };
  }

  /** Redraws the block after something outside it changed the condition. */
  let detect: () => void = () => undefined;

  function render(loadout: ShipLoadout | null) {
    if (loadout !== null) {
      active.commit(candidateFor(loadout));
    }
    const fixture = TestBed.createComponent(PowerSummary);
    fixture.detectChanges();
    detect = () => fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideLocalization(), ...provideIsolatedLocaleEnvironment()],
    });
    active = TestBed.inject(ActiveBuildStore);
  });

  it('draws nothing at all without a build', () => {
    const element = render(null);

    expect(element.textContent?.trim()).toBe('');
  });

  it('draws the POWER line with the lit draw against the plant output', () => {
    const build = withinBudgetBuild();
    const budget = BuildMetrics.of(build).powerBudget();
    const element = render(build);

    const figures = element.querySelector('.rail-power__figures')?.textContent ?? '';
    expect(figures).toContain(budget.deployed.toFixed(2));
    expect(figures).toContain(budget.available.toFixed(2));
    expect(element.querySelector('.rail-power__label')?.textContent?.trim()).toBe('Power');
  });

  it('names the unpowered remainder after the plant output, as the canvas does', () => {
    const build = shedBandBuild();
    const budget = BuildMetrics.of(build).powerBudget();
    const shed = budget.bands
      .filter((band) => !band.poweredDeployed)
      .reduce((total, band) => total + band.deployed, 0);
    const element = render(build);

    // The canvas's `29.64 / 31.20 MW · 7.80 OFF`: the first figure is the draw
    // the plant keeps lit rather than the whole demand, and the last is what is
    // left dark.
    const figures = element.querySelector('.rail-power__figures')?.textContent ?? '';
    expect(shed).toBeGreaterThan(0);
    expect(figures).toContain((budget.deployed - shed).toFixed(2));
    expect(figures).toContain(shed.toFixed(2));
  });

  it('states no remainder on a build with nothing dark', () => {
    const element = render(withinBudgetBuild());

    // A zero the artboard never draws is not printed in its place.
    expect(element.querySelector('.rail-power__figures')?.textContent?.toLowerCase()).not.toContain(
      'off',
    );
  });

  it('draws the bar the canvas draws, over the whole demand', () => {
    const build = shedBandBuild();
    const budget = BuildMetrics.of(build).powerBudget();
    const element = render(build);

    // The artboard's `79%`, `21%` and `83.3%` are the same figures as the line
    // above divided by the whole demand, so a build that sheds a group scales
    // the track to its demand and marks where the plant runs out.
    const bar = element.querySelector('.rail-bar');
    const width = (selector: string) =>
      Number.parseFloat(
        (bar?.querySelector(selector) as HTMLElement | null)?.style.inlineSize ?? '0',
      );
    const start = (selector: string) =>
      Number.parseFloat(
        (bar?.querySelector(selector) as HTMLElement | null)?.style.insetInlineStart ?? '0',
      );

    expect(bar).not.toBeNull();
    expect(width('.rail-bar__powered') + width('.rail-bar__unpowered')).toBeCloseTo(100, 6);
    expect(start('.rail-bar__unpowered')).toBeCloseTo(width('.rail-bar__powered'), 6);
    expect(start('.rail-bar__plant')).toBeCloseTo((budget.available / budget.deployed) * 100, 6);
  });

  it('marks the plant at the end of a track a covered build cannot overrun', () => {
    const element = render(withinBudgetBuild());

    // Scaled to the plant rather than the demand where the plant is the larger,
    // so the mark stays on the track instead of running off the end of it.
    const plant = element.querySelector('.rail-bar__plant') as HTMLElement | null;
    expect(Number.parseFloat(plant?.style.insetInlineStart ?? '0')).toBeCloseTo(100, 6);
  });

  it('names the bar rather than leaving it a shape to guess at', () => {
    const element = render(shedBandBuild());

    const bar = element.querySelector('.rail-bar');
    expect(bar?.getAttribute('role')).toBe('img');
    expect(bar?.getAttribute('aria-label')).toMatch(/%/u);
  });

  it('draws the block without a sentence, on a build with a group shed', () => {
    const build = shedBandBuild();
    expect(
      BuildMetrics.of(build)
        .powerBudget()
        .bands.filter((band) => !band.poweredDeployed).length,
    ).toBeGreaterThan(0);
    const element = render(build);

    // The sentence moved into the block that opens the rail, under feature
    // 003's issues. Drawn here as well it would be on the screen twice.
    expect(element.querySelector('.statement')).toBeNull();
    expect(element.querySelector('.rail-power')).not.toBeNull();
  });

  it('says nothing extra about a build whose plant covers every group', () => {
    const element = render(withinBudgetBuild());

    // Not an all-clear line and not a zero count: neither canvas draws such a
    // state, and silence claims strictly less than an all-clear would.
    expect(element.querySelector('.statement')).toBeNull();
    expect(element.querySelector('.rail-power')).not.toBeNull();
  });

  it('names no severity, because the canvas draws none here', () => {
    const element = render(shedBandBuild());

    const text = element.textContent ?? '';
    expect(text).not.toContain('Danger');
    expect(text).not.toContain('Caution');
  });

  it('reads the deployed state whatever the dashboard is showing', () => {
    const build = shedBandBuild();
    TestBed.inject(PowerConditionsStore).showHardpoints('retracted');
    const element = render(build);

    // The rail states what this build does, not what the dashboard is set to:
    // the plant output it prints is the deployed reading whether or not a
    // Commander is currently reading the stowed figures.
    expect(element.querySelector('.rail-power__figures')?.textContent).toContain(
      BuildMetrics.of(build).powerBudget().available.toFixed(2),
    );
  });

  it('keeps the figures and the bar read-only', () => {
    const element = render(shedBandBuild());

    // The canvas draws no control in either, and at both widths the dashboard
    // they describe is one segment away. The pips under them are the block's
    // only control, and they are not in either of these.
    for (const selector of ['.rail-power', '.rail-bar']) {
      expect(
        element.querySelectorAll(`${selector} button, ${selector} a, ${selector} input`),
      ).toHaveLength(0);
    }
  });

  describe('the pip control', () => {
    let conditions: PowerConditionsStore;

    beforeEach(() => {
      conditions = TestBed.inject(PowerConditionsStore);
    });

    it('draws the canvas’s three banks over four blocks each', () => {
      const element = render(withinBudgetBuild());

      const sets = [...element.querySelectorAll('.pipset')];
      expect(sets.map((set) => set.getAttribute('data-bank'))).toEqual([
        'systems',
        'engines',
        'weapons',
      ]);

      for (const set of sets) {
        // Four blocks, exactly as the distributor's cell draws them. No fifth
        // block for none, and no half-pip block.
        expect(set.querySelectorAll('.pips__step')).toHaveLength(4);
      }
    });

    it('names each bank with the allocation it stands at', () => {
      const element = render(withinBudgetBuild());

      // The reading for anyone who cannot see four rectangles, and the reason
      // the blocks themselves may be decoration.
      expect(
        element.querySelector('.pipset[data-bank="systems"] .pips')?.getAttribute('aria-label'),
      ).toBe('SYS, 2.0 of 6 pips');
    });

    it('fills the blocks from the leading edge, a half pip filling half a block', () => {
      const element = render(withinBudgetBuild());
      const fills = () =>
        [...element.querySelectorAll<HTMLElement>('.pipset[data-bank="systems"] .pips__fill')].map(
          (node) => node.style.inlineSize,
        );

      expect(fills()).toEqual(['100%', '100%', '0%', '0%']);

      // Two pips into engines from an even allocation costs systems half of
      // one, and the third block shows exactly that half.
      conditions.setPips('engines', 3);
      detect();
      expect(fills()).toEqual(['100%', '50%', '0%', '0%']);
    });

    it('moves the one allocation both surfaces read', () => {
      const element = render(withinBudgetBuild());

      const third = element.querySelectorAll('.pipset[data-bank="weapons"] .pips__step')[2];
      (third as HTMLButtonElement).click();

      // The press reaches the shared condition rather than a state of its own,
      // which is what makes the distributor table read the same allocation.
      expect(conditions.pips()).toEqual({ systems: 1.5, engines: 1.5, weapons: 3 });
    });

    it('draws what the store holds, including what another surface set', () => {
      const element = render(withinBudgetBuild());

      // The reverse direction: the distributor cell calls the same action, and
      // the rail redraws from it without being told.
      conditions.setPips('weapons', 4);
      detect();

      expect(
        element.querySelector('.pipset[data-bank="weapons"] .pips')?.getAttribute('aria-label'),
      ).toBe('WEP, 4.0 of 6 pips');
      expect(
        element.querySelector('.pipset[data-bank="systems"] .pips')?.getAttribute('aria-label'),
      ).toBe('SYS, 1.0 of 6 pips');
    });

    it('steps a bank back off the block it already stands on', () => {
      const element = render(withinBudgetBuild());

      const second = element.querySelectorAll('.pipset[data-bank="systems"] .pips__step')[1];
      (second as HTMLButtonElement).click();

      // Systems stands at two; pressing its second block is the way down to
      // one, which four blocks that each name a count have no other route to.
      expect(conditions.pips().systems).toBe(1);
    });

    it('names every block with the bank and the count pressing it asks for', () => {
      const element = render(withinBudgetBuild());

      const labels = [...element.querySelectorAll('.pipset[data-bank="engines"] .pips__step')].map(
        (step) => step.getAttribute('aria-label'),
      );

      expect(labels).toEqual(['Set ENG to 1', 'Set ENG to 2', 'Set ENG to 3', 'Set ENG to 4']);
    });

    it('draws no control without a build', () => {
      const element = render(null);

      expect(element.querySelectorAll('.pipset')).toHaveLength(0);
    });

    it('draws the pips the package returned, not the ones that were pressed', () => {
      const build = withinBudgetBuild();
      const element = render(build);

      conditions.setPips('weapons', 3);
      detect();

      // FR-013: both surfaces read the allocation back out of the result. The
      // two agree today because the package echoes what it is given — which is
      // exactly the property this asserts, so a package that started
      // normalising an allocation would move the rail with the table rather
      // than leaving it showing the request.
      const returned = BuildMetrics.of(build).distributorMetricsResult({
        systemsPips: conditions.pips().systems,
        enginesPips: conditions.pips().engines,
        weaponsPips: conditions.pips().weapons,
      }).value;

      expect(returned).not.toBeNull();
      expect(
        element.querySelector('.pipset[data-bank="weapons"] .pips')?.getAttribute('aria-label'),
      ).toBe(`WEP, ${returned?.pips.weapons.toFixed(1)} of 6 pips`);
    });

    it('keeps working for a build the package returns no distributor for', () => {
      // The rail is on screen for these builds and the table is not, so the
      // condition it is asking about is what the blocks stand at. No capacitor
      // figure is invented: the table states the unavailability, not this.
      const element = render(distributorOffBuild());

      expect(element.querySelectorAll('.pipset')).toHaveLength(3);
      expect(
        element.querySelector('.pipset[data-bank="systems"] .pips')?.getAttribute('aria-label'),
      ).toBe('SYS, 2.0 of 6 pips');
    });
  });
});
