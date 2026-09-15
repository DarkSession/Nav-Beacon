import { TestBed } from '@angular/core/testing';
import type { ShipLoadout } from '@elite-dangerous-almanac/core/ships/ship-loadout';
import { ActiveBuildStore } from '../../../../application/active-build/active-build.store';
import type { BuildCandidate } from '../../../../application/active-build/active-build.models';
import { OutfittingStore } from '../../../../application/outfitting/outfitting.store';
import {
  FIXTURE_SLOTS,
  defaultBuild,
} from '../../../../domain/ships/outfitting/outfitting.fixtures';
import { provideLocalization } from '../../../../i18n/i18n.providers';
import { provideIsolatedLocaleEnvironment } from '../../../../i18n/testing/localization-harness';
import { ScreenChrome } from '../../../shared/screen-chrome';
import { OutfittingWorkspace } from './outfitting-workspace';
import { declareMeasurement, declareResizeObserver } from '../../../../ui/measurement.spec-helpers';
import { provideRouter } from '@angular/router';
import type { PartialEngineeringFailure } from '../../../../domain/ships/build/build-ingress-result';
import { LibraryPresence } from '../../../build-library/library-presence';
import { AnnouncementService } from '../../../../ui/announcements/announcement.service';
import { suppliedFit } from '../../../../domain/ships/build/supplied-fit';

/**
 * What the workspace publishes to the command bar.
 *
 * Canvas 1c draws `↶ UNDO`, `REDO ↷` and the build's own name in the bar, and
 * canvas 1d draws the same two actions in its `⋮` menu. The shell already
 * renders one list in both placements, so what is checked here is that the
 * region publishes them rather than drawing a second pair of its own
 * (FR-016, FR-019).
 */

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

describe('the outfitting workspace’s command-bar channel', () => {
  let chrome: ScreenChrome;
  let store: OutfittingStore;
  let active: ActiveBuildStore;

  function render() {
    const fixture = TestBed.createComponent(OutfittingWorkspace);
    fixture.detectChanges();
    return fixture;
  }

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideLocalization(), ...provideIsolatedLocaleEnvironment()],
    });
    active = TestBed.inject(ActiveBuildStore);
    store = TestBed.inject(OutfittingStore);
    chrome = TestBed.inject(ScreenChrome);
  });

  it('publishes undo and redo, disabled until there is a decision', () => {
    active.commit(candidateFor(defaultBuild()));
    const fixture = render();

    const actions = chrome.actions();
    expect(actions.map((action) => action.id)).toEqual(['outfitting.undo', 'outfitting.redo']);
    expect(actions.every((action) => action.disabled)).toBe(true);

    store.dispatch({ kind: 'setEnabled', slotKey: FIXTURE_SLOTS.fittedHardpoint, enabled: false });
    fixture.detectChanges();

    expect(chrome.actions()[0]?.disabled).toBe(false);
    expect(chrome.actions()[1]?.disabled).toBe(true);
  });

  it('describes what each direction would step through, for a reader', () => {
    active.commit(candidateFor(defaultBuild()));
    const fixture = render();
    store.dispatch({ kind: 'remove', slotKey: FIXTURE_SLOTS.fittedOptional });
    fixture.detectChanges();

    const description = chrome.actions()[0]?.description ?? '';

    // The label a Commander reads is drawn; which decision it would undo is
    // said only to a reader, because the canvas draws no summary beside it.
    expect(description.toLowerCase()).toContain('undo');
    expect(description).not.toBe(chrome.actions()[0]?.label);
  });

  it('runs the action the shell reports back by id', () => {
    active.commit(candidateFor(defaultBuild()));
    const fixture = render();
    store.dispatch({ kind: 'setEnabled', slotKey: FIXTURE_SLOTS.fittedHardpoint, enabled: false });
    fixture.detectChanges();

    expect(chrome.select('outfitting.undo')).toBe(true);

    expect(store.canUndo()).toBe(false);
    expect(store.canRedo()).toBe(true);
  });

  it('publishes the build’s identity, and nothing where there is no build', () => {
    const fixture = render();

    expect(chrome.identity()).toBeNull();

    active.commit(candidateFor(defaultBuild()));
    fixture.detectChanges();

    expect(chrome.identity()).toEqual({
      name: null,
      // Titled by what the build calls itself where it has no name of its own,
      // exactly as the library titles the same record's row — and the hull is
      // then not repeated beneath that title (FR-010).
      fallbackName: 'Anaconda',
      detail: null,
      ident: null,
      editing: null,
    });
  });

  it('records one decision for a confirmed name, and none for opening the field', () => {
    active.commit(candidateFor(defaultBuild()));
    const fixture = render();

    chrome.openIdentity('name');
    fixture.detectChanges();

    expect(chrome.identity()?.editing).toBe('name');
    // Opening a field is not a decision about the build (FR-018).
    expect(store.canUndo()).toBe(false);

    chrome.commitIdentity({ field: 'name', value: 'Pacifier' });
    fixture.detectChanges();

    expect(store.loadout()?.shipName).toBe('Pacifier');
    expect(chrome.identity()).toEqual({
      name: 'Pacifier',
      fallbackName: 'Anaconda',
      detail: 'Anaconda',
      ident: null,
      editing: null,
    });
    expect(store.canUndo()).toBe(true);
  });

  it('closes the field without committing anything', () => {
    active.commit(candidateFor(defaultBuild()));
    const fixture = render();
    chrome.openIdentity('ident');
    fixture.detectChanges();

    chrome.closeIdentity();
    fixture.detectChanges();

    expect(chrome.identity()?.editing).toBeNull();
    expect(store.loadout()?.shipIdent).toBeNull();
    expect(store.canUndo()).toBe(false);
  });
});

