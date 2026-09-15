import { TestBed } from '@angular/core/testing';
import { BuildMetrics } from '@elite-dangerous-almanac/core/ships/build-metrics';
import type { ShipLoadout } from '@elite-dangerous-almanac/core/ships/ship-loadout';
import type { BuildCandidate } from '../../../../application/active-build/active-build.models';
import { ActiveBuildStore } from '../../../../application/active-build/active-build.store';
import {
  cargoRackBuild,
  mercenaryCargoRack,
} from '../../../../domain/ships/cost-materials/cost-materials.fixtures';
import {
  defaultBuild,
  FIXTURE_SLOTS,
} from '../../../../domain/ships/outfitting/outfitting.fixtures';
import { provideLocalization } from '../../../../i18n/i18n.providers';
import { provideIsolatedLocaleEnvironment } from '../../../../i18n/testing/localization-harness';
import { CostMaterials } from './cost-materials';
import { suppliedFit } from '../../../../domain/ships/build/supplied-fit';

/**
 * The two rail blocks, from the outside.
 *
 * What this suite mostly proves is *absence*: the wave 10 ruling built exactly
 * what canvases 1c and 1d draw and nothing else, so the tests that matter most
 * are the ones that fail if a trace control, an evidence list or a lower-bound
 * qualification comes back (`design/reference-review.md`, ruling F).
 */
