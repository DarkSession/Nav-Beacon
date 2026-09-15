import { TestBed } from '@angular/core/testing';
import { BuildMetrics } from '@elite-dangerous-almanac/core/ships/build-metrics';
import type { ShipLoadout } from '@elite-dangerous-almanac/core/ships/ship-loadout';
import type { BuildCandidate } from '../../../../application/active-build/active-build.models';
import { ActiveBuildStore } from '../../../../application/active-build/active-build.store';
import { PowerConditionsStore } from '../../../../application/power-heat/power-conditions.store';
import {
  distributorOffBuild,
  noPlantOutputBuild,
  overheatingBuild,
  overloadedPlantBuild,
  shedBandBuild,
  withinBudgetBuild,
} from '../../../../domain/ships/power-heat/power-heat.fixtures';
import { provideLocalization } from '../../../../i18n/i18n.providers';
import { provideIsolatedLocaleEnvironment } from '../../../../i18n/testing/localization-harness';
import { PowerThermals } from './power-thermals';
import { suppliedFit } from '../../../../domain/ships/build/supplied-fit';

/**
 * The dashboard, from the outside.
 *
 * Every assertion below is against the package's own answer for the same build,
 * never against a number written here: a suite that pinned `11.78 MW` would
 * pass a release that changed what the Almanac says and fail one that did not.
 *
 * The other half of the suite is about meaning being carried by words. The
 * canvas says `OFFLINE` with a dimmed row, `WITHIN LIMIT` with a green tick and
 * a filled block for a pip; a reader who cannot see any of that has to get the
 * same facts, so the tests read text rather than classes wherever the fact is
 * the point.
 */
