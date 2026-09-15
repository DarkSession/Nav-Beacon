import { TestBed } from '@angular/core/testing';
import type { ShipLoadout } from '@elite-dangerous-almanac/core/ships/ship-loadout';
import type { BuildCandidate } from '../../../../application/active-build/active-build.models';
import { ActiveBuildStore } from '../../../../application/active-build/active-build.store';
import {
  noPlantOutputBuild,
  shedBandBuild,
  withinBudgetBuild,
} from '../../../../domain/ships/power-heat/power-heat.fixtures';
import { provideLocalization } from '../../../../i18n/i18n.providers';
import { provideIsolatedLocaleEnvironment } from '../../../../i18n/testing/localization-harness';
import { PowerBadge } from './power-badge';
import { suppliedFit } from '../../../../domain/ships/build/supplied-fit';

/**
 * The compact strip's badge, from the outside (005/FR-014).
 *
 * Most of this suite is about when the plate is absent. It is a warning, so a
 * dark priority group is its whole condition: a build the plant covers draws
 * nothing at all, and the `STATUS` segment's `POWER` line is where the share
 * stands on every build.
 *
 * The one case that is easy to get backwards is a plant generating nothing. Its
 * share is a division with no answer, so a badge that reads the share first
 * draws nothing on the one build where every group is dark. The groups are read
 * first for that reason, and the last test here fails if that order comes
 * back.
 */
describe('PowerBadge', () => {
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

  function render(loadout: ShipLoadout | null): HTMLElement {
    if (loadout !== null) {
      active.commit(candidateFor(loadout));
    }
    const fixture = TestBed.createComponent(PowerBadge);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideLocalization(), ...provideIsolatedLocaleEnvironment()],
    });
    active = TestBed.inject(ActiveBuildStore);
  });

  it('draws nothing at all without a build', () => {
    expect(render(null).querySelector('.badge')).toBeNull();
  });

  it('draws nothing where the plant covers every band', () => {
    const element = render(withinBudgetBuild());

    expect(element.querySelector('.badge')).toBeNull();
    expect(element.textContent).not.toContain('PWR');
  });

  it('draws the share over one line per dark group where a band is shed', () => {
    const element = render(shedBandBuild());

    const badge = element.querySelector('.badge');
    expect(badge).not.toBeNull();

    const readings = [...element.querySelectorAll('.badge__reading')].map((node) =>
      node.textContent?.trim(),
    );
    expect(readings[0]).toMatch(/^PWR /);
    expect(readings.slice(1).every((reading) => /^GRP \d+ OFF$/.test(reading ?? ''))).toBe(true);
    expect(readings.length).toBeGreaterThan(1);
  });

  it('states each reading in words, and hides the shorthand from the reading', () => {
    const element = render(shedBandBuild());

    for (const shorthand of element.querySelectorAll('.badge__reading')) {
      expect(shorthand.getAttribute('aria-hidden')).toBe('true');
    }
    const words = [...element.querySelectorAll('.badge__words')].map((node) =>
      node.textContent?.trim(),
    );
    expect(words.some((sentence) => sentence?.includes('of plant output is lit'))).toBe(true);
    expect(words.some((sentence) => sentence?.includes('is unpowered'))).toBe(true);
  });

  it('warns on a plant generating nothing, and states no share for it', () => {
    const element = render(noPlantOutputBuild());

    const readings = [...element.querySelectorAll('.badge__reading')].map((node) =>
      node.textContent?.trim(),
    );
    expect(readings.length).toBeGreaterThan(0);
    // Every group is dark on this build, so every line is a group. A share of
    // no output has no answer, and `PWR 0%` would stand in for a figure that
    // does not exist (constitution IV).
    expect(readings.every((reading) => /^GRP \d+ OFF$/.test(reading ?? ''))).toBe(true);
    expect(element.textContent).not.toContain('PWR');
  });
});
