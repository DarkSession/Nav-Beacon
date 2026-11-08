import { BuildMetrics } from '@elite-dangerous-almanac/core/ships/build-metrics';
import { TestBed } from '@angular/core/testing';
import {
  projectConvergence,
  type Convergence,
} from '../../../../../domain/ships/offence/convergence';
import type { ShipLoadout } from '@elite-dangerous-almanac/core/ships/ship-loadout';
import {
  everyStateBuild,
  noWeaponsBuild,
  OFFENCE_DEFAULT_SLOTS,
  OFFENCE_FIXTURE_HULL,
  populatedBuild,
} from '../../../../../domain/ships/offence/offence.fixtures';
import { provideLocalization } from '../../../../../i18n/i18n.providers';
import { provideIsolatedLocaleEnvironment } from '../../../../../i18n/testing/localization-harness';
import { ShotConvergence } from './shot-convergence';

/**
 * The gunsight block, from the outside.
 *
 * The geometry is the projection's own, for the same fixture build the panel
 * around it draws — never a set of offsets written here, which would pass a
 * release that changed what the package publishes.
 */
describe('ShotConvergence', () => {
  function geometryOf(
    loadout: ShipLoadout = everyStateBuild(),
  ): Extract<Convergence, { kind: 'available' }> {
    const convergence = projectConvergence(
      OFFENCE_FIXTURE_HULL,
      BuildMetrics.of(loadout).weaponMetrics().weapons,
    );
    if (convergence.kind !== 'available') {
      throw new Error('expected an available convergence for the fixture hull');
    }
    return convergence;
  }

  function render(options: { build?: ShipLoadout; selectedSlot?: string } = {}) {
    const fixture = TestBed.createComponent(ShotConvergence);
    fixture.componentRef.setInput('geometry', geometryOf(options.build));
    if (options.selectedSlot !== undefined) {
      fixture.componentRef.setInput('selectedSlot', options.selectedSlot);
    }
    fixture.detectChanges();
    return {
      element: fixture.nativeElement as HTMLElement,
      component: fixture.componentInstance,
      detect: () => fixture.detectChanges(),
    };
  }

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideLocalization(), ...provideIsolatedLocaleEnvironment()],
    });
  });

  it('places one mark per hardpoint the hull’s gunsight carries', () => {
    const { component } = render();

    expect(component.shots()).toHaveLength(geometryOf().mounts.length);
    expect(component.shots().every((shot) => shot.armed)).toBe(true);
  });

  it('draws the hardpoints nothing is fitted to, and names them as empty', () => {
    // The stock build arms two of this hull's eight mounts, so the plate has to
    // carry both kinds at once. Where a mount sits is a property of the hull,
    // and a Commander choosing what to fit is asking where its shot would go.
    const { component, element } = render({ build: populatedBuild() });

    const shots = component.shots();
    expect(shots).toHaveLength(geometryOf(populatedBuild()).mounts.length);
    const empty = shots.filter((shot) => !shot.armed);
    expect(empty).toHaveLength(shots.length - OFFENCE_DEFAULT_SLOTS.length);
    expect(element.querySelectorAll('.plate__dot--empty')).toHaveLength(empty.length);

    // The ink is never the only thing that says so: each empty mount's own
    // sentence is in the list beside the plate, and it is not the sentence an
    // armed one gets (011 FR-010).
    const stated = [...element.querySelectorAll('.shots__entry')].map((entry) =>
      (entry.textContent ?? '').trim(),
    );
    for (const shot of empty) {
      expect(stated).toContain(shot.statement);
      expect(shot.statement).not.toBe(shots.find((other) => other.armed)?.statement);
    }
  });

  it('still draws every mount for a hull the build has armed nothing on', () => {
    const { component, element } = render({ build: noWeaponsBuild() });

    const shots = component.shots();
    expect(shots.length).toBeGreaterThan(0);
    expect(shots.every((shot) => !shot.armed)).toBe(true);
    expect(element.querySelectorAll('.plate__dot--empty')).toHaveLength(shots.length);
    // Where a mount sits is a property of the hull, so the plate still draws
    // every hardpoint and still names each one as empty in its own sentence.
    expect(element.querySelectorAll('.shots__entry')).toHaveLength(shots.length);
  });

  it('marks the mount the workspace has selected, and states it in words', () => {
    const selectedSlot = OFFENCE_DEFAULT_SLOTS[0];
    const { component, element } = render({ selectedSlot });

    const selected = component.shots().filter((shot) => shot.selected);
    expect(selected).toHaveLength(1);
    expect(selected[0]?.id).toBe(selectedSlot);
    expect(element.querySelectorAll('.plate__dot--selected')).toHaveLength(1);

    // Selection is one of the mark's three fills, and the mark is the same dot
    // every other mount gets — no ring, no outline, no numeral beside it.
    expect(element.querySelector('.plate__dot--selected')?.classList).toContain('plate__dot');
    expect(element.querySelectorAll('.plate__numeral')).toHaveLength(0);

    // And the plate draws no ink for how a weapon aims any more: the canvas's
    // second hue is spent on selection here, and the mount is named in words.
    expect(element.querySelector('.plate__dot--aimed')).toBeNull();

    // And it is a sentence, not a ring alone.
    const stated = [...element.querySelectorAll('.shots__entry')].map((entry) =>
      (entry.textContent ?? '').trim(),
    );
    expect(stated).toContain(selected[0]?.statement);
    const unselected = component.shots().find((shot) => !shot.selected);
    expect(selected[0]?.statement).not.toBe(unselected?.statement);
  });

  it('states a selected hardpoint with nothing on it as empty as well as selected', () => {
    // The stock build leaves this hull's Huge mount empty, and the workspace
    // opens on it. One mark cannot carry two fills, so the plate says
    // *selected* and the mark's own sentence says both — which is where the
    // reading was all along (011 FR-010).
    const { component, element } = render({
      build: populatedBuild(),
      selectedSlot: 'HugeHardpoint1',
    });

    const selected = component.shots().filter((shot) => shot.selected);
    expect(selected).toHaveLength(1);
    expect(selected[0]?.armed).toBe(false);
    expect(element.querySelectorAll('.plate__dot--empty.plate__dot--selected')).toHaveLength(1);

    // And the sentence is the empty-and-selected one, not either single state's.
    const stated = [...element.querySelectorAll('.shots__entry')].map((entry) =>
      (entry.textContent ?? '').trim(),
    );
    expect(stated).toContain(selected[0]?.statement);
    const otherEmpty = component.shots().find((shot) => !shot.armed && !shot.selected);
    expect(selected[0]?.statement).not.toBe(otherEmpty?.statement);
  });

  it('marks nothing when the workspace has no hardpoint selected', () => {
    const { component, element } = render();

    expect(component.shots().some((shot) => shot.selected)).toBe(false);
    expect(element.querySelector('.plate__dot--selected')).toBeNull();
  });

  it('states every shot in words as well as drawing it', () => {
    const { component, element } = render();

    // The plate itself is decorative; the sentences are the reading.
    expect(element.querySelector('.plate')?.getAttribute('aria-hidden')).toBe('true');
    const stated = [...element.querySelectorAll('.shots__entry')].map((entry) =>
      (entry.textContent ?? '').trim(),
    );
    // Every mark on the plate, and nothing else: the 2026-08-26 revision drops
    // the ring caption, so there is no figure left beside the marks to state.
    expect(stated).toHaveLength(component.shots().length);
    for (const sentence of stated) {
      expect(sentence).not.toBe('');
    }
  });

  it('moves the shots when the target range moves', () => {
    const { component, detect } = render();
    const near = component.shots().map((shot) => shot.left);

    component.setTargetRange(2000);
    detect();

    // The mounts are where they are: their separation in metres is a property
    // of the hull, and only what it subtends at a distance changes with range.
    expect(component.shots().map((shot) => shot.left)).not.toEqual(near);
  });

  it('draws the boresight ring the hull points along, and nothing at its centre', () => {
    const { element } = render();

    // The 2026-08-26 revision adds the ring that marks where the ship itself is
    // aimed, and withdraws the four cells — the two spans, the widest mount and
    // the apparent spread — along with the ring caption. The canvas's filled dot
    // at the ring's centre went on 2026-08-27: on a plate whose marks are dots
    // it read as a shot landing dead on the axis.
    expect(element.querySelector('.plate__boresight')).not.toBeNull();
    expect(element.querySelector('.plate__boresight-centre')).toBeNull();
    expect(element.querySelector('.fact')).toBeNull();
    expect(element.querySelector('.facts')).toBeNull();
  });

  it('marks each mount with one dot and nothing beside it', () => {
    const { element, component } = render();

    // The 2026-08-25 canvas revision withdrew the badge parked at the plate's
    // edge and the leader line back to it; the 2026-08-27 request withdrew the
    // numeral that replaced them, along with the leaders a crowded plate drew
    // to reach one. What is left is one dot a mount, and the mount's number is
    // in its own sentence beside the plate.
    const marks = component.shots().filter((shot) => shot.onPlate).length;
    expect(marks).toBeGreaterThan(0);
    expect(element.querySelectorAll('.plate__dot')).toHaveLength(marks);
    expect(element.querySelector('.plate__shot')).toBeNull();
    expect(element.querySelector('.plate__numeral')).toBeNull();
    expect(element.querySelector('.plate__leader')).toBeNull();
    expect(element.querySelector('.plate__leaders')).toBeNull();

    // Nothing on the plate carries text at all now, which is what lets an empty
    // mount take a mark ink rather than a text one.
    expect((element.querySelector('.plate')?.textContent ?? '').trim()).toBe('');
  });

  it('leaves a shot outside the field of view off the plate, and still states it', () => {
    const { component, element, detect } = render();

    // The track's shortest range puts this hull's widest mounts far outside the
    // plate's forty milliradians.
    component.setTargetRange(component.rangeBounds.min);
    detect();

    const marks = component.shots();
    const drawn = marks.filter((shot) => shot.onPlate);

    // Something is actually left off at this range — the rule is a rule rather
    // than a bound nothing reaches — and only the marks that fit are drawn.
    expect(drawn.length).toBeLessThan(marks.length);
    expect(element.querySelectorAll('.plate__dot')).toHaveLength(drawn.length);

    // Every mark that is drawn stands inside the frame's own 4% margin.
    const at = (percent: number) => Math.round(percent * 1e6) / 1e6;
    for (const shot of drawn) {
      expect(at(shot.left)).toBeGreaterThanOrEqual(4);
      expect(at(shot.left)).toBeLessThanOrEqual(96);
      expect(at(shot.top)).toBeGreaterThanOrEqual(4);
      expect(at(shot.top)).toBeLessThanOrEqual(96);
    }

    // And every mount is still stated in words, drawn or not: a shot the plate
    // cannot show is exactly the one whose sentence is the only reading of it.
    const stated = [...element.querySelectorAll('.shots__entry')].map((entry) =>
      (entry.textContent ?? '').trim(),
    );
    expect(stated).toHaveLength(marks.length);
    for (const shot of marks) {
      expect(shot.statement).not.toBe('');
      expect(stated).toContain(shot.statement);
    }
  });

  it('offers the range as a real control, with its value announced', () => {
    const { element, component } = render();
    const slider = element.querySelector<HTMLInputElement>('input[type="range"]');

    expect(slider).not.toBeNull();
    expect(slider?.min).toBe(String(component.rangeBounds.min));
    expect(slider?.max).toBe(String(component.rangeBounds.max));
    expect(slider?.getAttribute('aria-valuetext')).toBe(component.targetRangeText());
  });

  it('sets the range field’s label and value on the row above its own track', () => {
    const { element } = render();

    // The canvas's 2026-08-25 layout: `TARGET RANGE` and `600 m` share the row
    // above the track, and the track's two ends are printed beneath it. The
    // order in the document is the order it is read in.
    const field = element.querySelector('ednb-range-field');
    const parts = [...(field?.querySelectorAll('.range > *') ?? [])].map((part) =>
      part.className.replace('range__', ''),
    );
    expect(parts).toEqual(['label', 'value', 'track', 'scale']);
  });

  it('leaves the range alone in the readout under the plate', () => {
    const { element } = render();

    // The 2026-08-26 revision withdrew the four cells that used to stand under
    // the range, so the readout carries the range field and nothing
    // else. Everything the cells reported is still in the plate's sentences.
    const readout = element.querySelector('.convergence__readout');
    expect(readout).not.toBeNull();
    expect(readout?.querySelector('ednb-range-field')).not.toBeNull();
    expect(readout?.querySelectorAll('.fact')).toHaveLength(0);
  });
});
