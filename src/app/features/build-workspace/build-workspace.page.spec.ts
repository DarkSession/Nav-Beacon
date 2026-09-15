import { BrowserPlatformLocation, PlatformLocation } from '@angular/common';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { ShipLoadout } from '@elite-dangerous-almanac/core/ships/ship-loadout';
import { ActiveBuildStore } from '../../application/active-build/active-build.store';
import { FragmentPublisher } from '../../application/build-link/fragment-publisher';
import { AutosaveService } from '../../application/build-library/autosave.service';
import { provideLocalization } from '../../i18n/i18n.providers';
import { WebLocksAdapter } from '../../platform/browser/web-locks.adapter';
import { recordKey } from '../../platform/storage/storage-keys';
import { MemoryStorage, provideMemoryStorage } from '../../platform/storage/storage.spec-helpers';
import { LibraryPresence } from '../build-library/library-presence';
import { BuildWorkspacePage } from './build-workspace.page';
import { suppliedFit } from '../../domain/ships/build/supplied-fit';

/** A lock that serializes without a browser: what is under test is the save. */
class FakeLocks {
  readonly available = true;

  async request<T>(_name: string, operation: () => Promise<T>): Promise<T> {
    return operation();
  }
}

/**
 * What the workspace does with the action the status reports.
 *
 * The status component says which control was pressed and nothing more, because
 * it draws for both tools and each tool holds its own autosave (017/FR-008).
 * Reaching the ship tool's autosave is this screen's own work, so it is
 * asserted here rather than through the component: resuming is an explicit
 * Commander action (001/FR-012), and a full store is answered by choosing what
 * to discard (001/FR-013).
 */
