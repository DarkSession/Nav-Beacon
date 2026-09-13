import { Injectable, computed, inject, signal } from '@angular/core';
import type { PackageRefusal } from '../../domain/commander/fleet/fleet-answer';
import type { OwnedShip, OwnedShipMappingFailure } from '../../domain/commander/fleet/owned-ship';
import type { MessageKey } from '../../i18n/locale-registry';
import { Formatters } from '../../i18n/formatters/formatters';
import { GameTextPresenter } from '../../i18n/game-text.presenter';
import { MessageService } from '../../i18n/message.service';
import type { Fact } from '../../ui/components/fact-list/fact-list';
import type { StatusTone } from '../../ui/components/status/status-notice';
import { AccountStore } from '../account/account.store';
import { FleetStore, type FleetHolding, type RefusedOwnedShip } from './fleet.store';

/**
 * The states design decision 10 gives the owned-ships view.
 *
 * Nine, and each of them one sentence a Commander reads. They are named here so
 * a test, a preview and this presenter agree on what the view is showing rather
 * than inferring it from a tone.
 */
export type OwnedShipsState =
  | 'sign-in-required'
  | 'loading'
  | 'current'
  | 'incomplete'
  | 'empty'
  | 'waiting'
  | 'failed'
  | 'authorisation-expired'
  | 'package-refused';

/** One owned ship, as the list draws it. */
export interface OwnedShipRow {
  readonly id: string;
  /** The Commander's own name for the ship, or the hull where they gave none. */
  readonly label: string;
  /** The hull, the ident and where the projection was read from. */
  readonly detail: string;
  readonly selected: boolean;
}

/**
 * The package's own refusal of a candidate `Loadout`, shown unchanged.
 *
 * `message` is the package's text, or `null`. The pinned
 * `@elite-dangerous-almanac/core` publishes a diagnostic message for English
 * locales only and documents `null` for every other one, so a German reader gets
 * no text from it. This application keeps no private translation of a package
 * diagnostic and writes none from a diagnostic code, because either would be
 * this application saying what the game data says (constitution II, 020/FR-016).
 * `absentMessage` is the application's own localised sentence for that absence,
 * and the code, constraint and path beneath it are the package's own structured
 * answer, verbatim.
 */
export interface PackageRefusalView {
  readonly heading: string;
  readonly message: string | null;
  readonly absentMessage: string | null;
  readonly facts: readonly Fact[];
}

/** Everything the owned-ships view draws. */
export interface OwnedShipsView {
  readonly state: OwnedShipsState;
  readonly heading: string;
  readonly status: { readonly tone: StatusTone; readonly message: string };
  /** Supporting detail for the state, where the state has one. */
  readonly detail: string | null;
  /** What journal history the fleet was read from, where there is any. */
  readonly coverage: string | null;
  readonly listLabel: string;
  /** Visible text naming the chosen row, so the choice is not a tint alone. */
  readonly chosenLabel: string;
  readonly ships: readonly OwnedShipRow[];
  /** The sentence drawn instead of a list, where there is nothing to list. */
  readonly emptyLabel: string | null;
  /** The facts of the chosen ship, where one is chosen. */
  readonly selectedLabel: string | null;
  readonly facts: readonly Fact[];
  /** Ships the installed package will not rebuild, stated rather than dropped. */
  readonly unresolved: readonly { readonly id: string; readonly message: string }[];
  readonly refusal: PackageRefusalView | null;
  /** The label of the refresh, or `null` where there is nothing to refresh. */
  readonly refresh: string | null;
  readonly refreshing: boolean;
  /** The label of the sign-in, drawn only where there is no account. */
  readonly signIn: string | null;
  /** The label of the copy action, drawn only where a ship is chosen. */
  readonly copy: string | null;
}

/**
 * What the Ship Builder's stored-build layer says about the owned fleet.
 *
 * Nine states in one view model, so the layer draws the same region whatever
 * the fleet is doing. Every sentence says what it means and the tone is a
 * second rendering of it, so nothing here is carried by colour (011/FR-010).
 *
 * Presentation only. What the fleet is, and what a refresh answered, are
 * decided by the store below it (constitution III).
 */
@Injectable({ providedIn: 'root' })
export class FleetPresenter {
  readonly #messages = inject(MessageService);
  readonly #formatters = inject(Formatters);
  readonly #gameText = inject(GameTextPresenter);
  readonly #fleet = inject(FleetStore);
  readonly #account = inject(AccountStore);

