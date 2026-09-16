import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { getSlefDiagnosticMessage } from '@elite-dangerous-almanac/core/i18n/diagnostics';
import { ShipLoadout } from '@elite-dangerous-almanac/core/ships/ship-loadout';
import { GameTextPresenter } from '../../i18n/game-text.presenter';
import { provideLocalization } from '../../i18n/i18n.providers';
import { MemoryStorage, provideMemoryStorage } from '../../platform/storage/storage.spec-helpers';
import { provideIsolatedLocaleEnvironment } from '../../i18n/testing/localization-harness';
import { FIXTURE_HULL, FIXTURE_SLOTS } from '../../domain/ships/outfitting/outfitting.fixtures';
import {
  SLEF_IMPORT_LIMIT_BYTES,
  type SlefPackageDiagnostic,
} from '../../domain/ships/slef/slef-import.models';
import { AnnouncementService } from '../../ui/announcements/announcement.service';
import { ActiveBuildStore } from '../active-build/active-build.store';
import { DownloadAdapter } from '../../platform/browser/download.adapter';
import { NavigatorAdapter } from '../../platform/browser/navigator.adapter';
import { SlefPresenter } from './slef.presenter';
import { SlefStore } from './slef.store';
import { suppliedFit } from '../../domain/ships/build/supplied-fit';

/** A platform that can do everything, so the wording is what is under test. */
class FakeNavigator {
  languages(): readonly string[] {
    return ['en'];
  }
  clipboardAvailable(): boolean {
    return true;
  }
  canShare(): boolean {
    return true;
  }
  canShareFiles(): boolean {
    return true;
  }
  async copyText(): Promise<boolean> {
    return true;
  }
  async shareData(): Promise<'shared'> {
    return 'shared';
  }
}

class FakeDownload {
  dispatch(): boolean {
    return true;
  }
  toFile(payload: string, filename: string, mimeType: string): File {
    return new File([payload], filename, { type: mimeType });
  }
}

/** One package diagnostic, with only the field under test varied. */
function diagnostic(overrides: Partial<SlefPackageDiagnostic>): SlefPackageDiagnostic {
  return {
    index: 1,
    path: 'entries[1].Modules[0].Item',
    code: 'invalidModule',
    constraint: 'stringRequired',
    params: {},
    message: 'Unknown module.',
    ...overrides,
  } as SlefPackageDiagnostic;
}

function commit(active: ActiveBuildStore): void {
  active.commit({
    loadout: ShipLoadout.default(FIXTURE_HULL),
    suppliedFit: suppliedFit(ShipLoadout.default(FIXTURE_HULL).shipSymbol),
    hullName: 'Anaconda',
    provenance: 'working',
    sourceNamed: null,
    autosaveRecordId: null,
    baseline: null,
  });
}