/**
 * Canvas 1d's arrangement, which is not canvas 1c's stacked.
 *
 * The renderer here has no `ResizeObserver`, so the region reports the compact
 * composition — which is the one under test and the one every capability has to
 * fit into (`composition.ts`, `observeComposition`).
 */
describe('the compact workspace', () => {
  let active: ActiveBuildStore;
  let store: OutfittingStore;

  function render() {
    const fixture = TestBed.createComponent(OutfittingWorkspace);
    fixture.detectChanges();
    return fixture;
  }

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideLocalization(), ...provideIsolatedLocaleEnvironment()],
    });
    active = TestBed.inject(ActiveBuildStore);
    store = TestBed.inject(OutfittingStore);
    active.commit(candidateFor(defaultBuild()));
  });

  it('offers four categories and no “all”, as canvas 1d’s tabs do', () => {
    const fixture = render();

    const values = fixture.componentInstance.categories().map((entry) => entry.value);

    // At this width the ledger is one category at a time and a Commander says
    // which, rather than being handed thirty-four mounts to scroll.
    expect(values).toEqual(['hardpoint', 'core', 'optional', 'utility']);
    expect(fixture.componentInstance.category()).toBe('hardpoint');
  });

  it('lists armour and the cargo hatch under core', () => {
    const fixture = render();
    const workspace = fixture.componentInstance;

    workspace.showCategory('core');
    fixture.detectChanges();

    const kinds = workspace.groups().map((group) => group.kind);

    // Canvas 1c counts `CORE 8` on a hull whose seven core internals are
    // followed by its cargo hatch, and 1d's `CORE` panel draws that hatch as
    // its last row. Armour joins them: with no `ALL` there is no other tab it
    // could be reached from.
    expect(kinds).toContain('core');
    expect(kinds).toContain('armour');
    expect(kinds).toContain('cargoHatch');
    expect(workspace.categories().find((entry) => entry.value === 'core')?.count).toBe(
      workspace.groups().reduce((total, group) => total + group.slots.length, 0),
    );
  });

  it('draws the key readings once, in the strip while the rail is closed', () => {
    const element = render().nativeElement as HTMLElement;

    // The rail is in the document whether or not its segment is open — the
    // stylesheet is what withholds a closed one — so its band is what has to
    // stay unbuilt, or every cell would be live twice for one screen.
    expect(element.querySelectorAll('.outfitting__status-rail')).toHaveLength(1);
    expect(element.querySelectorAll('.outfitting__status-cells')).toHaveLength(0);
    expect(element.querySelectorAll('ednb-capacity-summary')).toHaveLength(0);
    expect(element.querySelectorAll('.outfitting__key-figures')).toHaveLength(1);
    expect(element.querySelectorAll('ednb-defence-summary')).toHaveLength(1);
  });

  it('moves the key readings into the rail when the status segment opens', () => {
    const fixture = render();
    const element = fixture.nativeElement as HTMLElement;

    fixture.componentInstance.showAnatomyMode('status');
    fixture.detectChanges();

    // The band goes wherever the rail goes, and the strip stands down for as
    // long as the rail is open: two copies of one figure on one screen leave a
    // reader no way to tell which is the reading (003/FR-024).
    expect(element.querySelectorAll('.outfitting__status-cells')).toHaveLength(1);
    expect(element.querySelectorAll('.outfitting__key-figures')).toHaveLength(0);
    expect(element.querySelectorAll('ednb-defence-summary')).toHaveLength(1);
    expect(element.querySelectorAll('ednb-capacity-summary')).toHaveLength(1);
  });

  it('hands the anatomy strip a status segment, and draws the rail for it', () => {
    const fixture = render();
    const workspace = fixture.componentInstance;

    expect(workspace.anatomyGuestModes().map((mode) => mode.id)).toEqual(['status']);
    expect(workspace.statusModeOpen()).toBe(false);

    workspace.showAnatomyMode('status');
    fixture.detectChanges();

    expect(workspace.statusModeOpen()).toBe(true);
    expect(
      (fixture.nativeElement as HTMLElement).querySelector('.outfitting__status-rail--guest'),
    ).not.toBeNull();
  });

  it('draws the two mount actions after the ledger, not inside the anatomy', () => {
    const fixture = render();

    store.select(FIXTURE_SLOTS.fittedHardpoint);
    fixture.detectChanges();

    const element = fixture.nativeElement as HTMLElement;
    const actions = element.querySelector('.outfitting__bench-actions');

    expect(actions).not.toBeNull();
    // Canvas 1d's sticky foot sits under the ledger it acts on, so the mount a
    // Commander marked is still on screen while they choose what to do to it.
    expect(element.querySelector('.outfitting__centre')?.contains(actions!)).toBe(false);
    expect(
      element.querySelector('.outfitting__ledger-region')!.compareDocumentPosition(actions!) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});

/**
 * Canvas 1c's arrangement, where the ledger is offered whole.
 *
 * The region measures its own box rather than the window, so a wide region is
 * declared by reporting one — see `restoreAfterWideRegion` below.
 */
describe('the wide workspace’s categories', () => {
  let active: ActiveBuildStore;

  function render() {
    const fixture = TestBed.createComponent(OutfittingWorkspace);
    fixture.detectChanges();
    return fixture;
  }

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideLocalization(), ...provideIsolatedLocaleEnvironment()],
    });
    active = TestBed.inject(ActiveBuildStore);
    active.commit(candidateFor(defaultBuild()));
  });

  it('opens on “all” where the width offers it, not on the tab it opened compact with', () => {
    // The region reports the compact composition until its observer has
    // measured it for the first time, so the offering a category is first read
    // against is canvas 1d's four tabs whatever the window is. A category that
    // remembered that first reading would open a desktop ledger on eight of
    // thirty-nine mounts with `ALL` beside it unpressed.
    const wide = restoreAfterWideRegion(1440);
    try {
      const workspace = render().componentInstance;

      expect(workspace.categories().map((entry) => entry.value)).toEqual([
        'all',
        'hardpoint',
        'core',
        'optional',
        'utility',
      ]);
      expect(workspace.category()).toBe('all');
    } finally {
      wide();
    }
  });

  it('holds the category a Commander chose, over the offering’s own first', () => {
    const wide = restoreAfterWideRegion(1440);
    try {
      const workspace = render().componentInstance;

      workspace.showCategory('optional');
      expect(workspace.category()).toBe('optional');
    } finally {
      wide();
    }
  });
});

