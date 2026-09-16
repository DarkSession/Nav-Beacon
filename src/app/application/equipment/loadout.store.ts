import { Injectable, computed, signal } from '@angular/core';
import type { RecordSource } from '../../domain/records/local-record';
import type { RecordPayload } from '../../domain/records/local-record.serializer';
import { isDirty } from '../../domain/records/record-fingerprint';
import { atSuitDefault } from '../../domain/equipment/loadout/loadout-default';
import { loadoutFingerprint } from '../../domain/equipment/loadout/loadout-fingerprint';
import type { PersistenceStatus, WorkingRecordSubject } from '../build-library/working-record.port';
import type { PersonalMountKey } from '@elite-dangerous-almanac/core/equipment/suits';
import type { EquipmentLoadout } from '../../domain/equipment/loadout-link/equipment-loadout';
import {
  clearSlot,
  fitModification,
  fitWeapon,
  newLoadout,
  selectSuit,
  setSuitGrade,
  setWeaponGrade,
  type EditTarget,
} from '../../domain/equipment/loadout/loadout-edit';
import { mountAvailability } from '../../domain/equipment/loadout/loadout-mounts';
import {
  emptyLoadoutHistory,
  recordLoadout,
  redoLoadout,
  undoLoadout,
  type LoadoutHistory,
} from './loadout-history';

/** One outfitting choice a Commander made, as the bench dispatches it. */
export type LoadoutEdit =
  | { readonly kind: 'selectSuit'; readonly suitFamily: string }
  | { readonly kind: 'setSuitGrade'; readonly grade: number }
  | { readonly kind: 'fitWeapon'; readonly mount: PersonalMountKey; readonly symbol: string | null }
  | { readonly kind: 'setWeaponGrade'; readonly mount: PersonalMountKey; readonly grade: number }
  | {
      readonly kind: 'fitModification';
      readonly target: EditTarget;
      readonly slot: number;
      readonly symbol: string;
    }
  | { readonly kind: 'clearSlot'; readonly target: EditTarget; readonly slot: number };

/**
 * The bench's open loadout, what is selected, and the session's undo tape.
 *
 * The loadout is the only thing here that is ever saved or shared. The
 * selection is workflow — which item the item view is showing — and is never
 * serialized, encoded into a link or exported.
 *
 * Every choice goes through `domain/equipment/loadout/loadout-edit`, which
 * returns the loadout unchanged when the choice would produce one the game
 * cannot hold. An unchanged loadout spends no revision and no history frame, so
 * undo never has a step that does nothing.
 */
@Injectable({ providedIn: 'root' })
export class LoadoutStore implements WorkingRecordSubject {
  readonly #loadout = signal<EquipmentLoadout | null>(null);
  // The bench opens pointing at the suit, whether one is worn or not: canvas 2a
  // draws the suit row marked while it is still a choice, because it is the row
  // the gate beside it is asking about.
  readonly #selected = signal<EditTarget | null>('suit');
  readonly #source = signal<RecordSource | null>(null);
  readonly #history = signal<LoadoutHistory>(emptyLoadoutHistory());
  readonly #revision = signal(0);
  readonly #autosaveRecordId = signal<string | null>(null);
  readonly #baseline = signal<string | null>(null);
  readonly #persistence = signal<PersistenceStatus>('ready');

  /** Which tool's records this store's work is written into. */
  readonly tool = 'equipment' as const;

