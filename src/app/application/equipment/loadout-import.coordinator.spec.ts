import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { JournalFile } from '../../domain/journal/journal-scan';
import { provideLocalization } from '../../i18n/i18n.providers';
import { provideIsolatedLocaleEnvironment } from '../../i18n/testing/localization-harness';
import { MemoryStorage, provideMemoryStorage } from '../../platform/storage/storage.spec-helpers';
import { BuildLibraryStore } from '../build-library/build-library.store';
import { LoadoutAutosaveService } from './loadout-autosave.service';
import { LoadoutImportCoordinator } from './loadout-import.coordinator';
import { LoadoutImportStore } from './loadout-import.store';
import { LoadoutStore } from './loadout.store';

const EVENT = {
  timestamp: '2026-09-01T10:00:00Z',
  event: 'SuitLoadout',
  SuitName: 'tacticalsuit_class5',
  LoadoutName: 'Double Trouble',
  SuitMods: ['suit_nightvision'],
  Modules: [{ SlotName: 'PrimaryWeapon1', ModuleName: 'wpn_m_launcher_rocket_sauto', Class: 5 }],
} as const;

function event(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({ ...EVENT, ...overrides });
}

function journalFile(name: string, lines: readonly string[]): JournalFile {
  const text = lines.join('\n');
  return { name, size: text.length, text: () => Promise.resolve(text) };
}

function storedNames(library: BuildLibraryStore): readonly (string | null)[] {
  return library.records().map((entry) => (entry.available ? entry.record.name : null));
}

/** An event holding the loadout the bench starts for its suit, and nothing more. */
function defaultEvent(overrides: Record<string, unknown> = {}): string {
  return event({ SuitName: 'tacticalsuit_class1', SuitMods: [], Modules: [], ...overrides });
}

