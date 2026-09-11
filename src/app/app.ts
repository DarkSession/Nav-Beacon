import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { Location } from '@angular/common';
import { NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { ApplicationUpdateStore } from './application/updates/application-update.store';
import { ActiveBuildStore } from './application/active-build/active-build.store';
import { MessageService } from './i18n/message.service';
import {
  AppNavigation,
  EQUIPMENT_REENTRY_ACTION,
  NAVIGATION_ROUTES,
} from './features/shared/app-navigation';
import { BuildLibraryPage } from './features/build-library/build-library.page';
import { LibraryPresence } from './features/build-library/library-presence';
import { ScreenChrome, WORKSPACE_EXPORT_ACTION } from './features/shared/screen-chrome';
import { LocaleStore } from './i18n/locale.store';
import { SlefStore } from './application/slef/slef.store';
import { ExportDialog } from './features/slef/export-build-layer/export.dialog';
import { ImportDialog } from './features/slef/import-build-layer/import.dialog';
import { AnnouncementService } from './ui/announcements/announcement.service';
import {
  AppFrame,
  type NavigationEntry,
  type ToolEntry,
  type ShellAction,
  type ShellStatus,
} from './ui/components/app-frame/app-frame';
import { AccountPresenter } from './application/account/account.presenter';
import { HelpPresenter } from './application/help/help.presenter';
import { NavigationWaitingStore } from './application/navigation/navigation-waiting.store';
import { ServedDocumentStore } from './application/navigation/served-document.store';
import { AccountDialog } from './features/account/account-dialog.component';
import { HelpDialog } from './features/help/help-dialog.component';
import { RenderingTarget } from './platform/browser/rendering-target';
import { EmptyBenchService } from './application/equipment/empty-bench.service';
import { LoadoutImportPresenter } from './application/equipment/loadout-import.presenter';
import { Layer } from './ui/components/layer/layer';
import { WaitingOverlay } from './ui/components/waiting-overlay/waiting-overlay';

/** The shell action that opens the import layer, named once. */
export const IMPORT_ACTION = 'slef.import';

/**
 * Opening a build already saved on this device.
 *
 * An action rather than a place. The library is a layer over the screen a
 * Commander is on, with no address of its own, so a link to it would be a link
 * to nowhere — see `build-library/library-presence.ts`.
 */
export const LIBRARY_ACTION = 'library.open';

/** The shell action that opens the Help · About modal, named once. */
export const HELP_ACTION = 'help.open';

/**
 * The shell action that opens the Commander account modal, named once.
 *
 * One action for every account state. It is drawn on every screen because an
 * account belongs to the session rather than to a tool, and a Commander reaches
 * sign-in, sign-out, what the account holds and account deletion from wherever
 * they happen to be (020/FR-001).
 */
export const ACCOUNT_ACTION = 'account.open';

/** The shell action that starts the application over on a newer version. */
export const UPDATE_ACTION = 'app.update';

/**
 * The application root.
 *
 * Mounts the shared frame around the router outlet and supplies the navigation
 * every screen offers. It owns no heading: each route renders its own `h1`
 * inside the frame's `<main>`, because a shell-synthesized heading would give
 * every screen the same one and leave a reader unable to tell where they are.
 *
 * It does own one thing beyond the frame: the question asked before unsaved
 * work is replaced. That question has to be answerable from wherever the
 * Commander happens to be — hull detail, the library, a pasted link — so it
 * lives at the one level that is always mounted rather than in the workspace
 * route, which may not be (cross-screen replacement rule).
 */
@Component({
  selector: 'app-root',
  imports: [
    AccountDialog,
    AppFrame,
    BuildLibraryPage,
    ExportDialog,
    HelpDialog,
    ImportDialog,
    Layer,
    RouterOutlet,
    WaitingOverlay,
  ],
  templateUrl: './app.html',
  styleUrl: './app.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class App {
  readonly #navigation = inject(AppNavigation);
  readonly #locale = inject(LocaleStore);
  readonly chrome = inject(ScreenChrome);
  readonly #router = inject(Router);
  readonly #location = inject(Location);
  readonly #messages = inject(MessageService);
  readonly #slef = inject(SlefStore);
  readonly #loadoutImport = inject(LoadoutImportPresenter);
  readonly #emptyBench = inject(EmptyBenchService);
  readonly #active = inject(ActiveBuildStore);
  readonly help = inject(HelpPresenter);
  readonly account = inject(AccountPresenter);
  /**
   * Whether a Commander is looking at this, or the build is rendering it.
   *
   * Read by the template for one thing only: whether to mount the Help · About
   * modal. See `app.html` for why that one is conditional and nothing else is.
   */
  readonly interactive = inject(RenderingTarget).isBrowser;
  readonly #updates = inject(ApplicationUpdateStore);
  readonly #navigationWaiting = inject(NavigationWaitingStore);
  readonly #servedDocument = inject(ServedDocumentStore);
  readonly #announcements = inject(AnnouncementService);
  readonly library = inject(LibraryPresence);

  /**
   * The address on screen, as the chrome reads it.
   *
   * Seeded from `Location` rather than from `Router.url`, which is `/` until the
   * first navigation finishes. On a direct load of any address but the
   * shipyard's, that made the shell's first paint name no current tool at all —
   * `/equipment` drew `Equipment Builder` without `aria-current` and without the
   * wash that marks the open tool, and corrected itself a frame later (Commander
   * request 2026-09-04). `Location.path()` answers before the router has run, in the
   * browser and in the prerender alike.
   */
  readonly #path = signal(this.#location.path() || NAVIGATION_ROUTES.start);

  /**
   * The revision of the version whose notice a reader has been told about, or
   * `null` before the first one.
   *
   * The update effect watches the restart overlay as well as the version, so
   * one version can run it more than once. See the effect for why the overlay
   * has to be watched, and why this is the one announcement here that remembers.
   */
  #announcedUpdate: number | null = null;

  /** Where the bar's insignia goes: the entry point, from every screen. */
  readonly home = computed(() => this.#navigation.home());

  /** The tools the shell names, with the open route's own marked as current. */
  readonly tools = computed(() => this.#navigation.tools(this.#path()));

  /**
   * What the command bar shows: the screen's own name, and the one count that
   * belongs to it. The name is what the document title is composed from, so the
   * bar and the tab can never name different screens.
   */
  readonly pageName = this.#locale.page;
  readonly pageCount = this.chrome.count;

  /**
   * What the command bar shows: the open screen's own actions, then Import, and
   * the restart when a newer version is waiting.
   *
   * Import is always present. The reference draws it in the command bar of the
   * shipyard, and a Commander can paste a build from any screen — including one
   * with no build at all — so it belongs to the shell rather than to four
   * screens that would each have to remember to offer it.
   *
   * Help follows it, for the same reason and one more: the reference draws it
   * at the trailing end of the wide command bar and as an item in the narrow
   * action menu, and draws no help control anywhere else in any canvas. The
   * frame surrounds every capability, so one action here is the route from all
   * of them and no screen owns a second one (012/FR-002, 012/FR-011).
   *
   * It is also the one action the bar draws as a mark. The reference sets a `?`
   * on that trailing edge and spells the entry out in the narrow menu, and the
   * `symbol` here is what carries that difference: the same action, the same
   * name to a reader at both widths, drawn as the mark only where the reference
   * draws one.
   *
   * The restart is last and almost never there. It sits at the trailing edge
   * where the canvas puts what a screen is asking for, and immediately before
   * the notice that explains it in reading order, so a reader meets the control
   * and its reason together. That is why it comes after Help rather than the
   * other way round: Help is a permanent fixture of the bar and this is a
   * transient thing the page is asking for, and separating it from its own
   * notice by a control that is always there would leave the notice explaining
   * something a reader has already scrolled past.
   */
  readonly actions = computed(() => {
    const screen = this.chrome.actions();
    const update = this.updateAction();
    // Importing opens the bar's actions rather than closing them.
    //
    // No canvas draws either of the two ways a build arrives on the command
    // bar's action row — the shipyard's `IMPORT` sits beside `?` and its
    // `OPEN SAVED BUILD` is a control on the page — so where they go on a bar
    // that carries both is this application's decision. They belong beside each
    // other: they are the same question with two answers, and the screen's own
    // history and export sat between them (Commander request 2026-08-26).
    // The library is the first of the two, where it was the link in the bar's
    // navigation immediately before this row until it stopped being a place a
    // Commander goes (2026-09-04). It is drawn where it was drawn.
    const [first, ...rest] = screen;
    return [
      {
        id: LIBRARY_ACTION,
        label: this.#messages.message('navigation.library'),
        emphasis: 'secondary' as const,
      },
      {
        id: IMPORT_ACTION,
        label: this.#messages.message(
          this.#path().startsWith(NAVIGATION_ROUTES.equipment)
            ? 'equipment.import.title'
            : 'slef.import.title',
        ),
        emphasis: 'secondary' as const,
      },
      ...(first === undefined ? [] : [{ ...first, startsGroup: true }, ...rest]),
      {
        id: ACCOUNT_ACTION,
        // The Commander's own name once there is one, which is what names the
        // account everywhere else, and the account's own name before that.
        label: this.account.actionLabel(),
        description: this.account.actionDescription(),
        emphasis: 'quiet' as const,
      },
      {
        id: HELP_ACTION,
        label: this.help.actionLabel(),
        symbol: this.help.actionSymbol(),
        description: this.help.actionDescription(),
        emphasis: 'quiet' as const,
      },
      ...(update === null ? [] : [update]),
    ];
  });

  /**
   * The restart, offered only while there is something to restart onto.
   *
   * The way in for the two cases the overlay does not cover: a cached version
   * the worker cannot repair, which is never restarted on a clock, and a newer
   * version whose restart could not happen because there was no page to start
   * over. Where the overlay *is* up this stays away — see below — because the
   * page under it is inert and a control nobody can reach is no control.
   *
   * Not pressing it costs nothing. The newer version is already downloaded, and
   * the next start of the application is served it.
   */
  readonly updateAction = computed<ShellAction | null>(() => {
    const state = this.#updates.state();
    if (state === 'current') {
      return null;
    }
    if (state === 'ready' && this.#updates.overlay()) {
      // The page under a modal layer is inert, so an action drawn here while
      // the overlay stands is one a Commander cannot press. It appears only if
      // the restart the overlay announced could not be carried out.
      return null;
    }
    return {
      id: UPDATE_ACTION,
      label: this.#messages.message(
        state === 'ready' ? 'update.ready.action' : 'update.unusable.action',
      ),
      emphasis: 'primary' as const,
      description: this.#messages.message(
        state === 'ready'
          ? 'update.ready.action.description'
          : 'update.unusable.action.description',
      ),
      disabled: this.#updates.applying(),
      startsGroup: true,
    };
  });

  /**
   * The version outcome, as visible text.
   *
   * The other thing a Commander would otherwise have no way of knowing: that
   * what they are reading is no longer what was published. It stays on the page
   * in reading order beside the control that acts on it, to be found and
   * re-read; the announcement below is the separate projection that interrupts,
   * once (feedback contract).
   *
   * The tone decides how the notice itself is exposed, and `StatusNotice` makes
   * that choice, not this: an error is an `alert` and everything else a
   * `status`. The unrepairable state therefore arrives in a live region of its
   * own, and the announcement beside it says something else rather than the
   * same sentence again — hull detail's unknown hull is the same shape, with
   * the summary in the outlet and the explanation on the page.
   */
  readonly updateStatus = computed<ShellStatus | null>(() => {
    const state = this.#updates.state();
    if (state === 'current') {
      return null;
    }
    if (state === 'ready' && this.#updates.overlay()) {
      // Same sentence, said by the overlay. On the shell as well it would be
      // the notice a reader meets twice for one event (feedback contract).
      return null;
    }
    if (state === 'unusable') {
      return {
        tone: 'error' as const,
        message: this.#messages.message('update.unusable.notice'),
        detail: this.#messages.message('update.unusable.detail'),
      };
    }
    return {
      tone: 'info' as const,
      message: this.#messages.message('update.ready.notice'),
      detail: this.#messages.message('update.ready.detail'),
    };
  });

  /**
   * What the address served, while no screen has replaced it.
   *
   * Handed to the frame, which places it where the outlet stands. `null` on
   * every ordinary frame: it answers with content only where a navigation ended
   * without presenting a screen and none has been presented in this session
   * (023/FR-001).
   */
  readonly heldContent = this.#servedDocument.held;

  /**
   * The language that content is in, which is the one the document declared
   * when it was served rather than the one the application is presenting in.
   */
  readonly heldLanguage = this.#servedDocument.language;

  /**
   * The box that content was served in, which is the box it goes back into.
   */
  readonly heldHeight = this.#servedDocument.height;

  /**
   * Everything the session has to say on the page, in reading order.
   *
   * The version outcome first, then a navigation that could not open its
   * screen. Both have to stay readable and neither may displace the other: the
   * version notice sits beside the control that acts on it, and the failure is
   * the only answer a Commander has to a press that produced nothing. The
   * version notice leads because it is about the whole session, where the
   * failure is about one press (018/FR-007).
   */
  readonly statusNotices = computed<readonly ShellStatus[]>(() => {
    const standing: ShellStatus[] = [];
    const version = this.updateStatus();
    if (version !== null) {
      standing.push(version);
    }
    if (this.#navigationWaiting.failed()) {
      // A warning rather than an error, because of what the tone commits the
      // notice to saying and how. An error is drawn as an `alert`, which a
      // reader speaks over whatever it was saying — and nothing here is
      // blocked: the Commander is on a screen they can use and one press
      // produced nothing. The failure is announced once, politely, through the
      // outlet below, and a notice that interrupted as well would be the same
      // sentence twice with the first of them cutting in (018/FR-007,
      // 011/FR-009, feedback contract).
      standing.push({
        tone: 'warning',
        message: this.#messages.message('navigation.failed.notice'),
        detail: this.#messages.message('navigation.failed.detail'),
      });
    }
    return standing;
  });

  /**
   * Whether the application is waiting for a screen it has been asked for.
   *
   * Held down while the restart announcement stands. That text has to be
   * visible while it is up (011/FR-025), and the page under it is inert — a
   * mark drawn on top of it would hide required words, and one drawn under it
   * would be a mark nobody can see. It costs nothing: the restart replaces the
   * page, so a navigation running underneath it is not going to finish
   * (018/FR-002).
   */
  readonly waitingOverlay = computed(
    () => this.#navigationWaiting.waiting() && !this.#updates.overlay(),
  );

  readonly waitingText = this.#messages.messageSignal('navigation.waiting.notice');

  /**
   * The overlay that stands over the page while the restart is coming.
   *
   * Everything about it is here rather than in a component of its own: it is
   * one layer, mounted beside the frame like the help dialog, and what it says
   * is the shell's own account of the version this session is running.
   *
   * It offers nothing to press. The restart is not a question (owner's
   * decision, 2026-08-27), so the layer is drawn with no dismiss label, which
   * is what takes its control, Escape and its ground away together.
   */
  readonly updateOverlay = computed(() => this.#updates.overlay());
  readonly updateOverlayTitle = this.#messages.messageSignal('update.applying.title');
  readonly updateOverlayNotice = this.#messages.messageSignal('update.applying.notice');

  /**
   * The notice the session that came up after the restart draws.
   *
   * The overlay above went with the page that drew it, and a Commander who
   * looked away for those few seconds would otherwise find a page that had
   * silently become a different one. This says what happened and which version
   * it happened onto, and it is dismissed rather than waited out.
   */
  readonly updateApplied = computed(() => this.#updates.applied());
  readonly updateAppliedTitle = this.#messages.messageSignal('update.applied.title');
  readonly updateAppliedNotice = this.#messages.messageSignal('update.applied.notice');
  readonly updateAppliedDismiss = this.#messages.messageSignal('update.applied.dismiss');
  readonly updateAppliedDetail = computed(() =>
    this.#messages.message('update.applied.detail', {
      version: this.help.manifest.build.applicationVersion,
    }),
  );

  /** Takes the after-the-restart notice down, having been read. */
  acknowledgeUpdate(): void {
    this.#updates.acknowledgeApplied();
  }

  /** The open screen's own identity block, where it publishes one. */
  readonly identity = this.chrome.identity;

  /** The compact bar a screen opened over another one publishes, where one does. */
  readonly back = this.chrome.return;

  /**
   * Whether either exchange layer is wanted.
   *
   * The shell holds the state; the layers themselves are deferred. Neither one
   * is on screen in most sessions, and loading the Almanac's serializer, the
   * inspector and the delivery ports at startup for a control nobody pressed is
   * a megabyte spent on nothing.
   */
  readonly exchangeWanted = computed(() => this.#slef.layer() !== 'none');

  constructor() {
    // The account state is read once, in a browser, when the session starts.
    // A generated document has no session to read and no origin to ask, and a
    // Commander who never signs in pays one refused request for the answer that
    // they are anonymous — which every tool then goes on working without.
    if (this.interactive) {
      this.account.initialise();
    }

    this.#router.events.subscribe((event) => {
      if (event instanceof NavigationEnd) {
        this.#path.set(event.urlAfterRedirects);
      }
    });

    // One announcement per version revision. A waiting version is a settled,
    // nonblocking change and waits its turn; a cached version that cannot be
    // repaired is blocking, because nothing else on the page can be trusted to
    // work, and interrupts (feedback contract).
    //
    // What each outlet carries differs by how the notice beside it is exposed.
    // A waiting version's notice is a `status`; an unrepairable one is an
    // `alert`, which is the stronger promise of the two, so the assertive
    // outlet carries a summary rather than the sentence the alert already
    // spoke, and the polite outlet repeats its notice. Which of the two roles
    // a reader actually speaks on insertion is a judgment no scan can make:
    // step 16 of `e2e/manual/screen-reader.protocol.md` is where it is settled,
    // and where a reader disagreeing sends this split back for a decision.
    //
    // The version and whether the overlay stands are the only things this
    // depends on. Announcing resolves a message, which reads the catalogue —
    // tracked, that would make a committed locale re-run this effect and
    // republish an event that already happened, over whatever the outlet was
    // carrying.
    effect(() => {
      const { state, revision } = this.#updates.snapshot();
      if (state === 'current') {
        return;
      }

      // Not while the overlay stands. It opens with `showModal()` in the same
      // tick the state arrives, which makes everything outside the dialog
      // inert — the outlet included, since it is mounted inside the frame — so
      // an announcement published here would be one no reader is ever offered.
      // The overlay is the announcement in that state: it takes focus and its
      // description is read where it stands.
      //
      // Tracked rather than read in `untracked`, because the overlay coming
      // down is exactly when this has something to say. A restart that could
      // not be carried out lowers it without moving the state or the revision,
      // and the notice left on the shell is the one thing telling a reader the
      // session is behind.
      if (state === 'ready' && this.#updates.overlay()) {
        return;
      }

      // Which is why this effect can run more than once for one version, and
      // why it is the one announcement in the application that remembers what
      // it said. Every other caller depends on its own event alone; this one
      // watches the overlay as well, so a version raising and lowering it twice
      // would otherwise tell a reader the same thing twice (011/FR-009, "One
      // event is published twice").
      if (revision === this.#announcedUpdate) {
        return;
      }
      this.#announcedUpdate = revision;

      untracked(() =>
        this.#announcements.announce({
          kind: 'app.update',
          urgency: state === 'unusable' ? 'assertive' : 'polite',
          // The durable fact, not the thing about to happen. An announcement
          // is spoken once and cannot be taken back, and this only reaches a
          // reader once the restart has already failed, where "this session is
          // restarting on it" would be a statement nothing corrects.
          messageKey: state === 'unusable' ? 'update.unusable.announcement' : 'update.ready.notice',
        }),
      );
    });

    // One polite announcement per failed navigation.
    //
    // Nothing is blocked: the overlay is already gone, the Commander has a
    // screen they can use, and what failed was one press — which is the
    // treatment 011/FR-009 gives a change that is not a blocking error. The
    // words also stay on the page, in the status list above, because a
    // spoken sentence cannot be re-read (018/FR-007).
    //
    // The count is what makes this effect run twice for two failures: both say
    // one sentence, and a boolean would not move. It is the trigger and nothing
    // more — the policy is told an event happened, not which one.
    //
    // Resolving the message reads the catalogue, so it is announced in
    // `untracked`: tracked, a committed locale would republish a failure the
    // Commander has already been told about.
    effect(() => {
      const failures = this.#navigationWaiting.failures();
      if (failures === 0) {
        return;
      }
      untracked(() =>
        this.#announcements.announce({
          kind: 'navigation.failed',
          urgency: 'polite',
          messageKey: 'navigation.failed.notice',
        }),
      );
    });
  }

  /**
   * Follows a shell navigation link without reloading the application.
   *
   * A full page load would discard the build a Commander is working on, which
   * is the one thing navigating between screens must never do. Modified clicks
   * — new tab, new window, download — are left to the browser, because that is
   * what the reader asked for.
   *
   * A plain click on a link that leads to the address already open is answered
   * with nothing: no navigation, no history entry, no scroll of a page that did
   * not change. The link is still a link — the browser states where it goes, a
   * new tab opens it and its address copies — which is what the entry keeps by
   * being drawn on every screen rather than taken away where it leads
   * (017/FR-002, FR-005).
   */
  navigateFromShell({ entry, event }: { entry: NavigationEntry; event: MouseEvent }): void {
    if (event.defaultPrevented || event.button !== 0) {
      return;
    }
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return;
    }
    event.preventDefault();
    if (this.#navigation.alreadyOpen(entry.href, this.#path())) {
      return;
    }
    void this.#router.navigateByUrl(entry.href);
  }

  /**
   * Follows a tool's tab, or re-enters the tool a Commander is already in.
   *
   * Every tab is a link and every tab is offered, so this is asked about the
   * open tool as well as the others. The tool a Commander is not in opens at
   * its own address. The one they are in re-enters by the action the registry
   * declares with it — the bench clears for the next loadout — and, where the
   * tool declares none, by opening its own address, which is how a build or a
   * hull returns to the list of ships and how the list itself answers with
   * nothing (017/FR-003, FR-004, FR-005).
   */
  selectTool({ entry, event }: { entry: ToolEntry; event: MouseEvent }): void {
    if (event.defaultPrevented || event.button !== 0) {
      return;
    }
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return;
    }
    if (entry.current === true && entry.reentry !== undefined) {
      event.preventDefault();
      this.selectAction(entry.reentry);
      return;
    }
    this.navigateFromShell({ entry, event });
  }

  /** Shell actions are navigation intents; the frame never navigates itself. */
  selectAction(id: string): void {
    // The screen's own actions first: the shell places them and knows nothing
    // about what they mean.
    if (this.chrome.select(id)) {
      return;
    }
    if (id === WORKSPACE_EXPORT_ACTION) {
      if (this.#active.loadout() === null) {
        return;
      }
      if (this.#active.link().kind === 'refused') {
        this.#slef.selectExportMode('slef');
      }
      this.#slef.openLayer('export');
      return;
    }
    if (id === LIBRARY_ACTION) {
      this.library.raise();
      return;
    }
    if (id === IMPORT_ACTION) {
      // The action belongs to the tool a Commander is in. Both tools import a
      // journal; what an event becomes is the difference, and the bench is the
      // only place a suit loadout can land.
      if (this.#path().startsWith(NAVIGATION_ROUTES.equipment)) {
        this.#loadoutImport.openLayer();
      } else {
        this.#slef.openLayer('import');
      }
      return;
    }
    if (id === EQUIPMENT_REENTRY_ACTION) {
      // The bench is what this clears, and the application layer is how the
      // shell reaches it: the frame draws tabs and imports no screen.
      this.#emptyBench.start();
      return;
    }
    if (id === ACCOUNT_ACTION) {
      this.account.openDialog();
      return;
    }
    if (id === HELP_ACTION) {
      this.help.openDialog();
      return;
    }
    if (id === UPDATE_ACTION) {
      void this.#updates.apply();
      return;
    }
  }
}
