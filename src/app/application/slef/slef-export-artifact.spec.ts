import { TestBed } from '@angular/core/testing';
import { ShipLoadout } from '@elite-dangerous-almanac/core/ships/ship-loadout';
import { inspectSlef } from '@elite-dangerous-almanac/core/ships/slef';
import { ActiveBuildStore } from '../active-build/active-build.store';
import { FragmentPublisher } from '../build-link/fragment-publisher';
import { FIXTURE_HULL, FIXTURE_SLOTS } from '../../domain/ships/outfitting/outfitting.fixtures';
import { SlefExportCoordinator } from './slef-export.coordinator';
import { SlefStore } from './slef.store';
import { suppliedFit } from '../../domain/ships/build/supplied-fit';

class StubPublisher {
  url: string | null = 'https://example.test/outfitting#b.abc';
  publishedUrl(): string | null {
    return this.url;
  }
}

function commit(active: ActiveBuildStore, loadout = ShipLoadout.default(FIXTURE_HULL)): void {
  active.commit({
    loadout,
    suppliedFit: suppliedFit(loadout.shipSymbol),
    hullName: 'Anaconda',
    provenance: 'working',
    sourceNamed: null,
    autosaveRecordId: null,
    baseline: null,
  });
}

describe('the export artifact’s life', () => {
  let active: ActiveBuildStore;
  let store: SlefStore;
  let coordinator: SlefExportCoordinator;
  let publisher: StubPublisher;

  beforeEach(() => {
    publisher = new StubPublisher();
    TestBed.configureTestingModule({
      providers: [{ provide: FragmentPublisher, useValue: publisher }],
    });
    active = TestBed.inject(ActiveBuildStore);
    store = TestBed.inject(SlefStore);
    coordinator = TestBed.inject(SlefExportCoordinator);
  });

  it('refuses to generate with no active build, and leaves no payload behind', () => {
    commit(active);
    coordinator.generate();
    expect(store.artifact()).not.toBeNull();

    active.clear();

    expect(coordinator.generate()).toBe(false);
    expect(store.artifact()).toBeNull();
  });

  it('keys the artifact to the revision it was generated for', () => {
    commit(active);

    coordinator.generate();

    expect(store.artifact()?.revision).toBe(active.revision());
  });

  it('holds at most one artifact', () => {
    commit(active);

    coordinator.generate();
    const first = store.artifact();
    coordinator.generate();

    expect(store.artifact()).not.toBe(first);
    expect(store.artifact()?.revision).toBe(active.revision());
  });

  it('invalidates the artifact synchronously after a modelled edit', () => {
    commit(active);
    coordinator.generate();

    active.touch();
    coordinator.invalidateStaleArtifact();

    expect(store.artifact()).toBeNull();
  });

  it('invalidates the artifact when the build is replaced', () => {
    commit(active);
    coordinator.generate();

    commit(active, ShipLoadout.default('Sidewinder'));
    coordinator.invalidateStaleArtifact();

    expect(store.artifact()).toBeNull();
  });

  it('exports an invalid or incomplete build, with the verdict attached', () => {
    const loadout = ShipLoadout.default(FIXTURE_HULL);
    loadout.removeModule(FIXTURE_SLOTS.fittedOptional);
    commit(active, loadout);

    expect(coordinator.generate()).toBe(true);
    expect(store.artifact()?.validation).toEqual(loadout.validation());
    expect(inspectSlef(store.artifact()?.payload ?? '').entries).toHaveLength(1);
  });

  describe('the link it carries', () => {
    it('includes a link published for exactly this revision', () => {
      commit(active);
      active.setLink({ kind: 'published', fragment: 'b.abc', revision: active.revision() });

      coordinator.generate();

      expect(store.artifact()?.header.appURL).toBe('https://example.test/outfitting#b.abc');
      expect(store.artifact()?.linkOmission).toBeNull();
    });

    it('omits a link published for an earlier revision, as stale', () => {
      commit(active);
      active.setLink({ kind: 'published', fragment: 'b.abc', revision: active.revision() });
      active.touch();

      coordinator.generate();

      expect(store.artifact()?.header.appURL).toBeUndefined();
      expect(store.artifact()?.linkOmission).toBe('stale');
    });

    it('omits a link that is still being encoded, as pending', () => {
      commit(active);
      active.setLink({ kind: 'encoding' });

      coordinator.generate();

      expect(store.artifact()?.linkOmission).toBe('pending');
    });

    it('omits a refused link, and is still a complete export', () => {
      commit(active);
      active.setLink({ kind: 'refused', code: 'tooLong', slot: null });

      coordinator.generate();

      expect(store.artifact()?.linkOmission).toBe('refused');
      expect(inspectSlef(store.artifact()?.payload ?? '').diagnostics).toHaveLength(0);
    });

    it('omits an absent link', () => {
      commit(active);

      coordinator.generate();

      expect(store.artifact()?.linkOmission).toBe('absent');
    });

    it('never builds a URL of its own when the publisher has none', () => {
      commit(active);
      active.setLink({ kind: 'published', fragment: 'b.abc', revision: active.revision() });
      publisher.url = null;

      coordinator.generate();

      expect(store.artifact()?.header.appURL).toBeUndefined();
    });
  });

  describe('what the payload does not carry', () => {
    it('carries no local record identity, name or note', () => {
      commit(active);
      active.setLink({ kind: 'published', fragment: 'b.abc', revision: active.revision() });
      store.setDraft('{"a":1}');

      coordinator.generate();
      const payload = store.artifact()?.payload ?? '';

      expect(payload).not.toContain('qualityCompleted');
      expect(payload).not.toContain('previousQuality');
      expect(payload).not.toContain('requestToken');
      expect(payload).not.toContain('provenance');
      expect(payload).not.toContain('autosaveRecordId');
    });
  });
});
