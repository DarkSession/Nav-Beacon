import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { BuildMetrics } from '@elite-dangerous-almanac/core/ships/build-metrics';
import type { ShipLoadout } from '@elite-dangerous-almanac/core/ships/ship-loadout';
import type { BuildCandidate } from '../../../../application/active-build/active-build.models';
import { ActiveBuildStore } from '../../../../application/active-build/active-build.store';
import { OutfittingStore } from '../../../../application/outfitting/outfitting.store';
import {
  OFFENCE_FIXTURE_HULL,
  allDisabledBuild,
  everyStateBuild,
  noWeaponsBuild,
  populatedBuild,
} from '../../../../domain/ships/offence/offence.fixtures';
import { provideLocalization } from '../../../../i18n/i18n.providers';
import { provideIsolatedLocaleEnvironment } from '../../../../i18n/testing/localization-harness';
import { OffenceSummary } from './offence-summary';
import { suppliedFit } from '../../../../domain/ships/build/supplied-fit';

/**
 * Whether a drawn figure is a zero, rather than merely containing one.
 *
 * Every digit in it, and at least one: `204.1` contains a zero and is not one,
 * and a locale's own grouping and decimal marks are not digits, so this says
 * the same thing in every language the catalogue carries.
 */
function readsZero(text: string | null | undefined): boolean {
  const digits = text?.match(/\d/gu) ?? [];
  return digits.length > 0 && digits.every((digit) => digit === '0');
}

/**
 * The rail's `DPS` cell.
 *
 * The cell is composed from `ednb-metric-group`, which is what the canvas draws
 * all six rail cells as, so the assertions read that component's own markup.
 * The canvas gives this cell a label and a bare figure, so most of them are
 * about what is *not* there: no unit, no second figure, no condition, and no
 * qualification on a build whose coverage resolved.
 */
describe('OffenceSummary', () => {
  let active: ActiveBuildStore;
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

  function render(loadout: ShipLoadout | null) {
    if (loadout !== null) {
      active.commit(candidateFor(loadout));
    }
    const fixture = TestBed.createComponent(OffenceSummary);
    fixture.detectChanges();
    return { element: fixture.nativeElement as HTMLElement, component: fixture.componentInstance };
  }

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideLocalization(), ...provideIsolatedLocaleEnvironment()],
    });
    active = TestBed.inject(ActiveBuildStore);
    outfitting = TestBed.inject(OutfittingStore);
  });

  it('draws nothing at all without a build', () => {
    const { element, component } = render(null);

    expect(element.textContent?.trim()).toBe('');
    expect(component.shown()).toBe(false);
    expect(component.figure()).toBeNull();
  });

  it('carries the package sustained total, which is what the specification settles', () => {
    // A build whose two totals differ, so the assertion fails if the cell were
    // ever changed to read the burst figure instead.
    const loadout = everyStateBuild();
    const total = BuildMetrics.of(loadout).weaponMetrics().total;
    expect(total.damagePerSecond).not.toBe(total.sustainedDamagePerSecond);

    const { component } = render(loadout);

    expect(component.figure()).toContain(
      String(Math.round(total.sustainedDamagePerSecond * 10) / 10),
    );
    expect(component.figure()).not.toContain(String(Math.round(total.damagePerSecond * 10) / 10));
  });

  it('draws one cell, as a label and a bare figure and nothing else', () => {
    const { element } = render(populatedBuild());

    expect(element.querySelectorAll('.metric')).toHaveLength(1);
    expect(element.querySelector('.metric__label')?.textContent?.trim()).toBeTruthy();
    expect(element.querySelector('.metric__number')?.textContent?.trim()).toBeTruthy();
    expect(element.querySelector('.metric__unit')).toBeNull();
    expect(element.querySelector('.metric__condition')).toBeNull();
    expect(element.querySelector('.metric__unavailable')).toBeNull();
    expect(element.querySelector('.metric__description')).toBeNull();
  });

  it('names the group, so the cell is not one loose figure in the rail', () => {
    const { element } = render(populatedBuild());

    expect(element.querySelector('.metric-group')?.getAttribute('aria-label')).toBeTruthy();
  });

  it('shows the package zero rather than an absence when every weapon is off', () => {
    const { component } = render(allDisabledBuild());

    expect(readsZero(component.figure())).toBe(true);
    expect(component.qualified()).toBe(false);
  });

  it('leaves an exact zero unqualified, because zero is an answer', () => {
    const { component } = render(noWeaponsBuild());

    // A hull with nothing fitted reads zero, and reads it plainly: the
    // qualification is for coverage the package could not establish, which is a
    // different claim from a build that carries no weapons.
    expect(readsZero(component.figure())).toBe(true);
    expect(component.qualified()).toBe(false);
  });

  /**
   * `hardpointCoverage` answers `unavailable` only for an empty set of slot
   * views, and the store computes those from the active build — so no build
   * reaches the state through the real store. It is stubbed here rather than
   * left uncovered, because the qualification is the whole point of the cell.
   */
  it('qualifies the cell once when the package could not establish coverage', () => {
    vi.spyOn(outfitting, 'slots').mockReturnValue([]);

    const { element, component } = render(populatedBuild());

    expect(component.qualified()).toBe(true);

    // The cell's own description, so a screen reader reaches it from the value
    // it qualifies rather than as a stray sentence in the rail.
    const qualification = element.querySelector('.metric__description');
    expect(qualification?.textContent?.trim()).toBeTruthy();
    expect(element.querySelectorAll('.metric__description')).toHaveLength(1);
    expect(element.querySelector('.metric__value')?.getAttribute('aria-describedby')).toBe(
      qualification?.id,
    );
  });
});