describe('cost and materials surface', () => {
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
    const fixture = TestBed.createComponent(CostMaterials);
    fixture.detectChanges();
    return fixture;
  }

  function text(fixture: ReturnType<typeof render>): string {
    return fixture.nativeElement.textContent ?? '';
  }

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideLocalization(), ...provideIsolatedLocaleEnvironment()],
    });
    active = TestBed.inject(ActiveBuildStore);
  });

  describe('the COST block', () => {
    it('draws nothing at all without a build', () => {
      const fixture = render(null);

      // The workspace already says why it is empty. An empty cost card beside
      // that message would be a second, wordless answer to the same question.
      expect(fixture.componentInstance.shown()).toBe(false);
      expect(text(fixture).trim()).toBe('');
    });

    it('draws the canvas’s four rows in the canvas’s order', () => {
      const rows = render(defaultBuild()).componentInstance.costRows();

      expect(rows.map((row) => row.id)).toEqual(['hull', 'modules', 'total', 'rebuy']);
    });

    it('weights TOTAL as the anchor and rebuy as the aside', () => {
      const rows = render(defaultBuild()).componentInstance.costRows();

      expect(rows.map((row) => row.weight)).toEqual(['plain', 'plain', 'total', 'quiet']);
    });

    it('labels every row, so no weight carries meaning by itself', () => {
      const rows = render(defaultBuild()).componentInstance.costRows();

      // `TOTAL` is amber and the rebuy is faint, and both are also named. The
      // colour is emphasis on a distinction the text already makes.
      for (const row of rows) {
        expect(row.label.length).toBeGreaterThan(0);
      }
    });

    it('shows the package figures, formatted and not otherwise changed', () => {
      const build = defaultBuild();
      const retail = BuildMetrics.of(build).buildCost().credits;
      const rows = render(build).componentInstance.costRows();

      const digits = (value: string): string => value.replaceAll(/\D/gu, '');
      expect(digits(rows[0]!.value)).toBe(String(retail.hull));
      expect(digits(rows[1]!.value)).toBe(String(retail.modules));
      expect(digits(rows[2]!.value)).toBe(String(retail.total));
      expect(digits(rows[3]!.value)).toBe(String(retail.rebuy));
    });

    it('names the currency for a reader who cannot see the block', () => {
      const fixture = render(defaultBuild());

      // Neither canvas prints a unit here, so it is announced rather than
      // drawn — the one thing allowed to exist without being on the design.
      const hidden = fixture.nativeElement.querySelectorAll('.cost__value .visually-hidden');
      expect(hidden.length).toBe(4);
      expect(fixture.componentInstance.creditsUnit().length).toBeGreaterThan(0);
    });
  });

  describe('the MATERIALS block', () => {
    it('is absent for a build with no engineering', () => {
      const fixture = render(defaultBuild());

      expect(fixture.componentInstance.materialsShown()).toBe(false);
      expect(fixture.componentInstance.blueprintCount()).toBeNull();
      expect(fixture.componentInstance.materialTotals()).toBeNull();
    });

    it('draws every consolidated row, with no truncation', () => {
      const build = defaultBuild();
      build.applyBlueprint(FIXTURE_SLOTS.frameShiftDrive, 'FSD_LongRange', { grade: 5 });
      const fixture = render(build);

      const rows = fixture.componentInstance.materialRows();
      // Ruling E: the canvas draws five of eighteen and closes with a count.
      // The count stays; the truncation does not, because a Commander cannot
      // shop from a list that hides most of itself.
      expect(rows.length).toBeGreaterThan(0);
      expect(fixture.nativeElement.querySelectorAll('.rail-material').length).toBe(rows.length);
    });

    it('states the blueprint count and the type and unit totals', () => {
      const build = defaultBuild();
      build.applyBlueprint(FIXTURE_SLOTS.frameShiftDrive, 'FSD_LongRange', { grade: 5 });
      const surface = render(build).componentInstance;

      expect(surface.blueprintCount()).toContain('1');
      expect(surface.materialTotals()?.types).toContain(String(surface.materialRows().length));
    });

    it('sets the two counts at opposite ends of one row', () => {
      const build = defaultBuild();
      build.applyBlueprint(FIXTURE_SLOTS.frameShiftDrive, 'FSD_LongRange', { grade: 5 });
      const fixture = render(build);

      // The canvas separates them by the width of the block, not by
      // punctuation. Two spans, and no invented middot between them.
      const footer = fixture.nativeElement.querySelector('.block__footer');
      expect(footer.querySelectorAll('span').length).toBe(2);
      expect(footer.textContent).not.toContain('·');
    });

    it('orders the rows commonest first, then by name', () => {
      const build = defaultBuild();
      build.applyBlueprint(FIXTURE_SLOTS.frameShiftDrive, 'FSD_LongRange', { grade: 5 });
      build.applyBlueprint(FIXTURE_SLOTS.thrusters, 'Engine_Dirty', { grade: 5 });
      const rows = render(build).componentInstance.materialRows();

      // The order a Commander gathers a shopping list in, and the order the
      // Engineer panel's list already uses. The package returns its own
      // catalogue order, so this ordering is the component's and has to be
      // asserted (ruling G).
      const grades = rows.map((row) => row.grade ?? Number.MAX_SAFE_INTEGER);
      expect(grades).toEqual([...grades].sort((left, right) => left - right));
      expect(rows.length).toBeGreaterThan(2);
    });

    it('breaks a rarity tie by name', () => {
      const build = defaultBuild();
      build.applyBlueprint(FIXTURE_SLOTS.frameShiftDrive, 'FSD_LongRange', { grade: 5 });
      build.applyBlueprint(FIXTURE_SLOTS.thrusters, 'Engine_Dirty', { grade: 5 });
      const rows = render(build).componentInstance.materialRows();

      for (const grade of new Set(rows.map((row) => row.grade))) {
        const band = rows.filter((row) => row.grade === grade).map((row) => row.name.text ?? '');
        expect(band).toEqual([...band].sort((left, right) => left.localeCompare(right)));
      }
    });

    it('gives each row a rarity marker the package published', () => {
      const build = defaultBuild();
      build.applyBlueprint(FIXTURE_SLOTS.frameShiftDrive, 'FSD_LongRange', { grade: 5 });
      const fixture = render(build);

      const marked = fixture.componentInstance.materialRows().filter((row) => row.grade !== null);
      expect(fixture.nativeElement.querySelectorAll('ednb-material-grade').length).toBe(
        marked.length,
      );
    });
  });

  describe('the Merc Coin row', () => {
    it('is absent when no article is bought with it', () => {
      const build = defaultBuild();
      build.applyBlueprint(FIXTURE_SLOTS.frameShiftDrive, 'FSD_LongRange', { grade: 5 });
      const fixture = render(build);

      expect(fixture.componentInstance.mercCoin()).toBeNull();
      expect(fixture.nativeElement.querySelector('.rail-material--merc-coin')).toBeNull();
    });

    it('closes the cost block when one is', () => {
      const build = cargoRackBuild(mercenaryCargoRack());
      const fixture = render(build);

      expect(fixture.componentInstance.mercCoin()).not.toBeNull();
      // Inside COST, ruled off under REBUY, as both canvases draw it since the
      // 2026-08-26 revision (ruling C, re-decided).
      const blocks = [...fixture.nativeElement.querySelectorAll('.block')];
      const coin = fixture.nativeElement.querySelector('.rail-material--merc-coin');
      expect(coin).not.toBeNull();
      expect(blocks[0]?.contains(coin)).toBe(true);
      // And never inside the material list.
      expect(
        fixture.nativeElement.querySelector('.materials-box .rail-material--merc-coin'),
      ).toBeNull();
    });

    it('still shows the price for a purchase that crafts nothing', () => {
      // A Mercenary article at its purchase grade is bought, not crafted: it
      // has a price and no shopping list. The price is now carried by COST, so
      // the materials block is drawn for rows alone and the price survives its
      // absence (ruling C, re-decided).
      const fixture = render(cargoRackBuild(mercenaryCargoRack()));

      expect(fixture.componentInstance.materialRows()).toEqual([]);
      expect(fixture.componentInstance.materialsShown()).toBe(false);
      expect(fixture.componentInstance.blueprintCount()).toBeNull();
      expect(fixture.nativeElement.querySelector('.rail-material--merc-coin')).not.toBeNull();
    });

    it('is named as well as coloured', () => {
      const fixture = render(cargoRackBuild(mercenaryCargoRack()));

      expect(fixture.componentInstance.mercCoinLabel().length).toBeGreaterThan(0);
      expect(text(fixture)).toContain(fixture.componentInstance.mercCoinLabel());
    });

    it('draws the coin ahead of the words, from this origin and decoratively', () => {
      const fixture = render(cargoRackBuild(mercenaryCargoRack()));

      const coin = fixture.nativeElement.querySelector('.rail-material__coin');
      expect(coin).not.toBeNull();
      // Decorative, because the visible label beside it already says what it
      // is. An alt text here would make a reader hear the currency twice.
      expect(coin.getAttribute('alt')).toBe('');
      // Same-origin: constitution I forbids reaching another host at runtime,
      // which is why the canvas's own asset reference is not used.
      expect(coin.getAttribute('src')).toBe('assets/icons/merc-coin.png');
      expect(coin.getAttribute('src')).not.toContain('//');
    });

    it('keeps its figure out of the material counts', () => {
      const build = cargoRackBuild(mercenaryCargoRack());
      build.applyBlueprint(FIXTURE_SLOTS.frameShiftDrive, 'FSD_LongRange', { grade: 5 });
      const surface = render(build).componentInstance;

      // Merc Coin is a purchase price, not a material. It may not swell the
      // unit total (FR-005).
      const units = surface
        .materialRows()
        .reduce((running, row) => running + Number(row.count.replaceAll(/\D/gu, '')), 0);
      expect(surface.materialTotals()?.units).toContain(String(units));
    });
  });

  describe('what the canvas does not draw', () => {
    it('offers no control of any kind', () => {
      const build = cargoRackBuild(mercenaryCargoRack());
      build.applyBlueprint(FIXTURE_SLOTS.frameShiftDrive, 'FSD_LongRange', { grade: 5 });
      const fixture = render(build);

      // Ruling F. Neither canvas draws a disclosure, a trace or a slot action
      // in these blocks, so there is nothing here to operate.
      const root = fixture.nativeElement as HTMLElement;
      expect(root.querySelectorAll('button, a, [aria-expanded], details').length).toBe(0);
    });

    it('draws no qualification when the catalogue cannot price a module', () => {
      const build = defaultBuild();
      const cost = BuildMetrics.of(build).buildCost();
      // No fixture hull produces an unpriced module, so the package's answer is
      // stood in for at the seam it is read through.
      const unpriced = build
        .fittedModules()
        .slice(0, 2)
        .map((module) => ({ slot: module.slot, symbol: module.symbol }));
      BuildMetrics.of(build).buildCost = () => ({
        ...cost,
        credits: { ...cost.credits, unpriced },
      });
      const fixture = render(build);

      // Whatever `unpriced` holds, the four canvas rows are all that is drawn:
      // no fifth row naming a mount, and no lower-bound wording beside the
      // figures. Accepted with ruling F.
      expect(unpriced).toHaveLength(2);
      expect(fixture.componentInstance.costRows().length).toBe(4);
      const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
      for (const module of unpriced) {
        expect(text).not.toContain(module.symbol);
      }
    });
  });
});
