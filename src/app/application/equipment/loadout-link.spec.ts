import { TestBed } from '@angular/core/testing';
import { BuildLinkCodecError } from '../../domain/build-link/build-link-codec-error';
import type { EquipmentLoadout } from '../../domain/equipment/loadout-link/equipment-loadout';
import { provideLocalization } from '../../i18n/i18n.providers';
import { BUNDLED_ENGLISH } from '../../i18n/locale-registry';
import { toStoredLoadout } from '../../domain/equipment/loadout/stored-loadout.serializer';
import germanCatalogue from '../../i18n/locales/de.json';
import { HistoryLocationAdapter } from '../../platform/browser/history-location.adapter';
import { MemoryStorage, provideMemoryStorage } from '../../platform/storage/storage.spec-helpers';
import { LinkErrorMapper } from '../build-link/link-error.mapper';
import {
  FIELDS_EXCLUDED_FROM_EQUIPMENT_LINKS,
  equipmentLinkPayloadSource,
} from '../build-link/link-payload.allowlist';
import { LoadoutAutosaveService } from './loadout-autosave.service';
import { LoadoutLinkCoordinator } from './loadout-link.coordinator';
import { LoadoutSummary } from './loadout-summary';
import { LoadoutStore } from './loadout.store';

const RIFLE = 'wpn_m_assaultrifle_plasma_fauto';

/** A location that remembers what was written to it, without a browser. */
class MemoryLocation {
  fragmentValue = '';
  /** How many times the fragment was replaced, so a test can count entries. */
  replacements = 0;

  fragment(): string {
    return this.fragmentValue;
  }

  currentDocument(): string {
    return '/equipment?tab=suit';
  }

  urlWithFragment(value: string): string {
    return `https://navbeacon.test/equipment?tab=suit#${value}`;
  }

  replaceFragment(value: string | null): void {
    this.replacements += 1;
    this.fragmentValue = value ?? '';
  }
}

function setup() {
  const location = new MemoryLocation();
  const storage = new MemoryStorage();
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      provideLocalization(),
      ...provideMemoryStorage(storage),
      { provide: HistoryLocationAdapter, useValue: location },
    ],
  });
  return {
    location,
    storage,
    store: TestBed.inject(LoadoutStore),
    links: TestBed.inject(LoadoutLinkCoordinator),
    autosave: TestBed.inject(LoadoutAutosaveService),
    errors: TestBed.inject(LinkErrorMapper),
    summary: TestBed.inject(LoadoutSummary),
  };
}

/**
 * The same bench, publishing onto the window's own address.
 *
 * The location adapter is left to be the real one, for the case that asks what
 * the adapter puts in a link rather than what the bench puts in a fragment.
 */
function setupOnTheWindow(): {
  store: LoadoutStore;
  links: LoadoutLinkCoordinator;
} {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [provideLocalization(), ...provideMemoryStorage(new MemoryStorage())],
  });
  return {
    store: TestBed.inject(LoadoutStore),
    links: TestBed.inject(LoadoutLinkCoordinator),
  };
}

/** A loadout with held content: a sniper on a mount the Maverick does not offer. */
function heldLoadout(store: LoadoutStore): EquipmentLoadout {
  store.dispatch({ kind: 'selectSuit', suitFamily: 'tacticalsuit' });
  store.dispatch({
    kind: 'fitWeapon',
    mount: 'PrimaryWeapon2',
    symbol: 'wpn_m_sniper_plasma_charged',
  });
  store.dispatch({ kind: 'selectSuit', suitFamily: 'utilitysuit' });
  return store.loadout()!;
}