  readonly #chosen = signal<number | null>(null);

  /** The ship the facts and the copy action are about, where one is chosen. */
  readonly chosen = computed<OwnedShip | null>(() => {
    const shipId = this.#chosen();
    const ships = this.#fleet.holding()?.ships ?? [];
    return ships.find((ship) => ship.shipId === shipId) ?? null;
  });

  readonly view = computed<OwnedShipsView>(() => {
    const state = this.#state();
    const holding = this.#fleet.holding();
    const chosen = this.chosen();
    const refusal = this.#refusalOf();

    return {
      state,
      heading: this.#messages.message('fleet.title'),
      status: this.#statusOf(state, holding),
      detail: this.#detailOf(state, holding),
      coverage: this.#coverageOf(holding),
      listLabel: this.#messages.message('fleet.list.label'),
      chosenLabel: this.#messages.message('fleet.list.chosen'),
      ships: (holding?.ships ?? []).map((ship) => this.#row(ship, chosen)),
      emptyLabel:
        state === 'sign-in-required' || (holding?.ships.length ?? 0) > 0
          ? null
          : this.#messages.message('fleet.list.empty'),
      selectedLabel:
        chosen === null
          ? null
          : this.#messages.message('fleet.facts.label', {
              ship: this.#shipLabel(chosen),
            }),
      facts: chosen === null ? [] : this.#factsOf(chosen),
      unresolved: (holding?.refused ?? []).map((entry) => ({
        id: `refused-${entry.shipId ?? 'unknown'}`,
        message: this.#unresolvedMessage(entry),
      })),
      refusal,
      refresh: state === 'sign-in-required' ? null : this.#messages.message('fleet.refresh'),
      refreshing: this.#fleet.exchange().kind === 'refreshing',
      signIn: state === 'sign-in-required' ? this.#messages.message('account.sign-in') : null,
      copy: chosen === null ? null : this.#messages.message('fleet.copy'),
    };
  });

  /** Chooses the ship the facts and the copy action are about. */
  choose(shipId: number): void {
    this.#chosen.set(shipId);
  }

  /** Asks the service to read more journal. */
  async refresh(): Promise<void> {
    await this.#fleet.refresh();
  }

  /** Opens the account panel, which is where a sign-in is asked for. */
  signIn(): void {
    this.#account.openDialog();
  }

  #state(): OwnedShipsState {
    if (this.#fleet.authorisationExpired()) {
      return 'authorisation-expired';
    }
    if (!this.#fleet.signedIn() && !this.#fleet.accountKnown()) {
      return 'sign-in-required';
    }
    const exchange = this.#fleet.exchange();
    const holding = this.#fleet.holding();

    switch (exchange.kind) {
      case 'authorisation-expired':
        return 'authorisation-expired';
      case 'waiting':
        return 'waiting';
      case 'failed':
        return exchange.failure === 'package-refused' ? 'package-refused' : 'failed';
      case 'session-expired':
      case 'refused':
      case 'unavailable':
        // A fleet already held is still readable; a browser that has none has
        // nothing to show and says why (020/FR-022).
        return holding === null ? 'failed' : this.#settledState(holding);
      case 'reading':
      case 'refreshing':
        return holding === null ? 'loading' : this.#settledState(holding);
      default:
        return holding === null ? 'loading' : this.#settledState(holding);
    }
  }

  #settledState(holding: FleetHolding): OwnedShipsState {
    if (holding.result === 'empty') {
      return 'empty';
    }
    return holding.result === 'incomplete' ? 'incomplete' : 'current';
  }

  #statusOf(state: OwnedShipsState, holding: FleetHolding | null): OwnedShipsView['status'] {
    switch (state) {
      case 'sign-in-required':
        return { tone: 'info', message: this.#messages.message('fleet.status.sign-in-required') };
      case 'loading':
        return { tone: 'loading', message: this.#messages.message('fleet.status.loading') };
      case 'current':
      case 'incomplete':
      case 'empty':
        return this.#settledStatus(state, holding);
      case 'waiting':
        return { tone: 'warning', message: this.#messages.message('fleet.status.waiting') };
      case 'authorisation-expired':
        return {
          tone: 'error',
          message: this.#messages.message('fleet.status.authorisation-expired'),
        };
      case 'package-refused':
        return { tone: 'error', message: this.#messages.message('fleet.status.package-refused') };
      default:
        return { tone: 'error', message: this.#failedMessage() };
    }
  }

  /**
   * What a fleet this browser holds says, and what the last exchange says.
   *
   * A refresh the service never answered leaves the ships listed and states
   * the failure instead of the settled sentence, because reading it as a
   * completed refresh would tell a Commander that their journal confirms a
   * fleet nothing has checked (020/FR-018, 020/FR-022).
   *
   * A fleet read out of this browser is the exception, and only where the
   * cached sentence is the one shown: that sentence already says that these are
   * the ships last accepted and that a refresh needs a network, which is the
   * same fact in the words that fit it. An incomplete or empty cached fleet
   * says neither, so a refresh that never reached the service is stated there
   * as it is anywhere else. Leaving it out would read as a completed refresh
   * that found nothing (020/FR-018).
   */
  #settledStatus(state: OwnedShipsState, holding: FleetHolding | null): OwnedShipsView['status'] {
    if (this.#unanswered() && !this.#speaksForItself(state, holding)) {
      return { tone: 'warning', message: this.#failedMessage() };
    }
    switch (state) {
      case 'incomplete':
        return { tone: 'warning', message: this.#messages.message('fleet.status.incomplete') };
      case 'empty':
        return { tone: 'info', message: this.#messages.message('fleet.status.empty') };
      default: {
        const key = this.#settledKey(holding);
        return {
          // A ship named below rather than listed is a list that does not carry
          // the confirmed fleet, which is what `fleet.status.incomplete` says
          // above it in a warning. Drawing the same fact as a success would be
          // a second rendering of a different sentence (011/FR-010).
          tone: key === 'fleet.status.unresolved' ? 'warning' : 'success',
          message: this.#messages.message(key),
        };
      }
    }
  }

  /**
   * Which sentence a settled fleet reads under.
   *
   * A ship the installed package will not rebuild is a ship the journal
   * confirmed and this list does not carry. Naming it below while the sentence
   * above says every confirmed ship is listed here states two different fleets
   * on one screen, and the sentence is the one that is wrong. The cached
   * sentence claims no completeness, so it stands as it is (020/FR-015,
   * 020/FR-016, constitution IV).
   */
  #settledKey(
    holding: FleetHolding | null,
  ): 'fleet.status.cached' | 'fleet.status.current' | 'fleet.status.unresolved' {
    if (holding?.fromCache === true) {
      return 'fleet.status.cached';
    }
    return (holding?.refused.length ?? 0) > 0 ? 'fleet.status.unresolved' : 'fleet.status.current';
  }

  /**
   * Whether the settled sentence already carries the failure's own fact.
   *
   * Only `fleet.status.cached` does, and only the state that reaches it.
   */
  #speaksForItself(state: OwnedShipsState, holding: FleetHolding | null): boolean {
    return holding?.fromCache === true && state !== 'incomplete' && state !== 'empty';
  }

  /**
   * Whether the last exchange ended without the service answering the fleet.
   *
   * A session that has ended and a service that could not be reached both
   * leave the held fleet standing and confirm nothing, and neither has a state
   * of its own while a fleet is held (020/FR-018).
   */
  #unanswered(): boolean {
    const kind = this.#fleet.exchange().kind;
    return kind === 'session-expired' || kind === 'refused' || kind === 'unavailable';
  }

  /** Why the last exchange did not leave this browser current. */
  #failedMessage(): string {
    const exchange = this.#fleet.exchange();
    if (exchange.kind === 'session-expired') {
      return this.#messages.message('fleet.status.session-expired');
    }
    if (exchange.kind === 'refused') {
      // One sentence for every refusal that is not an ended session, because
      // what a Commander does about each of them is the same and none of them
      // is Frontier's doing. The code is carried for a reader of this state,
      // not turned into a different sentence this application cannot stand
      // behind (020/FR-018).
      return this.#messages.message('fleet.status.refused');
    }
    if (exchange.kind !== 'failed') {
      return this.#messages.message('fleet.status.unavailable');
    }
    switch (exchange.failure) {
      case 'frontier-unavailable':
        return this.#messages.message('fleet.status.failed.frontier');
      case 'response-too-large':
      case 'line-too-large':
        return this.#messages.message('fleet.status.failed.too-large');
      case 'line-malformed':
        return this.#messages.message('fleet.status.failed.malformed');
      default:
        return this.#messages.message('fleet.status.failed.projection');
    }
  }

  #detailOf(state: OwnedShipsState, holding: FleetHolding | null): string | null {
    if (state === 'waiting') {
      const exchange = this.#fleet.exchange();
      const until = exchange.kind === 'waiting' ? exchange.until : null;
      return until === null
        ? this.#messages.message('fleet.detail.waiting')
        : this.#messages.message('fleet.detail.waiting.until', {
            when: this.#instant(until),
          });
    }
    if (state === 'incomplete' && holding?.pending === true) {
      return this.#messages.message('fleet.detail.pending');
    }
    // Every state that is not current says that the fleet already accepted is
    // still there, because that is the fact a Commander needs (020/FR-018). A
    // refresh the service never answered is one of them: the ships stay listed
    // and the status above says why none of them is confirmed.
    if (
      state === 'failed' ||
      state === 'package-refused' ||
      state === 'authorisation-expired' ||
      (this.#unanswered() && !this.#speaksForItself(state, holding))
    ) {
      return (holding?.ships.length ?? 0) > 0
        ? this.#messages.message('fleet.detail.last-accepted')
        : null;
    }
    return null;
  }

  /**
   * What journal history this fleet was read from.
   *
   * The cursor names the next unread date and line, so it is not the end of
   * what was read: at line zero nothing of its date has been opened, and at a
   * later line only the lines before it have. Reading the cursor date as an
   * inclusive end would claim days nobody read — the very overstatement the
   * projection refuses to make in its own bookkeeping (020/FR-013,
   * constitution IV).
   */
  #coverageOf(holding: FleetHolding | null): string | null {
    const coverage = holding?.coverage;
    if (coverage === null || coverage === undefined) {
      return null;
    }
    const part = coverage.cursorLine > 0 ? this.#day(coverage.cursorDate) : null;
    const lastComplete = this.#dayBefore(coverage.cursorDate);
    if (lastComplete === null || lastComplete < coverage.startDate) {
      // No day has been read end to end: either the cursor still stands where
      // coverage begins, or it has moved into that first day without leaving it.
      return part === null
        ? this.#messages.message('fleet.coverage.none')
        : this.#messages.message('fleet.coverage.started', { day: part });
    }
    const from = this.#day(coverage.startDate);
    const to = this.#day(lastComplete);
    return part === null
      ? this.#messages.message('fleet.coverage', { from, to })
      : this.#messages.message('fleet.coverage.partial', { from, to, day: part });
  }

  /**
   * One row of the owned fleet.
   *
   * The plate is carried beside the hull where the journal stated one, because
   * it is the only thing that tells two ships apart when neither is named: the
   * name falls back to the hull, and two unnamed ships of one hull read from
   * one journal day are otherwise the same row twice. Where the journal stated
   * no plate the row says the hull and the day alone, and nothing stands in for
   * the plate (020/FR-016, constitution IV).
   */
  #row(ship: OwnedShip, chosen: OwnedShip | null): OwnedShipRow {
    const ident = ship.loadout.shipIdent;
    const hull = this.#hullName(ship);
    const when = this.#day(ship.sourceDate);
    return {
      id: String(ship.shipId),
      label: this.#shipLabel(ship),
      detail:
        ident !== null && ident.length > 0
          ? this.#messages.message('fleet.row.detail.ident', { hull, ident, when })
          : this.#messages.message('fleet.row.detail', { hull, when }),
      selected: chosen !== null && chosen.shipId === ship.shipId,
    };
  }

  /**
   * The facts of one owned ship.
   *
   * Read off the build the package rebuilt, and nothing derived: an owned ship
   * is what the journal stated, and a figure this application worked out from
   * it would be a figure nobody stated (020/FR-016).
   */
  #factsOf(ship: OwnedShip): readonly Fact[] {
    return [
      {
        id: 'hull',
        label: this.#messages.message('fleet.fact.hull'),
        value: this.#hullName(ship),
        unit: '',
      },
      {
        id: 'ident',
        label: this.#messages.message('fleet.fact.ident'),
        value: ship.loadout.shipIdent,
        unit: '',
      },
      {
        id: 'source',
        label: this.#messages.message('fleet.fact.source'),
        value: this.#day(ship.sourceDate),
        unit: '',
      },
    ];
  }

  /**
   * What one ship the installed package would not rebuild says.
   *
   * The sentence is this application's and comes from the failure code, which
   * is the machine-readable answer the mapping gives. Where the package states
   * the reason in the language being read, its words are carried inside that
   * sentence and nothing else is read out of them.
   *
   * Where the package has no words for this language — which its API documents
   * for every locale but English — the sentence is the failure's own. Setting
   * the package's English inside a German sentence would pass untranslated game
   * text off as a translation, which is the one thing constitution VI forbids
   * doing with it; this application never writes the package's reason and never
   * translates it (constitution II, VI, 020/FR-016).
   */
  #unresolvedMessage(entry: RefusedOwnedShip): string {
    const stated = entry.stated === null ? null : this.#gameText.loadoutIssueMessage(entry.stated);
    if (stated?.translationState === 'localized' && stated.text !== null) {
      return this.#messages.message('fleet.unresolved.stated', { reason: stated.text });
    }
    return this.#messages.message(UNRESOLVED_KEYS[entry.failure]);
  }

  /**
   * The package refusal, where the last refresh carried one.
   *
   * The package's own message is shown where the package published one. Where
   * it published none — every locale but English, which the package's own API
   * documents as `null` — the application says so in its own words and shows
   * the structured refusal unchanged. It never writes the reason itself
   * (020/FR-016).
   */
  #refusalOf(): PackageRefusalView | null {
    const exchange = this.#fleet.exchange();
    const refusal: PackageRefusal | null = exchange.kind === 'failed' ? exchange.refusal : null;
    if (refusal === null) {
      return null;
    }
    const hasMessage = refusal.message !== null && refusal.message.length > 0;

    return {
      heading: this.#messages.message('fleet.refusal.title'),
      message: hasMessage ? refusal.message : null,
      absentMessage: hasMessage ? null : this.#messages.message('fleet.refusal.no-message'),
      facts: [
        {
          id: 'code',
          label: this.#messages.message('fleet.refusal.code'),
          value: refusal.code,
          unit: '',
        },
        {
          id: 'constraint',
          label: this.#messages.message('fleet.refusal.constraint'),
          value: refusal.constraint,
          unit: '',
        },
        {
          id: 'path',
          label: this.#messages.message('fleet.refusal.path'),
          value: refusal.path,
          unit: '',
        },
      ],
    };
  }

  /** A ship's own name, or the hull where the Commander registered none. */
  #shipLabel(ship: OwnedShip): string {
    const name = ship.loadout.shipName;
    return name !== null && name.length > 0 ? name : this.#hullName(ship);
  }

  /** The hull's name, from the package, or its symbol where the package has none. */
  #hullName(ship: OwnedShip): string {
    const symbol = ship.loadout.shipSymbol;
    return this.#gameText.shipName(symbol).text ?? symbol;
  }

  #day(value: string): string {
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return Number.isNaN(parsed.getTime()) ? value : this.#formatters.date(parsed);
  }

  /** The UTC date before this one, or `null` where the date does not read. */
  #dayBefore(value: string): string | null {
    const parsed = new Date(`${value}T00:00:00.000Z`);
    if (Number.isNaN(parsed.getTime())) {
      return null;
    }
    parsed.setUTCDate(parsed.getUTCDate() - 1);
    return parsed.toISOString().slice(0, 10);
  }

  #instant(value: string): string {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? value : this.#formatters.dateTime(parsed);
  }
}

/**
 * One sentence for each answer the mapping gives, where the package published
 * no words of its own.
 *
 * Written as a table rather than a chain, so a failure code added to the
 * mapping stops the build here instead of falling through to a sentence about a
 * different answer (constitution IV).
 */
const UNRESOLVED_KEYS: Readonly<Record<OwnedShipMappingFailure, MessageKey>> = {
  malformed: 'fleet.unresolved.malformed',
  'unknown-hull': 'fleet.unresolved.unknown-hull',
  'unknown-identity': 'fleet.unresolved.unknown-identity',
  refused: 'fleet.unresolved.refused',
  'unsupported-combination': 'fleet.unresolved.unsupported-combination',
};
