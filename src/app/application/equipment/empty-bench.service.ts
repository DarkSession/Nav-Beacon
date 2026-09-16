import { Injectable, inject } from '@angular/core';
import { TabOwnershipCoordinator } from '../build-library/tab-ownership.coordinator';
import { LoadoutAutosaveService } from './loadout-autosave.service';
import { LoadoutLinkCoordinator } from './loadout-link.coordinator';
import { LoadoutStore } from './loadout.store';

/**
 * Taking the loadout off the bench, for the next one.
 *
 * Two ways to reach the same bench. A Commander on the bench asks the equipment
 * tool's own tab for an empty one, and the bench comes back to the state it
 * holds before a suit is chosen, with the suit gate standing (017/FR-006); a
 * Commander who deletes the record the bench is autosaved into leaves it with
 * nowhere to be kept, and it goes the same way (017/FR-008). Both are here so
 * that what the loadout leaves behind — this tab's claim on its record and the
 * loadout the address carries — goes with it either time.
 *
 * Nothing is confirmed, and nothing needs to be. A loadout that carries a
 * decision is written to the record it is autosaved into before it leaves, so
 * it stays in the saved list and can be opened again. A loadout still at its
 * suit's default is in no record, and wearing the suit reaches it again
 * (024/FR-002). Either way there is nothing to lose and so nothing to ask
 * about. A named record it was opened from is not touched at all: autosave
 * never writes to one.
 *
 * The tape goes with it, as it does when a loadout is opened from a record or a
 * link: the choices before it belong to a loadout that is no longer on the
 * bench, and undoing onto one would restore something the Commander never had
 * here.
 *
 * An application-layer action rather than a method on the page, because the
 * tool bar reaches it: the shell dispatches the action the registry declares
 * beside the tool and imports no bench component to do it.
 */
@Injectable({ providedIn: 'root' })
export class EmptyBenchService {
  readonly #store = inject(LoadoutStore);
  readonly #autosave = inject(LoadoutAutosaveService);
  readonly #links = inject(LoadoutLinkCoordinator);
  readonly #ownership = inject(TabOwnershipCoordinator);

  /** Empties the bench, or does nothing at all when it is already empty. */
  start(): void {
    if (!this.#store.hasLoadout()) {
      return;
    }

    // Before the bench lets go of it. A loadout that has just been changed has
    // a write owed on it, and this is the last moment anything holds it.
    //
    // And only once that write has landed. `flush()` answers whether letting go
    // loses anything: it is true when the write landed, and true when nothing
    // was owed at all, which is what a loadout still at its suit's default
    // answers (024/FR-002). It is false where the store cannot hold the
    // loadout, and clearing the bench would lose work instead. The bench then
    // stays as it is, and the notice already on it says why (017/FR-006).
    if (!this.#autosave.flush()) {
      return;
    }

    this.#store.open(null);
    // And out of this tab's claim, or the next page built here would restore
    // the loadout that was just cleared. The record stays where it is: it is
    // what makes clearing the bench cost nothing (017/FR-006).
    this.#ownership.release('equipment');
    // And out of the address. Replaced rather than added to, which is what
    // publishing does and why is on `LoadoutLinkCoordinator`.
    this.#links.publish();
  }

  /**
   * Has the bench let go of a record deleted on this page, and says whether it did.
   *
   * Whether the bench lets go at all is `LoadoutStore.clearIfHolding`, and the
   * reason is there. What is added here is the rest of letting go: the claim on
   * a record that is gone, and the loadout in the address.
   *
   * Nothing is flushed on the way out. There is nowhere to flush it to, which
   * is the whole of the event.
   *
   * What is deleted is the record, not the addresses behind this page. A
   * loadout one of those still carries opens again from there, as any loadout
   * in an address does: into a record of its own where it carries a choice, and
   * into no record where it is still at its suit's default. The deleted one is
   * never written back either way (017/FR-008, 024/FR-002). The claim this tab
   * held on it goes with it (017/FR-010).
   */
  clearHolding(recordId: string): boolean {
    if (!this.#store.clearIfHolding(recordId)) {
      return false;
    }

    this.#ownership.release('equipment');
    // And out of the address this page is on, before anything watching the
    // bench reads it: a bench cleared while its own link stands reads that link
    // straight back onto itself.
    this.#links.publish();
    return true;
  }
}