describe('LoadoutLinkCoordinator', () => {
  it('publishes the loadout on the bench, and takes the link down with the bench', () => {
    const { links, store, location } = setup();

    store.dispatch({ kind: 'selectSuit', suitFamily: 'tacticalsuit' });
    links.publish();

    expect(location.fragmentValue.startsWith('e.')).toBe(true);
    expect(links.link().kind).toBe('published');

    store.open(null);
    links.publish();

    expect(location.fragmentValue).toBe('');
    expect(links.link()).toEqual({ kind: 'absent' });
  });

  it('publishes a loadout for a suit chosen and nothing else done', () => {
    // What a reload restores such a loadout from, because a loadout at its
    // suit's default takes no record. The watcher runs on the first revision,
    // so the address carries the loadout from the moment the suit is chosen and
    // no further choice is needed to put it there (024/FR-003).
    const { links, store, location } = setup();
    const stop = links.start();

    store.dispatch({ kind: 'selectSuit', suitFamily: 'tacticalsuit' });
    TestBed.tick();

    expect(location.fragmentValue.startsWith('e.')).toBe(true);
    expect(links.link().kind).toBe('published');
    expect(store.atDefault()).toBe(true);
    stop();
  });

  it('replaces the fragment on every change, adding no history entry', () => {
    // A published loadout is the loadout on the bench, continuously, rather
    // than a snapshot a Commander asked for. One entry per choice would bury
    // their real navigation under every version of one bench (024/FR-003).
    const { links, store, location } = setup();
    const stop = links.start();
    store.dispatch({ kind: 'selectSuit', suitFamily: 'tacticalsuit' });
    TestBed.tick();
    const first = location.fragmentValue;
    const replacements = location.replacements;

    store.dispatch({ kind: 'setSuitGrade', grade: 3 });
    TestBed.tick();
    store.dispatch({ kind: 'fitWeapon', mount: 'PrimaryWeapon1', symbol: RIFLE });
    TestBed.tick();

    // Replaced in place, once per change, and the fragment moved with it.
    expect(location.replacements).toBe(replacements + 2);
    expect(location.fragmentValue).not.toBe(first);
    expect(location.fragmentValue.startsWith('e.')).toBe(true);
    stop();
  });

  it('carries no part of the loadout in the path or the query', () => {
    // The loadout is in the fragment, which browsers do not send to a server.
    // A path or a query carrying any of it would publish a Commander's loadout
    // to whatever serves the address (024/FR-003).
    //
    // Read off the real location adapter rather than the double the rest of
    // this suite uses. The double returns one fixed base, so against it the
    // path and the query are the fixture's own literal and the rule would be
    // asserted of the test rather than of the code that builds the link.
    const address = '/equipment?tab=suit';
    const before = `${window.location.pathname}${window.location.search}`;
    window.history.replaceState(window.history.state, '', address);

    try {
      const { links, store } = setupOnTheWindow();
      store.dispatch({ kind: 'selectSuit', suitFamily: 'tacticalsuit' });

      links.publish();

      const published = new URL(links.publishedUrl() ?? '');
      expect(published.hash.startsWith('#e.')).toBe(true);
      expect(published.pathname).toBe('/equipment');
      expect(published.search).toBe('?tab=suit');
    } finally {
      window.history.replaceState(window.history.state, '', before);
    }
  });

  it('restores the loadout a link describes, held content and all (FR-018a)', () => {
    const first = setup();
    const held = heldLoadout(first.store);
    first.links.publish();
    const fragment = first.location.fragmentValue;

    // A second application, as a Commander opening the link would have.
    const second = setup();
    expect(second.links.ingest(fragment)).toEqual({ kind: 'opened' });
    expect(second.store.loadout()).toEqual(held);
    // A link is nobody's saved record, so the loadout it opens belongs to none.
    expect(second.store.sourceNamed()).toBeNull();
  });

  it('takes no record for a loadout at its suit’s default arriving in a link', () => {
    // The same answer the bench gives a suit chosen at the gate. What a link
    // carries is the loadout, and the loadout is what the rule reads
    // (024/FR-002).
    const first = setup();
    first.store.dispatch({ kind: 'selectSuit', suitFamily: 'tacticalsuit' });
    first.links.publish();
    const fragment = first.location.fragmentValue;

    const second = setup();
    expect(second.links.ingest(fragment)).toEqual({ kind: 'opened' });
    second.autosave.flush();

    expect(second.store.atDefault()).toBe(true);
    expect(second.store.autosaveRecordId()).toBeNull();
    expect(second.storage.entries.size).toBe(0);
  });

  it('takes a record at the first change to a loadout arrived in a link', () => {
    const first = setup();
    first.store.dispatch({ kind: 'selectSuit', suitFamily: 'tacticalsuit' });
    first.links.publish();

    const second = setup();
    second.links.ingest(first.location.fragmentValue);
    second.autosave.flush();
    second.store.dispatch({ kind: 'setSuitGrade', grade: 3 });
    second.autosave.flush();

    expect(second.store.autosaveRecordId()).not.toBeNull();
    expect(second.storage.entries.size).toBe(1);
  });

  it('leaves a fragment that belongs to something else alone', () => {
    const { links, store } = setup();
    store.dispatch({ kind: 'selectSuit', suitFamily: 'tacticalsuit' });
    const before = store.loadout();

    expect(links.ingest('b.something-elses')).toEqual({ kind: 'ignored' });
    expect(links.ingest('section-3')).toEqual({ kind: 'ignored' });
    expect(store.loadout()).toBe(before);
  });

  it('refuses an altered link without disturbing the loadout on the bench', () => {
    const { links, store } = setup();
    store.dispatch({ kind: 'selectSuit', suitFamily: 'tacticalsuit' });
    links.publish();
    const before = store.loadout();

    const result = links.ingest('e.notaloadoutatall');

    expect(result.kind).toBe('refused');
    expect(store.loadout()).toBe(before);
  });

  it('reads its own published link as nothing to do', () => {
    const { links, store, location } = setup();
    store.dispatch({ kind: 'selectSuit', suitFamily: 'tacticalsuit' });
    links.publish();

    expect(links.ingest(location.fragmentValue)).toEqual({ kind: 'unchanged' });
  });

  it('refuses a fragment longer than any it produces, without decoding it', () => {
    const { links } = setup();
    let decoded = false;
    links.decode = () => {
      decoded = true;
      throw new Error('should not be reached');
    };

    const result = links.ingest(`e.${'x'.repeat(600)}`);

    expect(result.kind === 'refused' && result.failure.code).toBe('tooLong');
    expect(decoded).toBe(false);
  });

  it('takes a stale fragment down when the loadout can no longer be encoded', () => {
    const { links, store, location } = setup();
    store.dispatch({ kind: 'selectSuit', suitFamily: 'tacticalsuit' });
    links.publish();

    links.encode = () => {
      throw new BuildLinkCodecError('unknownIdentity', 'internal detail', {
        slot: 'PrimaryWeapon1',
      });
    };
    links.publish();

    // The loadout is still on the bench; what is gone is a link describing an
    // earlier version of it.
    expect(store.hasLoadout()).toBe(true);
    expect(location.fragmentValue).toBe('');
    expect(links.link().kind).toBe('refused');
  });

  it('carries the mount a refused loadout is about, and leaves the bench alone', () => {
    const { links, store, location, errors, summary } = setup();
    const held = heldLoadout(store);
    links.publish();

    links.encode = () => {
      throw new BuildLinkCodecError('unknownIdentity', 'No handheld weapon is named x.', {
        slot: 'PrimaryWeapon1',
      });
    };
    links.publish();

    const link = links.link();
    expect(link.kind === 'refused' && link.failure).toEqual({
      code: 'unknownIdentity',
      slot: 'PrimaryWeapon1',
    });
    expect(store.loadout()).toEqual(held);
    expect(links.publishedUrl()).toBeNull();
    expect(location.fragmentValue).toBe('');

    // What a refusal withholds is the link. The loadout is still exportable as
    // a payload and as something a Commander can read.
    expect(JSON.parse(JSON.stringify(toStoredLoadout(store.loadout()!)))).toBeTruthy();
    expect(summary.write(store.loadout()!).length).toBeGreaterThan(0);

    const said = errors.describe(
      link.kind === 'refused' ? link.failure : { code: 'tooLong', slot: null },
      'equipment',
    );
    expect(said.message).toBe(BUNDLED_ENGLISH['link.error.equipment.unknownIdentity']);
    expect(said.detail).not.toContain('PrimaryWeapon1');
    expect(said.detail?.length).toBeGreaterThan(0);
  });

  it('says the suit refused it where the refusal is about the suit', () => {
    const { links, store, errors } = setup();
    store.dispatch({ kind: 'selectSuit', suitFamily: 'tacticalsuit' });
    links.publish();

    links.encode = () => {
      throw new BuildLinkCodecError('unknownIdentity', 'No suit is named x.', { slot: 'suit' });
    };
    links.publish();

    const link = links.link();
    expect(link.kind === 'refused' && link.failure.slot).toBe('suit');
    expect(errors.describe({ code: 'unknownIdentity', slot: 'suit' }, 'equipment').detail).toBe(
      BUNDLED_ENGLISH['link.refused.suit'],
    );
  });

  it('leaves a fragment belonging to another tool where a loadout is refused', () => {
    const { links, store, location } = setup();
    store.dispatch({ kind: 'selectSuit', suitFamily: 'tacticalsuit' });
    location.fragmentValue = 'b.somebodyelses';

    links.encode = () => {
      throw new BuildLinkCodecError('unknownIdentity', 'internal detail', { slot: 'suit' });
    };
    links.publish();

    expect(location.fragmentValue).toBe('b.somebodyelses');
    expect(links.link().kind).toBe('refused');
  });

  it('tells the Commander at once about a default loadout it cannot represent', () => {
    // A loadout at its suit's default is in no record by rule and now in no
    // fragment either, so the refusal has to reach the bench rather than wait
    // inside the export layer for a reload that finds nothing (024/FR-002).
    const { links, store, autosave, storage } = setup();
    store.dispatch({ kind: 'selectSuit', suitFamily: 'tacticalsuit' });

    links.encode = () => {
      throw new BuildLinkCodecError('unknownIdentity', 'internal detail', { slot: 'suit' });
    };
    links.publish();
    autosave.flush();

    expect(store.atDefault()).toBe(true);
    expect(store.autosaveRecordId()).toBeNull();
    expect(storage.entries.size).toBe(0);
    expect(store.hasLoadout()).toBe(true);
    expect(links.failure()).toEqual({ code: 'unknownIdentity', slot: 'suit' });
  });
});