describe('BuildWorkspacePage persistence actions', () => {
  let active: ActiveBuildStore;
  let storage: MemoryStorage;

  /**
   * Stands the workspace up over one browser store.
   *
   * Taken apart from `beforeEach` because a reload is a fresh application over
   * the same browser: same records, same address, nothing else carried over.
   */
  async function configure(store: MemoryStorage): Promise<void> {
    await TestBed.configureTestingModule({
      imports: [BuildWorkspacePage],
      providers: [
        provideLocalization(),
        provideRouter([]),
        ...provideMemoryStorage((storage = store)),
        { provide: WebLocksAdapter, useValue: new FakeLocks() },
        // The saved-records layer pushes and pops through `Location`, and the
        // build link is published onto `window.location`. The test environment
        // gives `Location` a history of its own, which writes nothing to
        // `window.location`. The case that gives the address back its build link
        // needs the layer and the publisher on one address, so the whole suite
        // runs over the browser's history.
        { provide: PlatformLocation, useClass: BrowserPlatformLocation },
      ],
    }).compileComponents();
    active = TestBed.inject(ActiveBuildStore);
  }

  beforeEach(async () => {
    // The workspace publishes the build it holds into the address, and the
    // document's address outlives one test.
    history.replaceState(null, '', location.pathname);

    await configure(new MemoryStorage());
  });

  afterEach(() => {
    // Given back as it was found. The case below ends with a build link on the
    // address, and the address is the document's rather than the test's.
    history.replaceState(null, '', location.pathname);
  });

  /** A build on the workspace, as opening a stock hull leaves one. */
  function openBuild(symbol = 'Anaconda'): ShipLoadout {
    const loadout = ShipLoadout.default(symbol);
    active.commit({
      loadout,
      suppliedFit: suppliedFit(loadout.shipSymbol),
      hullName: symbol,
      provenance: 'stock',
      sourceNamed: null,
      autosaveRecordId: null,
      baseline: null,
    });
    return loadout;
  }

  /**
   * A build carrying one decision, so a record is owed for it.
   *
   * A build still at the package default takes none, which is what every
   * persistence action below is not about: there is no record to pause on, to
   * retry into or to lose (024/FR-001).
   */
  function decidedBuild(symbol = 'Anaconda'): void {
    openBuild(symbol).setModulePriority('FrameShiftDrive', 2);
    active.touch();
  }

  it('resumes saving when the Commander asks it to', () => {
    const fixture = TestBed.createComponent(BuildWorkspacePage);
    fixture.detectChanges();
    decidedBuild();
    const autosave = TestBed.inject(AutosaveService);
    autosave.flush();
    const mine = active.autosaveRecordId()!;

    // Gone from the store as well as announced, so that the record standing
    // afterwards is one the resume wrote rather than the one it was told about.
    storage.entries.delete(recordKey(mine));
    window.dispatchEvent(new StorageEvent('storage', { key: recordKey(mine), newValue: null }));
    fixture.detectChanges();
    expect(autosave.paused()).toBe(true);
    expect(storage.entries.has(recordKey(mine))).toBe(false);

    fixture.componentInstance.actOnPersistence('resume');

    expect(autosave.paused()).toBe(false);
    expect(storage.entries.has(recordKey(mine))).toBe(true);
    fixture.destroy();
  });

  it('writes again when the Commander asks to retry', () => {
    const fixture = TestBed.createComponent(BuildWorkspacePage);
    fixture.detectChanges();
    decidedBuild();

    fixture.componentInstance.actOnPersistence('retry');

    expect(active.autosaveRecordId()).not.toBeNull();
    expect(storage.entries.has(recordKey(active.autosaveRecordId()!))).toBe(true);
    fixture.destroy();
  });

  it('raises the saved records layer to choose what to discard', () => {
    // A full store is the one state whose way out is somewhere else: what to
    // discard is the saved records layer's own work (001/FR-013).
    const fixture = TestBed.createComponent(BuildWorkspacePage);
    fixture.detectChanges();
    openBuild();
    const layer = TestBed.inject(LibraryPresence);
    expect(layer.open()).toBe(false);

    fixture.componentInstance.actOnPersistence('manage');

    expect(layer.open()).toBe(true);
    fixture.destroy();
  });

  /**
   * Runs the effects, lets the encode they started resolve, and runs them again.
   *
   * Publication spans an await and the page starts publishing from a promise
   * chain, so one pass is never the whole of either.
   */
  async function settle(fixture: ComponentFixture<BuildWorkspacePage>): Promise<void> {
    for (let pass = 0; pass < 3; pass += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      fixture.detectChanges();
    }
  }

  /**
   * Settles until the page reaches the state asked about, or gives up.
   *
   * The real codec is a lazily imported chunk, so the first encode of a run
   * takes as long as the import does. A fixed number of passes would either be
   * too few here or wasted everywhere else.
   */
  async function settleUntil(
    fixture: ComponentFixture<BuildWorkspacePage>,
    reached: () => boolean,
  ): Promise<void> {
    for (let pass = 0; pass < 50 && !reached(); pass += 1) {
      await settle(fixture);
    }
  }

  it('restores a build at the package default from the address after a reload', async () => {
    // Such a build takes no record, so a record is not what brings it back. The
    // address is: it carries the build from the moment the build becomes
    // active, and a page built at that address reads it straight back
    // (024/FR-001, 024/FR-003).
    const first = TestBed.createComponent(BuildWorkspacePage);
    first.detectChanges();
    openBuild();
    await settleUntil(first, () => window.location.hash.startsWith('#b.'));

    expect(window.location.hash.startsWith('#b.')).toBe(true);
    expect(active.autosaveRecordId()).toBeNull();
    expect(storage.entries.size).toBe(0);
    first.destroy();

    // The reload: a fresh application over the same browser store, at the
    // address the first page left behind. Nothing is claimed, because nothing
    // was ever claimed.
    const browserStore = storage;
    TestBed.resetTestingModule();
    await configure(browserStore);
    const second = TestBed.createComponent(BuildWorkspacePage);
    second.detectChanges();
    await settleUntil(second, () => active.loadout() !== null);

    expect(active.loadout()?.shipSymbol).toBe('Anaconda');
    // Let the restored build's own publication land, so nothing is still in
    // flight when the address is given back.
    await settle(second);
    second.destroy();
  });

  it('opens on the no-build state at an address carrying no fragment', async () => {
    // The ordinary state of a fresh tab. Nothing is claimed and nothing is in
    // the address, so there is nothing to restore and none is invented
    // (024/FR-001).
    const fixture = TestBed.createComponent(BuildWorkspacePage);
    fixture.detectChanges();
    await settle(fixture);

    expect(active.loadout()).toBeNull();
    expect(storage.entries.size).toBe(0);
    fixture.destroy();
  });

  it('gives the address back the build link the saved records were raised over', async () => {
    // The two are driven together here because `LibraryPresence` has no suite
    // of its own, and the race needs both: `raise()` pushes an entry at the
    // same address, so the publication's document guard passes and the fragment
    // lands on the layer's entry. `lower()` goes back to the workspace's, which
    // never received it (022/FR-001).
    const fixture = TestBed.createComponent(BuildWorkspacePage);
    fixture.detectChanges();

    // Held open, so the layer goes up inside the window rather than racing it.
    const publisher = TestBed.inject(FragmentPublisher);
    let finish: (fragment: string) => void = () => {};
    publisher.encode = () =>
      new Promise<string>((resolve) => {
        finish = resolve;
      });
    openBuild();
    await settle(fixture);

    const layer = TestBed.inject(LibraryPresence);
    expect(layer.raise()).toBe(true);
    finish('b.published');
    await settle(fixture);
    expect(window.location.hash).toBe('#b.published');

    const closed = new Promise<void>((resolve) => {
      window.addEventListener('hashchange', () => resolve(), { once: true });
    });
    layer.lower();
    await closed;
    await settle(fixture);

    // The address a Commander copies from the bar is the build they are
    // looking at, whether or not they glanced at their saved records first.
    expect(window.location.hash).toBe('#b.published');
    fixture.destroy();
  });
});
