import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { ShipLoadout } from '@elite-dangerous-almanac/core/ships/ship-loadout';
import {
  FIXTURE_HULL,
  FIXTURE_SLOTS,
  SUPPORTED_PARTIAL_QUALITY,
  SUPPORTED_PARTIAL_SOURCE_QUALITY,
  UNSUPPORTED_PARTIAL_QUALITY,
} from '../../domain/ships/outfitting/outfitting.fixtures';
import { provideLocalization } from '../../i18n/i18n.providers';
import { provideIsolatedLocaleEnvironment } from '../../i18n/testing/localization-harness';
import { ActiveBuildStore } from '../active-build/active-build.store';
import { BuildIngressCoordinator } from '../active-build/build-ingress.coordinator';
import type { BuildCandidate } from '../active-build/active-build.models';
import { AutosaveService } from '../build-library/autosave.service';
import { BuildLibraryStore } from '../build-library/build-library.store';
import { generateSlefExportArtifact } from '../../domain/ships/slef/slef-export';
import { MemoryStorage, provideMemoryStorage } from '../../platform/storage/storage.spec-helpers';
import type { JournalFile } from '../../domain/journal/journal-scan';
import { SlefImportCoordinator } from './slef-import.coordinator';
import { SlefStore } from './slef.store';
import { suppliedFit } from '../../domain/ships/build/supplied-fit';

const VALID = JSON.stringify({ event: 'Loadout', Ship: FIXTURE_HULL, Modules: [] });

/**
 * A paste holding the build the package publishes for its hull.
 *
 * Written by the application's own export, so it is the payload a Commander
 * pastes back after sharing a hull's default build, module for module.
 */
const DEFAULT_PASTE = generateSlefExportArtifact(
  { loadout: ShipLoadout.default(FIXTURE_HULL), revision: 1, canonicalLink: { kind: 'absent' } },
  { appName: 'nav-beacon', appVersion: '0.0.0' },
).payload;

function seedActive(active: ActiveBuildStore): void {
  active.commit({
    loadout: ShipLoadout.default('Sidewinder'),
    suppliedFit: suppliedFit(ShipLoadout.default('Sidewinder').shipSymbol),
    hullName: 'Sidewinder',
    provenance: 'working',
    sourceNamed: null,
    autosaveRecordId: null,
    baseline: null,
  });
}

