import { TestBed } from '@angular/core/testing';
import { ShipLoadout } from '@elite-dangerous-almanac/core/ships/ship-loadout';
import { provideLocalization } from '../../i18n/i18n.providers';
import { provideIsolatedLocaleEnvironment } from '../../i18n/testing/localization-harness';
import { HistoryLocationAdapter } from '../../platform/browser/history-location.adapter';
import { ActiveBuildStore } from '../active-build/active-build.store';
import { BuildLinkCoordinator } from './build-link.coordinator';
import { FragmentPublisher } from './fragment-publisher';

/**
 * What the address does while a build's link is published.
 *
 * Publication is asynchronous — one lazily imported codec chunk, then an encode
 * — and anything that moves history inside that window takes the fragment with
 * it. The publisher is the only part of the application that knows a build link
 * was published at all, so keeping the address carrying one is its work and is
 * asserted here (022/FR-001).
 *
 * The window is held open through the injectable `encode`, so every case below
 * is deterministic rather than raced against a real codec.
 */

/** A promise this test resolves by hand. */
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolveIt) => {
    resolve = resolveIt;
  });
  return { promise, resolve };
}

function setup() {
  // One window serves every test in this file, so the address starts at the
  // document with nothing on it rather than wherever the last test left it.
  const workspace = `${window.location.pathname}${window.location.search}`;
  window.history.replaceState(null, '', workspace);

  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [provideLocalization(), ...provideIsolatedLocaleEnvironment()],
  });
  return {
    workspace,
    publisher: TestBed.inject(FragmentPublisher),
    ingress: TestBed.inject(BuildLinkCoordinator),
    active: TestBed.inject(ActiveBuildStore),
    location: TestBed.inject(HistoryLocationAdapter),
  };
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

/** An encode that answers at once, with the values this test chose in order. */
function encodes(publisher: FragmentPublisher, ...fragments: readonly string[]): void {
  let next = 0;
  publisher.encode = () =>
    Promise.resolve(fragments[Math.min(next++, fragments.length - 1)] as string);
}

/**
 * Runs the effects, lets the encode they started resolve, and runs them again.
 *
 * Publication spans an await, so one pass is never the whole of it: the effect
 * starts an encode, and what the encode does to the address is a pass later.
 */
