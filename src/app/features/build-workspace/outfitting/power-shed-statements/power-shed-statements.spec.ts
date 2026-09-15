import { TestBed } from '@angular/core/testing';
import { BuildMetrics } from '@elite-dangerous-almanac/core/ships/build-metrics';
import type { ShipLoadout } from '@elite-dangerous-almanac/core/ships/ship-loadout';
import type { BuildCandidate } from '../../../../application/active-build/active-build.models';
import { ActiveBuildStore } from '../../../../application/active-build/active-build.store';
import { PowerConditionsStore } from '../../../../application/power-heat/power-conditions.store';
import {
  shedBandBuild,
  sustainedOverheatBuild,
  withinBudgetBuild,
} from '../../../../domain/ships/power-heat/power-heat.fixtures';
import { provideLocalization } from '../../../../i18n/i18n.providers';
import { provideIsolatedLocaleEnvironment } from '../../../../i18n/testing/localization-harness';
import { PowerShedStatements } from './power-shed-statements';
import { suppliedFit } from '../../../../domain/ships/build/supplied-fit';

/**
 * The sentence about a shed priority group, from the outside.
 *
 * As much of this suite is about absence as about presence. One sentence per
 * shed band and nothing else: no all-clear line on a build the plant covers, no
 * severity word beside a sentence, no heat sentence however hot the build gets,
 * and no control. Each of those comes back the moment somebody adds it, and
 * each has a test here that fails when it does (005/FR-013).
 */
describe('PowerShedStatements', () => {
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

  function render(loadout: ShipLoadout | null) {
    if (loadout !== null) {
      active.commit(candidateFor(loadout));
    }
    const fixture = TestBed.createComponent(PowerShedStatements);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  /** The bands the package reports dark with the hardpoints deployed. */
  function shedBands(build: ShipLoadout) {
    return BuildMetrics.of(build)
      .powerBudget()
      .bands.filter((band) => !band.poweredDeployed);
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

  it('says nothing about a build whose plant covers every group', () => {
    const element = render(withinBudgetBuild());

    // Not an all-clear line and not a zero count: neither canvas draws such a
    // state, and silence claims strictly less than an all-clear would.
    expect(element.querySelector('.statements')).toBeNull();
    expect(element.textContent?.trim()).toBe('');
  });

  it('states one sentence per shed group, naming it and its own draw', () => {
    const build = shedBandBuild();
    const shed = shedBands(build);
    const element = render(build);

    const statements = [...element.querySelectorAll('.statement')];
    expect(statements).toHaveLength(shed.length);
    expect(statements.length).toBeGreaterThan(0);
    for (const band of shed) {
      const sentence = statements.find((node) =>
        (node.textContent ?? '').includes(`Priority group ${band.priority}`),
      );
      expect(sentence?.textContent).toContain(band.deployed.toFixed(2));
    }
  });

  it('draws no sentence but the unpowered one, however hot the build gets', () => {
    const build = sustainedOverheatBuild();
    expect(BuildMetrics.of(build).heatMetricsResult().value?.firingSustained.overheats).toBe(true);
    const element = render(build);

    // A build that cooks itself under sustained fire says so in the heat
    // profile, which is the block that draws it.
    expect(element.querySelectorAll('.statement')).toHaveLength(shedBands(build).length);
  });

  it('names no severity, because the canvas draws none here', () => {
    const element = render(shedBandBuild());

    // The sentence says the group is unpowered; a word standing beside it to
    // grade that is a word the design does not draw.
    const text = element.textContent ?? '';
    expect(text).not.toContain('Danger');
    expect(text).not.toContain('Caution');
    expect(element.querySelector('.visually-hidden')).toBeNull();
  });

  it('reads the deployed state whatever the dashboard is showing', () => {
    const build = shedBandBuild();
    TestBed.inject(PowerConditionsStore).showHardpoints('retracted');
    const element = render(build);

    // The sentence states what this build does, not what the dashboard is set
    // to: a group shed with the hardpoints out is shed whether or not a
    // Commander is currently reading the stowed figures.
    expect(element.querySelectorAll('.statement')).toHaveLength(shedBands(build).length);
  });

  it('carries no control', () => {
    const element = render(shedBandBuild());

    // At both widths the dashboard these sentences describe is one segment
    // away, and the canvas draws no control in the block either.
    expect(element.querySelectorAll('button, a, input')).toHaveLength(0);
  });
});