  /** The open loadout, or none while the bench is empty. */
  readonly loadout = this.#loadout.asReadonly();
  readonly hasLoadout = computed(() => this.#loadout() !== null);

  /** Which item the item view is showing, or none. */
  readonly selected = this.#selected.asReadonly();

  /**
   * The saved record this loadout came from, while it came from one.
   *
   * What makes "replace the loadout I opened" a question the save layer can
   * ask. A loadout started here has no source, so that choice is not offered
   * for it (013 contracts/loadout-persistence.md). It is also what a working
   * record records it was forked from, which is why autosave reads it.
   */
  readonly sourceNamed = this.#source.asReadonly();

  /** The unnamed record this page autosaves this loadout into, or none yet. */
  readonly autosaveRecordId = this.#autosaveRecordId.asReadonly();

  /** What persistence is doing for the bench, or cannot do. */
  readonly persistence = this.#persistence.asReadonly();

  /** Changes once per committed choice, and never for a refused one. */
  readonly revision = this.#revision.asReadonly();

  readonly canUndo = computed(() => this.#history().past.length > 0);
  readonly canRedo = computed(() => this.#history().future.length > 0);

  /** The fingerprint of the loadout's own choices, recomputed once per change. */
  readonly fingerprint = computed<string | null>(() => {
    this.#revision();
    const loadout = this.#loadout();
    return loadout === null ? null : loadoutFingerprint(loadout);
  });

  /** Whether the bench holds anything autosave has not written yet. */
  readonly dirty = computed(() => isDirty(this.fingerprint(), this.#baseline()));

  /** Whether the loadout is still the one the bench starts for its suit. */
  readonly atDefault = computed(() => {
    this.#revision();
    const loadout = this.#loadout();
    return loadout !== null && atSuitDefault(loadout);
  });

  /**
   * What autosave writes for this loadout, or `null` while the bench is empty.
   *
   * Held content travels with it. A weapon in a mount the worn suit does not
   * carry, and a modification in a locked slot, are choices a Commander made
   * and the serializer keeps them (013/FR-018a).
   */
  payload(): RecordPayload | null {
    const loadout = this.#loadout();
    return loadout === null ? null : { tool: 'equipment', loadout };
  }

  /** The record this page autosaves into. Minted or taken over by autosave. */
  setAutosaveRecordId(recordId: string | null): void {
    this.#autosaveRecordId.set(recordId);
  }

  /** Marks the loadout on the bench as the stored baseline. */
  markSaved(sourceNamed: RecordSource | null): void {
    this.#baseline.set(this.fingerprint());
    if (sourceNamed !== null) {
      this.#source.set(sourceNamed);
    }
  }

  setPersistence(status: PersistenceStatus): void {
    this.#persistence.set(status);
  }

  /** What each catalogue mount is to the open loadout, in mount order. */
  readonly mounts = computed(() => {
    const loadout = this.#loadout();
    return loadout === null ? [] : mountAvailability(loadout);
  });

  /**
   * Opens a loadout that came from somewhere else — a saved record, or a link.
   *
   * Not an edit: the tape starts empty, because the loadouts before it belonged
   * to a different bench and undoing onto one would restore something the
   * Commander never had here.
   *
   * `stored` says what record the loadout arrives in. An unnamed record is
   * taken over, because it is already what autosave writes to, and its state is
   * the baseline, so opening it writes nothing and does not restart the seven
   * days it is counting down. A named record is only held: the bench writes
   * nothing to it and forks an unnamed record at the first change. A loadout
   * that arrives in no record — a link, or one read from a journal — has no
   * baseline, which is what sends autosave to mint or take over a record for it
   * (001/FR-008, 017/FR-007).
   *
   * The persistence state goes back to `ready` with it. What it said was about
   * the loadout that was on the bench — a store that refused a write, or a
   * record another page discarded — and a notice about that one standing over
   * this one states something a Commander cannot act on (017/FR-008).
   */
  open(
    loadout: EquipmentLoadout | null,
    source: RecordSource | null = null,
    stored: { readonly autosaveRecordId?: string | null; readonly baseline?: string | null } = {},
  ): void {
    this.#loadout.set(loadout);
    this.#source.set(loadout === null ? null : source);
    this.#selected.set('suit');
    this.#history.set(emptyLoadoutHistory());
    this.#autosaveRecordId.set(loadout === null ? null : (stored.autosaveRecordId ?? null));
    this.#baseline.set(loadout === null ? null : (stored.baseline ?? null));
    this.#persistence.set('ready');
    this.#revision.update((revision) => revision + 1);
  }

  /**
   * Clears the bench if the loadout on it lives in this record, and says
   * whether it did.
   *
   * The rule the workspace follows for a build, and for its reasons:
   * `ActiveBuildStore.clearIfHolding`. What differs is only what emptying
   * means here — the bench opens on nothing rather than clearing a build.
   */
  clearIfHolding(recordId: string): boolean {
    if (this.#autosaveRecordId() !== recordId) {
      return false;
    }
    this.open(null);
    return true;
  }

  /** Shows one item in the item view, or none. */
  select(target: EditTarget | null): void {
    this.#selected.set(target);
  }

  /**
   * Applies one choice.
   *
   * Selecting a suit on an empty bench starts a loadout; every other choice
   * needs one open. Answers whether anything changed, so a caller can leave a
   * chooser open on a refusal rather than closing it on nothing.
   */
  dispatch(edit: LoadoutEdit): boolean {
    const current = this.#loadout();
    if (current === null) {
      if (edit.kind !== 'selectSuit') return false;
      const started = newLoadout(edit.suitFamily);
      if (started === null) return false;
      this.#loadout.set(started);
      // Started here, so it belongs to no save and to no record until one is
      // written. A loadout the bench starts is the suit's own default, so
      // autosave owes it nothing and takes a record at the first choice made on
      // it (024/FR-002).
      this.#source.set(null);
      this.#autosaveRecordId.set(null);
      this.#baseline.set(null);
      this.#selected.set('suit');
      this.#revision.update((revision) => revision + 1);
      return true;
    }

    const next = apply(current, edit);
    if (next === current) return false;
    this.#history.update((history) => recordLoadout(history, current));
    this.#loadout.set(next);
    this.#revision.update((revision) => revision + 1);
    return true;
  }

  undo(): boolean {
    return this.#move(undoLoadout);
  }

  redo(): boolean {
    return this.#move(redoLoadout);
  }

  #move(
    step: (
      history: LoadoutHistory,
      current: EquipmentLoadout,
    ) => { readonly restore: EquipmentLoadout; readonly next: LoadoutHistory } | null,
  ): boolean {
    const current = this.#loadout();
    if (current === null) return false;
    const transition = step(this.#history(), current);
    if (transition === null) return false;
    this.#history.set(transition.next);
    this.#loadout.set(transition.restore);
    this.#revision.update((revision) => revision + 1);
    return true;
  }
}

function apply(loadout: EquipmentLoadout, edit: LoadoutEdit): EquipmentLoadout {
  switch (edit.kind) {
    case 'selectSuit':
      return selectSuit(loadout, edit.suitFamily);
    case 'setSuitGrade':
      return setSuitGrade(loadout, edit.grade);
    case 'fitWeapon':
      return fitWeapon(loadout, edit.mount, edit.symbol);
    case 'setWeaponGrade':
      return setWeaponGrade(loadout, edit.mount, edit.grade);
    case 'fitModification':
      return fitModification(loadout, edit.target, edit.slot, edit.symbol);
    case 'clearSlot':
      return clearSlot(loadout, edit.target, edit.slot);
  }
}