/**
 * Reports one region width to `observeComposition`, and gives back the undo.
 *
 * The composition is measured from the host's own box rather than from the
 * window, so a test about a wide region says how wide the box is rather than
 * resizing anything. The observer is stubbed only so the measurement path is
 * taken at all — the reading that matters is the synchronous one it makes
 * before observing (`composition.ts`).
 *
 * Both declarations come from `measurement.spec-helpers`, which is where the
 * rule about *which* prototype carries the patch is written down. This test
 * used to declare the width on `Element.prototype` itself and failed whenever
 * a spec that patches `HTMLElement.prototype` had run first in the same worker
 * and left an own property shadowing it: the patch landed somewhere nothing
 * read, the region measured nothing, and a wide ledger opened on canvas 1d's
 * four tabs. It failed by scheduling rather than by code, which is why the
 * declaration is shared now rather than written here.
 */
function restoreAfterWideRegion(width: number): () => void {
  const measured = declareMeasurement({ width });
  const observed = declareResizeObserver();

  return () => {
    observed();
    measured();
  };
}

/**
 * What the screen says about a record it could not open.
 *
 * The refusal is reported from `RecordOpenService`, which the saved builds
 * layer calls — and that layer stands over this screen rather than replacing
 * it, so this screen is mounted and running while the refusal arrives. An
 * announcement made then goes to an outlet the modal has made inert, and it
 * would spend the one mark the store holds (011/FR-009, design.md "An
 * announcement made under a layer").
 */
