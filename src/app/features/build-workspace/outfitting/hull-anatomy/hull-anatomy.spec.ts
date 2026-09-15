import { TestBed } from '@angular/core/testing';
import type { BuildCandidate } from '../../../../application/active-build/active-build.models';
import { ActiveBuildStore } from '../../../../application/active-build/active-build.store';
import { AnatomyStore } from '../../../../application/anatomy/anatomy.store';
import { OutfittingStore } from '../../../../application/outfitting/outfitting.store';
import type {
  SchematicDocument,
  SchematicSide,
  SideAssetState,
} from '../../../../domain/ships/anatomy/anatomy-model';
import {
  FIXTURE_SLOTS,
  defaultBuild,
} from '../../../../domain/ships/outfitting/outfitting.fixtures';
import { provideLocalization } from '../../../../i18n/i18n.providers';
import { provideIsolatedLocaleEnvironment } from '../../../../i18n/testing/localization-harness';
import { AlmanacSchematicLoader } from '../../../../platform/assets/almanac-schematic-loader';
import { AnnouncementService } from '../../../../ui/announcements/announcement.service';
import { HullAnatomy } from './hull-anatomy';
import { suppliedFit } from '../../../../domain/ships/build/supplied-fit';

/**
 * The panel, as the canvases draw it.
 *
 * The store already proves which mounts are admitted and when; what is left to
 * this component is what a reader actually meets — the three blocks the canvas
 * draws and nothing else, one plate per side always built so the layout can
 * choose, a mount that reaches feature 002's selection, and one announcement
 * for a side that stops working rather than one per mount on it.
 */

class FakeLoader {
  readonly #pending: { side: SchematicSide; settle: (state: SideAssetState) => void }[] = [];

