import { TestBed } from '@angular/core/testing';
import { ShipLoadout } from '@elite-dangerous-almanac/core/ships/ship-loadout';
import { baselineFingerprint } from '../../domain/ships/build/build-fingerprint';
import { toBuildSnapshotV1 } from '../../domain/ships/build/build-snapshot.serializer';
import type { PartialEngineeringFailure } from '../../domain/ships/build/build-ingress-result';
import { ActiveBuildStore } from './active-build.store';
import type { BuildCandidate } from './active-build.models';
import { suppliedFit } from '../../domain/ships/build/supplied-fit';

function store(): ActiveBuildStore {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({});
  return TestBed.inject(ActiveBuildStore);
}

function candidate(overrides: Partial<BuildCandidate> = {}): BuildCandidate {
  const loadout = ShipLoadout.default('Anaconda');
  return {
    loadout,
    suppliedFit: suppliedFit(loadout.shipSymbol),
    hullName: 'Anaconda',
    provenance: 'stock',
    sourceNamed: null,
    autosaveRecordId: null,
    baseline: null,
    ...overrides,
  };
}

describe('ActiveBuildStore', () => {
  it('starts with no build and nothing to lose', () => {
    const active = store();

    expect(active.loadout()).toBeNull();
    expect(active.provenance()).toBe('none');
    expect(active.dirty()).toBe(false);
    expect(active.snapshot()).toBeNull();
  });

  it('commits a candidate’s build and provenance in one write', () => {
    const active = store();
    const incoming = candidate({ provenance: 'link' });

    active.commit(incoming);

    expect(active.loadout()).toBe(incoming.loadout);
    expect(active.provenance()).toBe('link');
    expect(active.snapshot()?.shipSymbol).toBe('Anaconda');
  });

  it('treats a freshly created build as unsaved work', () => {
    const active = store();

    active.commit(candidate());

    expect(active.dirty()).toBe(true);
  });

  it('treats a build opened at its own baseline as clean', () => {
    const active = store();
    const incoming = candidate({ provenance: 'named' });

    active.commit({
      ...incoming,
      baseline: baselineFingerprint(toBuildSnapshotV1(incoming.loadout)),
    });

    expect(active.dirty()).toBe(false);
  });

  it('follows an in-place edit once the editor announces it', () => {
    const active = store();
    const incoming = candidate();
    active.commit({
      ...incoming,
      baseline: baselineFingerprint(toBuildSnapshotV1(incoming.loadout)),
    });
    expect(active.dirty()).toBe(false);

    incoming.loadout.setModuleEnabled('FrameShiftDrive', false);
    active.touch();

    expect(active.dirty()).toBe(true);
    expect(active.snapshot()?.modules.find((m) => m.slot === 'FrameShiftDrive')?.enabled).toBe(
      false,
    );
  });

  it('takes a new baseline only when the build is actually saved', () => {
    const active = store();
    active.commit(candidate());
    expect(active.dirty()).toBe(true);

    active.markSaved({ recordId: 'r1', baseRevisionId: 'v1' });

    expect(active.dirty()).toBe(false);
    expect(active.provenance()).toBe('named');
    expect(active.sourceNamed()).toEqual({ recordId: 'r1', baseRevisionId: 'v1' });
  });

  it('does not carry the previous build’s named source into the next one', () => {
    const active = store();
    active.commit(candidate());
    active.markSaved({ recordId: 'r1', baseRevisionId: 'v1' });

    active.commit(candidate({ provenance: 'link' }));

    expect(active.sourceNamed()).toBeNull();
    expect(active.link()).toEqual({ kind: 'absent' });
  });

  it('does not state a discarded record over the build that opens next', () => {
    // The notice is about the record another page discarded. A Commander who
    // answers it by opening another build has left that record behind, and the
    // alert would otherwise stand with nothing left to resume (001/FR-012).
    const active = store();
    active.commit(candidate());
    active.setPersistence('record-deleted-externally');

    active.commit(candidate({ provenance: 'link' }));

    expect(active.persistence()).toBe('ready');
  });

  it('publishes the package’s own validation verdict', () => {
    const active = store();
    active.commit(candidate());

    expect(active.validation()).toEqual(ShipLoadout.default('Anaconda').validation());
  });

  it('ignores an edit announcement when there is no build', () => {
    const active = store();
    const before = active.revision();

    active.touch();

    expect(active.revision()).toBe(before);
  });

  it('records persistence and link state without touching the build', () => {
    const active = store();
    const incoming = candidate();
    active.commit(incoming);

    active.setPersistence('quota-full');
    active.setLink({ kind: 'published', fragment: 'b.abc', revision: 1 });
    active.setAutosaveRecordId('w1');

    expect(active.state()).toMatchObject({
      loadout: incoming.loadout,
      persistence: 'quota-full',
      link: { kind: 'published', fragment: 'b.abc', revision: 1 },
      autosaveRecordId: 'w1',
    });
  });

  it('clears everything about the build on an explicit discard', () => {
    const active = store();
    active.commit(candidate());

    active.clear();

    expect(active.loadout()).toBeNull();
    expect(active.provenance()).toBe('none');
    expect(active.dirty()).toBe(false);
  });

  it('clears the build when the record it lives in is deleted here', () => {
    const active = store();
    active.commit(candidate({ autosaveRecordId: 'held' }));

    expect(active.clearIfHolding('held')).toBe(true);
    expect(active.loadout()).toBeNull();
    expect(active.autosaveRecordId()).toBeNull();
  });

  it('keeps the build when some other record is deleted', () => {
    const active = store();
    active.commit(candidate({ autosaveRecordId: 'held' }));

    expect(active.clearIfHolding('someone-elses')).toBe(false);
    expect(active.loadout()).not.toBeNull();
    expect(active.autosaveRecordId()).toBe('held');
  });
  describe('the ingress refusal a reader still has to be told about', () => {
    /** One refused roll, in the shape the package hands over. */
    const failure = (): PartialEngineeringFailure => ({
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
    });

    it('starts with nothing to say', () => {
      expect(store().ingressRefusalUnannounced()).toBe(false);
    });

    it('has something to say from the moment a refusal is reported', () => {
      // The notice that draws this is created after the report, because the
      // saved builds report it from a layer over whatever screen a Commander is
      // on and the workspace is built when they get there. It never sees the
      // refusal arrive. This is the fact it asks for instead (011/FR-009).
      const active = store();

      active.reportIngressRefusal([failure()]);

      expect(active.ingressRefusalUnannounced()).toBe(true);
    });

    it('has nothing more to say once it has been said', () => {
      const active = store();
      active.reportIngressRefusal([failure()]);

      active.markIngressRefusalAnnounced();

      // Which is what makes returning to a standing refusal silent: it is
      // initial content, drawn where a reader meets it in reading order.
      expect(active.ingressRefusalUnannounced()).toBe(false);
      expect(active.ingressFailures()).toHaveLength(1);
    });

    it('has something to say again when the next candidate is refused', () => {
      const active = store();
      active.reportIngressRefusal([failure()]);
      active.markIngressRefusalAnnounced();

      active.reportIngressRefusal([failure()]);

      expect(active.ingressRefusalUnannounced()).toBe(true);
    });

    it('says nothing about a build that arrived after all', () => {
      const active = store();
      active.reportIngressRefusal([failure()]);

      active.commit(candidate());

      expect(active.ingressFailures()).toEqual([]);
      expect(active.ingressRefusalUnannounced()).toBe(false);
    });
  });
});