describe('the one path from a draft to an active build', () => {
  let active: ActiveBuildStore;
  let store: SlefStore;
  let replacement: BuildIngressCoordinator;
  let coordinator: SlefImportCoordinator;
  let committed: BuildCandidate[];
  let autosave: AutosaveService;
  let storage: MemoryStorage;

  beforeEach(() => {
    storage = new MemoryStorage();
    TestBed.configureTestingModule({
      providers: [
        // A stub `/outfitting`, so the coordinator's move to the workspace resolves
        // without mounting feature 001's real route.
        provideRouter([{ path: 'outfitting', children: [] }]),
        provideLocalization(),
        ...provideIsolatedLocaleEnvironment(),
        // Storing a batch of imported builds is a write, so the coordinator
        // reaches the record repository. Nothing on this path writes one.
        ...provideMemoryStorage(storage),
      ],
    });
    active = TestBed.inject(ActiveBuildStore);
    store = TestBed.inject(SlefStore);
    replacement = TestBed.inject(BuildIngressCoordinator);
    coordinator = TestBed.inject(SlefImportCoordinator);
    autosave = TestBed.inject(AutosaveService);
    committed = [];
    replacement.addSink({
      onCommitted: (candidate) => {
        committed.push(candidate);
      },
    });
    // Since 2026-08-25 nothing is asked between a valid draft and an active
    // build: the build being replaced has a record of its own (FR-008).
  });

  describe('delegation', () => {
    it('replaces the build exactly once, through feature 001 alone', async () => {
      seedActive(active);
      const before = active.revision();
      store.setDraft(VALID);

      expect(await coordinator.submit()).toEqual({ kind: 'committed' });

      expect(committed).toHaveLength(1);
      expect(active.revision()).toBe(before + 1);
      expect(active.provenance()).toBe('working');
      expect(active.loadout()?.shipSymbol.toLowerCase()).toBe(FIXTURE_HULL.toLowerCase());
    });

    it('arrives dirty, with no baseline and no named source to get it back from', async () => {
      store.setDraft(VALID);

      await coordinator.submit();

      expect(active.dirty()).toBe(true);
      expect(active.sourceNamed()).toBeNull();
    });

    it('writes no link and no working record of its own', async () => {
      store.setDraft(VALID);

      await coordinator.submit();

      // Both belong to feature 001's sinks. Feature 004 committing either would
      // be the second replacement path the coordinator exists to prevent.
      expect(active.link()).toEqual({ kind: 'absent' });
      expect(active.autosaveRecordId()).toBeNull();
    });
  });

  describe('a paste holding a build at the package default', () => {
    it('takes no record for it', async () => {
      // The route the build arrived by is not the question. What is on screen
      // is the build the package publishes for the hull, which a Commander
      // reaches again by selecting the hull (024/FR-001).
      store.setDraft(DEFAULT_PASTE);

      expect(await coordinator.submit()).toEqual({ kind: 'committed' });
      autosave.flush();

      expect(active.atDefault()).toBe(true);
      expect(active.autosaveRecordId()).toBeNull();
      expect(storage.entries.size).toBe(0);
    });

    it('takes a record at the first modelled edit of it', async () => {
      store.setDraft(DEFAULT_PASTE);
      await coordinator.submit();
      autosave.flush();

      active.loadout()!.setModulePriority('FrameShiftDrive', 2);
      active.touch();
      autosave.flush();

      expect(active.autosaveRecordId()).not.toBeNull();
      expect(storage.entries.size).toBe(1);
    });
  });

  describe('what the accepted import reports', () => {
    it('completes a supported partial roll and says nothing about it', async () => {
      // A completed grade is what the application models, so reaching one is not
      // an event. The roll is normalised on the way in and nothing anywhere
      // reports that it was (design/import-outcome.md, "Divergence").
      store.setDraft(JSON.stringify(SUPPORTED_PARTIAL_QUALITY));

      await coordinator.submit();

      expect(active.loadout()?.fittedModuleAt(FIXTURE_SLOTS.thrusters)?.engineering?.Quality).toBe(
        1,
      );
      const held = JSON.stringify({
        draft: store.draft(),
        status: store.importStatus(),
        failure: store.importFailure(),
        ending: store.importEnding(),
        artifact: store.artifact(),
      });
      expect(held).not.toContain('qualityCompleted');
      expect(held).not.toContain('previousQuality');
      expect(held).not.toContain(String(SUPPORTED_PARTIAL_SOURCE_QUALITY));
      expect(held).not.toContain('valid');
    });

    it('leaves the verdict where feature 003 reads it: on the build itself', async () => {
      store.setDraft(VALID);

      await coordinator.submit();

      expect(active.loadout()?.validation()).toBeDefined();
    });
  });

  describe('the draft', () => {
    it('is cleared only once the draft has become a build', async () => {
      store.setDraft(VALID);

      await coordinator.submit();

      expect(store.draft().text).toBe('');
      expect(store.layer()).toBe('none');
    });

    it.each([
      ['a refusal', '[]'],
      ['a normalization refusal', JSON.stringify(UNSUPPORTED_PARTIAL_QUALITY)],
      ['malformed JSON', '{ not json'],
    ])('survives %s exactly as it was typed', async (_name, text) => {
      store.setDraft(text);

      expect(await coordinator.submit()).toEqual({ kind: 'failed' });

      expect(store.draft().text).toBe(text);
      expect(store.importFailure()).not.toBeNull();
    });

    it('is spent by a commit, and not before', async () => {
      // The draft stops being a draft only when it has become a build. Every
      // other ending keeps it exactly as it was typed.
      seedActive(active);
      store.setDraft(VALID);

      expect(await coordinator.submit()).toEqual({ kind: 'committed' });

      expect(store.draft().text).toBe('');
    });
  });

  describe('atomicity', () => {
    it('leaves the active build byte-identical after every refusal', async () => {
      seedActive(active);
      const fingerprint = active.fingerprint();
      const revision = active.revision();
      store.setDraft(JSON.stringify(UNSUPPORTED_PARTIAL_QUALITY));

      await coordinator.submit();
      store.setDraft('[]');
      await coordinator.submit();

      expect(active.fingerprint()).toBe(fingerprint);
      expect(active.revision()).toBe(revision);
      expect(committed).toHaveLength(0);
    });

    it('loses to a newer ingress started while it was in flight', async () => {
      // The slow-paste-lands-on-a-newer-build case the request token exists
      // for: feature 001 supersedes the older request rather than committing
      // it, and the draft survives untouched because it never became a build.
      seedActive(active);
      store.setDraft(VALID);

      const inFlight = coordinator.submit();
      const other = {
        loadout: ShipLoadout.default('Eagle'),
        suppliedFit: suppliedFit(ShipLoadout.default('Eagle').shipSymbol),
        hullName: 'Eagle',
        provenance: 'stock' as const,
        sourceNamed: null,
        autosaveRecordId: null,
        baseline: null,
      };
      await replacement.commit(() => ({ ok: true, candidate: other }));

      expect(await inFlight).toEqual({ kind: 'superseded' });
      expect(committed).toEqual([other]);
      expect(active.hullName()).toBe('Eagle');
      expect(store.draft().text).toBe(VALID);
    });

    it('stands by a commit even if the layer closes as it lands', async () => {
      // A token issued after the store has been written cannot un-replace the
      // build, and saying `superseded` here would describe an active build as
      // one that never arrived.
      seedActive(active);
      store.setDraft(VALID);
      const stop = replacement.addSink({ onCommitted: () => coordinator.abandon() });

      expect(await coordinator.submit()).toEqual({ kind: 'committed' });

      expect(committed).toHaveLength(1);
      expect(store.draft().text).toBe('');
      stop();
    });
  });
});

