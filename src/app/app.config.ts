import {
  ApplicationConfig,
  inject,
  isDevMode,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
} from '@angular/core';
import {
  TitleStrategy,
  type RouterFeatures,
  provideRouter,
  withComponentInputBinding,
  withEnabledBlockingInitialNavigation,
} from '@angular/router';
import { provideServiceWorker } from '@angular/service-worker';
import { provideClientHydration, withEventReplay } from '@angular/platform-browser';

import { routes } from './app.routes';
import { RetentionService } from './application/build-library/retention.service';
import { NavigationWaitingStore } from './application/navigation/navigation-waiting.store';
import { ServedDocumentStore } from './application/navigation/served-document.store';
import { RecordSynchronisationLoader } from './application/synchronisation/record-synchronisation.loader';
import { RouteTitleStrategy } from './features/shared/route-title.strategy';
import { provideLocalization } from './i18n/i18n.providers';
import { RenderingTarget } from './platform/browser/rendering-target';
import { WEB_STORAGE_PROVIDERS } from './platform/storage/web-storage.adapter';

/**
 * The router features that exist only where a document was rendered.
 *
 * Read as a function rather than written inline so the dev-only branch is a
 * statement about the environment, not a ternary buried in a provider list.
 */
function takeoverRouting(): RouterFeatures[] {
  return isDevMode() ? [] : [withEnabledBlockingInitialNavigation()];
}

/**
 * The store that holds what the address served, created before the router can
 * remove it.
 *
 * Creating it is what takes the copy: it injects `ServedContentAdapter`, whose
 * constructor reads the document as the address served it.
 *
 * Named rather than written inline because its position is the whole
 * mechanism, and a position stated only in a comment is one a later
 * initializer can take without anything noticing: `app.config.spec.ts` reads
 * this against `ROUTING_PROVIDERS` below and fails if the two ever swap.
 *
 * Initializers run in the order they are provided, and the blocking initial
 * navigation is started from one of the router's own — so the moment the
 * document still holds what the address served, with nothing claimed and
 * nothing removed, is here (023/FR-001).
 *
 * Not run in the build's renderer, and this is the same ruling the other
 * browser-only initializers carry: there is nothing served to a Commander at
 * build time, and the document the renderer is writing is not one anybody is
 * reading (015/FR-001).
 *
 * What the guard leaves out is this initializer, not the store: the shell
 * injects it wherever it is built, so the renderer constructs it too. There the
 * document has no `main` yet, so it holds nothing — and the renderer runs one
 * navigation, which presents a screen (015/FR-001).
 */
export const SERVED_DOCUMENT_INITIALIZER = provideAppInitializer(() => {
  if (inject(RenderingTarget).isBrowser) {
    inject(ServedDocumentStore);
  }
});

/**
 * The router, whose initial navigation is the takeover itself.
 *
 * Named for the same reason as the initializer above: this is what everything
 * that must happen before the takeover has to be registered before.
 */
