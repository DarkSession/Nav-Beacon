import { Injectable, computed, inject, signal } from '@angular/core';
import type { PackageRefusal } from '../../domain/commander/fleet/fleet-answer';
import type { OwnedShip } from '../../domain/commander/fleet/owned-ship';
import { Formatters } from '../../i18n/formatters/formatters';
import { GameTextPresenter } from '../../i18n/game-text.presenter';
import { MessageService } from '../../i18n/message.service';
import type { Fact } from '../../ui/components/fact-list/fact-list';
import type { StatusTone } from '../../ui/components/status/status-notice';
import { AccountStore } from '../account/account.store';
import { FleetStore, type FleetHolding } from './fleet.store';

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
        // The package's own reason, carried as the package wrote it. This
        // application states that a ship could not be rebuilt; what the package
        // says about it is the package's (constitution II).
        message: this.#messages.message('fleet.unresolved', { reason: entry.reason }),
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
        return {
          tone: 'success',
          message: this.#messages.message(
            holding?.fromCache === true ? 'fleet.status.cached' : 'fleet.status.current',
          ),
        };
      case 'incomplete':
        return { tone: 'warning', message: this.#messages.message('fleet.status.incomplete') };
      case 'empty':
        return { tone: 'info', message: this.#messages.message('fleet.status.empty') };
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

  /** Why the last exchange did not leave this browser current. */
  #failedMessage(): string {
    const exchange = this.#fleet.exchange();
    if (exchange.kind === 'session-expired') {
      return this.#messages.message('fleet.status.session-expired');
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
    // still there, because that is the fact a Commander needs (020/FR-018).
    if (state === 'failed' || state === 'package-refused' || state === 'authorisation-expired') {
      return (holding?.ships.length ?? 0) > 0
        ? this.#messages.message('fleet.detail.last-accepted')
        : null;
    }
    return null;
  }

  /** What journal history this fleet was read from. */
  #coverageOf(holding: FleetHolding | null): string | null {
    const coverage = holding?.coverage;
    if (coverage === null || coverage === undefined) {
      return null;
    }
    return this.#messages.message('fleet.coverage', {
      from: this.#day(coverage.startDate),
      to: this.#day(coverage.cursorDate),
    });
  }

  #row(ship: OwnedShip, chosen: OwnedShip | null): OwnedShipRow {
    return {
      id: String(ship.shipId),
      label: this.#shipLabel(ship),
      detail: this.#messages.message('fleet.row.detail', {
        hull: this.#hullName(ship),
        when: this.#day(ship.sourceDate),
      }),
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

  #instant(value: string): string {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? value : this.#formatters.dateTime(parsed);
  }
}
