import { TestBed } from '@angular/core/testing';
import { afterEach, vi } from 'vitest';
import {
  BuildMetrics,
  type StandardLoadInputs,
} from '@elite-dangerous-almanac/core/ships/build-metrics';
import type { CalculationIssue } from '@elite-dangerous-almanac/core/ships/loadout-calculations';
import { getModuleBySymbol } from '@elite-dangerous-almanac/core/ships/modules';
import { getShipBySymbol } from '@elite-dangerous-almanac/core/ships/ships';
import { ShipLoadout } from '@elite-dangerous-almanac/core/ships/ship-loadout';
import type { BuildCandidate } from '../../../../application/active-build/active-build.models';
import { ActiveBuildStore } from '../../../../application/active-build/active-build.store';
import { PowerConditionsStore } from '../../../../application/power-heat/power-conditions.store';
import { Formatters } from '../../../../i18n/formatters/formatters';
import { provideLocalization } from '../../../../i18n/i18n.providers';
import { provideIsolatedLocaleEnvironment } from '../../../../i18n/testing/localization-harness';
import type { StandardLoad } from '../../../../domain/ships/mobility-jump/mobility-jump';
import { DrivesMass } from './drives-mass';
import { suppliedFit } from '../../../../domain/ships/build/supplied-fit';

/**
 * The load the card reads its mass and its envelope at.
 *
 * The projector's own choice, restated here so these expectations ask the
 * package the same question the card does. Drift is caught rather than
 * absorbed: the card names this load on screen, and a test below reads that
 * name.
 */
const ENVELOPE_LOAD = 'unladen' satisfies StandardLoad;

/**
 * `DRIVES & MASS`, from the outside.
 *
 * Two rules run through the whole suite.
 *
 * The first is that no expectation writes down a game figure. Every number is
 * compared against what the installed Almanac answers for the same build, so a
 * release that changes what the package says fails here for the right reason
 * and one that does not, does not (constitution II).
 *
 * The second is that the four readings canvas 1c draws which an earlier Almanac
 * could not answer — the loaded mass, the mass split, the position on the
 * thruster curve and the `SCO` badge — are ordinary package readings now, and
 * the tests below hold them to the same rule as every other figure here: each
 * is compared against what the installed package answers, and none is
 * assembled on this side of the boundary.
 */