describe('what feature 004 says out loud', () => {
  let presenter: SlefPresenter;
  let store: SlefStore;
  let active: ActiveBuildStore;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideLocalization(),
        ...provideIsolatedLocaleEnvironment(),
        // The import coordinator reaches the record repository to store a batch.
        ...provideMemoryStorage(new MemoryStorage()),
        { provide: NavigatorAdapter, useClass: FakeNavigator },
        { provide: DownloadAdapter, useClass: FakeDownload },
      ],
    });
    presenter = TestBed.inject(SlefPresenter);
    store = TestBed.inject(SlefStore);
    active = TestBed.inject(ActiveBuildStore);
  });

  describe('the import status line', () => {
    it('says nothing at all until something has happened', () => {
      expect(presenter.importView().status).toBe('');

      store.setDraft('{}');

      expect(presenter.importView().status).toBe('');
    });

    it('says a cancelled attempt changed nothing', () => {
      store.setImportEnding('cancelled');

      expect(presenter.importView().status).toBe('Nothing was imported. Your build is unchanged.');
    });

    it('falls silent again on the next edit', () => {
      store.setImportEnding('superseded');
      store.setDraft('{}');

      expect(presenter.importView().status).toBe('');
    });

    it('still names the draft size and the limit when the draft is too big', () => {
      // The one moment the size decides anything. It is said by the field's own
      // error rather than by the status line, which is where a Commander who is
      // being refused is already looking.
      store.setImportFailure({
        kind: 'tooLarge',
        utf8Bytes: SLEF_IMPORT_LIMIT_BYTES + 1,
        limitBytes: SLEF_IMPORT_LIMIT_BYTES,
      });

      expect(presenter.importView().failure?.message).toBe(
        'This draft is 65.5 kB, and the most that can be imported is 65.5 kB.',
      );
    });
  });

  describe('the import refusals', () => {
    it('names the actual and the allowed size, not the raw byte counts', () => {
      store.setImportFailure({
        kind: 'tooLarge',
        utf8Bytes: SLEF_IMPORT_LIMIT_BYTES + 1,
        limitBytes: SLEF_IMPORT_LIMIT_BYTES,
      });

      expect(presenter.importView().failure?.message).toBe(
        'This draft is 65.5 kB, and the most that can be imported is 65.5 kB.',
      );
    });

    it('states the exactly-one rule with the count the payload held', () => {
      store.setImportFailure({ kind: 'cardinality', observed: 2, diagnostics: [] });

      expect(presenter.importView().failure?.message).toBe(
        'Exactly one build can be imported. This payload holds 2.',
      );
    });

    it('quotes the exact hull identity the package does not carry', () => {
      store.setImportFailure({ kind: 'unknownHull', sourceHull: 'Nonexistent_Hull' });

      expect(presenter.importView().failure?.message).toContain('Nonexistent_Hull');
    });

    it('frames a thrown parse error itself, with no package prose', () => {
      store.setImportFailure({ kind: 'syntax' });

      expect(presenter.importView().failure?.message).toBe(
        'This is not valid JSON, so it could not be read.',
      );
      expect(presenter.importView().failure?.diagnostics).toEqual([]);
    });

    it('names each refused roll by its slot, article and source quality', () => {
      store.setImportFailure({
        kind: 'normalizationUnsupported',
        failures: [
          {
            source: {
              slotKey: FIXTURE_SLOTS.frameShiftDrive,
              moduleSymbol: 'Int_Hyperdrive_Size6_Class5',
              blueprintFdname: 'FSD_LongRange',
              effectFdname: null,
              grade: 5,
              quality: 0.42,
            },
            code: 'unsupportedEngineering',
            params: null,
          },
        ],
      });
      const failure = presenter.importView().failure;

      expect(failure?.message).toContain('1 of these modules');
      expect(failure?.refusals).toHaveLength(1);
      expect(failure?.refusals[0]).toContain('42%');
      expect(failure?.refusals[0]).toContain('unsupportedEngineering');
    });
  });

  describe('the diagnostics it hands the list', () => {
    it('passes every package field through untouched, formatting only the index', () => {
      const [entry] = presenter.diagnostics([
        {
          index: 1,
          path: 'entries[1].Modules[0].Item',
          code: 'invalidModule',
          constraint: 'stringRequired',
          params: {},
          message: 'Unknown module.',
        },
      ]);

      expect(entry?.index).toBe('1');
      expect(entry?.path).toBe('entries[1].Modules[0].Item');
      expect(entry?.code).toBe('invalidModule');
      expect(entry?.constraint).toBe('stringRequired');
      expect(entry?.reason.length).toBeGreaterThan(0);
    });

    it('keeps the package’s own indices rather than renumbering the list', () => {
      const entries = presenter.diagnostics([
        diagnostic({ index: 3, path: 'entries[3].Ship' }),
        diagnostic({ index: 7, path: 'entries[7].Modules' }),
      ]);

      expect(entries.map((entry) => entry.index)).toEqual(['3', '7']);
    });

    it('keeps five separate facts rather than flattening them into a sentence', () => {
      const [entry] = presenter.diagnostics([diagnostic({})]);

      expect(entry?.path).not.toContain(entry?.code ?? '');
      expect(entry?.reason).not.toContain(entry?.path ?? '');
      expect(entry?.constraint).not.toContain(entry?.path ?? '');
    });

    it('says what the package says, in the package’s own words', () => {
      const source = diagnostic({});
      const packageText = getSlefDiagnosticMessage(
        source,
        TestBed.inject(GameTextPresenter).locale,
      );

      const [entry] = presenter.diagnostics([source]);

      expect(entry?.reason).toBe(packageText ?? source.message);
    });

    it('shows the diagnostic’s own message when the package resolves a code by echoing it', () => {
      // A code this release has no text of its own for comes back as the
      // message the diagnostic already carries. That is the package's answer,
      // not an application fallback, and it is shown as given (FR-011).
      const source = diagnostic({
        code: 'aCodeThePackageDoesNotCarry' as SlefPackageDiagnostic['code'],
      });

      const [entry] = presenter.diagnostics([source]);

      expect(entry?.reason).toBe(source.message);
    });

    it('discloses the language rather than inventing text when the package has none at all', () => {
      const source = diagnostic({
        code: 'aCodeThePackageDoesNotCarry' as SlefPackageDiagnostic['code'],
        message: '',
      });
      expect(getSlefDiagnosticMessage(source, 'en') ?? '').toBe('');

      const [entry] = presenter.diagnostics([source]);

      expect(entry?.reason).toBe('');
      expect(entry?.disclosure).not.toBeNull();
      expect(entry?.reasonLanguage).toBeNull();
    });

    it('never translates a package code through the application’s own messages', () => {
      const [entry] = presenter.diagnostics([diagnostic({})]);

      // The code renders as the package wrote it. A missing-message marker here
      // would mean the application had gone looking for a key of its own.
      expect(entry?.code).toBe('invalidModule');
      expect(entry?.code).not.toContain('slef.');
    });

    it('invents no code, path or diagnostic for a failure the package did not raise', () => {
      for (const failure of [
        { kind: 'syntax' } as const,
        { kind: 'unknownHull', sourceHull: 'Nonexistent_Hull' } as const,
        { kind: 'construction' } as const,
      ]) {
        store.setImportFailure(failure);

        const view = presenter.importView().failure;
        expect(view?.diagnostics).toEqual([]);
        expect(view?.message ?? '').not.toContain('entries[');
      }
    });
  });

  describe('the export layer', () => {
    it('names the build it is about, through the package’s own hull name', () => {
      commit(active);

      expect(presenter.exportView().title).toContain('Anaconda');
    });

    it('offers both drawn formats, with the selected one marked', () => {
      presenter.selectMode('slef');

      expect(presenter.exportView().modes.map((mode) => mode.mode)).toEqual(['slef', 'link']);
      expect(presenter.exportView().modes.find((mode) => mode.selected)?.mode).toBe('slef');
    });

    it('states the entry count and the payload size beside the payload', () => {
      commit(active);
      presenter.generate();

      expect(presenter.exportView().metadata).toMatch(/^SLEF v1 · \d+ modules · [\d.]+ kB$/);
    });

    it('says nothing about validation for a build the package is happy with', () => {
      commit(active);
      presenter.generate();

      expect(presenter.exportView().validation).toBeNull();
    });

    it('warns about an invalid build without withholding the export', () => {
      commit(active);
      presenter.generate();
      const generated = store.artifact();
      if (generated === null) {
        throw new Error('expected an artifact to warn about');
      }
      // Driven from the artifact's own verdict rather than from a build broken
      // on purpose: what is under test is that an unhappy verdict is said out
      // loud and withholds nothing, not which edits make the package unhappy.
      store.setArtifact({
        ...generated,
        validation: { valid: false, complete: false, issues: [] },
      });

      expect(presenter.exportView().validation).toBe(
        'The Almanac reports this build as invalid. It is exported exactly as it is.',
      );
      expect(presenter.exportView().payload.length).toBeGreaterThan(0);
    });

    it('says an otherwise valid build is incomplete, in its own words', () => {
      commit(active);
      presenter.generate();
      const generated = store.artifact();
      if (generated === null) {
        throw new Error('expected an artifact to warn about');
      }
      store.setArtifact({ ...generated, validation: { valid: true, complete: false, issues: [] } });

      expect(presenter.exportView().validation).toBe(
        'The Almanac reports this build as incomplete. It is exported exactly as it is.',
      );
    });

    it('explains why a link is absent rather than leaving a gap', () => {
      commit(active);
      presenter.generate();

      expect(presenter.exportView().link).toBe(
        'The export carries no link, because this build has none yet.',
      );
    });

    it('always offers Download, and never claims a file was saved', () => {
      commit(active);
      presenter.generate();
      presenter.download();
      const download = presenter.exportView().actions.find((one) => one.action === 'download');

      expect(download).toBeDefined();
      expect(download?.status).toContain('handed to your browser');
      expect(download?.failed).toBe(false);
    });

    it('leaves the payload selectable when copying fails', () => {
      commit(active);
      presenter.generate();
      store.setDelivery({ action: 'copy', status: 'failed', reason: 'failed' });
      const copy = presenter.exportView().actions.find((one) => one.action === 'copy');

      expect(copy?.failed).toBe(true);
      expect(presenter.exportView().payload.length).toBeGreaterThan(0);
    });

    it('offers Share only when the platform provides it', () => {
      commit(active);
      store.setCapability({ clipboard: 'available', download: 'available', share: 'unavailable' });

      expect(presenter.exportView().actions.map((one) => one.action)).toEqual(['download', 'copy']);
    });
  });
});