async function settle(): Promise<void> {
  for (let pass = 0; pass < 3; pass += 1) {
    TestBed.tick();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  TestBed.tick();
}

/** A browser's back across a fragment: `popstate` first, then `hashchange`. */
async function goBack(): Promise<void> {
  const moved = new Promise<void>((resolve) => {
    window.addEventListener('hashchange', () => resolve(), { once: true });
  });
  window.history.back();
  await moved;
  await settle();
}

describe('a published link the address lost', () => {
  it('is stated again where the publication landed on an entry the Commander left', async () => {
    const { publisher, active, location, workspace } = setup();
    const held = deferred<string>();
    publisher.encode = () => held.promise;
    const stop = publisher.start();
    commitAnaconda(active);
    TestBed.tick();

    // The window the defect lives in. The codec arrives as a lazily imported
    // chunk, so the encode is still running when the saved builds push their
    // own entry — at the same address, which is why the publication's document
    // guard passes and the fragment lands on the layer's entry.
    window.history.pushState(null, '', workspace);
    held.resolve('b.published');
    await settle();
    expect(location.fragment()).toBe('b.published');

    // Closing the layer goes back, to the entry that never received it.
    await goBack();

    expect(location.fragment()).toBe('b.published');
    expect(window.location.hash).toBe('#b.published');
    stop();
  });

  it('is stated again without adding a history entry', async () => {
    const { publisher, active, location, workspace } = setup();
    const held = deferred<string>();
    publisher.encode = () => held.promise;
    const stop = publisher.start();
    commitAnaconda(active);
    TestBed.tick();
    window.history.pushState(null, '', workspace);
    held.resolve('b.published');
    await settle();

    // Asked of the mechanism rather than of `history.length`, which cannot
    // answer here: back leaves the address on an entry with one ahead of it, so
    // a push would truncate that entry and append its own and the count would
    // not move. A restoration puts back what the address already claimed to
    // hold, so it is not an edit and does not lengthen a Commander's history.
    const pushed = vi.spyOn(window.history, 'pushState');
    try {
      await goBack();

      expect(pushed).not.toHaveBeenCalled();
      expect(location.fragment()).toBe('b.published');
    } finally {
      pushed.mockRestore();
      stop();
    }
  });

  it('leaves the build that is open exactly as it is', async () => {
    const { publisher, ingress, active, location } = setup();
    encodes(publisher, 'b.published');
    const decode = vi.fn(() => Promise.reject(new Error('the codec refused')));
    ingress.decode = decode as unknown as typeof ingress.decode;
    const stop = publisher.start();
    const listening = ingress.listen();
    commitAnaconda(active);
    await settle();
    expect(location.fragment()).toBe('b.published');

    // Another build link arrives and is refused. The build on the screen is
    // untouched, and the fragment the ingress holds as accounted for is that
    // link rather than the published one — which is what makes the marking
    // below the only thing standing between a restoration and a decode.
    location.replaceFragment('b.other');
    await settle();
    const revision = active.revision();
    const fingerprint = active.fingerprint();
    const refusal = ingress.failure();
    expect(refusal).not.toBeNull();
    decode.mockClear();

    location.replaceFragment(null);
    await settle();

    // Read back as an arrival the restored link would be decoded and offered
    // for a build it already describes. `markPublished` is what stops it, and
    // the decode never running is the whole of what that means.
    expect(decode).not.toHaveBeenCalled();
    expect(active.revision()).toBe(revision);
    expect(active.fingerprint()).toBe(fingerprint);
    expect(ingress.failure()).toBe(refusal);
    expect(location.fragment()).toBe('b.published');
    listening();
    stop();
  });
});

describe('a fragment that is not the published link', () => {
  it('leaves a loadout link where it stands rather than restoring over it', async () => {
    const { publisher, active, location } = setup();
    encodes(publisher, 'b.published');
    const stop = publisher.start();
    commitAnaconda(active);
    await settle();
    expect(location.fragment()).toBe('b.published');

    // The bench's own published link, at the document the build link was
    // published onto: a fragment this application owns and did write, which is
    // the case telling a fragment apart by ownership would have licensed the
    // ship builder to overwrite. Emptiness is the test, so this stands.
    location.replaceFragment('e.loadout');
    await settle();

    expect(location.fragment()).toBe('e.loadout');
    stop();
  });

  it('leaves another build link alone and lets the ingress read it', async () => {
    const { publisher, ingress, active, location } = setup();
    encodes(publisher, 'b.published', 'b.adder');
    ingress.decode = () => Promise.resolve(ShipLoadout.default('Adder'));
    const stop = publisher.start();
    const listening = ingress.listen();
    commitAnaconda(active);
    await settle();
    expect(location.fragment()).toBe('b.published');

    location.replaceFragment('b.incoming');
    TestBed.tick();

    // Read before the decode resolves, which is the moment a widened trigger
    // would have written the open build back over the incoming one. A build
    // link could then never be opened from a running workspace.
    expect(location.fragment()).toBe('b.incoming');

    await settle();
    expect(active.loadout()?.shipSymbol).toBe('Adder');
    listening();
    stop();
  });
});

describe('the bounds on stating a link into the address', () => {
  it('records nothing to restore when the Commander left while it encoded', async () => {
    const { publisher, active, location, workspace } = setup();
    const held = deferred<string>();
    publisher.encode = () => held.promise;
    const stop = publisher.start();
    commitAnaconda(active);
    TestBed.tick();

    // The publication's own bound: moving the document between the encode and
    // its resolution makes the publication discard itself.
    window.history.replaceState(null, '', '/ships');
    held.resolve('b.published');
    await settle();

    try {
      expect(location.fragment()).toBe('');
      expect(window.location.hash).toBe('');
      expect(active.link().kind).toBe('encoding');
    } finally {
      window.history.replaceState(null, '', workspace);
      stop();
    }
  });

  it('states nothing onto a document other than the one it published onto', async () => {
    const { publisher, active, location, workspace } = setup();
    encodes(publisher, 'b.published');
    const stop = publisher.start();
    commitAnaconda(active);
    await settle();
    expect(location.fragment()).toBe('b.published');

    // The restoration's own bound. The address moves to another screen and
    // carries no fragment; the adapter learns of a fragment that moved from
    // `hashchange`, and the traversal itself is the browser's, not this unit's.
    window.history.replaceState(null, '', '/ships');
    window.dispatchEvent(new Event('hashchange'));
    await settle();

    try {
      // A Commander who published a link and then walked away does not find it
      // on the screen they walked to.
      expect(location.fragment()).toBe('');
      expect(window.location.hash).toBe('');
    } finally {
      window.history.replaceState(null, '', workspace);
      stop();
    }
  });

  it('states nothing while no build has been opened', async () => {
    const { publisher, location } = setup();
    encodes(publisher, 'b.published');
    const stop = publisher.start();

    await settle();

    expect(location.fragment()).toBe('');
    stop();
  });

  it('states nothing after the record the workspace autosaves into is deleted', async () => {
    const { publisher, active, location } = setup();
    encodes(publisher, 'b.published');
    const stop = publisher.start();
    commitAnaconda(active);
    active.setAutosaveRecordId('record-42');
    await settle();
    expect(location.fragment()).toBe('b.published');

    // Deleting that record clears the active build to the no-build state
    // (001/FR-009). The publisher takes the fragment down with it, so the
    // address goes empty at the document it published onto — which is the
    // shape of the defect, on a build that is gone.
    expect(active.clearIfHolding('record-42')).toBe(true);
    await settle();

    // An address naming a build the workspace no longer holds is the failure
    // this case guards.
    expect(location.fragment()).toBe('');
    expect(active.link()).toEqual({ kind: 'absent' });
    stop();
  });

  it('states nothing where the encode was refused', async () => {
    const { publisher, active, location } = setup();
    encodes(publisher, 'b.published');
    const stop = publisher.start();
    commitAnaconda(active);
    await settle();
    expect(location.fragment()).toBe('b.published');

    // A refusal removes the stale fragment with `replaceState` (001 build-link
    // contract, "Active-edit synchronization"). The watcher must not undo it.
    publisher.encode = () => Promise.reject(new Error('the codec refused'));
    active.touch();
    await settle();

    expect(active.link().kind).toBe('refused');
    expect(location.fragment()).toBe('');
    stop();
  });
});
