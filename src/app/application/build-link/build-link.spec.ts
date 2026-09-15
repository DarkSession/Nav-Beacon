import { TestBed } from '@angular/core/testing';
import { ShipLoadout } from '@elite-dangerous-almanac/core/ships/ship-loadout';
import { normalizeIncomingBuild } from '../../domain/ships/build/build-ingress-normalizer';
import { BuildLinkCodecError } from '../../domain/build-link/build-link-codec-error';
import { encodeBuildLinkFragment } from '../../domain/ships/build-link/build-link-codec-loader';
import { provideLocalization } from '../../i18n/i18n.providers';
import { provideIsolatedLocaleEnvironment } from '../../i18n/testing/localization-harness';
import { BUNDLED_ENGLISH } from '../../i18n/locale-registry';
import { HistoryLocationAdapter } from '../../platform/browser/history-location.adapter';
import { MemoryStorage, provideMemoryStorage } from '../../platform/storage/storage.spec-helpers';
import { ActiveBuildStore } from '../active-build/active-build.store';
import { AutosaveService } from '../build-library/autosave.service';
import { BuildIngressCoordinator } from '../active-build/build-ingress.coordinator';
import { BuildLinkCoordinator } from './build-link.coordinator';
import { FragmentPublisher } from './fragment-publisher';
import { MAX_BUILD_LINK_LENGTH } from './fragment-recognizer';
import { LinkErrorMapper, type LinkFailureCode } from './link-error.mapper';
import { FIELDS_EXCLUDED_FROM_LINKS, linkPayloadSource } from './link-payload.allowlist';

function setup() {
  const storage = new MemoryStorage();
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      provideLocalization(),
      ...provideIsolatedLocaleEnvironment(),
      ...provideMemoryStorage(storage),
    ],
  });
  return {
    ingress: TestBed.inject(BuildLinkCoordinator),
    publisher: TestBed.inject(FragmentPublisher),
    active: TestBed.inject(ActiveBuildStore),
    autosave: TestBed.inject(AutosaveService),
    replacement: TestBed.inject(BuildIngressCoordinator),
    errors: TestBed.inject(LinkErrorMapper),
    location: TestBed.inject(HistoryLocationAdapter),
    storage,
  };
}

/** A real build, encoded by the real codec — no hand-written payloads here. */
async function anacondaFragment(): Promise<string> {
  return encodeBuildLinkFragment(ShipLoadout.default('Anaconda'));
}

function commitAnaconda(active: ActiveBuildStore, hull = 'Anaconda'): void {
  active.commit({
    loadout: ShipLoadout.default(hull),
    hullName: hull,
    provenance: 'stock',
    sourceNamed: null,
    autosaveRecordId: null,
    baseline: null,
  });
}

