import { BrowserPlatformLocation, Location, PlatformLocation } from '@angular/common';
import { TestBed } from '@angular/core/testing';
import { HistoryLocationAdapter } from './history-location.adapter';

function adapter(): HistoryLocationAdapter {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({});
  return TestBed.inject(HistoryLocationAdapter);
}

/**
 * An adapter over the history the browser itself keeps.
 *
 * The test environment hands `Location` a history of its own, which writes
 * nothing to `window.location`. That is enough for every other case in this
 * file. It is not enough for the router case, where the question is what the
 * address carries after the router has written to it, so the router has to
 * write to the address the adapter reads.
 */
function adapterOverTheBrowsersHistory(): HistoryLocationAdapter {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [{ provide: PlatformLocation, useClass: BrowserPlatformLocation }],
  });
  return TestBed.inject(HistoryLocationAdapter);
}

describe('HistoryLocationAdapter', () => {
  beforeEach(() => {
    history.replaceState(null, '', location.pathname + location.search);
  });

  it('reads the current fragment without its leading hash', () => {
    history.replaceState(null, '', `${location.pathname}#b.abc`);

    expect(adapter().fragment()).toBe('b.abc');
  });

  it('reports an empty fragment when the URL has none', () => {
    expect(adapter().fragment()).toBe('');
  });

  it('replaces the fragment without adding a history entry', () => {
    const port = adapter();
    const before = history.length;

    port.replaceFragment('b.xyz');

    expect(location.hash).toBe('#b.xyz');
    expect(port.fragment()).toBe('b.xyz');
    expect(history.length).toBe(before);
  });

  it('preserves the path and query when replacing', () => {
    history.replaceState(null, '', `${location.pathname}?keep=1`);
    const port = adapter();

    port.replaceFragment('b.xyz');

    expect(location.search).toBe('?keep=1');
    expect(location.pathname).toBe(location.pathname);
  });

  it('removes the fragment entirely when given null', () => {
    const port = adapter();
    port.replaceFragment('b.stale');

    port.replaceFragment(null);

    expect(location.hash).toBe('');
    expect(port.fragment()).toBe('');
  });

  it('follows a hashchange the Commander caused', () => {
    const port = adapter();

    history.replaceState(null, '', `${location.pathname}#b.pasted`);
    window.dispatchEvent(new HashChangeEvent('hashchange'));

    expect(port.fragment()).toBe('b.pasted');
  });

  it('follows the address the router rewrites under it', () => {
    const port = adapterOverTheBrowsersHistory();
    port.replaceFragment('b.published');

    // A router restores the address it recorded for a history entry, and a
    // fragment written straight onto `history` is in no record of its. It writes
    // through Angular's `Location`, and that fires no `hashchange` — so an
    // adapter listening for one alone would go on reporting a fragment the
    // address stopped carrying, and nothing reading it could tell.
    TestBed.inject(Location).replaceState(window.location.pathname);

    expect(window.location.hash).toBe('');
    expect(port.fragment()).toBe('');
  });

  it('builds the canonical link for the current document', () => {
    const port = adapter();

    expect(port.urlWithFragment('b.abc')).toBe(
      `${location.origin}${location.pathname}${location.search}#b.abc`,
    );
  });
});