describe('a suit loadout coming in from a journal', () => {
  let store: LoadoutImportStore;
  let bench: LoadoutStore;
  let library: BuildLibraryStore;
  let coordinator: LoadoutImportCoordinator;
  let autosave: LoadoutAutosaveService;
  let storage: MemoryStorage;

  beforeEach(() => {
    storage = new MemoryStorage();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideLocalization(),
        ...provideIsolatedLocaleEnvironment(),
        ...provideMemoryStorage(storage),
      ],
    });
    store = TestBed.inject(LoadoutImportStore);
    bench = TestBed.inject(LoadoutStore);
    library = TestBed.inject(BuildLibraryStore);
    coordinator = TestBed.inject(LoadoutImportCoordinator);
    autosave = TestBed.inject(LoadoutAutosaveService);
  });

  describe('one loadout chosen', () => {
    it('opens it on the bench', async () => {
      store.setDraft(event());

      expect(await coordinator.submit()).toEqual({ kind: 'opened' });

      expect(bench.loadout()?.suitFamily).toBe('tacticalsuit');
      expect(bench.loadout()?.suitGrade).toBe(5);
      expect(bench.loadout()?.weapons[0]?.symbol).toBe('wpn_m_launcher_rocket_sauto');
    });

    it('saves no record for it', async () => {
      store.setDraft(event());

      await coordinator.submit();

      library.refresh();
      expect(library.total()).toBe(0);
    });

    it('takes no record where the event holds a loadout at its suit’s default', async () => {
      // The route it arrived by is not the question. The loadout on the bench
      // is the one a Commander reaches again by choosing the suit, so it is
      // worth no record (024/FR-002).
      store.setDraft(defaultEvent());

      await coordinator.submit();
      autosave.flush();

      expect(bench.atDefault()).toBe(true);
      expect(bench.autosaveRecordId()).toBeNull();
      expect(storage.entries.size).toBe(0);
      library.refresh();
      expect(library.total()).toBe(0);
    });

    it('takes a record at the first change to a default loadout read from an event', async () => {
      store.setDraft(defaultEvent());
      await coordinator.submit();
      autosave.flush();

      bench.dispatch({ kind: 'setSuitGrade', grade: 3 });
      autosave.flush();

      expect(bench.autosaveRecordId()).not.toBeNull();
      expect(storage.entries.size).toBe(1);
    });

    it('takes a record where the event holds a loadout carrying choices', async () => {
      store.setDraft(event());

      await coordinator.submit();
      autosave.flush();

      expect(bench.atDefault()).toBe(false);
      expect(bench.autosaveRecordId()).not.toBeNull();
      // Unnamed: a loadout read from one event is work in progress, not a save
      // a Commander asked for by name (017/FR-007).
      library.refresh();
      expect(storedNames(library)).toEqual([null]);
    });

    it('opens the loadout and keeps what the package left out on screen', async () => {
      store.setDraft(
        event({
          Modules: [{ SlotName: 'PrimaryWeapon1', ModuleName: 'wpn_not_a_weapon', Class: 5 }],
        }),
      );

      await coordinator.submit();

      expect(bench.loadout()?.suitFamily).toBe('tacticalsuit');
      expect(store.open()).toBe(false);
      expect(store.failure()).toEqual({
        kind: 'partial',
        outcomes: [
          { action: 'unknownWeapon', mount: 'PrimaryWeapon1', sourceSymbol: 'wpn_not_a_weapon' },
        ],
        heldBack: [],
      });
    });
  });

  describe('what the bench refuses', () => {
    it('says an empty box holds nothing', async () => {
      store.setDraft('   ');

      expect(await coordinator.submit()).toEqual({ kind: 'failed' });
      expect(store.failure()).toEqual({ kind: 'empty' });
      expect(bench.loadout()).toBeNull();
    });

    it('says what is not JSON is not JSON', async () => {
      store.setDraft('not json at all');

      await coordinator.submit();

      expect(store.failure()).toEqual({ kind: 'syntax' });
    });

    it('names a suit it does not recognise, and leaves the bench alone', async () => {
      store.setDraft(event({ SuitName: 'not_a_suit_class5' }));

      await coordinator.submit();

      expect(store.failure()).toEqual({ kind: 'unknownSuit', sourceSuit: 'not_a_suit_class5' });
      expect(bench.loadout()).toBeNull();
    });

    it('refuses a payload that is not a suit loadout event', async () => {
      store.setDraft(JSON.stringify({ event: 'Docked', StarSystem: 'Sol' }));

      await coordinator.submit();

      expect(store.failure()).toEqual({ kind: 'malformed' });
    });

    it('refuses to load while nothing is chosen from a list', async () => {
      await coordinator.scanFiles([
        journalFile('Journal.01.log', [
          event({ LoadoutName: 'One' }),
          event({ LoadoutName: 'Two', timestamp: '2026-09-02T10:00:00Z' }),
        ]),
      ]);
      store.setSelection([]);

      expect(await coordinator.submit()).toEqual({ kind: 'failed' });
      expect(store.failure()).toEqual({ kind: 'nothingSelected' });
    });
  });

  describe('a paste holding more than one loadout', () => {
    it('lists them rather than taking the newest', async () => {
      store.openLayer();
      store.setDraft(
        [
          event({ LoadoutName: 'Recon', timestamp: '2026-09-01T10:00:00Z' }),
          event({ LoadoutName: 'Assault', timestamp: '2026-09-02T10:00:00Z' }),
        ].join('\n'),
      );

      // A pasted stretch of a journal is a log like any other. Taking the
      // newest would discard the rest of what the Commander pasted in silence.
      expect(await coordinator.submit()).toEqual({ kind: 'listed' });

      expect(store.entries().length).toBe(2);
      expect(bench.loadout()).toBe(null);
      expect(store.open()).toBe(true);
    });
  });

  describe('a scan nobody is waiting for', () => {
    it('is discarded when a newer one has started', async () => {
      const slow = journalFile('Journal.slow.log', [event({ LoadoutName: 'Superseded' })]);
      const scanning = coordinator.scanFiles([slow]);
      // A second drop while the first is still being read: the newer selection
      // is the question, and the older answer must not land on top of it.
      await coordinator.scanFiles([
        journalFile('Journal.fast.log', [event({ LoadoutName: 'Chosen' })]),
      ]);
      await scanning;

      expect(store.entries().map((entry) => entry.value.name)).toEqual(['Chosen']);
      expect(store.scanning()).toBe(false);
    });

    it('leaves nothing behind after the layer closes', async () => {
      const scanning = coordinator.scanFiles([
        journalFile('Journal.01.log', [event({ LoadoutName: 'Abandoned' })]),
      ]);
      store.closeLayer();
      await scanning;

      expect(store.entries()).toEqual([]);
      expect(store.scanning()).toBe(false);
    });
  });

  describe('several loadouts chosen', () => {
    async function scanTwo(): Promise<void> {
      await coordinator.scanFiles([
        journalFile('Journal.01.log', [
          event({ LoadoutName: 'One', timestamp: '2026-09-02T10:00:00Z' }),
          event({ LoadoutName: 'Two', timestamp: '2026-09-01T10:00:00Z' }),
        ]),
      ]);
      store.setSelection(store.entries().map((entry) => entry.key));
    }

    it('lists what a scan found, newest first', async () => {
      await scanTwo();

      expect(store.entries().map((entry) => entry.value.name)).toEqual(['One', 'Two']);
      expect(store.report()).toEqual({
        fileCount: 1,
        fileName: 'Journal.01.log',
        eventCount: 2,
        refused: [],
      });
    });

    it('saves each one and opens none of them', async () => {
      await scanTwo();

      expect(await coordinator.submit()).toEqual({
        kind: 'stored',
        stored: 2,
        refused: [],
        left: 0,
      });

      expect(bench.loadout()).toBeNull();
      library.refresh();
      expect([...storedNames(library)].sort()).toEqual(['One', 'Two']);
    });

    it('stores a named record for every loadout selected, a default one included', async () => {
      // A batch is a Commander asking for these loadouts by name. That is a
      // deliberate save, which the rule about default loadouts does not touch
      // (024/FR-002).
      await coordinator.scanFiles([
        journalFile('Journal.01.log', [
          event({ LoadoutName: 'Chosen', timestamp: '2026-09-02T10:00:00Z' }),
          defaultEvent({ LoadoutName: 'Untouched', timestamp: '2026-09-01T10:00:00Z' }),
        ]),
      ]);
      store.setSelection(store.entries().map((entry) => entry.key));

      expect(await coordinator.submit()).toEqual({
        kind: 'stored',
        stored: 2,
        refused: [],
        left: 0,
      });

      library.refresh();
      expect([...storedNames(library)].sort()).toEqual(['Chosen', 'Untouched']);
    });

    it('names one the event did not name by its suit', async () => {
      await coordinator.scanFiles([
        journalFile('Journal.01.log', [
          event({ LoadoutName: undefined, timestamp: '2026-09-02T10:00:00Z' }),
          event({ LoadoutName: 'Named', timestamp: '2026-09-01T10:00:00Z' }),
        ]),
      ]);
      store.setSelection(store.entries().map((entry) => entry.key));

      await coordinator.submit();

      library.refresh();
      expect([...storedNames(library)].sort()).toEqual(['Dominator Suit', 'Named']);
    });

    it('keeps both copies where a name is already saved, without asking', async () => {
      await scanTwo();
      await coordinator.submit();

      await coordinator.scanFiles([
        journalFile('Journal.02.log', [
          event({ LoadoutName: 'One', SuitMods: [], timestamp: '2026-09-03T10:00:00Z' }),
          event({ LoadoutName: 'Two', SuitMods: [], timestamp: '2026-09-04T10:00:00Z' }),
        ]),
      ]);
      store.setSelection(store.entries().map((entry) => entry.key));
      await coordinator.submit();

      library.refresh();
      expect([...storedNames(library)].sort()).toEqual(['One', 'One', 'Two', 'Two']);
    });

    it('carries the note that says where they came from', async () => {
      await scanTwo();

      await coordinator.submit();

      library.refresh();
      const notes = library.records().map((entry) => (entry.available ? entry.record.note : null));
      expect(notes.every((note) => note === 'Imported from journal')).toBe(true);
    });

    it('states how many were saved, and closes on a clean batch', async () => {
      store.openLayer();
      await scanTwo();

      await coordinator.submit();

      expect(store.batchOutcome()).toEqual({ stored: 2, refused: [] });
      expect(store.open()).toBe(false);
    });

    it('saves them and still states what the package left out', async () => {
      store.openLayer();
      await coordinator.scanFiles([
        journalFile('Journal.01.log', [
          event({ LoadoutName: 'Whole', timestamp: '2026-09-02T10:00:00Z' }),
          event({
            LoadoutName: 'Partial',
            timestamp: '2026-09-01T10:00:00Z',
            Modules: [{ SlotName: 'PrimaryWeapon1', ModuleName: 'wpn_not_a_weapon', Class: 5 }],
          }),
        ]),
      ]);
      store.setSelection(store.entries().map((entry) => entry.key));

      const submission = await coordinator.submit();

      // Both are saved — a loadout missing one weapon is still a loadout — and
      // the layer stays up saying which entry the package could not take
      // (016/FR-015).
      expect(submission).toEqual({ kind: 'stored', stored: 2, refused: [], left: 1 });
      expect(store.open()).toBe(true);
      expect(store.failure()?.kind).toBe('partial');
      library.refresh();
      expect(library.total()).toBe(2);
    });
  });
});