/**
 * A journal file, as the coordinator takes one: a name, a size and its text.
 * The browser's own `File` is the same three things.
 */
function journalFile(name: string, lines: readonly string[]): JournalFile {
  const text = lines.join('\n');
  return { name, size: text.length, text: () => Promise.resolve(text) };
}

/** The names of every readable record, in the order the library lists them. */
function storedNames(library: BuildLibraryStore): readonly (string | null)[] {
  return library.records().map((entry) => (entry.available ? entry.record.name : null));
}

/**
 * One journal line holding the build the package publishes for the hull.
 *
 * Written from `ShipLoadout.default` through the package's own export, so it
 * names every module the hull carries rather than the empty list `loadoutLine`
 * writes. The package accepts `event` on the way in and never writes it, so the
 * line names itself.
 *
 * Shaped the way a game journal writes one: the power of every module stated,
 * and the ship named blank because this one carries no name. A build assembled
 * in the application states none of that, and the two are the same build
 * (024/FR-001).
 */
function defaultLoadoutLine(timestamp: string): string {
  return JSON.stringify({
    timestamp,
    event: 'Loadout',
    ...ShipLoadout.default(FIXTURE_HULL).toLoadoutEvent({ explicitPower: true }),
    ShipName: '',
    ShipIdent: '',
  });
}

function loadoutLine(fields: Record<string, unknown>): string {
  return JSON.stringify({
    timestamp: '2026-09-01T10:00:00Z',
    event: 'Loadout',
    Ship: FIXTURE_HULL,
    Modules: [],
    ...fields,
  });
}