describe('PowerThermals', () => {
  let active: ActiveBuildStore;
  let conditions: PowerConditionsStore;

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
    const fixture = TestBed.createComponent(PowerThermals);
    fixture.detectChanges();
    return {
      element: fixture.nativeElement as HTMLElement,
      component: fixture.componentInstance,
      detect: () => fixture.detectChanges(),
    };
  }

  function cells(element: HTMLElement, selector: string): string[][] {
    return [...element.querySelectorAll(`${selector} tbody tr`)].map((row) =>
      [...row.querySelectorAll('th, td')].map((cell) => (cell.textContent ?? '').trim()),
    );
  }

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideLocalization(), ...provideIsolatedLocaleEnvironment()],
    });
    active = TestBed.inject(ActiveBuildStore);
    conditions = TestBed.inject(PowerConditionsStore);
  });

  it('draws nothing at all without a build', () => {
    expect(render(null).element.textContent?.trim()).toBe('');
  });

  it('has nothing to say about a workspace with no build in it', () => {
    // The template asks once and draws nothing, so every group is checked here
    // instead: an absent build is an empty list rather than a zero, an
    // exception or a row of dashes. The workspace's own empty state already
    // says why there is nothing.
    const { component } = render(null);

    expect(component.shown()).toBe(false);
    expect(component.bandRows()).toEqual([]);
    expect(component.summaryMetrics()).toEqual([]);
    expect(component.moduleRows()).toEqual([]);
    expect(component.heatFacts()).toEqual([]);
    expect(component.heatBars()).toEqual([]);
    expect(component.bankRows()).toEqual([]);
    expect(component.modulesTotal()).toBeNull();
    expect(component.heatAvailable()).toBe(false);
  });

  describe('the priority groups', () => {
    it('draws the groups the build uses, in the package’s order', () => {
      const build = withinBudgetBuild();
      const budget = BuildMetrics.of(build).powerBudget();
      // The game has five and the package returns five; a group nothing is
      // assigned to is not a reading of this build, so it is not a row.
      const used = new Set(budget.consumers.map((consumer) => consumer.priority));
      const bands = budget.bands.filter((band) => used.has(band.priority));
      const { element } = render(build);

      expect(bands.length).toBeGreaterThan(0);
      const rows = [...element.querySelectorAll('.power__block--bands .power__band')];
      expect(rows).toHaveLength(bands.length);
      expect(rows.map((row) => row.querySelector('.power__band-group')?.textContent)).toEqual(
        bands.map((band) => `Group ${band.priority}`),
      );
    });

    it('carries each group’s own draw and its running total', () => {
      const build = withinBudgetBuild();
      const first = BuildMetrics.of(build).powerBudget().bands[0];
      const { element } = render(build);

      const row = element.querySelector('.power__block--bands .power__band');
      expect(row?.querySelector('.power__band-draw')?.textContent).toBe(
        `${first.deployed.toFixed(2)} MW`,
      );
      // The canvas's third column is the running total as a share of plant
      // output, which the projection publishes and this reads back.
      const share = first.deployedTotal / BuildMetrics.of(build).powerBudget().available;
      expect(row?.querySelector('.power__band-share')?.textContent).toBe(
        `${Math.round(share * 100)}%`,
      );
    });

    it('draws each group’s bar starting where the group above it ended', () => {
      const build = shedBandBuild();
      const { element } = render(build);

      // The groups are cumulative, so each row carries two lengths: the wash is
      // everything above it and the solid length is its own on the end of that.
      // Read back as drawn, because a wash that started at zero on every row
      // would state each group's own draw against the plant and call it the
      // running total the column beside it reports.
      const rows = [...element.querySelectorAll('.power__block--bands .power__band')].map(
        (row) => ({
          preceding: percent(row.querySelector<HTMLElement>('.power__band-preceding')),
          own: percent(row.querySelector<HTMLElement>('.power__band-fill')),
          start:
            Number.parseFloat(
              row.querySelector<HTMLElement>('.power__band-fill')?.style.insetInlineStart ?? '',
            ) / 100,
        }),
      );

      expect(rows.length).toBeGreaterThan(1);
      expect(rows[0].preceding).toBe(0);
      rows.forEach((row, index) => {
        // The solid length starts at the end of the wash, not at the leading
        // edge of the track.
        expect(row.start).toBeCloseTo(row.preceding, 6);

        const above = rows[index - 1];
        if (above) {
          expect(row.preceding).toBeCloseTo(above.preceding + above.own, 6);
        }
      });
    });

    it('marks the plant in the same place on every group’s bar', () => {
      const build = shedBandBuild();
      const { element } = render(build);

      // One reading, drawn on every row: the mark is where the plant runs out
      // on a track every row shares, so the group whose length crosses it is
      // the group the plant ran out on.
      const marks = [...element.querySelectorAll<HTMLElement>('.power__band-plant')].map((mark) =>
        Number.parseFloat(mark.style.insetInlineStart),
      );

      expect(marks.length).toBeGreaterThan(1);
      expect(new Set(marks).size).toBe(1);
      expect(marks[0]).toBeGreaterThan(0);
    });

    it('marks half of the plant’s output beside it, and names both marks', () => {
      const { component, element } = render(shedBandBuild());

      // The scale every bar is read on is the share of plant output the column
      // at the end of each row prints, so the plant's own mark is its 100% and
      // the mark half way to it is its 50%.
      const halves = [...element.querySelectorAll<HTMLElement>('.power__band-half')].map((mark) =>
        Number.parseFloat(mark.style.insetInlineStart),
      );
      expect(halves.length).toBeGreaterThan(1);
      expect(new Set(halves).size).toBe(1);
      expect(halves[0]).toBeCloseTo((component.plantMark() * 100) / 2, 6);

      // Named where they stand, under the tracks they are drawn through, and
      // hidden from a reader: each row already prints its own share beside it.
      const axis = element.querySelector('.power__axis-row');
      const names = [...element.querySelectorAll('.power__axis-label')].map((label) =>
        label.textContent?.trim(),
      );
      expect(axis?.getAttribute('aria-hidden')).toBe('true');
      expect(names).toEqual(['50%', '100%']);
      const offsets = [...element.querySelectorAll<HTMLElement>('.power__axis-mark')].map((mark) =>
        Number.parseFloat(mark.style.insetInlineStart),
      );
      expect(offsets).toEqual([halves[0], component.plantMark() * 100]);
      // And it is not one of the groups: a row of names is not a priority group.
      expect(element.querySelectorAll('.power__axis-row.power__band')).toHaveLength(0);
    });

    it('drops the half mark where there is no room to name it beside the plant’s', () => {
      // The two names are centred on marks half a track apart, so a demand that
      // runs well past the plant pushes them together until they print over
      // each other. The plant's own mark is the one a track that overruns is
      // read for, so it is the one that stays — unnamed lines are not the
      // answer, and neither is a pair of names nobody can read.
      const { component, element } = render(overloadedPlantBuild());
      expect(component.plantMark()).toBeLessThan(0.5);

      expect(element.querySelectorAll('.power__band-half')).toHaveLength(0);
      const names = [...element.querySelectorAll('.power__axis-label')].map((label) =>
        label.textContent?.trim(),
      );
      expect(names).toEqual(['100%']);
      const offsets = [...element.querySelectorAll<HTMLElement>('.power__axis-mark')].map((mark) =>
        Number.parseFloat(mark.style.insetInlineStart),
      );
      expect(offsets).toEqual([component.plantMark() * 100]);
    });

    it('names no mark at all on a plant that makes nothing', () => {
      // There is no share of nothing, so there is no axis to name. Every row
      // says `OFFLINE` beside it, which is the reading that state has.
      const { element } = render(noPlantOutputBuild());

      expect(element.querySelectorAll('.power__axis-row')).toHaveLength(0);
      expect(element.querySelectorAll('.power__band-half')).toHaveLength(0);
    });

    it('states every group’s verdict in words, not only the shed one', () => {
      const build = shedBandBuild();
      const budget = BuildMetrics.of(build).powerBudget();
      const used = new Set(budget.consumers.map((consumer) => consumer.priority));
      const bands = budget.bands.filter((band) => used.has(band.priority));
      const { element } = render(build);

      // The canvas prints `OFFLINE` in place of a shed group's percentage, and
      // the percentage where the plant keeps the group lit. The word is the
      // reading rather than the bar's colour, so a reader who cannot see the
      // fill still gets it.
      const states = [...element.querySelectorAll('.power__block--bands .power__band')].map(
        (row) => row.querySelector('.power__band-state')?.textContent?.trim() ?? null,
      );
      expect(states).toEqual(bands.map((band) => (band.poweredDeployed ? null : 'Offline')));
      expect(states).toContain('Offline');
      expect(states.filter((state) => state === null).length).toBeGreaterThan(0);
    });
  });

  describe('the plant summary', () => {
    it('draws the canvas’s three tiles and nothing beside them', () => {
      const build = withinBudgetBuild();
      const budget = BuildMetrics.of(build).powerBudget();
      const { element } = render(build);

      const summary = element.querySelector('.power__summary')?.textContent ?? '';
      expect(summary).toContain(budget.available.toFixed(2));
      expect(summary).toContain(budget.deployed.toFixed(2));
      expect(summary).toContain('Plant output');
      expect(summary).toContain('Unpowered');
      // The canvas draws no headroom, no utilisation and no verdict beside
      // these, so neither does this.
      expect(summary).not.toContain('Headroom');
      expect(summary).not.toContain('Utilisation');
      expect(summary).not.toContain('Verdict');
    });

    it('states all three tiles in either hardpoint state', () => {
      const build = withinBudgetBuild();
      const budget = BuildMetrics.of(build).powerBudget();
      conditions.showHardpoints('retracted');
      const { element } = render(build);

      // Every tile the canvas draws holds with the hardpoints stowed, which is
      // why there is no sentence about figures that went missing: none did.
      const summary = element.querySelector('.power__summary')?.textContent ?? '';
      expect(summary).toContain(budget.retracted.toFixed(2));
      expect(summary).toContain('Plant output');
      expect(summary).toContain('Unpowered');
      expect(element.querySelector('.power__block--bands .power__note--inline')?.textContent).toBe(
        'Cumulative draw',
      );
    });

    it('states a shed group’s demand rather than a share of a plant not feeding it', () => {
      const build = noPlantOutputBuild();
      const { element } = render(build);

      const summary = element.querySelector('.power__summary')?.textContent ?? '';
      expect(summary).not.toContain('Infinity');
      expect(summary).not.toContain('∞');
      expect(summary).toContain(BuildMetrics.of(build).powerBudget().deployed.toFixed(2));
      // No plant output is no share to state: the groups say `Offline` where
      // the percentage would go, and no bar claims a fraction of nothing.
      const shares = element.querySelectorAll('.power__block--bands .power__band-share');
      expect(shares).toHaveLength(0);
      expect(element.querySelector('.power__plant')).toBeNull();
    });
  });

  describe('draw by module', () => {
    it('draws one line per kind of consumer, heaviest first', () => {
      const build = withinBudgetBuild();
      const consumers = BuildMetrics.of(build).powerBudget().consumers;
      const { element } = render(build);

      const rows = [...element.querySelectorAll('.module')];
      const heaviest = [...consumers].sort((left, right) => right.draw - left.draw)[0];

      expect(rows.length).toBeGreaterThan(0);
      expect(rows[0].textContent).toContain(heaviest.draw.toFixed(2));
    });

    it('gathers two mounts of one module onto one line, counted and added up', () => {
      const build = withinBudgetBuild();
      const repeated = BuildMetrics.of(build)
        .powerBudget()
        .consumers.filter((consumer) => consumer.symbol === 'Hpt_PulseLaser_Fixed_Small');
      const { element } = render(build);

      expect(repeated.length).toBeGreaterThan(1);
      const gathered = [...element.querySelectorAll('.module')].filter((node) =>
        node.textContent?.includes(`×${repeated.length}`),
      );
      const added = repeated.reduce((total, consumer) => total + consumer.draw, 0);

      expect(gathered).toHaveLength(1);
      expect(gathered[0]?.textContent).toContain(added.toFixed(2));
    });

    it('heads the list with the canvas’s two column names', () => {
      const { element } = render(withinBudgetBuild());

      // `MODULE` over the names and `MW` over the figures. The bar column
      // between them is unheaded: the bar is the figure beside it drawn out,
      // and a head over it would name a reading that is not there.
      expect(element.querySelector('.modules__head-name')?.textContent?.trim()).toBe('Module');
      expect(element.querySelector('.modules__head-draw')?.textContent?.trim()).toBe('MW');
      // Three cells on the list's three tracks, and the middle one — over the
      // bars — is empty: the bar is the figure beside it drawn out, and a head
      // over it would name a reading that is not there.
      const cells = element.querySelectorAll('.modules__head > *');
      expect(cells).toHaveLength(3);
      expect(cells[1]?.textContent?.trim()).toBe('');
    });

    it('closes the list with the whole list’s draw, dark groups included', () => {
      const build = withinBudgetBuild();
      const { element } = render(build);

      // The canvas's `TOTAL DRAW` row, which is what the lines above it add up
      // to — and a different reading from the `POWERED DRAW` tile beside the
      // priority groups, which leaves the dark groups out.
      expect(element.querySelector('.modules__total-label')?.textContent?.trim()).toBe(
        'Total draw',
      );
      expect(element.querySelector('.modules__total-draw')?.textContent).toContain(
        BuildMetrics.of(build).powerBudget().deployed.toFixed(2),
      );
    });

    it('carries no total beside the heading, where the canvas withdrew it', () => {
      const { element } = render(withinBudgetBuild());

      expect(element.querySelector('.power__block--modules .power__note')).toBeNull();
    });

    it('keeps a switched-off consumer on the list, at zero, and says it is off', () => {
      const build = distributorOffBuild();
      const consumer = BuildMetrics.of(build)
        .powerBudget()
        .consumers.find((entry) => entry.label === 'PowerDistributor');
      const { element } = render(build);

      // Listed rather than dropped, at the nothing it draws, and named as off
      // rather than left to be inferred from a zero.
      expect(consumer?.enabled).toBe(false);
      const off = [...element.querySelectorAll('.module')].filter((node) =>
        (node.textContent ?? '').includes('Off'),
      );
      expect(off.length).toBeGreaterThan(0);
      expect(off[0]?.querySelector('.module__draw')?.textContent).toContain('0.00');
    });

    it('lists a stowed hardpoint at zero rather than at what it would draw', () => {
      const build = withinBudgetBuild();
      const { component } = render(build);
      const deployed = component.moduleRows().length;

      TestBed.inject(PowerConditionsStore).showHardpoints('retracted');
      const retracted = component.moduleRows();

      // The same lines, and the weapons among them reading zero: a mount that
      // left the list when the hardpoints went in would be a mount a reader
      // could not account for.
      expect(retracted).toHaveLength(deployed);
      expect(retracted.some((row) => row.draw.includes('0.00'))).toBe(true);
    });

    it('names the group on the lines the plant leaves dark, and nowhere else', () => {
      const build = shedBandBuild();
      const dark = BuildMetrics.of(build)
        .powerBudget()
        .bands.filter((band) => !band.poweredDeployed);
      const { element } = render(build);

      const named = [...element.querySelectorAll('.module')].filter((node) =>
        node.querySelector('.module__group'),
      );

      expect(dark.length).toBeGreaterThan(0);
      expect(named.length).toBeGreaterThan(0);
      for (const node of named) {
        expect(node.classList).toContain('module--offline');
        expect(dark.some((band) => node.textContent?.includes(`Group ${band.priority}`))).toBe(
          true,
        );
      }
    });
  });

  describe('the hardpoint condition', () => {
    it('draws its caption, and names the group by it rather than by a hidden string', () => {
      const { element } = render(withinBudgetBuild());

      const caption = element.querySelector('.tab-group__label');
      const group = element.querySelector('.power__hardpoints [role="group"]');

      // Drawn, not hidden — and the group is named *by* it, so the words a
      // reader sees and the words a screen reader announces are one string.
      expect(caption?.textContent?.trim()).toBe('Hardpoints');
      expect(group?.getAttribute('aria-labelledby')).toBe(caption?.id);
      expect(group?.getAttribute('aria-label')).toBeNull();
    });
  });

  describe('the heat profile', () => {
    it('draws the canvas’s bars, in its order, named as it names them', () => {
      const { element } = render(withinBudgetBuild());

      // The trigger's own text, which is what the row draws. The gloss beside
      // it is the tooltip's and is asserted where the tooltip is.
      const names = [...element.querySelectorAll('.heat__name')].map((node) =>
        node.querySelector('button')?.textContent?.trim(),
      );
      // The five the package returns plus the cell-bank spike it declines to
      // publish as one, where a bank is fitted to spike.
      expect(names.slice(0, 5)).toEqual([
        'Idle · retracted',
        'Cruise · full throttle',
        'FSD charging',
        'Weapons alpha',
        'Sustained weapon fire',
      ]);
      expect(names.length).toBeLessThanOrEqual(6);
      if (names.length === 6) {
        expect(names[5]).toBe('Shield cell bank');
      }
    });

    it('says what each scenario name is shorthand for, in a tooltip rather than a title', () => {
      const { element } = render(withinBudgetBuild());

      const bars = [...element.querySelectorAll('.heat__bar')];
      expect(bars.length).toBeGreaterThan(0);

      for (const bar of bars) {
        const trigger = bar.querySelector('.heat__description button');
        const tip = bar.querySelector('.heat__description [role="tooltip"]');

        // In the document and related to the name it glosses, rather than in a
        // `title` or a `data-tip`: those are unreachable by touch and
        // unreliably announced, which is the whole reason this is a component
        // and not an attribute.
        expect(tip?.textContent?.trim()).toBeTruthy();
        expect(trigger?.getAttribute('aria-describedby')).toBe(tip?.getAttribute('id'));
        expect(bar.querySelector('[title]')).toBeNull();
        expect(bar.querySelector('[data-tip]')).toBeNull();
      }

      expect(
        element.querySelector('.heat__description [role="tooltip"]')?.textContent?.trim(),
      ).toBe('Hardpoints stowed, no throttle');
    });

    it('asks for the dense trigger, because the word is inside a row of bars', () => {
      // A trigger at the 44-pixel baseline set the height of every row in this
      // block, so six 14-pixel bars stood across the height of ten. This block
      // asks for SC 2.5.8's 24-pixel floor instead — the tooltip does not
      // decide it, and a trigger standing on its own still takes the baseline.
      const { element } = render(withinBudgetBuild());

      const triggers = [...element.querySelectorAll('.heat__description button')];
      expect(triggers.length).toBeGreaterThan(0);
      for (const trigger of triggers) {
        expect(trigger.classList.contains('tooltip__trigger--dense')).toBe(true);
      }
    });

    it('draws a scenario gloss only once it is asked for', () => {
      const { element, detect } = render(withinBudgetBuild());

      const trigger = element.querySelector<HTMLButtonElement>('.heat__description button');
      const tip = element.querySelector('.heat__description [role="tooltip"]');

      // Closed to begin with — the name is what the row draws — and the state
      // is on the trigger rather than left to be inferred from what is visible.
      expect(trigger?.getAttribute('aria-expanded')).toBe('false');
      expect(tip?.classList.contains('tooltip__tip--shown')).toBe(false);

      // A press is what a touch has instead of a hover, so a press opens it.
      trigger?.click();
      detect();

      expect(
        element.querySelector('.heat__description button')?.getAttribute('aria-expanded'),
      ).toBe('true');
      expect(
        element
          .querySelector('.heat__description [role="tooltip"]')
          ?.classList.contains('tooltip__tip--shown'),
      ).toBe(true);
    });

    it('draws the key above the four tiles it does not explain', () => {
      const { element } = render(withinBudgetBuild());

      const heat = element.querySelector('.heat');
      const legend = heat?.querySelector('.heat__legend');
      const facts = heat?.querySelector('.power__facts');

      // Document order is what the stacked arrangement reads and what the wide
      // one places from, so the key reading before the tiles is the assertion.
      expect(legend).not.toBeNull();
      expect(facts).not.toBeNull();
      expect(legend?.compareDocumentPosition(facts as Node)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    });

    it('reads each bar as the gauge reads it, beside the bar it drew', () => {
      const build = withinBudgetBuild();
      const idle = BuildMetrics.of(build).heatMetricsResult().value?.idle;
      const { element } = render(build);

      const first = element.querySelector('.heat__bar');
      expect(first?.querySelector('.heat__level')?.textContent?.trim()).toBe(
        `${Math.round((idle?.gauge ?? 0) * 100)}%`,
      );
      // A level that settles is a number and carries no second reading beside
      // it: there is nothing standing in for it to explain.
      expect(first?.querySelector('.heat__level .visually-hidden')).toBeNull();
      expect(first?.classList).not.toContain('heat__bar--over');
    });

    it('reads a load that never settles as the symbol, worded beside it', () => {
      const build = overheatingBuild();
      const { element } = render(build);

      expect(BuildMetrics.of(build).heatMetricsResult().value?.firingDrained.heatLevel).toBe(
        Infinity,
      );
      const bar = [...element.querySelectorAll('.heat__bar')][3];
      const level = bar?.querySelector('.heat__level');

      // The symbol is what is drawn; the sentence it stands for is carried with
      // it, so the state is never a glyph a reader has to already know.
      expect(level?.firstChild?.textContent?.trim()).toBe('∞');
      expect(level?.querySelector('.visually-hidden')?.textContent).toBe('Never settles');
      expect(bar?.classList).toContain('heat__bar--over');
    });

    it('names both fills in words, not by colour alone', () => {
      const { element } = render(withinBudgetBuild());

      // The line the bars are measured against is drawn through them and carries
      // no caption: the canvas withdrew it on 2026-08-28, and each bar's own
      // gauge beside it is what says where it falls against the line.
      expect(element.querySelector('.heat__threshold-label')).toBeNull();
      const keys = [...element.querySelectorAll('.heat__key')].map((node) =>
        node.textContent?.trim(),
      );
      expect(keys).toEqual(['Within limit', 'Over threshold']);
    });

    it('draws the canvas’s four tiles, the sinks counted from the build', () => {
      const build = withinBudgetBuild();
      const { element, component } = render(build);
      const launchers = build
        .fittedModules()
        .filter((module) => /heatsinklauncher/iu.test(module.symbol));

      expect(component.heatFacts().map((fact) => fact.label)).toEqual([
        'Resting heat',
        'Peak sustained',
        'Dissipation',
        'Heat sinks',
      ]);
      expect(component.heatFacts()[3]?.value).toBe(
        String(launchers.reduce((total, module) => total + (module.ammunition?.total ?? 0), 0)),
      );
      expect(element.querySelector('.power__block--heat .power__facts')).not.toBeNull();
    });

    it('states one unavailable group, with no hull figure standing in', () => {
      const { element } = render(noPlantOutputBuild());

      const block = element.querySelector('.power__block--heat');
      expect(block?.querySelector('ednb-unavailable-value')).not.toBeNull();
      expect(block?.querySelector('.heat')).toBeNull();
      // The rest of the dashboard is still readable.
      expect(element.querySelectorAll('.module').length).toBeGreaterThan(0);
    });
  });

  describe('the distributor', () => {
    it('draws the three banks with the package’s own figures and pips', () => {
      const build = withinBudgetBuild();
      const metrics = BuildMetrics.of(build).distributorMetricsResult({
        systemsPips: 2,
        enginesPips: 2,
        weaponsPips: 2,
      }).value;
      const { element } = render(build);

      const rows = cells(element, '.distributor');
      expect(rows.map((row) => row[0])).toEqual(['SYS', 'ENG', 'WEP']);
      expect(rows[0][4]).toBe(`${metrics?.systems.rechargeRate.toFixed(1)} MJ/s`);

      // The two middle cells carry the column's own name beside the figure, for
      // the arrangement where the header row is off screen, so the figure is
      // read out of its own element rather than off the whole cell.
      const systems = element.querySelector('[data-bank="systems"]');
      const capacity = systems?.querySelector('.distributor__cell--capacity [data-bidi-isolate]');
      const rated = systems?.querySelector('.distributor__cell--rated [data-bidi-isolate]');
      // `MW`, not the `MJ` a stored pool is actually in: the unit is the one
      // the game's own outfitting panel writes after a bank's capacity, so the
      // two panels state one figure rather than appearing to state two (ruled
      // 2026-08-27). The number is the package's, untouched.
      expect(capacity?.textContent?.trim()).toBe(`${metrics?.systems.capacity.toFixed(1)} MW`);
      expect(rated?.textContent?.trim()).toBe(`${metrics?.systems.ratedRecharge.toFixed(1)} MJ/s`);
    });

    it('labels the two figures the narrow arrangement leaves without a header', () => {
      const { element } = render(withinBudgetBuild());

      const headings = [...element.querySelectorAll('.distributor thead th')].map((cell) =>
        cell.textContent?.trim(),
      );
      const labels = [...element.querySelectorAll('[data-bank="systems"] .distributor__label')];

      // Each label repeats its own column's heading, and each is hidden from a
      // reader: the header row is still in the accessibility tree at every
      // width, so a reader who met both would meet the column name twice.
      expect(labels.map((label) => label.textContent?.trim())).toEqual([headings[1], headings[2]]);
      expect(labels.every((label) => label.getAttribute('aria-hidden') === 'true')).toBe(true);
    });

    it('states every table role, so the narrow arrangement keeps the table', () => {
      const { element } = render(withinBudgetBuild());

      // The narrow arrangement lays a row out as a block of three lines, which
      // takes the implicit table roles with it unless they are written out.
      const table = element.querySelector('.distributor');
      expect(table?.getAttribute('role')).toBe('table');
      expect([...(table?.querySelectorAll('tr') ?? [])].every((row) => row.role === 'row')).toBe(
        true,
      );
      expect(element.querySelector('[data-bank="systems"] th')?.role).toBe('rowheader');
      expect(element.querySelector('[data-bank="systems"] td')?.role).toBe('cell');
      expect(element.querySelector('.distributor thead th')?.role).toBe('columnheader');
    });

    it('names the fitted distributor nowhere, where the canvas withdrew it', () => {
      const build = withinBudgetBuild();
      const distributor = build
        .fittedModules()
        .find((module) => /powerdistributor/iu.test(module.symbol));
      const { element } = render(build);

      // The 2026-08-25 revision took the module's identity off this heading.
      // The block heads itself and says nothing about what is fitted.
      expect(element.querySelector('ednb-distributor-block .block__note')).toBeNull();
      expect(element.querySelector('ednb-distributor-block')?.textContent).not.toContain(
        `${distributor?.effectiveStats?.class}${distributor?.effectiveStats?.rating}`,
      );
    });

    it('heads the block once, in the name the revision shortened it to', () => {
      const { element } = render(withinBudgetBuild());

      expect(
        element.querySelector('ednb-distributor-block .block__heading')?.textContent?.trim(),
      ).toBe('Power distributor and pips');
    });

    it('draws four blocks per bank, filled to the allocation the package used', () => {
      const build = withinBudgetBuild();
      const { element } = render(build);

      const first = element.querySelector('.distributor tbody tr');
      const fills = [...(first?.querySelectorAll<HTMLElement>('.pips__fill') ?? [])].map(
        (node) => node.style.inlineSize,
      );
      // Two pips across four blocks: two full, two empty.
      expect(fills).toEqual(['100%', '100%', '0%', '0%']);
    });

    it('takes the pips it gives to one bank out of the other two', () => {
      const build = withinBudgetBuild();
      const { element, detect } = render(build);

      const before = cells(element, '.distributor');
      const rows = element.querySelectorAll('.distributor tbody tr');
      // The third block on systems: three pips there, and the other two banks
      // pay for it.
      rows[0]?.querySelectorAll<HTMLElement>('.pips__step')[2]?.click();
      detect();

      const after = cells(element, '.distributor');
      expect(after[0][4]).not.toBe(before[0][4]);
      expect(after[1][4]).not.toBe(before[1][4]);
      expect(after[2][4]).not.toBe(before[2][4]);
      // Capacity and rated recharge are properties of the fitted distributor.
      expect(after[0][1]).toBe(before[0][1]);
      expect(after[0][2]).toBe(before[0][2]);
    });

    it('shows the pips the package used rather than the ones pressed', () => {
      const build = withinBudgetBuild();
      const { element, detect, component } = render(build);

      const rows = element.querySelectorAll('.distributor tbody tr');
      rows[0]?.querySelectorAll<HTMLElement>('.pips__step')[3]?.click();
      detect();

      const used = BuildMetrics.of(build).distributorMetricsResult({
        systemsPips: 4,
        enginesPips: 1,
        weaponsPips: 1,
      }).value?.pips.systems;
      expect(component.bankRows()[0]?.pipsLabel).toContain(String(used));
    });

    it('steps a bank back when the block it already stands on is pressed', () => {
      const build = withinBudgetBuild();
      const { element, detect, component } = render(build);

      // Systems opens on two, so pressing its second block asks for one.
      const rows = element.querySelectorAll('.distributor tbody tr');
      rows[0]?.querySelectorAll<HTMLElement>('.pips__step')[1]?.click();
      detect();

      expect(component.bankRows()[0]?.pipsLabel).toContain('1');
    });

    it('states one unavailable group when the package publishes no distributor', () => {
      const { element } = render(distributorOffBuild());

      const block = element.querySelector('ednb-distributor-block');
      expect(block?.querySelector('ednb-unavailable-value')).not.toBeNull();
      expect(block?.querySelector('.distributor')).toBeNull();
      // No diagnosis of which of the four reasons it was: the package gives none.
      expect(element.querySelector('.power__block--heat .heat')).not.toBeNull();
    });
  });

  describe('the conditions', () => {
    it('draws the two the canvas draws, and no draft, apply, reset or error', () => {
      const { element } = render(withinBudgetBuild());

      const segments = [...element.querySelectorAll('.power__hardpoints button')].map((node) =>
        (node.textContent ?? '').trim(),
      );
      expect(segments).toEqual(['Deployed', 'Retracted']);
      expect(element.textContent).not.toContain('Apply');
      expect(element.textContent).not.toContain('Reset');
      expect(element.querySelector('.field__error')).toBeNull();
    });

    it('switches every figure to the other state at once', () => {
      const build = withinBudgetBuild();
      const budget = BuildMetrics.of(build).powerBudget();
      const { element, detect } = render(build);

      element
        .querySelectorAll<HTMLElement>('.power__hardpoints button')[1]
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      detect();

      expect(element.querySelector('.power__block--bands .power__band-draw')?.textContent).toBe(
        `${budget.bands[0].retracted.toFixed(2)} MW`,
      );
      expect(element.querySelector('.power__summary')?.textContent).toContain(
        budget.retracted.toFixed(2),
      );
    });
  });

  it('draws every reading the canvas draws, by its own name', () => {
    const { element } = render(shedBandBuild());
    const text = element.textContent ?? '';

    // These five were argued out of the build as arithmetic this application
    // had no right to do. The canvas draws all of them, so the projection
    // publishes them and the panel says them.
    expect(text).toContain('Plant output');
    expect(text).toContain('Unpowered');
    expect(text).toContain('Priority groups');
    expect(text).toContain('Cumulative draw');
    // And none of the words the canvas has no place for, anywhere on the panel.
    expect(text).not.toContain('Headroom');
    expect(text).not.toContain('Utilisation');
    expect(text).not.toContain('Verdict');
    expect(text).not.toContain('Heat efficiency');
    expect(text).not.toContain('Heat capacity');
  });
});

/** One drawn length, as a fraction of the track it is on. */
function percent(length: HTMLElement | null): number {
  return Number.parseFloat(length?.style.inlineSize ?? '') / 100;
}
