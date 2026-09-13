import { Location } from '@angular/common';
import { Component, inject } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { Router, provideRouter, withRouterConfig } from '@angular/router';
import { App } from './app';
import { provideLocalization } from './i18n/i18n.providers';
import {
  ApplicationUpdateAdapter,
  type VersionEvent,
} from './platform/browser/application-update.adapter';
import { MemoryStorage, provideMemoryStorage } from './platform/storage/storage.spec-helpers';

/**
 * What an address served, across a takeover that presents no screen.
 *
 * The production lane reads this where it happens, over a document the build
 * wrote (`e2e/prerendered-first-frame.spec.ts`). This file drives the same
 * sequence without a browser, because two of the outcomes the requirement
 * covers have no browser instance at all: the routes configure one redirect and
 * no guard, so a cancellation and a handover can only be produced here
 * (`openspec/changes/archive/023-served-document-held/design.md`, "The boundary is the
 * first screen presented, not the first navigation").
 *
 * The mechanism differs from the browser's and the outcome does not. There the
 * served nodes go because hydration claims the nodes a screen renders and no
 * screen rendered; here there was never a hydration to claim them. Either way
 * nothing holds what the address served, and the frame's `main` is empty when
 * the navigation ends — which is what these tests read.
 */

/** A screen, standing in for one the build would split into its own chunk. */
@Component({ selector: 'ednb-a-screen', template: '<h1>A screen</h1>' })
class AScreen {}

@Component({ selector: 'ednb-another-screen', template: '<h1>Another screen</h1>' })
class AnotherScreen {}

/** The worker port, reporting nothing. */
class SilentUpdates {
  available = false;
  restartable = false;
  onVersionEvent(_listener: (event: VersionEvent) => void): () => void {
    return () => {};
  }
  async check(): Promise<void> {}
  async activate(): Promise<void> {}
  reload(): boolean {
    return false;
  }
  every(): () => void {
    return () => {};
  }
  after(_milliseconds: number, _run: () => void): () => void {
    return () => {};
  }
}

/**
 * The words the served document carries, which no part of the shell says.
 *
 * A subject rather than a sentence: the assertion is that the content the
 * address answered with is still standing, and a word the banner also carries
 * would pass on an empty `main` inside a shell.
 */
const SERVED_SUBJECT = 'Anaconda';

/**
 * The document as the address served it, before anything has taken over.
 *
 * One `main`, because that is what the landmark rules allow and what the
 * adapter reads. Returns what takes it back out: the environment is shared with
 * every other file in the run.
 */
function serveDocument(): () => void {
  const served = document.createElement('main');
  served.className = 'frame__main';
  served.innerHTML = `<h1>Ships</h1><ul><li>${SERVED_SUBJECT}</li></ul>`;
  document.body.prepend(served);
  return () => served.remove();
}