describe('what a journal source adds to the words', () => {
  let presenter: SlefPresenter;
  let store: SlefStore;
  let announcements: AnnouncementService;

  const FILE = (name: string, lines: readonly string[]) => {
    const text = lines.join('\n');
    return { name, size: text.length, text: () => Promise.resolve(text) };
  };

  const line = (fields: Record<string, unknown>) =>
    JSON.stringify({
      timestamp: '2026-09-01T10:00:00Z',
      event: 'Loadout',
      Ship: 'Anaconda',
      Modules: [],
      ...fields,
    });

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideLocalization(),
        ...provideIsolatedLocaleEnvironment(),
        ...provideMemoryStorage(new MemoryStorage()),
        { provide: NavigatorAdapter, useClass: FakeNavigator },
        { provide: DownloadAdapter, useClass: FakeDownload },
      ],
    });
    presenter = TestBed.inject(SlefPresenter);
    store = TestBed.inject(SlefStore);
    announcements = TestBed.inject(AnnouncementService);
  });

  it('says what the one file it read came to', async () => {
    await presenter.scanFiles([
      FILE('Journal.01.log', [line({ ShipName: 'A' }), line({ ShipName: 'B' })]),
    ]);

    expect(presenter.importView().scanned).toBe('Journal.01.log · 2 builds');
  });

  it('counts the files rather than naming one when it read several', async () => {
    await presenter.scanFiles([
      FILE('Journal.01.log', [line({ ShipName: 'A' })]),
      FILE('Journal.02.log', [line({ ShipName: 'B' })]),
    ]);

    expect(presenter.importView().scanned).toBe('2 files · 2 builds');
  });

  it('says one build in the singular', async () => {
    await presenter.scanFiles([FILE('Journal.01.log', [line({ ShipName: 'A' })])]);

    expect(presenter.importView().scanned).toBe('Journal.01.log · 1 build');
  });

  it('lists nothing where a scan found one build', async () => {
    await presenter.scanFiles([FILE('Journal.01.log', [line({ ShipName: 'A' })])]);

    expect(presenter.importView().picks).toEqual([]);
    expect(presenter.importView().picksLabel).toBeNull();
  });

  it('names each build by what tells it apart, with the hull from the package', async () => {
    await presenter.scanFiles([
      FILE('Journal.01.log', [
        line({ ShipName: 'Night Watch', ShipIdent: 'NW-01' }),
        line({ ShipName: 'Day Watch', timestamp: '2026-08-01T10:00:00Z' }),
      ]),
    ]);
    const [first, second] = presenter.importView().picks;

    expect(first?.title).toBe('Night Watch · NW-01');
    expect(first?.detail).toBe('Anaconda · 0 modules');
    expect(first?.selected).toBe(true);
    expect(second?.title).toBe('Day Watch');
    expect(second?.selected).toBe(false);
  });

  it('says how many were found and how many are chosen', async () => {
    await presenter.scanFiles([
      FILE('Journal.01.log', [
        line({ ShipName: 'A' }),
        line({ ShipName: 'B', timestamp: '2026-08-01T10:00:00Z' }),
      ]),
    ]);

    expect(presenter.importView().picksLabel).toBe(
      '2 builds found · select one or more · 1 selected',
    );
  });

  it('counts the chosen builds on the action that loads them', async () => {
    await presenter.scanFiles([
      FILE('Journal.01.log', [
        line({ ShipName: 'A' }),
        line({ ShipName: 'B', timestamp: '2026-08-01T10:00:00Z' }),
      ]),
    ]);
    presenter.chooseJournalPicks(store.journalEntries().map((entry) => entry.key));

    expect(presenter.importView().submitLabel).toBe('Load 2 builds');
  });

  it('refuses to submit while nothing is chosen from a list', async () => {
    await presenter.scanFiles([
      FILE('Journal.01.log', [
        line({ ShipName: 'A' }),
        line({ ShipName: 'B', timestamp: '2026-08-01T10:00:00Z' }),
      ]),
    ]);
    presenter.chooseJournalPicks([]);

    expect(presenter.importView().canSubmit).toBe(false);
  });

  it('names the file that was too large, and the bound', async () => {
    await presenter.scanFiles([
      { name: 'Journal.huge.log', size: 25_000_001, text: () => Promise.resolve('') },
    ]);

    expect(presenter.importView().failure?.message).toContain('Journal.huge.log');
    expect(presenter.importView().failure?.message).toContain('25');
  });

  it('names the files it scanned when none of them holds a build', async () => {
    await presenter.scanFiles([FILE('Journal.01.log', ['{"event":"Docked"}'])]);

    expect(presenter.importView().failure?.message).toBe(
      'No loadout event was found in Journal.01.log.',
    );
  });

  it('says that it is reading files, out loud', async () => {
    const scanning = presenter.scanFiles([FILE('Journal.01.log', [line({ ShipName: 'A' })])]);

    expect(announcements.polite()).toBe('Reading journal files.');

    await scanning;
  });

  it('says how the scan ended, not only that it started', async () => {
    await presenter.scanFiles([
      FILE('Journal.01.log', [line({ ShipName: 'A' }), line({ ShipName: 'B' })]),
    ]);

    // Everything else a scan produces — the list, the scanned line, the
    // refusal — is on the screen. A Commander who is not looking at the screen
    // would otherwise hear that a scan started and never hear it finish.
    expect(announcements.polite()).toBe('2 builds found. Choose one or more.');
  });

  it('says what refused a scan, in the sentence the panel states it in', async () => {
    await presenter.scanFiles([FILE('Journal.01.log', ['{"event":"Docked"}'])]);

    // Not "Nothing was found to import.", which is an outcome that did not
    // happen for every refusal but this one: a file over the size limit was
    // never read, and saying nothing was found in it would be untrue
    // (constitution IV).
    expect(announcements.polite()).toBe('No loadout event was found in Journal.01.log.');
  });

  it('never says a file held nothing when it was never read', async () => {
    // A file over the size limit is refused before it is opened. The panel
    // says it was not read; an outlet saying nothing was found in it states an
    // outcome nobody reached (constitution IV).
    const enormous = {
      name: 'Journal.big.log',
      size: 64 * 1024 * 1024,
      text: () => Promise.resolve(''),
    };

    await presenter.scanFiles([enormous]);

    const spoken = announcements.polite();
    expect(spoken).toContain('Journal.big.log');
    expect(spoken).not.toContain('Nothing was found');
  });

  it('says nothing about the outcome of a scan a newer one replaced', async () => {
    let release: (text: string) => void = () => {};
    const slow = {
      name: 'Journal.slow.log',
      size: 1,
      text: () => new Promise<string>((resolve) => (release = resolve)),
    };

    const abandoned = presenter.scanFiles([slow]);

    // A second drop while the first is still being read. Its outcome is the
    // answer the Commander is waiting for.
    await presenter.scanFiles([
      FILE('Journal.02.log', [line({ ShipName: 'A' }), line({ ShipName: 'B' })]),
    ]);
    const answered = announcements.politeEvent();
    expect(answered?.text).toBe('2 builds found. Choose one or more.');

    // The abandoned scan then settles, on nothing at all. Announced, it would
    // talk over the answer to the question that replaced it. This order was
    // never the broken one — the current scan had already spent the number both
    // outcomes were compared on, so the late one was dropped for free. It is
    // read because the number is gone and nothing drops anything now; the order
    // that went wrong is the test below.
    release('{"event":"Docked"}');
    await abandoned;

    expect(announcements.politeEvent()).toBe(answered);
  });

  it('lets the current scan answer when the one it replaced settles first', async () => {
    let release: (text: string) => void = () => {};
    const slow = {
      name: 'Journal.slow.log',
      size: 1,
      text: () => new Promise<string>((resolve) => (release = resolve)),
    };

    // The other order, and the one that went wrong. The first drop holds
    // nothing and is read at once; the second is still being read when it
    // lands. Settling first is what made the abandoned scan the louder of the
    // two under the policy this change replaced: it stated its own empty
    // reading, spent the number both outcomes were compared on, and the answer
    // the Commander was actually waiting for was dropped for being no further
    // ahead (011/FR-009).
    const abandoned = presenter.scanFiles([FILE('Journal.01.log', ['{"event":"Docked"}'])]);
    const current = presenter.scanFiles([slow]);

    await abandoned;
    expect(announcements.polite()).toBe('Reading journal files.');

    release([line({ ShipName: 'A' }), line({ ShipName: 'B' })].join('\n'));
    await current;

    expect(announcements.polite()).toBe('2 builds found. Choose one or more.');
  });
});