describe('BuildLinkCoordinator', () => {
  it('leaves an unrelated fragment uninterpreted and the build untouched', async () => {
    const { ingress, active } = setup();
    commitAnaconda(active);
    const before = active.fingerprint();

    expect(await ingress.ingest('#some-anchor')).toEqual({ kind: 'ignored' });
    expect(active.fingerprint()).toBe(before);
    expect(ingress.failure()).toBeNull();
  });

  it('refuses an over-long value before any decoding, keeping the active build', async () => {
    const { ingress, active } = setup();
    commitAnaconda(active);
    const before = active.fingerprint();

    const result = await ingress.ingest('b.' + 'x'.repeat(MAX_BUILD_LINK_LENGTH));

    expect(result).toEqual({ kind: 'refused', failure: { code: 'tooLong', slot: null } });
    expect(ingress.failure()?.code).toBe('tooLong');
    expect(active.fingerprint()).toBe(before);
  });

  it('commits a decoded link as link provenance with no saved baseline', async () => {
    const { ingress, active } = setup();

    const result = await ingress.ingest(await anacondaFragment());

    expect(result.kind).toBe('replacement');
    expect(active.provenance()).toBe('link');
    expect(active.loadout()?.shipSymbol).toBe('Anaconda');
    // Saved nowhere a Commander could get it back from, so it arrives dirty.
    expect(active.baselineFingerprint()).toBeNull();
    expect(active.dirty()).toBe(true);
  });

  it('takes no record for a build at the package default arriving in a link', async () => {
    // A link carrying the hull's own default loadout is the same build a
    // Commander reaches by selecting the hull. It takes no record, and the
    // address it arrived on is what it is reached from again (024/FR-001).
    const { ingress, active, autosave, storage } = setup();

    await ingress.ingest(await anacondaFragment());

    expect(active.atDefault()).toBe(true);
    expect(autosave.flush()).toBe(true);
    expect(active.autosaveRecordId()).toBeNull();
    expect(storage.entries.size).toBe(0);
  });

  it('takes a record at the first modelled edit of a build arrived in a link', async () => {
    const { ingress, active, autosave, storage } = setup();
    await ingress.ingest(await anacondaFragment());

    active.loadout()!.setModulePriority('FrameShiftDrive', 2);
    active.touch();

    expect(autosave.flush()).toBe(true);
    expect(active.autosaveRecordId()).not.toBeNull();
    expect(storage.entries.size).toBe(1);
  });

  it('accepts a link whose fixed mounts the package populated, without repairing them', async () => {
    const { ingress, active } = setup();

    await ingress.ingest(await anacondaFragment());

    const fixed = [
      ...(active.loadout()?.slots('core') ?? []),
      ...(active.loadout()?.slots('armour') ?? []),
    ];
    expect(fixed.length).toBeGreaterThan(0);
    expect(fixed.every((slot) => slot.module !== null)).toBe(true);
  });

  it('replaces unsaved work without asking about it', async () => {
    // A pasted link commits over whatever was on screen, because whatever was
    // on screen has a record of its own to be reopened from (FR-008).
    const { ingress, active } = setup();
    commitAnaconda(active, 'Adder');

    const result = await ingress.ingest(await anacondaFragment());

    expect(result.kind).toBe('replacement');
    expect(result.kind === 'replacement' && result.result.kind).toBe('committed');
    expect(active.provenance()).toBe('link');
  });

  it('refuses a corrupted value without touching the active build', async () => {
    const { ingress, active } = setup();
    commitAnaconda(active);
    const before = active.fingerprint();

    const result = await ingress.ingest('b.zzzzzzzzzzzz');

    expect(result.kind).toBe('replacement');
    expect(ingress.failure()).not.toBeNull();
    expect(active.provenance()).toBe('stock');
    expect(active.fingerprint()).toBe(before);
  });

  it('treats a link describing the build already open as nothing to do', async () => {
    const { ingress, active } = setup();
    commitAnaconda(active);

    // What a reload looks like from here: the address still carries the link of
    // the build that was just restored.
    expect(await ingress.ingest(await anacondaFragment())).toEqual({ kind: 'unchanged' });
    expect(active.provenance()).toBe('stock');
  });

  it('treats an imported build’s own link as nothing to do', async () => {
    const { ingress, active } = setup();
    const imported = normalizeIncomingBuild({ event: 'Loadout', Ship: 'anaconda', Modules: [] });
    if (imported.kind !== 'accepted') {
      throw new Error('the fixture import was refused');
    }
    active.commit({
      loadout: imported.candidate,
      hullName: 'Anaconda',
      provenance: 'working',
      sourceNamed: null,
      autosaveRecordId: null,
      baseline: null,
    });

    // What a reload of an imported build looks like from here. A journal event
    // names the hull the way the game logs it, and the codec names it the way
    // the package does; the sameness test folds module symbols and compares the
    // hull byte for byte. Until the identity was resolved at ingress, the
    // restored record said `anaconda` where its own link said `Anaconda`, so
    // the build differed from itself and a Commander was asked whether to
    // replace it with an identical one.
    const fragment = await encodeBuildLinkFragment(active.loadout()!);

    expect(await ingress.ingest(fragment)).toEqual({ kind: 'unchanged' });
    expect(active.provenance()).toBe('working');
  });

  it('does not read back a fragment it published itself', async () => {
    const { ingress } = setup();
    const fragment = await anacondaFragment();
    ingress.markPublished(fragment);

    expect(await ingress.ingest(fragment)).toEqual({ kind: 'unchanged' });
  });
});