export const ROUTING_PROVIDERS = provideRouter(
  routes,
  withComponentInputBinding(),
  ...takeoverRouting(),
);

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    // Take over the document the build rendered rather than replacing it.
    //
    // Without this, Angular treats a generated document as debris: it empties
    // `<app-root>` and renders the application into it from nothing. Measured
    // on `/ships/Anaconda`, that is the hull's figures painted at 39ms, gone at
    // 181ms, and back at 1236ms — a second of the page a Commander was already
    // reading being blank, which is exactly the content that "disappears and
    // returns" that 015/FR-009 forbids and SC-003 measures.
    //
    // Hydration walks the rendered DOM instead and adopts it, so the nodes a
    // Commander is looking at are the nodes the application goes on to own.
    //
    // `withEventReplay()` is the other half. A generated document paints every
    // control before any script has run, so a Commander can press one in that
    // window — and without replay the press lands on markup with no listener
    // behind it and nothing happens at all. That is a control that looks
    // interactive and is not, which is a worse first frame than the empty shell
    // this feature replaced. Replay records those presses and delivers them
    // once the application owns the node.
    provideClientHydration(withEventReplay()),
    // The store that watches navigations, created before the first one runs.
    //
    // It has to be here rather than left to the shell component that reads it.
    // The blocking initial navigation below is started from an application
    // initializer and releases bootstrap part-way through, so the router's
    // first `NavigationStart` — and, where the first screen's code never
    // arrives, its `NavigationError` — is raised before any component exists.
    // A store created with the shell would miss them: it would take the press
    // after the arrival for the session's first navigation and draw nothing
    // over it, and a first navigation that failed would be stated to nobody
    // (018/FR-001, FR-004, FR-007).
    //
    // The order is the whole point, so it is stated by position: this
    // initializer is registered before `provideRouter` below, and initializers
    // run in the order they are provided.
    //
    // The renderer does not need it this early. It runs one navigation and has
    // no Commander to state a wait to (015/FR-001), and the shell it builds
    // injects the store anyway — what the guard leaves out is the initializer,
    // not the store.
    provideAppInitializer(() => {
      if (inject(RenderingTarget).isBrowser) {
        inject(NavigationWaitingStore);
      }
    }),
    SERVED_DOCUMENT_INITIALIZER,
    // Route parameters are bound to component inputs, so a screen takes its
    // subject as an input rather than reaching into the router for it.
    //
    // The initial navigation blocks bootstrap, which is what lets the takeover
    // above adopt a screen instead of rebuilding it. Every screen here is behind
    // a lazily loaded route, so without this the router reaches the outlet
    // before that route's chunk has arrived, throws away the document's copy of
    // the screen and draws its own a moment later. Measured on
    // `/ships/Anaconda`: the whole inspector — manufacturer, speed, shield, hull
    // mass, every hardpoint count — left the page for one frame and came back,
    // and on a phone the hull sheet was replaced by the whole catalogue, 1029
    // pixels tall becoming 4857. That is the content that "disappears and
    // returns" 015/FR-009 forbids and SC-003 measures.
    //
    // Not in development, and this is the same ruling as the service worker
    // below rather than a new one: there is no rendered document on a
    // development server, so there is nothing for a blocking navigation to
    // protect and Angular says so — NG05001 calls hydration and enabled
    // blocking initial navigation a contradiction, which is exactly what they
    // are where nothing was rendered to hydrate. The warning is `ngDevMode`
    // only; what ships is the blocking navigation, because what ships has 50
    // documents to adopt.
    ROUTING_PROVIDERS,
    // Route titles are message keys resolved in the committed locale, so the
    // tab's language cannot lag the page's.
    { provide: TitleStrategy, useClass: RouteTitleStrategy },
    provideLocalization(),
    // Every browser store is reached through a port with an exception
    // boundary, so a blocked or full one changes persistence and nothing else.
    ...WEB_STORAGE_PROVIDERS,
    // One of the expiry's two moments; the other is every listing read. An
    // initializer rather than a timer, and rather than something the shell
    // component does: a record that outlives its deadline until the next start
    // costs nothing, and a row vanishing under a Commander reading the library
    // costs trust (FR-013, ruled 2026-08-25).
    //
    // Not in the build's renderer. What the sweep removes are records from a
    // browser's own store, and the renderer has none: there is no Commander at
    // build time and no library to sweep (015/FR-001).
    provideAppInitializer(() => {
      if (inject(RenderingTarget).isBrowser) {
        inject(RetentionService).sweep();
      }
    }),
    // The account's records, exchanging for as long as the application runs.
    //
    // An initializer rather than something a screen does, for two reasons. The
    // first merge belongs to the account becoming signed in rather than to a
    // library being opened, so a Commander who signs in from the shipyard has
    // their records merged from there (024/FR-008). And the protection a live
    // page owes its open records is owed while the page is live, not while a
    // particular screen is drawn (024/FR-025).
    //
    // Through the loader rather than the coordinator itself, which is what
    // keeps the rules for an account's records out of the first payload of
    // every page: the engine is fetched for the account the session belongs to,
    // from whatever page the Commander signed in on, and an anonymous browser
    // never fetches it at all.
    //
    // Not in the build's renderer, for the reason the sweep gives: there is no
    // Commander at build time, no session and no record to protect
    // (015/FR-001).
    provideAppInitializer(() => {
      if (inject(RenderingTarget).isBrowser) {
        inject(RecordSynchronisationLoader).start();
      }
    }),
    // The application's only service worker, and its only cache owner.
    //
    // It exists for one reason: complete English and the shell must be readable
    // with no network, and a German catalogue that has already been opened once
    // must stay readable after that (FR-019). Everything it caches is a
    // same-origin static asset; it never fetches another origin and it never
    // caches a build or any Commander data (constitution I).
    //
    // Registered immediately rather than on application stability, so the
    // controller exists at a predictable point — the offline journey has to be
    // able to say "the worker is in control" without waiting on a heuristic.
    provideServiceWorker('ngsw-worker.js', {
      enabled: !isDevMode(),
      registrationStrategy: 'registerImmediately',
    }),
  ],
};