describe('the loadout link payload allowlist', () => {
  it('names every bench field a link must never carry', () => {
    expect([...FIELDS_EXCLUDED_FROM_EQUIPMENT_LINKS]).toEqual([
      'selected',
      'source',
      'revision',
      'canUndo',
      'canRedo',
    ]);
  });

  it('leaves the published link unchanged when only the selection moves', () => {
    const { links, store, location } = setup();
    store.dispatch({ kind: 'selectSuit', suitFamily: 'tacticalsuit' });
    links.publish();
    const published = location.fragmentValue;

    store.select('PrimaryWeapon1');
    store.markSaved({ recordId: 'record-42', baseRevisionId: 'revision-7' });
    links.publish();

    expect(location.fragmentValue).toBe(published);
    expect(equipmentLinkPayloadSource(store.loadout())).toBe(store.loadout());
  });
});

describe('a loadout link refusal', () => {
  it('says what a loadout link failed at, not what a build link would have', () => {
    const { errors } = setup();

    for (const code of ['unknownIdentity', 'invalidPayload', 'unsupportedTableVersion'] as const) {
      const ship = errors.describe({ code, slot: null }).message;
      const loadout = errors.describe({ code, slot: null }, 'equipment').message;

      expect(loadout).toBe(BUNDLED_ENGLISH[`link.error.equipment.${code}`]);
      expect(loadout).not.toBe(ship);
    }
  });

  it('says a loadout link is from a newer version in every shipped locale', () => {
    // The key is the one a Commander meets when a link names a table this
    // application does not carry, so a locale missing it would leave the ship
    // wording in its place.
    const key = 'link.error.equipment.unsupportedTableVersion';

    expect(BUNDLED_ENGLISH[key]).toContain('loadout link');
    expect(germanCatalogue[key]).toContain('Loadout-Link');
    expect(germanCatalogue[key]).not.toBe(BUNDLED_ENGLISH[key]);
  });

  it('names the mount in the library’s words, never by its journal key (FR-021)', () => {
    const { errors } = setup();

    const detail =
      errors.describe({ code: 'invalidPayload', slot: 'PrimaryWeapon1' }, 'equipment').detail ?? '';

    expect(detail).not.toContain('PrimaryWeapon1');
    expect(detail.length).toBeGreaterThan(0);
  });

  it('says the suit is what failed where the codec named the suit', () => {
    const { errors } = setup();

    expect(errors.describe({ code: 'invalidPayload', slot: 'suit' }, 'equipment').detail).toBe(
      BUNDLED_ENGLISH['link.refused.suit'],
    );
  });
});