describe('the workspace and a refused record', () => {
  function failure(): PartialEngineeringFailure {
    return {
      source: {
        slotKey: 'MainEngines',
        moduleSymbol: 'Int_Engine_Size7_Class5',
        blueprintFdname: 'Engine_Dirty',
        effectFdname: null,
        grade: 5,
        quality: 0.42,
      },
      reason: 'packageResult',
      code: 'unsupportedEngineering',
      params: null,
    };
  }

  let active: ActiveBuildStore;
  let library: LibraryPresence;
  let announcements: AnnouncementService;

  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [provideRouter([]), provideLocalization(), ...provideIsolatedLocaleEnvironment()],
    });
    active = TestBed.inject(ActiveBuildStore);
    library = TestBed.inject(LibraryPresence);
    announcements = TestBed.inject(AnnouncementService);
  });

  it('says nothing while the saved builds stand over it, and says it when they go', () => {
    active.commit(candidateFor(defaultBuild()));
    library.raise();
    const fixture = TestBed.createComponent(OutfittingWorkspace);
    fixture.detectChanges();

    active.reportIngressRefusal([failure()]);
    fixture.detectChanges();

    // Spoken here, the sentence reaches an outlet the open layer has made
    // inert, and the mark it spends is the only one there is.
    expect(announcements.assertive()).toBe('');
    expect(active.ingressRefusalUnannounced()).toBe(true);

    library.lower();
    fixture.detectChanges();

    expect(announcements.assertive()).not.toBe('');
    expect(active.ingressRefusalUnannounced()).toBe(false);
  });

  it('speaks a refusal that was standing before this screen was built', () => {
    // The refusal reached the store while the Commander was somewhere else —
    // from the layer they have since closed, or from a shared link, which opens
    // a screen rather than a layer. Nothing stands over this screen now, so
    // nothing is held back and the notice speaks on its first run: the case a
    // first-run guard would silence.
    active.commit(candidateFor(defaultBuild()));
    active.reportIngressRefusal([failure()]);

    const fixture = TestBed.createComponent(OutfittingWorkspace);
    fixture.detectChanges();

    expect(announcements.assertive()).not.toBe('');
    expect(active.ingressRefusalUnannounced()).toBe(false);
  });
});
