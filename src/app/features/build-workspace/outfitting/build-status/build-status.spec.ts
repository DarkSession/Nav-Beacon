import { TestBed } from '@angular/core/testing';
import { ShipLoadout } from '@elite-dangerous-almanac/core/ships/ship-loadout';
import type { LoadoutEvent } from '@elite-dangerous-almanac/core/ships/slef';
import germanCatalogue from '../../../../i18n/locales/de.json';
import englishCatalogue from '../../../../i18n/locales/en.json';
import type { BuildCandidate } from '../../../../application/active-build/active-build.models';
import { ActiveBuildStore } from '../../../../application/active-build/active-build.store';
import { FIXTURE_HULL } from '../../../../domain/ships/outfitting/outfitting.fixtures';
import { provideLocalization } from '../../../../i18n/i18n.providers';
import type { MessageCatalogue } from '../../../../i18n/locale-registry';
import { LocaleStore } from '../../../../i18n/locale.store';
import { provideIsolatedLocaleEnvironment } from '../../../../i18n/testing/localization-harness';
import { BuildStatus } from './build-status';
import { suppliedFit } from '../../../../domain/ships/build/supplied-fit';

/**
 * The `BUILD STATUS` block, from the outside.
 *
 * Half of what this suite proves is *absence*. The wave 11 rulings built exactly
 * what canvases 1c and 1d draw and nothing else, so the tests that matter most
 * are the ones that fail if a count, a structural-facts list or a per-issue
 * action comes back
 * (`openspec/changes/archive/003-ship-statistics/design/reference-review.md`, rulings A–C). The
 * all-clear line is the one thing ruling A withheld that a Commander asked for
 * back, so it is asserted rather than forbidden.
 */