describe('LoadoutSummary', () => {
  it('names the suit, every mount and every fitted modification, in the library’s words', () => {
    const { store, summary } = setup();
    store.dispatch({ kind: 'selectSuit', suitFamily: 'tacticalsuit' });
    store.dispatch({ kind: 'setSuitGrade', grade: 5 });
    store.dispatch({
      kind: 'fitWeapon',
      mount: 'PrimaryWeapon1',
      symbol: 'wpn_m_assaultrifle_plasma_fauto',
    });
    store.dispatch({
      kind: 'fitModification',
      target: 'suit',
      slot: 0,
      symbol: 'suit_increasedshieldregen',
    });

    const written = summary.write(store.loadout()!);
    const lines = written.split('\n');

    expect(lines[0]).toContain('Dominator Suit');
    expect(lines[0]).toContain('G5');
    // A fitted recipe is set in under the item that holds it.
    expect(lines[1]?.startsWith('  ')).toBe(true);
    expect(written).toContain('Manticore Oppressor');
    // Every mount the catalogue offers is accounted for, empty ones included.
    expect(written).toContain(BUNDLED_ENGLISH['equipment.mount.empty']);
    // No symbol ever reaches the summary: it is read by people (constitution VI).
    expect(written).not.toContain('wpn_m_');
    expect(written).not.toContain('suit_');
  });
});
