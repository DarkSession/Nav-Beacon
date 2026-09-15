import { TestBed } from '@angular/core/testing';
import { ShipLoadout } from '@elite-dangerous-almanac/core/ships/ship-loadout';
import { BuildLinkCodecError } from '../../domain/build-link/build-link-codec-error';
import { provideLocalization } from '../../i18n/i18n.providers';
import { provideIsolatedLocaleEnvironment } from '../../i18n/testing/localization-harness';
import { HistoryLocationAdapter } from '../../platform/browser/history-location.adapter';
import { ActiveBuildStore } from '../active-build/active-build.store';
import { BuildLinkCoordinator } from './build-link.coordinator';
import { FragmentPublisher } from './fragment-publisher';
import { MAX_BUILD_LINK_LENGTH } from './fragment-recognizer';
import { suppliedFit } from '../../domain/ships/build/supplied-fit';

/**
 * The codec, replaced by something whose timing this test controls.
 *
 * The real codec is exercised end to end in `build-link.spec.ts`. What cannot
 * be shown with it is a decode that finishes at an inconvenient moment or an
 * encode that refuses — both of which are the difference between "a link failed"
 * and "a Commander lost their build".
 */
const decode = vi.fn();
const encode = vi.fn();

/** A promise this test resolves by hand. */
function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolveIt, rejectIt) => {
    resolve = resolveIt;
    reject = rejectIt;
  });
  return { promise, resolve, reject };
}

function setup() {
  decode.mockReset();
  encode.mockReset();
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [provideLocalization(), ...provideIsolatedLocaleEnvironment()],
  });
  const ingress = TestBed.inject(BuildLinkCoordinator);
  const publisher = TestBed.inject(FragmentPublisher);
  ingress.decode = decode as unknown as typeof ingress.decode;
  publisher.encode = encode as unknown as typeof publisher.encode;
  return {
    ingress,
    publisher,
    active: TestBed.inject(ActiveBuildStore),
    location: TestBed.inject(HistoryLocationAdapter),
  };
}

function commitAnaconda(active: ActiveBuildStore): void {
  active.commit({
    loadout: ShipLoadout.default('Anaconda'),
    suppliedFit: suppliedFit(ShipLoadout.default('Anaconda').shipSymbol),
    hullName: 'Anaconda',
    provenance: 'stock',
    sourceNamed: null,
    autosaveRecordId: null,
    baseline: null,
  });
}

describe('an incoming link that arrives late', () => {
  it('cannot replace the build a newer navigation opened', async () => {
    const { ingress, active } = setup();
    const slow = deferred<ShipLoadout>();
    decode.mockImplementationOnce(() => slow.promise);
    decode.mockImplementationOnce(() => Promise.resolve(ShipLoadout.default('Adder')));

    const first = ingress.ingest('b.slow');
    const second = await ingress.ingest('b.fast');
    slow.resolve(ShipLoadout.default('Anaconda'));
    await first;

    expect(second.kind).toBe('replacement');
    expect(active.loadout()?.shipSymbol).toBe('Adder');
  });

  it('cannot report its failure over the build that replaced it', async () => {
    const { ingress, active } = setup();
    const slow = deferred<ShipLoadout>();
    decode.mockImplementationOnce(() => slow.promise);
    decode.mockImplementationOnce(() => Promise.resolve(ShipLoadout.default('Adder')));

    const first = ingress.ingest('b.slow');
    await ingress.ingest('b.fast');
    slow.reject(new BuildLinkCodecError('integrityCheckFailed', 'internal detail'));
    await first;

    // A refusal about an abandoned link, shown beneath the build that succeeded,
    // would say the Commander's current build is broken. It is not.
    expect(ingress.failure()).toBeNull();
    expect(active.loadout()?.shipSymbol).toBe('Adder');
  });
});

describe('an encode that is refused', () => {
  it('keeps the build, clears the stale link and names the mount', async () => {
    const { publisher, active, location } = setup();
    commitAnaconda(active);
    encode.mockResolvedValueOnce('b.published');
    await publisher.publish();
    expect(location.fragment()).toBe('b.published');

    encode.mockRejectedValueOnce(
      new BuildLinkCodecError('unknownIdentity', 'internal detail', { slot: 'Slot03_Size6' }),
    );
    active.touch();
    await publisher.publish();

    expect(active.link()).toEqual({
      kind: 'refused',
      code: 'unknownIdentity',
      slot: 'Slot03_Size6',
    });
    // The stale fragment described the previous version, so it goes; the build
    // itself is untouched and still editable.
    expect(location.fragment()).toBe('');
    expect(active.loadout()?.shipSymbol).toBe('Anaconda');
  });

  it('refuses a value that would exceed the published bound rather than publishing it', async () => {
    const { publisher, active, location } = setup();
    commitAnaconda(active);
    encode.mockResolvedValueOnce('b.' + 'x'.repeat(MAX_BUILD_LINK_LENGTH));

    await publisher.publish();

    expect(active.link()).toEqual({ kind: 'refused', code: 'tooLong', slot: null });
    expect(location.fragment()).toBe('');
  });

  it('leaves an unrelated fragment alone when it refuses', async () => {
    const { publisher, active, location } = setup();
    location.replaceFragment('section-2');
    commitAnaconda(active);
    encode.mockRejectedValueOnce(new BuildLinkCodecError('invalidPayload', 'internal detail'));

    await publisher.publish();

    expect(location.fragment()).toBe('section-2');
  });

  it('discards an encode that finished after a newer edit started one', async () => {
    const { publisher, active } = setup();
    commitAnaconda(active);
    const slow = deferred<string>();
    encode.mockImplementationOnce(() => slow.promise);
    encode.mockImplementationOnce(() => Promise.resolve('b.newest'));

    const first = publisher.publish();
    active.touch();
    await publisher.publish();
    slow.resolve('b.stale');
    await first;

    expect(active.link()).toEqual({ kind: 'published', fragment: 'b.newest', revision: 2 });
  });
});

describe('a link the installed package cannot fly', () => {
  it('refuses a hull the package no longer carries, keeping the active build', async () => {
    const { ingress, active } = setup();
    commitAnaconda(active);
    const before = active.fingerprint();
    // The codec table and the package are versioned separately, so a table that
    // still carries a dropped hull is possible. The package is authoritative.
    decode.mockResolvedValueOnce({ shipSymbol: 'RetiredHull', slots: () => [] });

    await ingress.ingest('b.retired');

    expect(ingress.failure()).toEqual({ code: 'unknownIdentity', slot: null });
    expect(active.loadout()?.shipSymbol).toBe('Anaconda');
    expect(active.fingerprint()).toBe(before);
  });

  it('refuses a rebuild that arrived with an empty fixed mount, naming it', async () => {
    const { ingress, active } = setup();
    const stripped = ShipLoadout.default('Anaconda');
    decode.mockResolvedValueOnce({
      shipSymbol: stripped.shipSymbol,
      slots: (kind: string) => (kind === 'core' ? [{ key: 'PowerPlant', module: null }] : []),
    });

    await ingress.ingest('b.stripped');

    // Not repaired and not reported as a defaulting: the package's own
    // construction is the only thing allowed to populate a fixed mount.
    expect(ingress.failure()).toEqual({ code: 'reconstructionFailed', slot: 'PowerPlant' });
    expect(active.loadout()).toBeNull();
  });
});