/** Waits for an encode the publisher started on its own to land. */
async function settlePublication(location: HistoryLocationAdapter): Promise<void> {
  for (let pass = 0; pass < 50 && !location.fragment().startsWith('b.'); pass += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

describe('FragmentPublisher', () => {
  it('publishes a build that becomes active and is never edited', async () => {
    // What a reload restores such a build from, now that a build at the package
    // default takes no record. The watcher runs on the first revision, so the
    // address carries the build from the moment it opens and no edit is needed
    // to put it there (024/FR-003).
    const { publisher, active, location } = setup();
    const stop = publisher.start();

    commitAnaconda(active);
    TestBed.tick();
    await settlePublication(location);

    expect(location.fragment().startsWith('b.')).toBe(true);
    expect(active.link().kind).toBe('published');
    stop();
  });

  it('publishes no link for a build the codec refuses, and takes down a stale one', async () => {
    // The address is what such a build is restored from, so a fragment left
    // standing over a build that could not be encoded would read an earlier
    // build back onto the page (024/FR-003, 001 link contract).
    const { publisher, active, location } = setup();
    commitAnaconda(active);
    await publisher.publish();
    expect(location.fragment().startsWith('b.')).toBe(true);

    publisher.encode = () =>
      Promise.reject(new BuildLinkCodecError('invalidPayload', 'the codec refuses this build'));
    active.touch();
    await publisher.publish();

    expect(location.fragment()).toBe('');
    expect(active.link().kind).not.toBe('published');
  });

  it('publishes the active build within the published bound, preserving path and query', async () => {
    const { publisher, active, location } = setup();
    commitAnaconda(active);

    await publisher.publish();

    const link = active.link();
    expect(link.kind).toBe('published');
    const fragment = link.kind === 'published' ? link.fragment : '';
    expect(fragment.startsWith('b.')).toBe(true);
    expect(fragment.length).toBeLessThanOrEqual(MAX_BUILD_LINK_LENGTH);
    expect(location.fragment()).toBe(fragment);
    expect(publisher.publishedUrl()).toContain(`#${fragment}`);
    expect(publisher.publishedUrl()).not.toContain(`?${fragment}`);
  });

  it('adds no history entry per revision', async () => {
    const { publisher, active } = setup();
    commitAnaconda(active);
    const before = window.history.length;

    await publisher.publish();
    active.touch();
    await publisher.publish();
    active.touch();
    await publisher.publish();

    expect(window.history.length).toBe(before);
  });

  it('stamps no fragment on a screen the Commander moved to while it encoded', async () => {
    const build = `${window.location.pathname}${window.location.search}`;
    // Earlier tests here publish onto the same window, and the adapter reads the
    // address it finds. The condition under test is a *new* fragment appearing,
    // so the address starts clean.
    window.history.replaceState(window.history.state, '', build);

    const { publisher, active, location } = setup();
    commitAnaconda(active);
    expect(location.fragment()).toBe('');

    // The encode is held open, which is the whole condition: on a loaded
    // machine it takes long enough for a Commander to leave.
    let finish: (fragment: string) => void = () => {};
    publisher.encode = () =>
      new Promise<string>((resolve) => {
        finish = resolve;
      });

    const publishing = publisher.publish();
    window.history.replaceState(window.history.state, '', '/ships');
    finish(await anacondaFragment());
    await publishing;

    try {
      // The shipyard is not a build, and a build link on it would decode into
      // one the Commander is not editing.
      expect(location.fragment()).toBe('');
      expect(window.location.pathname).toBe('/ships');
    } finally {
      window.history.replaceState(window.history.state, '', build);
    }
  });

  it('takes down a stale build fragment when there is no build left', async () => {
    const { publisher, active, location } = setup();
    commitAnaconda(active);
    await publisher.publish();
    expect(location.fragment().startsWith('b.')).toBe(true);

    active.clear();
    await publisher.publish();

    expect(location.fragment()).toBe('');
    expect(active.link()).toEqual({ kind: 'absent' });
  });
});

describe('the link payload allowlist', () => {
  it('names every application field a link must never carry', () => {
    expect([...FIELDS_EXCLUDED_FROM_LINKS]).toEqual([
      'hullName',
      'provenance',
      'autosaveRecordId',
      'sourceNamed',
      'baselineFingerprint',
      'dirty',
      'persistence',
      'link',
    ]);
  });

  it('hands the encoder the build and nothing else', () => {
    const { active } = setup();
    commitAnaconda(active);

    expect(linkPayloadSource(active.state())).toBe(active.loadout());
  });

  it('leaves the published link unchanged when only local metadata moves', async () => {
    const { publisher, active } = setup();
    commitAnaconda(active);
    await publisher.publish();
    const published = active.link();

    active.setAutosaveRecordId('record-42');
    active.markSaved({ recordId: 'record-42', baseRevisionId: 'revision-7' });
    active.setPersistence('saved');
    await publisher.publish();

    expect(active.link()).toEqual(published);
  });
});

describe('LinkErrorMapper', () => {
  const codes: readonly LinkFailureCode[] = [
    'invalidEncoding',
    'integrityCheckFailed',
    'unsupportedEnvelope',
    'unsupportedTableVersion',
    'invalidPayload',
    'unknownIdentity',
    'reconstructionFailed',
    'tooLong',
  ];

  it('says something distinct, translated and actionable for every code', () => {
    const { errors } = setup();

    const messages = codes.map((code) => errors.describe({ code, slot: null }).message);

    expect(new Set(messages).size).toBe(codes.length);
    for (const [index, message] of messages.entries()) {
      expect(message).toBe(BUNDLED_ENGLISH[`link.error.${codes[index]!}`]);
      // Never an internal exception message: those name table versions and bit
      // widths, and are not translated.
      expect(message).not.toContain('codec table');
    }
  });

  it('names the mount when the codec named one', () => {
    const { errors } = setup();

    expect(errors.describe({ code: 'unknownIdentity', slot: 'Slot03_Size6' }).detail).toContain(
      'Slot03_Size6',
    );
    expect(errors.describe({ code: 'unknownIdentity', slot: null }).detail).toBeNull();
  });

  it('carries the codec’s own code and slot through', () => {
    const { errors } = setup();
    const error = new BuildLinkCodecError('unknownIdentity', 'internal detail', {
      slot: 'Military01',
    });

    expect(errors.classify(error)).toEqual({ code: 'unknownIdentity', slot: 'Military01' });
  });

  it('treats anything else as a reconstruction failure', () => {
    const { errors } = setup();

    expect(errors.classify(new TypeError('undefined is not a function'))).toEqual({
      code: 'reconstructionFailed',
      slot: null,
    });
  });
});