/**
 * What an import and a delivery say out loud.
 *
 * Both are a request a Commander made, and both used to be muted by a number
 * that did not rise: a stored batch behind a committed import carried the same
 * build revision, and a second press of Copy carried the same export revision.
 * The policy no longer compares anything, so each of these is read as what a
 * Commander is owed rather than as what a counter allowed (011/FR-009).
 */
describe('what an import and a delivery say out loud', () => {
  let presenter: SlefPresenter;
  let store: SlefStore;
  let active: ActiveBuildStore;
  let announcements: AnnouncementService;

  /** A clipboard that can be made to fail, so both outcomes can be read. */
  class TogglingNavigator extends FakeNavigator {
    copies = true;

    override async copyText(): Promise<boolean> {
      return this.copies;
    }
  }

  let navigator: TogglingNavigator;

  const loadoutLine = (fields: Record<string, unknown>) =>
    JSON.stringify({
      timestamp: '2026-09-01T10:00:00Z',
      event: 'Loadout',
      Ship: FIXTURE_HULL,
      ShipName: 'Anaconda',
      Modules: [],
      ...fields,
    });

  const journalFile = (name: string, lines: readonly string[]) => {
    const text = lines.join('\n');
    return { name, size: text.length, text: () => Promise.resolve(text) };
  };

  beforeEach(() => {
    navigator = new TogglingNavigator();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        // A stub `/outfitting`, so the move to the workspace resolves without
        // mounting feature 001's real route.
        provideRouter([{ path: 'outfitting', children: [] }]),
        provideLocalization(),
        ...provideIsolatedLocaleEnvironment(),
        ...provideMemoryStorage(new MemoryStorage()),
        { provide: NavigatorAdapter, useValue: navigator },
        { provide: DownloadAdapter, useClass: FakeDownload },
      ],
    });
    presenter = TestBed.inject(SlefPresenter);
    store = TestBed.inject(SlefStore);
    active = TestBed.inject(ActiveBuildStore);
    announcements = TestBed.inject(AnnouncementService);
  });

  /**
   * Works on the open build, spending build revisions and no request token.
   *
   * This is what puts the build ahead of the import counter, and it is the only
   * arrangement in which the policy this change replaced fell silent here: it
   * compared one number across all three `slef.import` outcomes, a commit
   * supplied the build's revision and a batch supplied the request token, and a
   * Commander who had been editing had a build revision far above any token the
   * layer had reached. Without the edits the token is the larger of the two,
   * the old policy publishes, and a test written here proves nothing.
   */
  function workOnIt(times: number): void {
    for (let index = 0; index < times; index += 1) {
      active.touch();
    }
  }

  /** Pastes one build and submits it, which commits and opens the workspace. */
  async function commitOne(): Promise<void> {
    store.setDraft(JSON.stringify({ event: 'Loadout', Ship: FIXTURE_HULL, Modules: [] }));
    expect(await presenter.submit()).toEqual({ kind: 'committed' });
  }

  /** Scans three builds and chooses all of them. */
  async function chooseAll(lines: readonly string[]): Promise<void> {
    await presenter.scanFiles([journalFile('Journal.01.log', lines)]);
    for (const entry of store.journalEntries().slice(1)) {
      store.toggleSelection(entry.key);
    }
  }

  it('states a stored batch after a committed import', async () => {
    await commitOne();
    workOnIt(5);
    await commitOne();
    const committed = announcements.politeEvent();
    expect(committed?.text).toContain('imported');

    // The batch spends no build revision, because nothing it stores is opened.
    // It carries a request token instead, and the commit before it carried a
    // build revision that five edits had pushed well past it — so under the old
    // policy the batch was the smaller number of the two and went unsaid.
    await chooseAll([
      loadoutLine({ ShipName: 'First', timestamp: '2026-09-04T09:00:00Z' }),
      loadoutLine({ ShipName: 'Second', timestamp: '2026-09-03T09:00:00Z' }),
    ]);
    // The arrangement the old policy fell silent in, stated rather than assumed:
    // the build is ahead of the token, so the number the batch would have
    // carried is behind the number the commit already published.
    expect(active.revision()).toBeGreaterThan(store.requestToken);

    expect(await presenter.submit()).toMatchObject({ kind: 'stored', stored: 2 });

    const stored = announcements.politeEvent();
    expect(stored?.text).toBe('2 builds imported and saved.');
    expect(stored?.identity).not.toBe(committed?.identity);
  });

  it('states a refused payload after a committed import', async () => {
    await commitOne();
    workOnIt(5);
    await commitOne();
    const committed = announcements.politeEvent();
    expect(committed?.text).toContain('imported');

    // Same shape as the batch above: the refusal carries a request token, the
    // commit carried a build revision the edits had raised past it, and one
    // number for both is what silenced the second.
    store.setDraft('not a payload');
    expect(active.revision()).toBeGreaterThan(store.requestToken);
    expect(await presenter.submit()).toEqual({ kind: 'failed' });

    const failed = announcements.politeEvent();
    expect(failed?.text).toBe('This payload was not imported.');
    expect(failed?.identity).not.toBe(committed?.identity);
  });

  it('states both outcomes of a batch that stores some and refuses one', async () => {
    // One request, two outcomes. One sentence carries both: the polite outlet
    // holds one event, so a second announcement in the same tick would write
    // over the first and only the last of them would reach a reader
    // (011/FR-009, 016/FR-011).
    await chooseAll([
      loadoutLine({ ShipName: 'First', timestamp: '2026-09-04T09:00:00Z' }),
      loadoutLine({
        ShipName: 'Refused',
        Ship: 'Nonexistent_Hull',
        timestamp: '2026-09-03T09:00:00Z',
      }),
      loadoutLine({ ShipName: 'Third', timestamp: '2026-09-02T09:00:00Z' }),
    ]);

    expect(await presenter.submit()).toMatchObject({ kind: 'stored', stored: 2 });

    // Both counts. How many were imported is what 016/FR-010 asks the outcome
    // to state, and a reader who hears only the refusal has to go and count
    // the records to learn the rest of their own answer.
    expect(announcements.polite()).toBe('2 builds imported and saved. 1 build was not saved.');
  });

  it('states what a batch saved even where the Commander closed the layer over it', async () => {
    // Closing the layer withdraws the question, and a withdrawn question's
    // answer is normally not announced — it would land on top of the answer to
    // whatever replaced it. A batch is the exception, and the records are the
    // reason: they are in storage by the time this settles and they stay
    // there. Silence would leave a Commander holding saved builds nobody told
    // them about (011/FR-009, 016/FR-010).
    await chooseAll([
      loadoutLine({ ShipName: 'First', timestamp: '2026-09-04T09:00:00Z' }),
      loadoutLine({ ShipName: 'Second', timestamp: '2026-09-03T09:00:00Z' }),
    ]);

    const submitting = presenter.submit();
    const inFlight = store.requestToken;
    presenter.closeLayer();
    expect(store.requestToken, 'closing the layer did not withdraw the request').not.toBe(inFlight);

    expect(await submitting).toMatchObject({ kind: 'stored', stored: 2 });
    expect(announcements.polite()).toBe('2 builds imported and saved.');
  });

  it('never says the rest were saved where nothing was', async () => {
    // Every chosen build refused. The batch still reports, because the
    // Commander asked and is owed an answer — but the answer is that nothing
    // was saved. Saying "the rest were" here would state an outcome that did
    // not happen (constitution IV).
    await chooseAll([
      loadoutLine({
        ShipName: 'Refused',
        Ship: 'Nonexistent_Hull',
        timestamp: '2026-09-04T09:00:00Z',
      }),
      loadoutLine({
        ShipName: 'Also refused',
        Ship: 'Nonexistent_Hull',
        timestamp: '2026-09-03T09:00:00Z',
      }),
    ]);

    expect(await presenter.submit()).toMatchObject({ kind: 'stored', stored: 0 });

    expect(announcements.polite()).toBe('2 builds were not saved.');
  });

  it('answers a second Copy, in the same words', async () => {
    await commitOne();
    presenter.generate();

    await presenter.copy();
    const first = announcements.politeEvent();
    expect(first?.text).toBe('Copy: Copied');

    // The export did not change between the presses, which is exactly why the
    // second one used to be silent. A Commander presses again because they
    // were unsure of the first press, and the sentence is the answer.
    await presenter.copy();
    const second = announcements.politeEvent();
    expect(second?.text).toBe(first?.text);
    expect(second?.identity, 'the second press was published as the first').not.toBe(
      first?.identity,
    );
  });

  it('says a copy that failed, and then the one that worked', async () => {
    await commitOne();
    presenter.generate();

    navigator.copies = false;
    await presenter.copy();
    expect(announcements.polite()).toContain('could not be copied');

    // The export still has not changed, so the old policy muted the outcome
    // that differed from the first — which is the press that actually worked.
    navigator.copies = true;
    await presenter.copy();
    expect(announcements.polite()).toBe('Copy: Copied');
  });
});
