import { TestBed } from '@angular/core/testing';
import { ShipLoadout } from '@elite-dangerous-almanac/core/ships/ship-loadout';
import type { BuildCandidate } from '../../../../application/active-build/active-build.models';
import { ActiveBuildStore } from '../../../../application/active-build/active-build.store';
import { provideLocalization } from '../../../../i18n/i18n.providers';
import { provideIsolatedLocaleEnvironment } from '../../../../i18n/testing/localization-harness';
import { CapacitySummary } from './capacity-summary';
import { suppliedFit } from '../../../../domain/ships/build/supplied-fit';

/**
 * The rail's two capacity cells.
 *
 * Both figures are the package's own answers for the build in memory, and
 * neither is ever unavailable: a build with no rack and no cabin carries none
 * of either, which is a reading rather than a gap (003/FR-023).
 */
describe('CapacitySummary', () => {
  let active: ActiveBuildStore;

  function candidateFor(loadout: ShipLoadout): BuildCandidate {
    return {
      loadout,
      suppliedFit: suppliedFit(loadout.shipSymbol),
      hullName: loadout.shipSymbol,
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
    const fixture = TestBed.createComponent(CapacitySummary);
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
  });

  it('draws nothing at all without a build', () => {
    const { element, component } = render(null);

    expect(element.textContent?.trim()).toBe('');
    expect(component.cells()).toEqual([]);
  });

  it('carries the package hold and berths, in that order', () => {
    // The Orca is the fixture because its two figures differ — a hold of 24
    // tonnes over 40 berths — so a pair drawn the wrong way round is caught
    // here. A hull whose figures match would let them be swapped in silence.
    const build = ShipLoadout.default('Orca');
    const { component } = render(build);

    expect(build.cargoCapacity).not.toBe(build.passengerCapacity);
    expect(component.cells().map(({ id }) => id)).toEqual(['cargo', 'passengers']);
    expect(component.cells()[0]?.value).toBe(String(build.cargoCapacity));
    expect(component.cells()[1]?.value).toBe(String(build.passengerCapacity));
  });

  it('states the hold in tonnes and leaves the berths bare', () => {
    const { component } = render(ShipLoadout.default('Orca'));

    expect(component.cells()[0]?.unit).toBe('t');
    expect(component.cells()[1]?.unit).toBeUndefined();
  });

  it('draws nought rather than dropping a cell the build carries none of', () => {
    const { component, element } = render(ShipLoadout.empty('SideWinder'));

    expect(component.cells().map(({ value }) => value)).toEqual(['0', '0']);
    expect(component.cells().every(({ unavailableLabel }) => unavailableLabel === undefined)).toBe(
      true,
    );
    expect(element.textContent).toContain('0');
  });

  it('follows an edit that changes what the build carries', () => {
    const build = ShipLoadout.empty('SideWinder');
    const { component } = render(build);
    const before = component.cells().map(({ value }) => value);
    const rack = build
      .modulesForSlot('Slot02_Size2')
      .find(({ symbol }) => /CargoRack/i.test(symbol));

    expect(rack).toBeDefined();
    build.setModule('Slot02_Size2', rack!);
    active.commit(candidateFor(build));

    // The rack moves the hold and nothing else: an edit read into the wrong
    // cell would move the other one, or both.
    expect(component.cells()[0]?.value).toBe(String(build.cargoCapacity));
    expect(component.cells()[0]?.value).not.toBe(before[0]);
    expect(component.cells()[1]?.value).toBe(before[1]);
  });
});