  load(_symbol: string, side: SchematicSide): Promise<SideAssetState> {
    return new Promise((resolve) => this.#pending.push({ side, settle: resolve }));
  }

  async settle(side: SchematicSide, state: SideAssetState): Promise<void> {
    const index = this.#pending.findIndex((request) => request.side === side);
    const [request] = this.#pending.splice(index, 1);
    request.settle(state);
    await Promise.resolve();
    await Promise.resolve();
  }
}

function documentFor(side: SchematicSide, journalSlot: string): SchematicDocument {
  return {
    side,
    symbol: 'Anaconda',
    viewBox: '0 0 100 200',
    content: { x: 0, y: 0, width: 100, height: 200 },
    annotations: [
      {
        feature: journalSlot.startsWith('Tiny') ? 'utility_mount' : 'hardpoint',
        journalSlot,
        centre: { x: 2, y: 2 },
      },
    ],
  };
}

function candidate(symbol = 'Anaconda'): BuildCandidate {
  return {
    loadout: defaultBuild(symbol),
    suppliedFit: suppliedFit(defaultBuild(symbol).shipSymbol),
    hullName: symbol,
    provenance: 'stock',
    sourceNamed: null,
    autosaveRecordId: null,
    baseline: null,
  };
}

describe('HullAnatomy', () => {
  let loader: FakeLoader;
  let announced: { messageKey: string; kind: string }[];

  function render(): { element: HTMLElement; detect: () => void } {
    const fixture = TestBed.createComponent(HullAnatomy);
    fixture.detectChanges();
    return {
      element: fixture.nativeElement as HTMLElement,
      detect: () => fixture.detectChanges(),
    };
  }

  beforeEach(() => {
    loader = new FakeLoader();
    announced = [];
    TestBed.configureTestingModule({
      providers: [
        provideLocalization(),
        ...provideIsolatedLocaleEnvironment(),
        { provide: AlmanacSchematicLoader, useValue: loader },
        {
          provide: AnnouncementService,
          useValue: {
            announce: (event: { messageKey: string; kind: string }) => announced.push(event),
          },
        },
      ],
    });
  });

  it('draws the three blocks the canvas draws, in that order', () => {
    const { element } = render();

    const blocks = [...element.querySelectorAll('.anatomy > *')].map((node) => node.className);
    expect(blocks).toEqual(['anatomy__header', 'anatomy__plates', 'anatomy__legend']);
    expect(element.querySelector('.anatomy__heading')).not.toBeNull();
    expect(element.querySelector('.anatomy__sides')).not.toBeNull();
  });

  it('draws the canvas’s five modes, with only the ones that exist operable', () => {
    const { element } = render();

    const strip = element.querySelector('.anatomy__modes');
    const tabs = [...(strip?.querySelectorAll('button') ?? [])];
    expect(tabs.map((tab) => (tab.textContent ?? '').trim())).toEqual([
      'Mounts',
      'Power',
      'Drives',
      'Defence',
      'Offence',
    ]);
    // All five are built now: `MOUNTS` is this region's own and the other four
    // are capabilities that read the same plates. Nothing is disabled, so
    // nothing opens a panel with nothing in it.
    expect(tabs[0].getAttribute('aria-pressed')).toBe('true');
    expect(tabs.filter((tab) => tab.hasAttribute('disabled'))).toEqual([]);
  });

  describe('the power mode', () => {
    /** Opens `POWER` on a plate that has arrived, and returns the rendered DOM. */
    async function openPower(): Promise<{ element: HTMLElement; detect: () => void }> {
      TestBed.inject(AnatomyStore);
      TestBed.inject(ActiveBuildStore).commit(candidate());
      TestBed.tick();
      await loader.settle('top', {
        kind: 'ready',
        document: documentFor('top', FIXTURE_SLOTS.fittedHardpoint),
      });
      const rendered = render();
      rendered.element
        .querySelectorAll<HTMLElement>('.anatomy__modes button')[1]
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      rendered.detect();
      return rendered;
    }

    it('retitles the region, and adds nothing under the title', async () => {
      const { element } = await openPower();

      // The canvas's switching script carries a title per mode and nothing
      // else: a line under it explaining the panel is not something it draws.
      expect(element.querySelector('.anatomy__heading')?.textContent?.trim()).toBe(
        'Power and thermals',
      );
      expect(element.querySelectorAll('.anatomy__title p')).toHaveLength(0);
    });

    it('replaces the plates rather than drawing under them', async () => {
      const { element, detect } = await openPower();

      // The canvas's switching script sets the plate container to
      // `display: none` for every mode but `mounts`, so the side selector and
      // the legend that belong to the plates go with them and the panel is what
      // the region draws (design/canvas-contract.md).
      expect(element.querySelector('ednb-power-thermals')).not.toBeNull();
      const blocks = [...element.querySelectorAll('.anatomy > *')].map((node) => node.className);
      expect(blocks).toEqual(['anatomy__header', 'anatomy__dashboard']);
      expect(element.querySelector('.anatomy__plates')).toBeNull();
      expect(element.querySelector('.anatomy__sides')).toBeNull();
      expect(element.querySelector('.anatomy__legend')).toBeNull();
      expect(element.querySelector('.schematic__mount')).toBeNull();

      element
        .querySelectorAll<HTMLElement>('.anatomy__modes button')[0]
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      detect();

      expect(element.querySelector('ednb-power-thermals')).toBeNull();
      expect(element.querySelector('.anatomy__plates')).not.toBeNull();
      expect(element.querySelector('.anatomy__legend')).not.toBeNull();
      expect(element.querySelector('.anatomy__heading')?.textContent?.trim()).toBe('Hull anatomy');
    });

    it('leaves the mounts layer exactly as the mounts mode drew it', async () => {
      const { element, detect } = await openPower();

      element
        .querySelectorAll<HTMLElement>('.anatomy__modes button')[0]
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      detect();

      // Coming back from POWER draws the node number and no power attribute:
      // the layer the canvas authors over the plates is never revealed, so
      // nothing this capability does survives the trip.
      const mount = element.querySelector<HTMLElement>('.schematic__mount');
      expect(mount?.hasAttribute('data-power')).toBe(false);
      expect(mount?.textContent?.trim()).toMatch(/^\d+$/u);
    });
  });

  describe('the drives mode', () => {
    /** Opens `DRIVES` on a plate that has arrived, and returns the rendered DOM. */
    async function openDrives(): Promise<{ element: HTMLElement; detect: () => void }> {
      TestBed.inject(AnatomyStore);
      TestBed.inject(ActiveBuildStore).commit(candidate());
      TestBed.tick();
      await loader.settle('top', {
        kind: 'ready',
        document: documentFor('top', FIXTURE_SLOTS.fittedHardpoint),
      });
      const rendered = render();
      rendered.element
        .querySelectorAll<HTMLElement>('.anatomy__modes button')[2]
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      rendered.detect();
      return rendered;
    }

    it('retitles the region, and adds nothing under the title', async () => {
      const { element } = await openDrives();

      // The canvas's switching script maps this mode to its own title and
      // nothing else, exactly as it does for POWER.
      expect(element.querySelector('.anatomy__heading')?.textContent?.trim()).toBe(
        'Drives and mass',
      );
      expect(element.querySelectorAll('.anatomy__title p')).toHaveLength(0);
    });

    it('replaces the plates rather than drawing under them', async () => {
      const { element } = await openDrives();

      expect(element.querySelector('ednb-drives-mass')).not.toBeNull();
      const blocks = [...element.querySelectorAll('.anatomy > *')].map((node) => node.className);
      expect(blocks).toEqual(['anatomy__header', 'anatomy__dashboard']);
      expect(element.querySelector('.anatomy__plates')).toBeNull();
      expect(element.querySelector('.anatomy__sides')).toBeNull();
      expect(element.querySelector('.anatomy__legend')).toBeNull();
    });

    it('gives the plates and the title back on the way out', async () => {
      const { element, detect } = await openDrives();

      element
        .querySelectorAll<HTMLElement>('.anatomy__modes button')[0]
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      detect();

      expect(element.querySelector('ednb-drives-mass')).toBeNull();
      expect(element.querySelector('.anatomy__plates')).not.toBeNull();
      expect(element.querySelector('.anatomy__legend')).not.toBeNull();
      expect(element.querySelector('.anatomy__heading')?.textContent?.trim()).toBe('Hull anatomy');
    });
  });

  describe('the defence mode', () => {
    /** Opens `DEFENCE` on a plate that has arrived, and returns the rendered DOM. */
    async function openDefence(): Promise<{ element: HTMLElement; detect: () => void }> {
      TestBed.inject(AnatomyStore);
      TestBed.inject(ActiveBuildStore).commit(candidate());
      TestBed.tick();
      await loader.settle('top', {
        kind: 'ready',
        document: documentFor('top', FIXTURE_SLOTS.fittedHardpoint),
      });
      const rendered = render();
      rendered.element
        .querySelectorAll<HTMLElement>('.anatomy__modes button')[3]
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      rendered.detect();
      return rendered;
    }

    it('retitles the region with the canvas’s own title for the mode', async () => {
      const { element } = await openDefence();

      expect(element.querySelector('.anatomy__heading')?.textContent?.trim()).toBe(
        'Defence analysis',
      );
      expect(element.querySelectorAll('.anatomy__title p')).toHaveLength(0);
    });

    it('replaces the plates with the two cards, and gives them back on the way out', async () => {
      const { element, detect } = await openDefence();

      expect(element.querySelector('ednb-defence-analysis')).not.toBeNull();
      expect(element.querySelector('ednb-power-thermals')).toBeNull();
      const blocks = [...element.querySelectorAll('.anatomy > *')].map((node) => node.className);
      expect(blocks).toEqual(['anatomy__header', 'anatomy__dashboard']);
      expect(element.querySelector('.anatomy__plates')).toBeNull();
      expect(element.querySelector('.anatomy__legend')).toBeNull();

      element
        .querySelectorAll<HTMLElement>('.anatomy__modes button')[0]
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      detect();

      expect(element.querySelector('ednb-defence-analysis')).toBeNull();
      expect(element.querySelector('.anatomy__plates')).not.toBeNull();
      expect(element.querySelector('.anatomy__heading')?.textContent?.trim()).toBe('Hull anatomy');
    });

    it('draws one capability at a time, never both', async () => {
      const { element, detect } = await openDefence();

      element
        .querySelectorAll<HTMLElement>('.anatomy__modes button')[1]
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      detect();

      expect(element.querySelector('ednb-power-thermals')).not.toBeNull();
      expect(element.querySelector('ednb-defence-analysis')).toBeNull();
    });
  });

  describe('the offence mode', () => {
    /** Opens `OFFENCE` on a plate that has arrived, and returns the rendered DOM. */
    async function openOffence(): Promise<{ element: HTMLElement; detect: () => void }> {
      TestBed.inject(AnatomyStore);
      TestBed.inject(ActiveBuildStore).commit(candidate());
      TestBed.tick();
      await loader.settle('top', {
        kind: 'ready',
        document: documentFor('top', FIXTURE_SLOTS.fittedHardpoint),
      });
      const rendered = render();
      rendered.element
        .querySelectorAll<HTMLElement>('.anatomy__modes button')[4]
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      rendered.detect();
      return rendered;
    }

    it('retitles the region, and adds nothing under the title', async () => {
      const { element } = await openOffence();

      // The canvas's switching script carries a title per mode and nothing
      // else: canvas 1d's `OUTPUT, RANGE, CONVERGENCE` sub-line is not
      // something the desktop script draws, and two of its three words name
      // content this feature does not build
      // (openspec/changes/archive/007-offence-profile/design/canvas-contract.md).
      expect(element.querySelector('.anatomy__heading')?.textContent?.trim()).toBe(
        'Offence analysis',
      );
      expect(element.querySelectorAll('.anatomy__title p')).toHaveLength(0);
    });

    it('replaces the plates rather than drawing under them', async () => {
      const { element, detect } = await openOffence();

      expect(element.querySelector('ednb-offence-analysis')).not.toBeNull();
      expect(element.querySelector('ednb-power-thermals')).toBeNull();
      expect(element.querySelector('ednb-defence-analysis')).toBeNull();
      const blocks = [...element.querySelectorAll('.anatomy > *')].map((node) => node.className);
      expect(blocks).toEqual(['anatomy__header', 'anatomy__dashboard']);
      expect(element.querySelector('.anatomy__plates')).toBeNull();
      expect(element.querySelector('.anatomy__sides')).toBeNull();
      expect(element.querySelector('.anatomy__legend')).toBeNull();

      element
        .querySelectorAll<HTMLElement>('.anatomy__modes button')[0]
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      detect();

      expect(element.querySelector('ednb-offence-analysis')).toBeNull();
      expect(element.querySelector('.anatomy__plates')).not.toBeNull();
      expect(element.querySelector('.anatomy__heading')?.textContent?.trim()).toBe('Hull anatomy');
    });

    it('numbers the mounts again on the way back, having never written on them', async () => {
      const { element, detect } = await openOffence();

      element
        .querySelectorAll<HTMLElement>('.anatomy__modes button')[0]
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      detect();

      // Weaker than POWER's version of this, and it should be: POWER authors a
      // `data-power` attribute over the plates and so has something to leave
      // behind, while OFFENCE draws its panel beside them and never touches the
      // mounts layer at all. What is checked is that the round trip re-renders
      // the plates rather than leaving them torn down.
      const mount = element.querySelector<HTMLElement>('.schematic__mount');
      expect(mount?.textContent?.trim()).toMatch(/^\d+$/u);
    });

    it('opens one dashboard at a time', async () => {
      const { element, detect } = await openOffence();

      element
        .querySelectorAll<HTMLElement>('.anatomy__modes button')[1]
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      detect();

      expect(element.querySelector('ednb-power-thermals')).not.toBeNull();
      expect(element.querySelector('ednb-offence-analysis')).toBeNull();
      expect(element.querySelector('ednb-defence-analysis')).toBeNull();
    });
  });

  it('lists the reference legend, entry for entry', () => {
    const { element } = render();

    const entries = [...element.querySelectorAll('.anatomy__legend-entry')].map((node) =>
      (node.textContent ?? '').trim(),
    );
    expect(entries.length).toBe(5);
    expect(entries[0]).toMatch(/selected/i);
    expect(entries[4]).toMatch(/engineered/i);
    // The mark is decoration; the word beside it is what is read.
    expect(element.querySelector('.anatomy__legend-mark')?.getAttribute('aria-hidden')).toBe(
      'true',
    );
  });

  it('builds one plate per side, whichever side is shown', () => {
    TestBed.inject(ActiveBuildStore).commit(candidate());
    TestBed.tick();
    const { element } = render();

    const plates = element.querySelectorAll('ednb-hull-schematic');
    expect(plates.length).toBe(2);
    // The layout decides which is seen; both exist so a container query is the
    // only thing that has to change between the wide and compact arrangements.
    expect(element.querySelectorAll('.anatomy__plate--hidden').length).toBe(1);
  });

  it('shows the side a Commander asks for', () => {
    const anatomy = TestBed.inject(AnatomyStore);
    const { element, detect } = render();

    expect(anatomy.visibleSide()).toBe('top');
    element
      .querySelectorAll<HTMLElement>('.anatomy__sides button')[1]
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    detect();

    expect(anatomy.visibleSide()).toBe('bottom');
    expect(element.querySelector('.anatomy__plate:not(.anatomy__plate--hidden)')).not.toBeNull();
  });

  it('reaches feature 002 selection when a mount is activated', async () => {
    TestBed.inject(AnatomyStore);
    TestBed.inject(ActiveBuildStore).commit(candidate());
    TestBed.tick();
    await loader.settle('top', {
      kind: 'ready',
      document: documentFor('top', FIXTURE_SLOTS.hardpoint),
    });
    const { element, detect } = render();
    detect();

    const mount = element.querySelector<HTMLElement>('.schematic__mount');
    expect(mount?.getAttribute('data-slot')).toBe(FIXTURE_SLOTS.hardpoint);

    mount?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    detect();

    expect(TestBed.inject(OutfittingStore).selectedSlotKey()).toBe(FIXTURE_SLOTS.hardpoint);
  });

  it('announces a side failing, recovering and failing again, at one revision', async () => {
    TestBed.inject(ActiveBuildStore).commit(candidate());
    TestBed.tick();
    render();

    // The first answer is not a change: a reader arriving at the region reads
    // its state in place rather than being told the state it already sees.
    expect(announced).toEqual([]);

    await loader.settle('top', { kind: 'temporarilyUnavailable' });
    TestBed.tick();
    expect(announced.map((event) => event.messageKey)).toEqual(['anatomy.announce.unavailable']);

    TestBed.inject(AnatomyStore).retry('top');
    TestBed.tick();
    await loader.settle('top', {
      kind: 'ready',
      document: documentFor('top', FIXTURE_SLOTS.hardpoint),
    });
    TestBed.tick();

    expect(announced.map((event) => event.messageKey)).toEqual([
      'anatomy.announce.unavailable',
      'anatomy.announce.recovered',
    ]);
    expect(announced.every((event) => event.kind === 'anatomy.side.top')).toBe(true);

    // And failing again. Nothing about the build moved through any of the
    // three, so a policy comparing the build's revision heard one event and
    // the Commander was left with a region that had stopped working and no
    // word about it (011/FR-009).
    TestBed.inject(AnatomyStore).retry('top');
    TestBed.tick();
    await loader.settle('top', { kind: 'temporarilyUnavailable' });
    TestBed.tick();

    expect(announced.map((event) => event.messageKey)).toEqual([
      'anatomy.announce.unavailable',
      'anatomy.announce.recovered',
      'anatomy.announce.unavailable',
    ]);
  });

  it('asks a plate for its side again when a Commander presses retry', async () => {
    TestBed.inject(AnatomyStore);
    TestBed.inject(ActiveBuildStore).commit(candidate());
    TestBed.tick();
    await loader.settle('top', { kind: 'temporarilyUnavailable' });
    const { element, detect } = render();
    detect();

    const plate = element.querySelector('.schematic[data-side="top"]');
    expect(plate?.getAttribute('data-state')).toBe('temporarilyUnavailable');

    plate?.querySelector<HTMLElement>('ednb-action-button button')?.click();
    TestBed.tick();
    detect();

    // Back to pending, and the peer is untouched by either the failure or the
    // retry: the two sides have independent lifecycles (FR-010).
    expect(plate?.getAttribute('data-state')).toBe('loading');
    expect(
      element.querySelector('.schematic[data-side="bottom"]')?.getAttribute('data-state'),
    ).toBe('loading');
  });

  it('says nothing about the previous hull\u2019s failure when a different hull opens', async () => {
    TestBed.inject(ActiveBuildStore).commit(candidate());
    TestBed.tick();
    render();

    await loader.settle('bottom', { kind: 'temporarilyUnavailable' });
    TestBed.tick();
    expect(announced.map((event) => event.messageKey)).toEqual(['anatomy.announce.unavailable']);

    // A build link opens a different ship into the same workspace, so this
    // component is not destroyed between them. The next hull\u2019s bottom is a
    // side nobody was told about, and a perfectly good one arriving must not be
    // announced as a recovery from a failure that was another ship\u2019s.
    TestBed.inject(ActiveBuildStore).commit(candidate('Adder'));
    TestBed.tick();
    await loader.settle('bottom', {
      kind: 'ready',
      document: documentFor('bottom', FIXTURE_SLOTS.hardpoint),
    });
    TestBed.tick();

    expect(announced.map((event) => event.messageKey)).toEqual(['anatomy.announce.unavailable']);
  });

  it('marks itself while a guest segment is open, so it can close against that panel', () => {
    TestBed.inject(ActiveBuildStore).commit(candidate());
    TestBed.tick();

    const fixture = TestBed.createComponent(HullAnatomy);
    const status = { id: 'status', label: 'Status', heading: 'Build status' };
    fixture.componentRef.setInput('guestModes', [status]);
    fixture.detectChanges();

    // The panel for a guest segment is drawn by the region that owns it,
    // outside this box. Unmarked, this region kept the inset under a panel that
    // is not here and the workspace put its band gap after it, which opened a
    // band of empty ground between the strip and `BUILD STATUS`.
    const host = fixture.nativeElement as HTMLElement;
    expect(host.classList.contains('anatomy--guest')).toBe(false);

    fixture.componentInstance.showMode('status');
    fixture.detectChanges();
    expect(host.classList.contains('anatomy--guest')).toBe(true);

    fixture.componentInstance.showMode('mounts');
    fixture.detectChanges();
    expect(host.classList.contains('anatomy--guest')).toBe(false);
  });

  it('falls back to its own first segment when a guest segment is withdrawn', () => {
    TestBed.inject(ActiveBuildStore).commit(candidate());
    TestBed.tick();

    const fixture = TestBed.createComponent(HullAnatomy);
    const status = { id: 'status', label: 'Status', heading: 'Build status' };
    fixture.componentRef.setInput('guestModes', [status]);
    fixture.detectChanges();

    fixture.componentInstance.showMode('status');
    fixture.detectChanges();
    expect(fixture.componentInstance.guestMode()).toEqual(status);
    expect(fixture.componentInstance.activeMode()).toBe('status');

    // The segment belongs to the caller and the roomy arrangement does not offer
    // it. Left standing on it, the region drew its rule and its strip and
    // nothing under them, with no segment marked as the open one — which is what
    // rotating a phone to landscape with `STATUS` open did.
    fixture.componentRef.setInput('guestModes', []);
    fixture.detectChanges();

    expect(fixture.componentInstance.guestMode()).toBeNull();
    expect(fixture.componentInstance.activeMode()).toBe('mounts');
    expect(fixture.componentInstance.isDashboard()).toBe(false);
  });

  it('says a defective document is a defect, not a hiccup', async () => {
    TestBed.inject(ActiveBuildStore).commit(candidate());
    TestBed.tick();
    render();

    await loader.settle('bottom', { kind: 'contractDefect' });
    TestBed.tick();

    expect(announced.map((event) => event.messageKey)).toEqual(['anatomy.announce.defect']);
  });
});
