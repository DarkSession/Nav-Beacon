import { TestBed } from '@angular/core/testing';
import { BuildMetrics } from '@elite-dangerous-almanac/core/ships/build-metrics';
import type { ShipLoadout } from '@elite-dangerous-almanac/core/ships/ship-loadout';
import type { BuildCandidate } from '../../../../application/active-build/active-build.models';
import { ActiveBuildStore } from '../../../../application/active-build/active-build.store';
import { PowerConditionsStore } from '../../../../application/power-heat/power-conditions.store';
import {
  DEFENCE_FIXTURE_HULL,
  disabledGeneratorBuild,
  fullyFittedBuild,
} from '../../../../domain/ships/defence/defence.fixtures';
import { provideLocalization } from '../../../../i18n/i18n.providers';
import { provideIsolatedLocaleEnvironment } from '../../../../i18n/testing/localization-harness';
import { DefenceSummary } from './defence-summary';
import { suppliedFit } from '../../../../domain/ships/build/supplied-fit';

/**
 * The rail's two cells.
 *
 * Both figures are the package's own answers for the same build, and the
 * shield's absence is a state rather than a zero: a rail cell reading `0 MJ`
 * about a shield the Almanac declined to calculate is a number a Commander
 * might act on (constitution IV).
 */
describe('DefenceSummary', () => {
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
    const fixture = TestBed.createComponent(DefenceSummary);
    fixture.detectChanges();
    return {
      element: fixture.nativeElement as HTMLElement,
      component: fixture.componentInstance,
    };
  }

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideLocalization(), ...provideIsolatedLocaleEnvironment()],
    });
    active = TestBed.inject(ActiveBuildStore);
    conditions = TestBed.inject(PowerConditionsStore);
  });

  it('draws nothing at all without a build', () => {
    const { element, component } = render(null);

    expect(element.textContent?.trim()).toBe('');
    expect(component.cells()).toEqual([]);
  });

  it('carries the package shield strength and hull points, in that order', () => {
    const build = fullyFittedBuild();
    const { component } = render(build);
    const shield = BuildMetrics.of(build).shieldMetricsResult().value!;
    const whole = new Intl.NumberFormat('en', { maximumFractionDigits: 0 });

    const cells = component.cells();
    expect(cells.map((cell) => cell.label)).toEqual(['Shield', 'Armour']);
    expect(cells[0]?.value).toBe(whole.format(shield.strength));
    expect(cells[0]?.unit).toBe('MJ');
    expect(cells[1]?.value).toBe(whole.format(BuildMetrics.of(build).armourMetrics().hitPoints));
  });

  it('states an unavailable shield rather than standing the cell at zero', () => {
    const { component, element } = render(disabledGeneratorBuild());
    const cells = component.cells();

    expect(cells[0]?.value).toBeNull();
    expect(cells[0]?.unavailableLabel).toBe('Unavailable');
    expect(element.textContent).toContain('Unavailable');
    // The hull answers for every build, so its cell keeps its figure.
    expect(cells[1]?.value).not.toBeNull();
  });

  it('re-reads on a SYS change, which the package answers with the same strength', () => {
    // The rail is read at the same allocation the dashboard is, and the package
    // makes the pool independent of it. What the allocation does move — the
    // capacitor's figures and the recovery — the rail does not draw.
    const build = fullyFittedBuild();
    const { component } = render(build);
    const atRest = component.cells()[0]?.value;

    conditions.setPips('systems', 4);
    TestBed.tick();

    expect(component.cells()[0]?.value).toBe(atRest);
  });
});