describe('DrivesMass', () => {
  // The calculations moved onto `BuildMetrics` in Almanac 0.2.0, so the seam
  // is its prototype rather than one build. A prototype stays mocked for
  // every later test in this file unless it is put back.
  afterEach(() => {
    vi.restoreAllMocks();
  });

  let active: ActiveBuildStore;
  let conditions: PowerConditionsStore;
  let formatters: Formatters;

  const HULL = 'Anaconda';
  /** The mount every reading in the left card is qualified by. */
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
    const fixture = TestBed.createComponent(DrivesMass);
    fixture.detectChanges();
    return {
      element: fixture.nativeElement as HTMLElement,
      component: fixture.componentInstance,
      detect: () => fixture.detectChanges(),
    };
  }

  function build(): ShipLoadout {
    return ShipLoadout.default(HULL);
  }

  /** The same build with its thrusters switched off — the reachable unavailable state. */
  function thrustersOffBuild(): ShipLoadout {
    const loadout = build();
    loadout.setModuleEnabled(THRUSTER_SLOT, false);
    return loadout;
  }

  /**
   * A mass as this locale writes it.
   *
   * Through the application's own formatter rather than `toFixed`, because the
   * expectation here is about the package's figure reaching the screen — the
   * digit grouping is the locale's business and writing it out by hand would
   * turn a mass test into a punctuation test.
   */
  function tonnes(value: number): string {
    return `${formatters.decimal(value, 0)} t`;
  }

  /** A fuel quantity, at the finer precision the canvas writes those at. */
  function fuelTonnes(value: number): string {
    return `${formatters.decimal(value, 2)} t`;
  }

  function text(element: Element | null | undefined): string {
    return (element?.textContent ?? '').trim().replace(/\s+/gu, ' ');
  }

  /**
   * One of the pair, by the order canvas 1c draws them in.
   *
   * Both cards close with a legend of the same shape, so a selector that does
   * not say which card it means now reads six rows where it once read three.
   */
  function card(element: HTMLElement, which: 'thrusters' | 'drive'): Element {
    const cards = element.querySelectorAll('.drives__card');
    const found = cards[which === 'thrusters' ? 0 : 1];
    if (!found) {
      throw new Error(`The ${which} card was not drawn.`);
    }
    return found;
  }

  function texts(element: Element | null | undefined, selector: string): string[] {
    if (!element) {
      throw new Error(`Nothing to read ${selector} out of.`);
    }
    return [...element.querySelectorAll(selector)].map((node) => text(node));
  }

  /** What the load the card is read at carries, unwrapped. */
  function carried(loadout: ShipLoadout): StandardLoadInputs {
    const result = BuildMetrics.of(loadout).standardLoadResult(ENVELOPE_LOAD);
    if (!result.complete) {
      throw new Error(
        `The installed package no longer weighs this hull at its ${ENVELOPE_LOAD} load.`,
      );
    }
    return result.value;
  }

  /** What the package answers for this build at the load and allocation the card names. */
  function mobilityAt(loadout: ShipLoadout, enginesPips: number) {
    return BuildMetrics.of(loadout).mobilityCapacitorMetricsResult({
      ...carried(loadout),
      enginesPips,
    }).value;
  }

  /** The four-pip envelope at that load, which is where `boost` is stated. */
  function envelopeOf(loadout: ShipLoadout) {
    return BuildMetrics.of(loadout).mobilityMetricsResult(carried(loadout)).value;
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
    expect(render(null).element.textContent?.trim()).toBe('');
  });

  it('has nothing to say about a workspace with no build in it', () => {
    // The template asks once, so each group is checked here instead: an absent
    // build is an empty list rather than a zero, a dash or an exception. The
    // workspace's own empty state already says why there is nothing.
    const { component } = render(null);

    expect(component.shown()).toBe(false);
    expect(component.massSegments()).toEqual([]);
    expect(component.curveMarks()).toEqual([]);
    expect(component.envelope()).toEqual([]);
    expect(component.mobilityIssues()).toEqual([]);
    expect(component.ranges()).toEqual([]);
    expect(component.driveFacts()).toEqual([]);
    expect(component.thrusterRating()).toBeNull();
    expect(component.driveRating()).toBeNull();
    expect(component.thrusterOff()).toBe(false);
    expect(component.driveOff()).toBe(false);
  });

  it('draws canvas 1c’s two cards, each named by its own heading', () => {
    const { element, component } = render(build());

    const cards = [...element.querySelectorAll('.drives__card')];
    expect(cards).toHaveLength(2);
    expect(texts(element, '.drives__card-heading')).toEqual([
      component.thrustersHeading(),
      component.driveHeading(),
    ]);
    // Each card is a region a reader can move to by name, so the heading has to
    // be the thing that names it rather than a nearby paragraph.
    for (const [index, card] of cards.entries()) {
      const labelledBy = card.getAttribute('aria-labelledby');
      expect(labelledBy).toBe(
        index === 0 ? component.thrustersHeadingId : component.driveHeadingId,
      );
      expect(element.querySelector(`#${labelledBy}`)?.className).toContain('drives__card-heading');
    }
  });

  describe('the four readings the canvas draws and the package now answers', () => {
    it('puts the package’s own loaded mass on the headline', () => {
      // `buildMass(load).total`, at the same load the speed envelope is read
      // at. Nothing on this card is summed here.
      const loadout = build();
      const { element, component } = render(loadout);

      expect(component.loadedMass()).toBe(
        tonnes(BuildMetrics.of(loadout).buildMass(carried(loadout)).total),
      );
      expect(text(element.querySelector('.drives__headline-mass'))).toBe(component.loadedMass());
    });

    it('states where the build sits on the thruster curve, as a share of optimal', () => {
      // The canvas's `91% OF OPTIMAL MASS`. The package's own thrusters getter
      // prescribes the comparison: the loaded mass against `optMass`.
      const loadout = build();
      const stats = loadout.fittedModuleAt(THRUSTER_SLOT)?.effectiveStats;
      const { element, component } = render(loadout);
      const mobility = BuildMetrics.of(loadout).mobilityMetricsResult({
        ...carried(loadout),
      });

      expect(component.massCurvePosition()).toContain(
        formatters.percent((mobility.value?.loadedMass ?? 0) / (stats?.optMass ?? 1)),
      );
      expect(text(element.querySelector('.drives__curve-position'))).toBe(
        component.massCurvePosition(),
      );
    });

    it('measures the modules segment rather than leaving it blank', () => {
      // The split the canvas's bar draws is one package answer, so the middle
      // segment carries a mass and a length like the two beside it.
      const loadout = build();
      const { component } = render(loadout);
      const modules = component.massSegments().find((segment) => segment.id === 'modules');
      const part = component.massBar()?.segments.find((segment) => segment.id === 'modules');

      expect(modules?.value).toBe(
        tonnes(BuildMetrics.of(loadout).buildMass(carried(loadout)).modules),
      );
      expect(part?.size).toBeGreaterThan(0);
    });

    it('leaves the SCO badge off a drive the catalogue does not mark', () => {
      // The canvas draws a badge, not a negation: a drive without the
      // capability has nothing said about it.
      const { element } = render(build());

      expect(element.querySelector('.drives__sco')).toBeNull();
    });

    it('draws the SCO badge, and the word behind it, once an Overcharge drive is fitted', () => {
      const loadout = build();
      const overcharge = getModuleBySymbol('Int_Hyperdrive_Overcharge_Size6_Class5');
      if (!overcharge) {
        throw new Error('The installed package no longer carries an Overcharge drive to fit.');
      }
      loadout.setModule('FrameShiftDrive', overcharge);
      const { element, component } = render(loadout);

      // The letters are an abbreviation, so what they stand for is in the
      // markup — and only there. A `title` would be the hover disclosure the
      // design review ruled out, and a second reading of the same words for
      // anything configured to expand abbreviations.
      expect(text(element.querySelector('.drives__sco'))).toBe(component.scoLabel());
      expect(element.querySelector('.drives__sco')?.hasAttribute('title')).toBe(false);
      // On the card's own rule, beside the words it qualifies — the canvas
      // gives it no line of its own.
      expect(text(element.querySelector('.drives__card-heading .visually-hidden'))).toBe(
        component.scoDescription(),
      );
      expect(element.querySelector('.drives__card-heading .drives__sco')).not.toBeNull();
    });
  });

  describe('the mass bar', () => {
    it('draws the hull and the fuel from the package and nothing else', () => {
      const loadout = build();
      const { element } = render(loadout);

      const rows = [...card(element, 'thrusters').querySelectorAll('.drives__legend-row')];
      // The canvas runs each row's qualifier in beside its name, so the name is
      // the label's own text and the qualifier is the element after it.
      expect(
        rows.map((row) =>
          row.querySelector('.drives__legend-label')?.firstChild?.textContent?.trim(),
        ),
      ).toEqual(['Hull', 'Modules', 'Fuel']);
      const mass = BuildMetrics.of(loadout).buildMass(carried(loadout));
      expect(rows.map((row) => text(row.querySelector('.drives__legend-value')))).toEqual([
        tonnes(mass.hull),
        tonnes(mass.modules),
        tonnes(mass.fuel),
      ]);
      // The headline is what the three drawn rows account for, and nothing the
      // card has no row for.
      expect(mass.hull + mass.modules + mass.fuel).toBeCloseTo(mass.total);
    });

    it('qualifies each segment with what the canvas sets under its label', () => {
      // The canvas's `ANACONDA · MILITARY GRADE`, `22 FITTED`, `TANK`. The
      // first two are a package identity and a count of package rows; the
      // third names which of the ship's two fuel stores this part of the mass
      // is, and states no capacity at all — the revision of 2026-08-25 cut the
      // `32 T + RESERVE` that once stood beside the word.
      const loadout = build();
      const { element, component } = render(loadout);

      const details = texts(card(element, 'thrusters'), '.drives__legend-detail');
      expect(details).toHaveLength(3);
      expect(details[0]).toContain(HULL);
      expect(details[1]).toContain(formatters.integer(loadout.fittedModules().length));
      expect(details[2]).toBe('Tank');
      expect(component.massSegments().map((segment) => segment.detail)).toEqual(details);
    });

    it('states no tank capacity anywhere on either card', () => {
      // `fuelCapacity` is a real package figure that no canvas draws any more.
      // What a rendering test can show is that neither tank's figure reaches
      // the screen — the whole component's text, not one legend row, because a
      // capacity could come back through the headline, the drive legend or the
      // rail rather than the row it left.
      //
      // That this application never *asks* for the getter is a different claim
      // and not one this suite can make: `BuildMetrics` reads the loadout's
      // fuel capacity itself while answering the questions this card does ask,
      // so a spy on the getter counts the package's own reads too. The absence
      // of a call site is proven where absences are provable — the repository
      // rule in `scripts/policy/mobility-jump-ownership.mjs`.
      const loadout = build();
      const { element } = render(loadout);

      // At the fuel precision this card would have printed them at. A
      // Sidewinder's real 0.3 t reserve is the case that makes this worth
      // asserting: it rounds to `0 t` at the mass bar's whole tonnes, so a
      // capacity slipping back in could read as a fabricated zero over a real
      // quantity, which is exactly what constitution IV forbids.
      const drawn = element.textContent ?? '';
      expect(drawn).not.toContain(fuelTonnes(loadout.fuelCapacity.main));
      expect(drawn).not.toContain(fuelTonnes(loadout.fuelCapacity.reserve));
    });

    it('scales every part against the thrusters’ own maximum mass', () => {
      // The only maximum the package gives this bar. A bar drawn against
      // anything else would be a figure invented by its length.
      const loadout = build();
      const stats = loadout.fittedModuleAt(THRUSTER_SLOT)?.effectiveStats;
      const mass = BuildMetrics.of(loadout).buildMass(carried(loadout));
      const { component } = render(loadout);
      const size = (id: string): number | undefined =>
        component.massBar()?.segments.find((segment) => segment.id === id)?.size;

      expect(size('hull')).toBeCloseTo(mass.hull / (stats?.maxMass ?? 1));
      expect(size('modules')).toBeCloseTo(mass.modules / (stats?.maxMass ?? 1));
      expect(size('fuel')).toBeCloseTo(mass.fuel / (stats?.maxMass ?? 1));
    });

    it('lays the three parts end to end on one track, and marks optimal on it', () => {
      // The canvas's arithmetic: its `400`, `662` and `80` run 21.16%, 35.03%
      // and 4.23% of a track whose end is `MAX 1,890 t`, and its optimal mark
      // stands at 1,260 of the same 1,890. So the parts are additive — laid in
      // order they reach exactly what the build weighs against that maximum —
      // and the mark sits on the same scale.
      const loadout = build();
      const stats = loadout.fittedModuleAt(THRUSTER_SLOT)?.effectiveStats;
      const mass = BuildMetrics.of(loadout).buildMass(carried(loadout));
      const { element, component } = render(loadout);
      const bar = component.massBar();

      const reached = (bar?.segments ?? []).reduce((sum, segment) => sum + segment.size, 0);
      expect(reached).toBeCloseTo(mass.total / (stats?.maxMass ?? 1));
      expect(bar?.optimal).toBeCloseTo((stats?.optMass ?? 0) / (stats?.maxMass ?? 1));

      // Drawn in the canvas's order, so the parts read hull, modules, fuel from
      // the start of the track.
      const parts = [...element.querySelectorAll('.drives__mass-part')];
      expect(parts.map((part) => part.getAttribute('data-tone'))).toEqual([
        'strong',
        'dim',
        'deep',
      ]);
      expect(element.querySelector('.drives__mass-optimal')).not.toBeNull();
    });

    it('keeps the bar out of the reading, and the numbers in it', () => {
      const { element } = render(build());

      expect(element.querySelector('.drives__mass-bar')?.getAttribute('aria-hidden')).toBe('true');
      // Every part still says its own mass in words under the bar, so the bar
      // carries nothing a reader would otherwise have to see.
      expect(texts(card(element, 'thrusters'), '.drives__legend-value')).toHaveLength(3);
    });

    it('writes the module’s own optimal and maximum mass under the bar', () => {
      const loadout = build();
      const stats = loadout.fittedModuleAt(THRUSTER_SLOT)?.effectiveStats;
      const { element, component } = render(loadout);

      expect(component.curveMarks().map((mark) => mark.value)).toEqual([
        tonnes(stats?.optMass ?? 0),
        tonnes(stats?.maxMass ?? 0),
      ]);
      // On the screen, not only in the view model: they are the scale the bar
      // above them is drawn on.
      expect(texts(element, '.drives__mass-mark-value')).toEqual([
        tonnes(stats?.optMass ?? 0),
        tonnes(stats?.maxMass ?? 0),
      ]);
    });

    it('draws no group of readings beside the ones the canvas draws', () => {
      // Canvas 1c's left card goes headline, bar, its two marks, the three
      // legend rows, then the speed envelope; its right card opens with three
      // cells and closes with three legend rows. An unladen mass or a cargo
      // capacity among them would be this screen adding a reading the template
      // does not have — and the main tank is already stated where the canvas
      // states it, in the fuel row's own qualifier.
      const { element } = render(build());

      // Exactly one cell grid on the pair: the drive card's headline trio. The
      // canvas draws its two legends as ruled rows, not as cells.
      const groups = [...element.querySelectorAll('ednb-metric-group')].map((group) =>
        [...group.classList].find((name) => name.startsWith('drives__')),
      );
      expect(groups).toEqual(['drives__cells']);
      expect(element.querySelectorAll('.drives__legend')).toHaveLength(2);
    });
  });

  describe('the speed envelope', () => {
    it('draws the five readings the package returns, each with its unit', () => {
      const loadout = build();
      // Four readings move with the allocation and come from the capacitor;
      // boost ignores it and is stated on the envelope (Almanac 0.2.0).
      const mobility = mobilityAt(loadout, 2);
      const envelope = envelopeOf(loadout);
      const { element } = render(loadout);

      expect(texts(element, '.drives__envelope-label')).toEqual([
        'Top speed',
        'Boost',
        'Pitch',
        'Roll',
        'Yaw',
      ]);
      expect(texts(element, '.drives__envelope-value')).toEqual([
        `${(mobility?.speed ?? 0).toFixed(0)} m/s`,
        `${(envelope?.boost ?? 0).toFixed(0)} m/s`,
        `${(mobility?.pitch ?? 0).toFixed(0)} °/s`,
        `${(mobility?.roll ?? 0).toFixed(0)} °/s`,
        `${(mobility?.yaw ?? 0).toFixed(0)} °/s`,
      ]);
    });

    it('says which load the readings belong to', () => {
      // The canvas states the load on the headline line, over `SPEED ENVELOPE
      // AT THIS MASS`. The mass and the envelope are read at the same load, so
      // this is what names which of the three all six readings belong to.
      const { element, component } = render(build());

      expect(component.envelopeLoad()).toBe('Fuelled');
      expect(text(element.querySelector('.drives__headline-load'))).toBe('Fuelled');
    });

    it('re-reads the package when the ENG pips move', () => {
      const loadout = build();
      const { element, detect } = render(loadout);
      const before = texts(element, '.drives__envelope-value');

      conditions.setPips('engines', 4);
      detect();

      const after = texts(element, '.drives__envelope-value');
      expect(after[0]).toBe(`${(mobilityAt(loadout, 4)?.speed ?? 0).toFixed(0)} m/s`);
      expect(after).not.toEqual(before);
    });

    it('keeps its bars out of the reading too', () => {
      const { element } = render(build());

      for (const track of element.querySelectorAll('.drives__envelope-track')) {
        expect(track.getAttribute('aria-hidden')).toBe('true');
      }
    });
  });

  describe('when the package cannot say how the build moves', () => {
    it('draws no envelope and gives the package’s own reasons', () => {
      const loadout = thrustersOffBuild();
      const { element } = render(loadout);

      expect(element.querySelector('.drives__envelope')).toBeNull();
      expect(texts(element, '.drives__issues li')).toHaveLength(
        BuildMetrics.of(loadout).mobilityMetricsResult(carried(loadout)).issues.length,
      );
      expect(texts(element, '.drives__issues li').join(' ').length).toBeGreaterThan(0);
    });

    it('substitutes no hull speed for the reading it does not have', () => {
      // The catalogue's figures for this hull exist and are deliberately not
      // reached for: a catalogue speed is not this build's speed (FR-005).
      const { element } = render(thrustersOffBuild());

      expect(element.querySelector('.unavailable')).not.toBeNull();
      expect(texts(element, '.drives__envelope-value')).toEqual([]);
    });

    it('says the mount is switched off rather than missing', () => {
      const { element, component } = render(thrustersOffBuild());

      // Off and absent are different states and the screen words them
      // differently; the module is still there and still named.
      expect(component.thrusterOff()).toBe(true);
      expect(component.driveOff()).toBe(false);
      expect(texts(element, '.drives__state')).toEqual(['Switched off']);
      // The identity line still carries the module's class and blueprint, which
      // is what the canvas names it by.
      expect(component.thrusterRating() ?? '').not.toBe('');
    });

    it('keeps the curve marks, which the switch did not take away', () => {
      // A switched-off thruster still has a mass curve. What is unavailable is
      // the build's mobility, not the module's stats.
      const { component } = render(thrustersOffBuild());

      expect(component.envelope()).toEqual([]);
      expect(component.curveMarks()).toHaveLength(2);
    });
  });

  describe('when the package cannot settle the load the card is read at', () => {
    /**
     * The same build with the envelope's own load unresolved.
     *
     * The package resolves it for every catalogue hull, so the state is reached
     * by making the package say what it would say. It is what takes the
     * headline, the three mass rows and the speed envelope out together — they
     * are one answer, and this proves the card words that one absence once.
     */
    function unsettledLoadBuild(): ShipLoadout {
      const loadout = build();
      const issue: CalculationIssue = {
        field: 'fuelCapacity',
        reason: 'missing',
        message: 'The load could not be resolved.',
      };
      const maximum = BuildMetrics.of(loadout).standardLoadResult('maximum');

      vi.spyOn(BuildMetrics.prototype, 'standardLoadResult').mockImplementation((load) =>
        load === ENVELOPE_LOAD ? { complete: false, value: null, issues: [issue] } : maximum,
      );
      return loadout;
    }

    it('words the headline, the mass rows and the envelope the same way', () => {
      const { element, component } = render(unsettledLoadBuild());

      expect(component.loadedMass()).toBeNull();
      expect(component.massSegments().every((segment) => segment.value === null)).toBe(true);
      expect(component.envelope()).toEqual([]);
      // One cause, one word. Eight absences — the headline, the three mass rows,
      // the envelope, the ranges and the two drive constants the same load
      // guards — that all say the package could not settle this load, rather
      // than some of them claiming there is no figure to give at all.
      expect(texts(element, '.unavailable__text')).toEqual(Array<string>(8).fill('Incomplete'));
    });

    it('takes the drive down with it, because the summary needs this load too', () => {
      // `jumpRangeSummary()` resolves the maximum, unladen and laden loads in
      // turn and throws on the first it cannot, so all three gate the drive. A
      // guard that watched only the maximum load would let this one throw out
      // of the projector and take the whole anatomy region down (FR-003).
      const { element, component } = render(unsettledLoadBuild());

      expect(component.ranges()).toEqual([]);
      expect(component.driveIssues()).toHaveLength(1);
      // One list on each card, each naming the reading it explains — the same
      // package reason, given where each absence is.
      expect(texts(element, '.drives__issues')).toHaveLength(2);
      expect(texts(element, '.drives__issues li')).toHaveLength(2);
    });
  });

  describe('when the package cannot read the drive', () => {
    /**
     * The same build with the load every jump reading is gated on unresolved.
     *
     * `standardLoadResult('maximum')` is the one load the package documents as
     * able to come back incomplete, and it is what the projector guards on. No
     * catalogue drive reaches the state today, so it is reached here instead of
     * left untested.
     */
    function unreadableDriveBuild(): ShipLoadout {
      const loadout = build();
      const issue: CalculationIssue = {
        field: 'frameShiftDrive',
        reason: 'missing',
        message: 'No usable frame shift drive is fitted.',
      };
      const resolved = BuildMetrics.of(loadout).standardLoadResult(ENVELOPE_LOAD);

      vi.spyOn(BuildMetrics.prototype, 'standardLoadResult').mockImplementation((load) =>
        load === 'maximum' ? { complete: false, value: null, issues: [issue] } : resolved,
      );
      return loadout;
    }

    it('leaves the thruster card whole, fuel figure included', () => {
      // The two cards are separate readings of separate modules. Taking the
      // fuel segment off the drive's profiles would have put the left card
      // behind the right one's failure (FR-003).
      const loadout = unreadableDriveBuild();
      const fuel = carried(loadout).fuel ?? 0;
      const { element, component } = render(loadout);

      expect(component.ranges()).toEqual([]);
      expect(component.envelope()).toHaveLength(5);

      const thrusters = card(element, 'thrusters');
      const rows = [...thrusters.querySelectorAll('.drives__legend-row')];
      expect(text(rows[2]?.querySelector('.drives__legend-value'))).toBe(tonnes(fuel));
      expect(thrusters.querySelector('.drives__legend-row .unavailable')).toBeNull();
    });

    it('says one word for one cause, on both cards', () => {
      // The guard the ranges are gated on is the same package answer the drive
      // constants come from, so `FSD optimal mass` and `Fuel per jump` say what
      // the ranges beside them say. A card that read `Incomplete` where the
      // ranges were and `Unavailable` two rows below would be describing one
      // absence as two.
      const { element, component } = render(unreadableDriveBuild());

      expect(component.driveFacts().map((fact) => fact.value)).toEqual([null, null]);
      expect(component.jumpCells().map((cell) => cell.value)).toEqual([
        null,
        null,
        // Mass lock is the hull's own catalogue fact and the guard never
        // touched it.
        expect.any(String),
      ]);
      // Both jump cells, in the one cell grid on the pair.
      expect(texts(element, '.metric__unavailable')).toEqual(['Incomplete', 'Incomplete']);
      // The ranges the guard refused, and the two drive constants that came
      // from the same refusal, all saying the one word.
      expect(texts(element, '.unavailable__text')).toEqual([
        'Incomplete',
        'Incomplete',
        'Incomplete',
      ]);
    });

    it('gives the package’s own reasons in place of the ranges', () => {
      const { element, component } = render(unreadableDriveBuild());

      expect(component.driveIssues()).toHaveLength(1);
      expect(texts(element, '.drives__issues li')).toHaveLength(1);
      // Named, so a reader who cannot see the layout is told which reading the
      // list explains rather than meeting an anonymous set of sentences.
      expect(element.querySelector('.drives__issues')?.getAttribute('aria-label')).toBe(
        component.driveIssuesLabel(),
      );
    });
  });

  describe('when the package throws instead of declining', () => {
    it('draws the card unavailable with no reasons list beside it', () => {
      // A throw carries no `CalculationIssue`, so there is nothing to list. An
      // empty named "why" list would be worse than none: it promises reasons
      // and shows a Commander an empty box.
      const loadout = build();
      vi.spyOn(BuildMetrics.prototype, 'frameShiftDrive').mockImplementation(() => {
        throw new TypeError('BuildMetrics: drive record has no jump constants');
      });

      const { element, component } = render(loadout);

      expect(component.ranges()).toEqual([]);
      expect(component.driveIssues()).toEqual([]);
      expect(element.querySelectorAll('.drives__issues')).toHaveLength(0);
      // Said in the same word the rest of the card says for the same cause,
      // rather than left as a blank space: once where the ranges were, and once
      // on each drive constant the same throw took with it.
      expect(texts(card(element, 'drive'), '.unavailable__text')).toEqual([
        'Incomplete',
        'Incomplete',
        'Incomplete',
      ]);
    });

    it('leaves the thruster card whole', () => {
      // The envelope's own load is the one of the three that costs no jump, so
      // the drive's failure never reaches it (FR-003).
      const loadout = build();
      vi.spyOn(BuildMetrics.prototype, 'frameShiftDrive').mockImplementation(() => {
        throw new TypeError('BuildMetrics: drive record has no jump constants');
      });

      const { element } = render(loadout);
      const thrusterCard = element.querySelectorAll('.drives__card')[0];

      expect(texts(element, '.drives__envelope-value')).toHaveLength(5);
      expect(texts(thrusterCard, '.drives__legend-value')).toHaveLength(3);
    });
  });

  describe('range by load', () => {
    it('draws the canvas’s three loads and not a fourth', () => {
      const { element } = render(build());

      // Three, not the canvas's four: its `CURRENT` row is a jump at some
      // arbitrary current fuel and cargo state, which this application has no
      // viewing condition to read one at.
      expect(texts(element, '.drives__range-label')).toEqual(['Unladen', 'Fuelled', 'Full cargo']);
    });

    it('gives each row the one figure the canvas puts on it', () => {
      // The canvas's rows carry a load and its jump, nothing else. The whole
      // tank is its own reading and is drawn once, under the ranges.
      const loadout = build();
      const summary = BuildMetrics.of(loadout).jumpRangeSummary();
      const { element } = render(loadout);

      const rows = [...element.querySelectorAll('.drives__range')];
      expect(rows).toHaveLength(3);
      for (const row of rows) {
        expect(row.querySelectorAll('.drives__range-value')).toHaveLength(1);
      }
      expect(texts(element, '.drives__range-value')).toEqual([
        `${summary.max.toFixed(1)} ly`,
        `${summary.unladen.toFixed(1)} ly`,
        `${summary.laden.toFixed(1)} ly`,
      ]);
    });
  });

  describe('the drive’s own facts', () => {
    it('states the canvas’s legend rows under the ranges', () => {
      const loadout = build();
      const summary = BuildMetrics.of(loadout).jumpRangeSummary();
      const { component } = render(loadout);
      const facts = component.driveFacts();

      expect(facts.map((fact) => fact.id)).toEqual(['opt-mass', 'max-fuel', 'total-range']);
      expect(facts[0].value).toBe(tonnes(BuildMetrics.of(loadout).frameShiftDrive().optMass));
      // At the canvas's own fuel precision — its `MAX FUEL 8.30 t`. A
      // Sidewinder draws 0.6 t a jump, which the mass bar's whole tonnes would
      // print as `1 t`.
      expect(facts[1].value).toBe(fuelTonnes(BuildMetrics.of(loadout).frameShiftDrive().maxFuel));
      expect(facts[2].value).toBe(`${summary.totalUnladen.range.toFixed(0)} ly`);
      // The canvas's `8 JUMPS ON A FULL TANK`: how many jumps that range is,
      // which the figure alone does not say.
      expect(facts[2].detail).toContain(String(summary.totalUnladen.jumps));
    });

    it('heads the card with the canvas’s own three cells', () => {
      // Canvas 1c opens the card with `JUMP LADEN`, `JUMP UNLADEN` and
      // `MASS LOCK` on one hairline ground, above `RANGE BY LOAD`. The two
      // jumps are the ends of the list under them, and mass lock is the hull's
      // own catalogue fact.
      const loadout = build();
      const summary = BuildMetrics.of(loadout).jumpRangeSummary();
      const { element, component } = render(loadout);

      expect(component.jumpCells().map((cell) => cell.value)).toEqual([
        `${summary.laden.toFixed(1)} ly`,
        `${summary.max.toFixed(1)} ly`,
        String(getShipBySymbol(loadout.shipSymbol)?.masslock),
      ]);
      expect(texts(element, '.drives__cells .metric__number')).toEqual([
        `${summary.laden.toFixed(1)} ly`,
        `${summary.max.toFixed(1)} ly`,
        String(getShipBySymbol(loadout.shipSymbol)?.masslock),
      ]);
    });

    it('says how much mass is left under the drive’s optimal, beside it', () => {
      // The canvas's `658 T OF HEADROOM`: the drive's own optimal mass less
      // what the build weighs at the load the other card is read at. Two
      // package answers, and their difference is the reading (FR-008).
      const loadout = build();
      const metrics = BuildMetrics.of(loadout);
      const optimal = metrics.frameShiftDrive().optMass ?? 0;
      const loaded = metrics.buildMass(carried(loadout)).total;
      const { component } = render(loadout);

      const gap = optimal - loaded;
      const detail = component.driveFacts()[0].detail ?? '';
      expect(detail).toContain(tonnes(Math.abs(gap)));
      // Worded for which side of the optimal this build is on: a headroom, or
      // how far over it the build already is.
      expect(detail).toMatch(gap >= 0 ? /headroom/iu : /over optimal/iu);
    });

    it('leaves the optimal mass unqualified where the load cannot be settled', () => {
      // Half a subtraction is not a headroom. A load the package could not
      // weigh leaves the row with its own figure and nothing beside it, rather
      // than a comparison against a mass that was assumed (constitution IV).
      vi.spyOn(BuildMetrics.prototype, 'standardLoadResult').mockReturnValue({
        complete: false,
        value: undefined,
        issues: [],
      } as never);
      const { component } = render(build());

      expect(component.driveFacts()[0].detail ?? '').not.toMatch(/headroom|over optimal/iu);
    });

    it('draws no row the canvas’s legend does not have, whatever else is fitted', () => {
      // A Guardian booster changes every range above, and the canvas still
      // states only its three legend rows. A fourth row for the bonus would be
      // this screen adding a reading the template has not got (FR-008).
      const { component } = render(boostedBuild());

      expect(component.driveFacts().map((fact) => fact.id)).toEqual([
        'opt-mass',
        'max-fuel',
        'total-range',
      ]);
    });
  });

  it('draws no heading over the speed envelope, and keeps the words as its name', () => {
    // The canvas heads the block `SPEED ENVELOPE AT THIS MASS`; this card does
    // not draw that line any more. Five rows that each name themselves do not
    // need a sentence over them, and the load it states is on the headline
    // directly above (Commander request 2026-08-26). A reader moving by list
    // still meets the block under the canvas's own name.
    const { element, component } = render(build());
    const envelope = card(element, 'thrusters').querySelector('.drives__envelope');

    expect(envelope?.getAttribute('aria-label')).toBe(component.envelopeHeading());
    expect(texts(card(element, 'thrusters'), '.drives__section-heading')).toEqual([]);
    // The drive card keeps the heading the canvas gives its ranges.
    expect(texts(card(element, 'drive'), '.drives__section-heading')).toEqual([
      component.rangeHeading(),
    ]);
  });

  it('carries the optimal mark to its own tick, and the maximum to the end', () => {
    // The optimal is placed at its tick by the margin that starts its box
    // there; the maximum has no tick of its own, because the end of the track
    // is where it is.
    const { element, component } = render(build());
    const marks = component.curveMarks();
    const drawn = element.querySelectorAll<HTMLElement>('.drives__mass-mark');

    expect(drawn[0]?.style.marginInlineStart).toBe(`${(marks[0].position ?? 0) * 100}%`);
    expect(marks[1].position).toBeNull();
    expect(drawn[1]?.style.marginInlineStart).toBe('');
  });

  it('qualifies each card by the fitted module’s class, and never by its name', () => {
    const { element, component } = render(build());

    // The canvas's `7A · DIRTY DRIVES G5` note. A stock build has no blueprint,
    // so what is drawn is the class and rating the package publishes.
    expect(component.thrusterRating() ?? '').not.toBe('');
    expect(component.driveRating() ?? '').not.toBe('');
    expect(texts(element, '.drives__rating').every((rating) => rating.length > 0)).toBe(true);

    // The module's own name is not repeated: each card's rule already says what
    // the card reads, and the class beside it says which one is fitted.
    expect(element.querySelector('ednb-game-text')).toBeNull();
  });

  /** The same build with the largest Guardian booster the hull will take. */
  function boostedBuild(): ShipLoadout {
    const loadout = build();
    const booster = getModuleBySymbol('Int_GuardianFSDBooster_Size5');
    const slot = loadout
      .slots('optional')
      .find((candidate) => candidate.size >= 5 && candidate.module === null);

    if (!booster || !slot) {
      throw new Error('The installed package no longer carries a Guardian FSD Booster to fit.');
    }
    loadout.setModule(slot.key, booster);
    return loadout;
  }
});