describe('App and a first navigation that presents no screen', () => {
  let refuse: () => void;
  let unserve: () => void;

  beforeEach(async () => {
    unserve = serveDocument();
    const held = new Promise<typeof AnotherScreen>((_resolve, reject) => {
      refuse = () => reject(new Error('The chunk could not be fetched.'));
    });
    held.catch(() => {});

    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [
        provideLocalization(),
        provideRouter(
          [
            { path: '', pathMatch: 'full', component: AScreen },
            { path: 'held', loadComponent: () => held },
            // The application declares no guard, so a cancellation with nothing
            // taking over has no instance in its own route table. It is declared
            // here because the outcome is one the requirement covers and one a
            // route added later would reach (023/FR-001, 018/FR-005).
            { path: 'refused', canActivate: [() => false], component: AnotherScreen },
            // And a redirect, for the same reason: the wildcard is the only one
            // the application declares, and an address it catches served the
            // shell rather than a document, so no lane can reach the pairing at
            // an address with something to hold (design.md, "The boundary is the
            // first screen presented, not the first navigation").
            {
              path: 'elsewhere',
              canActivate: [() => inject(Router).parseUrl('/held')],
              component: AnotherScreen,
            },
            { path: '**', redirectTo: '' },
          ],
          // A navigation that fails answers with `false` rather than by
          // rejecting. The router starts the replacement in a handover itself,
          // so where that replacement is the one that fails there is no promise
          // a test can hold — and a rejection nobody is holding is an unhandled
          // one, which this run reports as an error whatever the assertions
          // said. What is read here is the router's events, and this changes
          // none of them.
          withRouterConfig({ resolveNavigationPromiseOnError: true }),
        ),
        { provide: ApplicationUpdateAdapter, useValue: new SilentUpdates() },
        ...provideMemoryStorage(new MemoryStorage(), new MemoryStorage()),
      ],
    }).compileComponents();
  });

  afterEach(() => {
    TestBed.inject(Location).go('/');
    unserve();
  });

  /** What the frame's own `main` is holding, ignoring how it is typeset. */
  const mainText = (fixture: ComponentFixture<App>): string =>
    ((fixture.nativeElement as HTMLElement).querySelector('main')?.textContent ?? '').replace(
      /\s+/g,
      ' ',
    );

  it('keeps the Commander on what the address served when the first navigation fails', async () => {
    // The whole of the defect, in the smallest sequence that shows it: the
    // document is standing, the session's first navigation asks for a screen
    // whose code never arrives, and what the Commander keeps is what they were
    // given (023/FR-001).
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();

    const navigation = TestBed.inject(Router).navigateByUrl('/held');
    refuse();
    await navigation;
    fixture.detectChanges();

    expect(mainText(fixture)).toContain(SERVED_SUBJECT);
  });

  it('keeps them on it when that navigation is cancelled with nothing taking over', async () => {
    // The outcome that separates counting screens presented from counting
    // errors raised: a guard refuses, nothing takes over, and the Commander is
    // left on what they were given with nothing said over it — a cancellation
    // is not a failure and is stated as nothing (018/FR-007). An
    // implementation that put the copy back only on `NavigationError` passes
    // every other reading in this change and leaves this Commander on an empty
    // shell.
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();

    await TestBed.inject(Router).navigateByUrl('/refused');
    fixture.detectChanges();

    expect(mainText(fixture)).toContain(SERVED_SUBJECT);
    const element = fixture.nativeElement as HTMLElement;

    // The frame's status region, which is drawn only where a notice stands, so
    // its absence is the whole of "nothing is said". Reading every notice in
    // the shell instead would read past the page: the layers mounted beside the
    // frame carry notices of their own — the account states what it is doing —
    // and each sits inside a closed dialog, which draws nothing and says
    // nothing to a Commander on the screen behind it (018/FR-007).
    expect(element.querySelector('.frame__status')).toBeNull();
  });

  it('lets the screen a navigation presents replace it', async () => {
    // The hold's end, and the only thing that ends it. A screen the Commander
    // can use is what the served document was standing in for (023/FR-001).
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();

    await TestBed.inject(Router).navigateByUrl('/');
    fixture.detectChanges();

    expect(mainText(fixture)).toContain('A screen');
    expect(mainText(fixture)).not.toContain(SERVED_SUBJECT);
    const element = fixture.nativeElement as HTMLElement;

    expect(element.querySelector('.frame__held')).toBeNull();
  });

  it('puts nothing back over a screen when a later navigation fails', async () => {
    // The other side of the same boundary. Once a screen is presented there is
    // nothing left to put back, and a document the Commander left behind
    // landing over the screen they are using would take that screen away to
    // answer a failure (023/FR-001, 018/FR-007).
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await TestBed.inject(Router).navigateByUrl('/');
    fixture.detectChanges();

    const navigation = TestBed.inject(Router).navigateByUrl('/held');
    refuse();
    await navigation;
    fixture.detectChanges();

    expect(mainText(fixture)).toContain('A screen');
    expect(mainText(fixture)).not.toContain(SERVED_SUBJECT);
  });

  it('keeps them on it when a first navigation hands over and its replacement fails', async () => {
    // The pair counts as one presentation. A first navigation cancelled on its
    // way to a replacement has presented nothing, and where that replacement
    // ends without a screen either, the Commander is owed what the address
    // served — though the navigation that ended is not the first one. A rule
    // written about the session's first navigation would miss exactly this
    // (023/FR-001).
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();

    const navigation = TestBed.inject(Router).navigateByUrl('/elsewhere');
    refuse();
    await navigation;
    fixture.detectChanges();

    expect(mainText(fixture)).toContain(SERVED_SUBJECT);
  });
});
