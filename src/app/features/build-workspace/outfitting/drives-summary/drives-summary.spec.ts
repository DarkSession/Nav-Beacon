import { TestBed } from '@angular/core/testing';
import { BuildMetrics } from '@elite-dangerous-almanac/core/ships/build-metrics';
import { ShipLoadout } from '@elite-dangerous-almanac/core/ships/ship-loadout';
import type { BuildCandidate } from '../../../../application/active-build/active-build.models';
import { ActiveBuildStore } from '../../../../application/active-build/active-build.store';
import { PowerConditionsStore } from '../../../../application/power-heat/power-conditions.store';
import { Formatters } from '../../../../i18n/formatters/formatters';
import { provideLocalization } from '../../../../i18n/i18n.providers';
import { provideIsolatedLocaleEnvironment } from '../../../../i18n/testing/localization-harness';
import { DrivesSummary } from './drives-summary';
import { suppliedFit } from '../../../../domain/ships/build/supplied-fit';

/**
 * The rail's `JUMP`, `SPEED` and `MASS` cells.
 *
 * No expectation writes down a game figure: every one is compared against what
 * the installed Almanac answers for the same build, so a release that changes
 * what the package says fails here for the right reason and one that does not,
 * does not (constitution II).
 *
 * The suite's other job is the one the rail exists to fail at: these three
 * figures also appear on the two cards in the anatomy region, and a rail that
 * read a different load, a different allocation or a different precision would
 * put two numbers for one quantity on one screen. Each is therefore asserted
 * against the exact package call the card makes.
 */
describe('DrivesSummary', () => {
  let active: ActiveBuildStore;
  let conditions: PowerConditionsStore;
  let formatters: Formatters;

  const HULL = 'Anaconda';
  const THRUSTER_SLOT = 'MainEngines';

  function candidateFor(loadout: ShipLoadout): BuildCandidate {
    return {
      loadout,
      suppliedFit: suppliedFit(loadout.shipSymbol),
      hullName: HULL,
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
    const fixture = TestBed.createComponent(DrivesSummary);
    fixture.detectChanges();
    return {
      element: fixture.nativeElement as HTMLElement,
      component: fixture.componentInstance,
    };
  }

  function build(): ShipLoadout {
    return ShipLoadout.default(HULL);
  }

  function texts(element: HTMLElement, selector: string): string[] {
    return [...element.querySelectorAll(selector)].map((node) =>
      (node.textContent ?? '').trim().replace(/\s+/gu, ' '),
    );
  }

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideLocalization(), ...provideIsolatedLocaleEnvironment()],
    });
    active = TestBed.inject(ActiveBuildStore);
    conditions = TestBed.inject(PowerConditionsStore);
    formatters = TestBed.inject(Formatters);
  });

  it('draws nothing at all without a build', () => {
    const { element, component } = render(null);

    expect(element.textContent?.trim()).toBe('');
    expect(component.cells()).toEqual([]);
  });

  it('draws the canvas’s three cells, in the canvas’s order', () => {
    const { element, component } = render(build());

    expect(component.cells().map((cell) => cell.id)).toEqual(['jump', 'speed', 'mass']);
    expect(texts(element, '.metric__label')).toEqual(['Jump', 'Speed', 'Mass']);
  });

  it('carries the package’s laden jump, top speed and loaded mass, each with its unit', () => {
    const loadout = build();
    const summary = BuildMetrics.of(loadout).jumpRangeSummary();
    const load = BuildMetrics.of(loadout).standardLoadResult('unladen');
    if (!load.complete) {
      throw new Error('The installed package no longer weighs this hull at its unladen load.');
    }
    const mobility = BuildMetrics.of(loadout).mobilityCapacitorMetricsResult({
      ...load.value,
      enginesPips: conditions.pips().engines,
    });
    const { element, component } = render(loadout);

    expect(component.cells().map((cell) => cell.value)).toEqual([
      formatters.decimal(summary.laden, 1),
      formatters.decimal(mobility.value?.speed ?? 0, 0),
      formatters.decimal(BuildMetrics.of(loadout).buildMass(load.value).total, 0),
    ]);
    expect(texts(element, '.metric__unit')).toEqual(['ly', 'm/s', 't']);
  });

  it('reads the mass at the load the thruster card heads, not at full cargo', () => {
    // The rail and the card are one reading of one build seen twice. A rail
    // that weighed the hold would sit a different mass six centimetres from
    // the card's headline, and both would look like answers.
    const loadout = build();
    const unladen = BuildMetrics.of(loadout).standardLoadResult('unladen');
    const laden = BuildMetrics.of(loadout).standardLoadResult('laden');
    if (!unladen.complete || !laden.complete) {
      throw new Error('The installed package no longer weighs this hull at both loads.');
    }
    expect(BuildMetrics.of(loadout).buildMass(laden.value).total).not.toBe(
      BuildMetrics.of(loadout).buildMass(unladen.value).total,
    );

    const { component } = render(loadout);

    expect(component.cells()[2]?.value).toBe(
      formatters.decimal(BuildMetrics.of(loadout).buildMass(unladen.value).total, 0),
    );
  });

  it('re-reads on an ENG change, which is what moves the speed', () => {
    const loadout = build();
    const { component } = render(loadout);
    const atRest = component.cells()[1]?.value;

    conditions.setPips('engines', 4);
    TestBed.tick();

    expect(component.cells()[1]?.value).not.toBe(atRest);
    // The jump and the mass are read at a load the allocation does not touch.
    expect(component.cells()[0]?.value).toBeTruthy();
  });

  it('states an unavailable speed rather than standing the cell at zero', () => {
    // A build with its thrusters switched off is the reachable unavailable
    // state, and a cell reading `0 m/s` about it is a number a Commander might
    // act on (constitution IV).
    const loadout = build();
    loadout.setModuleEnabled(THRUSTER_SLOT, false);
    const { element, component } = render(loadout);

    expect(component.cells()[1]?.value).toBeNull();
    expect(texts(element, '.metric__unavailable')).toEqual(['Incomplete']);
    // The jump and the mass do not depend on the thrusters and keep theirs.
    expect(component.cells()[0]?.value).not.toBeNull();
    expect(component.cells()[2]?.value).not.toBeNull();
  });

  it('names the group, so the three cells are not loose figures in the rail', () => {
    const { element } = render(build());

    expect(element.querySelector('.metric-group')?.getAttribute('aria-label')).toBeTruthy();
  });
});