describe('builds a journal offers', () => {
  let active: ActiveBuildStore;
  let store: SlefStore;
  let library: BuildLibraryStore;
  let coordinator: SlefImportCoordinator;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: 'outfitting', children: [] }]),
        provideLocalization(),
        ...provideIsolatedLocaleEnvironment(),
        ...provideMemoryStorage(new MemoryStorage()),
      ],
    });
    active = TestBed.inject(ActiveBuildStore);
    store = TestBed.inject(SlefStore);
    library = TestBed.inject(BuildLibraryStore);
    coordinator = TestBed.inject(SlefImportCoordinator);
  });

  describe('a scan nobody is waiting for', () => {
    it('leaves the panel usable after the layer is closed mid-scan', async () => {
      const scanning = coordinator.scanFiles([
        journalFile('Journal.01.log', [loadoutLine({ ShipName: 'Abandoned' })]),
      ]);
      // What Cancel, Close and a route change all do.
      coordinator.abandon();
      await scanning;

      // The counter the scan raised has to come down with it: left standing,
      // the panel reopens saying it is reading a file nobody asked for, with
      // its own file control disabled.
      expect(store.scanningFiles()).toBe(0);
      expect(store.scanning()).toBe(false);
      expect(store.journalEntries()).toEqual([]);
    });
  });

  describe('choosing what to import', () => {
    it('lists every build a scan found, newest first', async () => {
      await coordinator.scanFiles([
        journalFile('Journal.01.log', [
          loadoutLine({ ShipName: 'Older', timestamp: '2026-09-01T09:00:00Z' }),
          loadoutLine({ ShipName: 'Newer', timestamp: '2026-09-02T09:00:00Z' }),
        ]),
      ]);

      expect(store.journalEntries().map((entry) => entry.value.shipName)).toEqual([
        'Newer',
        'Older',
      ]);
      expect(store.scanReport()).toEqual({
        fileCount: 1,
        fileName: 'Journal.01.log',
        eventCount: 2,
        refused: [],
      });
    });

    it('chooses the newest build and leaves the rest to the Commander', async () => {
      await coordinator.scanFiles([
        journalFile('Journal.01.log', [
          loadoutLine({ ShipName: 'Older', timestamp: '2026-09-01T09:00:00Z' }),
          loadoutLine({ ShipName: 'Newer', timestamp: '2026-09-02T09:00:00Z' }),
        ]),
      ]);

      expect(store.selectedEntries().map((entry) => entry.value.shipName)).toEqual(['Newer']);
    });

    it('turns a build on and off again', async () => {
      await coordinator.scanFiles([
        journalFile('Journal.01.log', [
          loadoutLine({ ShipName: 'One' }),
          loadoutLine({ ShipName: 'Two' }),
        ]),
      ]);
      const [, second] = store.journalEntries();

      store.toggleSelection(second?.key ?? '');
      expect(store.selectedEntries()).toHaveLength(2);

      store.toggleSelection(second?.key ?? '');
      expect(store.selectedEntries()).toHaveLength(1);
    });

    it('refuses to load while nothing is chosen', async () => {
      await coordinator.scanFiles([journalFile('Journal.01.log', [loadoutLine({})])]);
      const [only] = store.journalEntries();
      store.toggleSelection(only?.key ?? '');

      expect(await coordinator.submit()).toEqual({ kind: 'failed' });
      expect(store.importFailure()).toEqual({ kind: 'nothingSelected' });
      expect(library.total()).toBe(0);
    });

    it('refuses a file over the bound without reading it', async () => {
      const oversized: JournalFile = {
        name: 'Journal.huge.log',
        size: 25_000_001,
        text: () => Promise.reject(new Error('should not be read')),
      };

      await coordinator.scanFiles([oversized]);

      expect(store.importFailure()).toEqual({
        kind: 'fileTooLarge',
        fileName: 'Journal.huge.log',
        sizeBytes: 25_000_001,
        limitBytes: 25_000_000,
      });
      expect(store.journalEntries()).toEqual([]);
    });

    it('says which files it read when none of them holds a build', async () => {
      await coordinator.scanFiles([journalFile('Journal.01.log', ['{"event":"Docked"}'])]);

      expect(store.importFailure()).toEqual({
        kind: 'noEvents',
        fileNames: ['Journal.01.log'],
      });
    });
  });

  describe('one build chosen', () => {
    it('becomes the active build, and no record is named for it', async () => {
      await coordinator.scanFiles([
        journalFile('Journal.01.log', [loadoutLine({ ShipName: 'Night Watch' })]),
      ]);

      expect(await coordinator.submit()).toEqual({ kind: 'committed' });

      expect(active.loadout()?.shipSymbol.toLowerCase()).toBe(FIXTURE_HULL.toLowerCase());
      library.refresh();
      expect(library.total()).toBe(0);
    });
  });

  describe('one build at the package default chosen', () => {
    it('becomes the active build, and the build is read as at its hull’s default', async () => {
      // The journal states the power of every module and names the ship blank,
      // none of which a Commander decided. Read otherwise, this build would be
      // the one default build that takes a record (024/FR-001).
      await coordinator.scanFiles([
        journalFile('Journal.01.log', [defaultLoadoutLine('2026-09-01T09:00:00Z')]),
      ]);

      expect(await coordinator.submit()).toEqual({ kind: 'committed' });

      expect(active.atDefault()).toBe(true);
    });
  });

  describe('several builds chosen', () => {
    async function scanThree(): Promise<void> {
      await coordinator.scanFiles([
        journalFile('Journal.01.log', [
          loadoutLine({ ShipName: 'Night Watch', timestamp: '2026-09-03T09:00:00Z' }),
          loadoutLine({ ShipIdent: 'NW-02', timestamp: '2026-09-02T09:00:00Z' }),
          loadoutLine({ timestamp: '2026-09-01T09:00:00Z' }),
        ]),
      ]);
      for (const entry of store.journalEntries().slice(1)) {
        store.toggleSelection(entry.key);
      }
    }

    it('stores one named record for each, and opens none of them', async () => {
      seedActive(active);
      const before = active.revision();
      await scanThree();

      const submission = await coordinator.submit();

      expect(submission).toEqual({ kind: 'stored', stored: 3, refused: [] });
      expect(active.revision()).toBe(before);
      expect(active.hullName()).toBe('Sidewinder');
    });

    it('names each record from the build: ship name, then ident, then hull', async () => {
      await scanThree();

      await coordinator.submit();

      library.refresh();
      // Ordered by the instant they were stored, which is one instant for a
      // batch, so the assertion is about which names exist rather than which
      // way a tie broke.
      expect([...storedNames(library)].sort()).toEqual(['Anaconda', 'NW-02', 'Night Watch']);
      expect(
        library.records().every((entry) => entry.available && entry.record.kind === 'named'),
      ).toBe(true);
    });

    it('keeps every record when two of them would carry one name', async () => {
      await coordinator.scanFiles([
        journalFile('Journal.01.log', [
          loadoutLine({ ShipName: 'Twin', ShipIdent: 'A', timestamp: '2026-09-02T09:00:00Z' }),
          loadoutLine({ ShipName: 'Twin', ShipIdent: 'B', timestamp: '2026-09-01T09:00:00Z' }),
        ]),
      ]);
      for (const entry of store.journalEntries().slice(1)) {
        store.toggleSelection(entry.key);
      }

      await coordinator.submit();

      library.refresh();
      expect(storedNames(library)).toEqual(['Twin', 'Twin']);
    });

    it('states how many were stored', async () => {
      await scanThree();

      await coordinator.submit();

      expect(store.batchOutcome()).toEqual({ stored: 3, refused: [] });
    });

    it('closes the layer only when everything chosen was stored', async () => {
      store.openLayer('import');
      await scanThree();

      await coordinator.submit();

      expect(store.layer()).toBe('none');
    });
  });

  describe('a batch holding a build at the package default', () => {
    it('stores one named record for it, as it does for every other entry', async () => {
      // Choosing a build in a batch is the decision. The build is not opened,
      // so the address holds nothing, and a record is the only place it is
      // kept — which is why the gate on an active build does not reach here
      // (024/FR-001).
      await coordinator.scanFiles([
        journalFile('Journal.01.log', [
          loadoutLine({ ShipName: 'Chosen', timestamp: '2026-09-02T09:00:00Z' }),
          defaultLoadoutLine('2026-09-01T09:00:00Z'),
        ]),
      ]);
      for (const entry of store.journalEntries().slice(1)) {
        store.toggleSelection(entry.key);
      }

      const submission = await coordinator.submit();

      expect(submission).toEqual({ kind: 'stored', stored: 2, refused: [] });
      library.refresh();
      expect([...storedNames(library)].sort()).toEqual(['Anaconda', 'Chosen']);
    });
  });

  describe('a refused entry', () => {
    async function scanWithOneRefused(): Promise<void> {
      await coordinator.scanFiles([
        journalFile('Journal.01.log', [
          loadoutLine({ ShipName: 'First', timestamp: '2026-09-04T09:00:00Z' }),
          loadoutLine({
            ShipName: 'Refused',
            Ship: 'Nonexistent_Hull',
            timestamp: '2026-09-03T09:00:00Z',
          }),
          loadoutLine({ ShipName: 'Third', timestamp: '2026-09-02T09:00:00Z' }),
        ]),
      ]);
      for (const entry of store.journalEntries().slice(1)) {
        store.toggleSelection(entry.key);
      }
    }

    it('stores the rest and names the one it could not take', async () => {
      await scanWithOneRefused();

      const submission = await coordinator.submit();

      expect(submission).toEqual({
        kind: 'stored',
        stored: 2,
        refused: [
          { title: 'Refused', failure: { kind: 'unknownHull', sourceHull: 'Nonexistent_Hull' } },
        ],
      });
      library.refresh();
      expect([...storedNames(library)].sort()).toEqual(['First', 'Third']);
    });

    it('keeps the layer open, because the refusal is read there', async () => {
      store.openLayer('import');
      await scanWithOneRefused();

      await coordinator.submit();

      expect(store.layer()).toBe('import');
      expect(store.batchOutcome()?.refused).toHaveLength(1);
    });
  });
});