describe('the build status block', () => {
  let active: ActiveBuildStore;

  /** A payload naming a mount the hull does not have: one `error` issue. */
  const UNKNOWN_SLOT: LoadoutEvent = {
    event: 'Loadout',
    Ship: FIXTURE_HULL,
    Modules: [{ Slot: 'NoSuchSlot99', Item: 'Int_CargoRack_Size5_Class1' }],
  };

  /** Two mounts the hull does not have, so package order has something to be. */
  const TWO_UNKNOWN_SLOTS: LoadoutEvent = {
    event: 'Loadout',
    Ship: FIXTURE_HULL,
    Modules: [
      { Slot: 'NoSuchSlotA', Item: 'Int_CargoRack_Size5_Class1' },
      { Slot: 'NoSuchSlotB', Item: 'Int_CargoRack_Size4_Class1' },
    ],
  };

  /** Thrusters that carry the fit and its fuel but not a full hold: one `warning`. */
  const HOLD_ONLY_OVERLOAD: LoadoutEvent = {
    event: 'Loadout',
    Ship: FIXTURE_HULL,
    Modules: [
      { Slot: 'MainEngines', Item: 'Int_Engine_Size6_Class1' },
      { Slot: 'Slot01_Size7', Item: 'Int_CargoRack_Size7_Class1' },
      { Slot: 'Slot02_Size6', Item: 'Int_CargoRack_Size6_Class1' },
      { Slot: 'Slot03_Size6', Item: 'Int_CargoRack_Size6_Class1' },
      { Slot: 'Slot04_Size6', Item: 'Int_CargoRack_Size6_Class1' },
      { Slot: 'Slot05_Size5', Item: 'Int_CargoRack_Size5_Class1' },
      { Slot: 'Slot06_Size5', Item: 'Int_CargoRack_Size5_Class1' },
      { Slot: 'Slot07_Size5', Item: 'Int_CargoRack_Size5_Class1' },
      { Slot: 'Slot08_Size4', Item: 'Int_CargoRack_Size4_Class1' },
      { Slot: 'Slot09_Size4', Item: 'Int_CargoRack_Size4_Class1' },
      { Slot: 'Slot10_Size4', Item: 'Int_CargoRack_Size4_Class1' },
    ],
  };

  /** A hardpoint article in an optional internal: an `incompatibleModule` issue. */
  const INCOMPATIBLE_MODULE: LoadoutEvent = {
    event: 'Loadout',
    Ship: FIXTURE_HULL,
    Modules: [{ Slot: 'Slot01_Size7', Item: 'Hpt_PulseLaser_Fixed_Small' }],
  };

  function candidateFor(loadout: ShipLoadout): BuildCandidate {
    return {
      loadout,
      suppliedFit: suppliedFit(loadout.shipSymbol),
      hullName: FIXTURE_HULL,
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
    const fixture = TestBed.createComponent(BuildStatus);
    fixture.detectChanges();
    return fixture;
  }

  function host(fixture: ReturnType<typeof render>): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  function text(fixture: ReturnType<typeof render>): string {
    return host(fixture).textContent ?? '';
  }

  function items(fixture: ReturnType<typeof render>): readonly HTMLElement[] {
    return [...host(fixture).querySelectorAll<HTMLElement>('.issue:not(.issue--valid)')];
  }

  function allClear(fixture: ReturnType<typeof render>): HTMLElement | null {
    return host(fixture).querySelector<HTMLElement>('.issue--valid');
  }

  /** Commits German, which the package publishes no diagnostics in. */
  function readInGerman(): void {
    TestBed.inject(LocaleStore).commitCandidate(
      {
        requested: 'de',
        catalogue: germanCatalogue as unknown as MessageCatalogue,
        source: 'asset',
        failure: null,
      },
      'browser',
    );
  }

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideLocalization(), ...provideIsolatedLocaleEnvironment()],
    });
    active = TestBed.inject(ActiveBuildStore);
  });

  describe('when the package reports nothing', () => {
    it('draws nothing at all without a build', () => {
      // The workspace already says why it is empty; a block here would be a
      // second answer to a question feature 001 has already answered (FR-001).
      // No build is not a valid build either, so there is no all-clear.
      expect(items(render(null))).toHaveLength(0);
      expect(allClear(render(null))).toBeNull();
      expect(text(render(null)).trim()).toBe('');
    });

    it('confirms a build the package raises no issue about', () => {
      const fixture = render(ShipLoadout.default(FIXTURE_HULL));

      // The verdict, either way. Silence here read as a rail that had not
      // loaded rather than as an all-clear (Commander request 2026-08-27,
      // revising FR-015).
      expect(items(fixture)).toHaveLength(0);
      expect(allClear(fixture)?.textContent?.trim()).toBe(englishCatalogue['build-status.valid']);
    });
  });

  describe('the issues', () => {
    it('draws one item per package issue, in package order', () => {
      const loadout = ShipLoadout.fromLoadout(TWO_UNKNOWN_SLOTS);
      const fixture = render(loadout);

      expect(items(fixture)).toHaveLength(loadout.validation().issues.length);
      // Parity with the package's own order, asserted against the package
      // rather than against a written-down order that could drift from it.
      const drawn = items(fixture).map((item) => item.textContent ?? '');
      loadout.validation().issues.forEach((issue, position) => {
        expect(drawn[position]).toContain(issue.message);
      });
    });

    it('draws each issue exactly once', () => {
      const loadout = ShipLoadout.fromLoadout(UNKNOWN_SLOT);
      const fixture = render(loadout);
      const sentence = loadout.validation().issues[0]!.message;

      expect(text(fixture).split(sentence)).toHaveLength(2);
    });

    it('names the severity in words, unseen, beside the marker that draws it', () => {
      const fixture = render(ShipLoadout.fromLoadout(UNKNOWN_SLOT));

      // FR-022, at the design's own terms. Neither canvas draws a severity
      // word, so it is not on the screen — but it is read aloud, which is the
      // one thing that may exist without being drawn.
      const severity = items(fixture)[0]?.querySelector('.visually-hidden');
      expect(severity?.textContent).toBe(englishCatalogue['build-status.severity.error']);
      expect(items(fixture)[0]?.classList).toContain('issue--error');
    });

    it('draws the warning tier for a build the package still calls valid', () => {
      const loadout = ShipLoadout.fromLoadout(HOLD_ONLY_OVERLOAD);
      const fixture = render(loadout);

      // The severity is the package's, not a reading of `valid`: a hold-only
      // thruster overload is a `warning` beside `valid` and `complete`, and the
      // block draws its own tier for it (`design/status-rail.md`).
      expect(loadout.validation().valid).toBe(true);
      const first = items(fixture)[0];
      expect(first?.querySelector('.visually-hidden')?.textContent).toBe(
        englishCatalogue['build-status.severity.warning'],
      );
      expect(first?.classList).toContain('issue--warning');
    });

    it('states the verdict above a warning the package raises anyway', () => {
      const loadout = ShipLoadout.fromLoadout(HOLD_ONLY_OVERLOAD);
      const fixture = render(loadout);

      // The two blocks are not exclusive, and this is the arrangement Almanac
      // 0.2.1 made reachable. `valid` is read rather than derived from the issue
      // count, so a build the package calls valid says so even where it also
      // raises a warning about a load the pilot chose (constitution II).
      expect(loadout.validation().valid).toBe(true);
      expect(items(fixture)).toHaveLength(1);
      expect(allClear(fixture)?.textContent?.trim()).toBe(englishCatalogue['build-status.valid']);
    });

    it('carries the package’s own sentence, with its interpolated identities', () => {
      const loadout = ShipLoadout.fromLoadout(UNKNOWN_SLOT);
      const issue = loadout.validation().issues[0]!;
      const fixture = render(loadout);

      // The package has already interpolated its parameters; nothing here
      // composes a second sentence out of them (FR-005, FR-007).
      expect(text(fixture)).toContain(issue.message);
      expect(text(fixture)).toContain('NoSuchSlot99');

      // And nothing here composes a *first* one either. The issue carries a
      // `symbol` the package chose to leave out of its sentence, and it stays
      // out: adding it would be this application writing a diagnostic.
      expect(issue.symbol).toBe('Int_CargoRack_Size5_Class1');
      expect(text(fixture)).not.toContain('Int_CargoRack_Size5_Class1');
    });

    it('renders a constraint-bearing diagnostic the same way', () => {
      const loadout = ShipLoadout.fromLoadout(INCOMPATIBLE_MODULE);
      const fixture = render(loadout);

      expect(text(fixture)).toContain(loadout.validation().issues[0]!.message);
    });

    it('shows neither the machine-readable code nor a count', () => {
      const fixture = render(ShipLoadout.fromLoadout(UNKNOWN_SLOT));

      // Ruling A withdrew both. The canvas draws a sentence, not a code, and
      // no canvas draws a count anywhere in this region.
      expect(text(fixture)).not.toContain('unknownSlot');
    });

    it('exposes no control, link or action', () => {
      const fixture = render(ShipLoadout.fromLoadout(UNKNOWN_SLOT));

      // Ruling A. Nothing in either canvas's block is interactive, and the slot
      // ledger a per-issue action would reach is on screen beside it anyway.
      expect(host(fixture).querySelectorAll('button, a, [role="button"], input')).toHaveLength(0);
    });

    it('is an ordinary list rather than a live region', () => {
      const fixture = render(ShipLoadout.fromLoadout(UNKNOWN_SLOT));

      // Ruling A withdrew the announcer with the counts it announced. Visible
      // content stays on the page to be found and re-read.
      expect(
        host(fixture).querySelectorAll('[aria-live], [role="alert"], [role="status"]'),
      ).toHaveLength(0);
      expect(host(fixture).querySelector('ul')).not.toBeNull();
      expect(items(fixture)[0]?.tagName).toBe('LI');
    });
  });

  describe('a locale the package has no diagnostic for', () => {
    it('reads the canonical sentence with its untranslated disclosure', () => {
      readInGerman();
      const loadout = ShipLoadout.fromLoadout(UNKNOWN_SLOT);
      const fixture = render(loadout);

      // `getLoadoutIssueMessage` returns `null` outside English at the pinned
      // version, so this is the path every German reader is on. The sentence is
      // the package's English one, and the disclosure says why it is in another
      // language — both from feature 011's shared primitive, not from here.
      const value = host(fixture).querySelector('.game-text__value');
      expect(value?.textContent).toContain(loadout.validation().issues[0]!.message);
      expect(value?.getAttribute('lang')).toBe('en');
      expect(host(fixture).querySelector('.game-text__disclosure')).not.toBeNull();
    });

    it('still names the severity in the reader’s language', () => {
      readInGerman();
      const fixture = render(ShipLoadout.fromLoadout(UNKNOWN_SLOT));

      // The framing is the application's and is translated; the diagnostic is
      // the package's and is not.
      expect(host(fixture).querySelector('.visually-hidden')?.textContent).toBe(
        germanCatalogue['build-status.severity.error'],
      );
    });
  });

  describe('across revisions', () => {
    it('reports the build now in memory after a replacement', () => {
      const fixture = render(ShipLoadout.fromLoadout(UNKNOWN_SLOT));
      expect(items(fixture)).toHaveLength(1);

      active.commit(candidateFor(ShipLoadout.default(FIXTURE_HULL)));
      fixture.detectChanges();

      // A resolved issue leaves with its build, and the build that replaced it
      // is confirmed in its place. There is no second source to fall behind the
      // one in memory, which is why ruling A could withdraw the
      // revision-stamped projection envelope entirely.
      expect(items(fixture)).toHaveLength(0);
      expect(allClear(fixture)).not.toBeNull();
    });
  });
});
