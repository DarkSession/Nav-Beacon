import { TestBed } from '@angular/core/testing';
import { provideLocalization } from '../../i18n/i18n.providers';
import { provideIsolatedLocaleEnvironment } from '../../i18n/testing/localization-harness';
import { SHIPS } from '@elite-dangerous-almanac/core/ships/ships';
import { ShipLoadout } from '@elite-dangerous-almanac/core/ships/ship-loadout';
import { toBuildSnapshotV1 } from '../../domain/ships/build/build-snapshot.serializer';
import { ActiveBuildStore } from './active-build.store';
import { BuildIngressCoordinator } from './build-ingress.coordinator';
import { StockBuildCreator } from './stock-build.creator';

function setup(): {
  creator: StockBuildCreator;
  store: ActiveBuildStore;
  coordinator: BuildIngressCoordinator;
} {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [provideLocalization(), ...provideIsolatedLocaleEnvironment()],
  });
  return {
    creator: TestBed.inject(StockBuildCreator),
    store: TestBed.inject(ActiveBuildStore),
    coordinator: TestBed.inject(BuildIngressCoordinator),
  };
}

describe('StockBuildCreator', () => {
  it('creates exactly the package’s own default build', async () => {
    const { creator, store } = setup();

    const result = await creator.create('Anaconda');

    expect(result.kind).toBe('committed');
    expect(toBuildSnapshotV1(store.loadout()!)).toEqual(
      toBuildSnapshotV1(ShipLoadout.default('Anaconda')),
    );
  });

  it('commits the build with stock provenance and as unsaved work', async () => {
    const { creator, store } = setup();

    await creator.create('Anaconda');

    expect(store.provenance()).toBe('stock');
    expect(store.dirty()).toBe(true);
    expect(store.sourceNamed()).toBeNull();
  });

  it('arrives with every fixed mount populated by the package', async () => {
    const { creator, store } = setup();

    await creator.create('Anaconda');
    const loadout = store.loadout()!;

    for (const kind of ['armour', 'core', 'cargoHatch'] as const) {
      expect(loadout.slots(kind).every((slot) => slot.module !== null)).toBe(true);
    }
  });

  it('refuses an unknown hull without creating or replacing anything', async () => {
    const { creator, store } = setup();
    await creator.create('Anaconda');
    const before = store.loadout();

    const result = await creator.create('Nonexistent_Hull');

    expect(result).toMatchObject({ kind: 'failed' });
    expect(store.loadout()).toBe(before);
  });

  it('replaces unsaved work without asking, because it is not lost', async () => {
    // Creating a second stock build leaves the first one where it is: in its own
    // record, on the library's list (FR-008, ruled 2026-08-25).
    const { creator, store } = setup();
    await creator.create('Anaconda');

    const result = await creator.create('SideWinder');

    expect(result.kind).toBe('committed');
    expect(store.loadout()?.shipSymbol).toBe('SideWinder');
  });

  it('names the hull in the Commander’s language', async () => {
    const { creator, store } = setup();

    await creator.create('Empire_Trader');

    expect(store.hullName()).toBe('Imperial Clipper');
  });

  it('reports up front whether a hull can be created at all', () => {
    const { creator } = setup();

    expect(creator.canCreate('Anaconda')).toBe(true);
    expect(creator.canCreate('Nonexistent_Hull')).toBe(false);
  });

  it('creates a stock build for every installed hull', async () => {
    const { creator } = setup();

    for (const ship of SHIPS) {
      const result = await creator.create(ship.symbol);
      expect(result.kind).toBe('committed');
    }
  });

  it('creates a build reported at the package default, for every installed hull', async () => {
    // What keeps the answer tied to what the application actually starts. A
    // creator that transformed what the package handed it, or a comparison
    // built against some other default, would have every new build take a
    // record again and nothing would say so (024/FR-001).
    const { creator, store } = setup();

    for (const ship of SHIPS) {
      await creator.create(ship.symbol);
      expect(store.atDefault()).toBe(true);
    }
  });

  it('reports the first modelled edit of a created build as away from the default', async () => {
    const { creator, store } = setup();
    await creator.create('Anaconda');

    store.loadout()!.setModulePriority('FrameShiftDrive', 2);
    store.touch();

    expect(store.atDefault()).toBe(false);
  });

  it('does not consult the illustration at any point', async () => {
    const { creator, store } = setup();

    await creator.create('Anaconda');

    // The build exists whatever the artwork did; nothing here has an image
    // state to consult in the first place.
    expect(store.loadout()).not.toBeNull();
    expect(JSON.stringify(store.snapshot())).not.toContain('illustration');
  });
});
