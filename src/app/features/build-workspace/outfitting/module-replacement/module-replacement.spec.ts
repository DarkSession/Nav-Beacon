import { TestBed } from '@angular/core/testing';
import type { BuildCandidate } from '../../../../application/active-build/active-build.models';
import { ActiveBuildStore } from '../../../../application/active-build/active-build.store';
import { OutfittingStore } from '../../../../application/outfitting/outfitting.store';
import type { SlotView } from '../../../../application/outfitting/slot-view';
import {
  FIXTURE_SLOTS,
  defaultBuild,
} from '../../../../domain/ships/outfitting/outfitting.fixtures';
import { provideLocalization } from '../../../../i18n/i18n.providers';
import { provideIsolatedLocaleEnvironment } from '../../../../i18n/testing/localization-harness';
import { ModuleReplacement } from './module-replacement';
import { suppliedFit } from '../../../../domain/ships/build/supplied-fit';

/**
 * The chooser's states, from the outside.
 *
 * What matters here is that the six the contract names stay six: an empty
 * package answer, a search that found nothing, a build that moved underneath
 * and a mount that takes nothing at all look identical on screen — an empty
 * list — and a Commander needs a different sentence for each of them
 * (module-catalogue contract, "Search").
 */

function candidateFor(): BuildCandidate {
  return {
    loadout: defaultBuild(),
    suppliedFit: suppliedFit(defaultBuild().shipSymbol),
    hullName: 'Anaconda',
    provenance: 'stock',
    sourceNamed: null,
    autosaveRecordId: null,
    baseline: null,
  };
}

describe('module replacement surface', () => {
  let store: OutfittingStore;
  let active: ActiveBuildStore;

  function open(slotKey: string) {
    store.select(slotKey);
    const fixture = TestBed.createComponent(ModuleReplacement);
    fixture.componentRef.setInput('slot', slotFor(slotKey));
    fixture.detectChanges();
    return fixture;
  }

  /**
   * The same surface, told it is canvas 1d's full-screen layer.
   *
   * Set after the inline render and never re-rendered: `<dialog>.showModal()`
   * does not exist in the test environment, and what is being checked here is
   * the two-step the layer adds — pick, then commit — which is component state
   * rather than anything the layer draws.
   */
  function asLayer(fixture: ReturnType<typeof open>) {
    fixture.componentRef.setInput('asLayer', true);
    return fixture;
  }

  function slotFor(slotKey: string): SlotView {
    const slot = store.slots().find((candidate) => candidate.key === slotKey);
    if (slot === undefined) {
      throw new Error(`The fixture hull has no ${slotKey} mount.`);
    }
    return slot;
  }

  /**
   * How many rows the chooser has actually built.
   *
   * Counted off the families it draws rather than read from a figure on the
   * surface: neither canvas draws one, so there is nothing there to read
   * (design-canvas rule, wave 3). Every family's choices are counted, open or
   * not — what a closed family withholds from the *document* is still part of
   * the list the Commander was offered.
   */
  function built(instance: ModuleReplacement): number {
    return instance.families().reduce((total, family) => total + family.choices.length, 0);
  }

  /** The first choice the chooser offers, wherever its family puts it. */
  function firstChoice(instance: ModuleReplacement) {
    return instance.families()[0]!.choices[0]!;
  }

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideLocalization(), ...provideIsolatedLocaleEnvironment()],
    });
    active = TestBed.inject(ActiveBuildStore);
    store = TestBed.inject(OutfittingStore);
    active.commit(candidateFor());
  });

  it('offers the package’s whole expansion for a mount that takes modules', () => {
    const fixture = open(FIXTURE_SLOTS.hardpoint);

    expect(fixture.componentInstance.state()).toBe('ready');
    expect(fixture.componentInstance.resultCount()).toBe(store.membership()?.choices.length ?? 0);
    expect(fixture.componentInstance.families().length).toBeGreaterThan(0);
  });

  it('renders the whole expansion, so the scroller knows how tall it is', () => {
    const fixture = open(FIXTURE_SLOTS.hardpoint);
    const instance = fixture.componentInstance;

    // Every choice, in the document, from the first frame. A list that grew as
    // it was scrolled could not tell the browser its height, and its scrollbar
    // shrank under the Commander every time it grew (wave 4).
    expect(built(instance)).toBe(instance.resultCount());
    expect(instance.resultCount()).toBeGreaterThan(100);
  });

  it('narrows to the matches and back, with no page state in between', () => {
    const fixture = open(FIXTURE_SLOTS.hardpoint);
    const instance = fixture.componentInstance;
    const all = instance.resultCount();

    instance.search('multi');
    fixture.detectChanges();
    expect(built(instance)).toBe(instance.resultCount());
    expect(instance.resultCount()).toBeLessThan(all);

    instance.clear();
    fixture.detectChanges();
    expect(built(instance)).toBe(all);
  });

  it('separates a successful empty answer from a search that found nothing', () => {
    const empty = open(FIXTURE_SLOTS.cargoHatch);
    // The hatch's menus come back empty, so the surface never opens a chooser
    // over it at all — it says the Almanac takes nothing else there.
    expect(empty.componentInstance.state()).toBe('notReplaceable');

    const searched = open(FIXTURE_SLOTS.hardpoint);
    store.setQuery('zzzz nothing');
    searched.detectChanges();

    expect(searched.componentInstance.state()).toBe('noMatches');
    expect(searched.componentInstance.canClear()).toBe(true);
  });

  it('restores every choice when the query is cleared, without touching the build', () => {
    const fixture = open(FIXTURE_SLOTS.hardpoint);
    const all = fixture.componentInstance.resultCount();
    const revision = active.revision();

    store.setQuery('zzzz nothing');
    fixture.detectChanges();
    expect(fixture.componentInstance.resultCount()).toBe(0);

    fixture.componentInstance.clear();
    fixture.detectChanges();

    expect(fixture.componentInstance.resultCount()).toBe(all);
    expect(active.revision()).toBe(revision);
  });

  it('takes a row as the fit where the panel is drawn without a commit control', () => {
    // Canvas 1c draws no `FIT MODULE`: the amber row is the module in the
    // mount, and choosing another row is the fit. One decision, one revision.
    const fixture = open(FIXTURE_SLOTS.hardpoint);
    const revision = active.revision();
    const choice = firstChoice(fixture.componentInstance);

    fixture.componentInstance.choose(choice.key);
    fixture.detectChanges();

    expect(active.revision()).toBe(revision + 1);
  });

  it('marks the module already in the mount as the chosen row', () => {
    // Opening a fitted mount already opened the right family and already
    // scrolled the right row into view. What it did not do was say which row
    // was chosen: every control in the group reported unchecked, and what is
    // fitted was carried by the row's own ground alone (Commander request
    // 2026-08-26).
    const fixture = open(FIXTURE_SLOTS.fittedHardpoint);
    const fitted = fixture.componentInstance
      .query()
      ?.choices.find((choice) => choice.key === fixture.componentInstance.markedChoiceKey());

    expect(fixture.componentInstance.markedChoiceKey()).not.toBeNull();
    expect(fitted).toBeDefined();

    // And it is a mark, not a decision: the layer's commit control stays
    // disarmed until a Commander actually takes a row, so pressing it cannot
    // spend a press re-fitting what is already there.
    expect(fixture.componentInstance.selectedChoiceKey()).toBeNull();
    expect(fixture.componentInstance.canFit()).toBe(false);
  });

  it('marks nothing on a mount with nothing in it', () => {
    const fixture = open(FIXTURE_SLOTS.hardpoint);

    expect(fixture.componentInstance.markedChoiceKey()).toBeNull();
  });

  it('fits the same module to a second mount after fitting it to the first', () => {
    // The reported case. Two hardpoints of the same size are offered the same
    // modules under the same keys, so the row is the *same* row on both — and a
    // pick that outlived the mount it was made for left that row marked, and
    // the radio the browser had checked was never written back. Pressing it
    // again changed nothing, so nothing happened (reported 2026-08-26).
    //
    // Selecting a mount spends no revision, which is why the revision check
    // alone could not catch this: the pick has to be about a *mount* as well as
    // about a build.
    // Two mounts of one size on the reference hull, so both are offered the
    // same modules and the row really is the same row.
    const first = open('LargeHardpoint1');
    const choice = firstChoice(first.componentInstance);
    first.componentInstance.choose(choice.key);
    first.detectChanges();

    // The pick is spent, and the mount itself is what marks the row from here:
    // the manifest goes on marking exactly what was chosen, without holding a
    // decision that has already been taken.
    expect(first.componentInstance.selectedChoiceKey()).toBeNull();
    expect(first.componentInstance.markedChoiceKey()).toBe(choice.key);

    const revision = active.revision();
    const second = open('LargeHardpoint2');

    // Nothing is carried over: this is a different mount, so no row is marked
    // and the control that draws it is written back to unchecked.
    expect(second.componentInstance.selectedChoiceKey()).toBeNull();

    // The very same row, which is the whole of the report.
    second.componentInstance.choose(choice.key);
    second.detectChanges();

    expect(active.revision()).toBe(revision + 1);
    expect(second.componentInstance.markedChoiceKey()).toBe(choice.key);
  });

  it('writes the row\u2019s control back to unchecked when the mount changes', () => {
    // The same report, at the level it actually broke. One surface is kept and
    // handed a different mount — which is what the workspace does — so the rows
    // are re-rendered rather than rebuilt, and a row with the same key keeps its
    // own element. Angular writes `checked` only when the bound expression
    // *changes*, so a binding that reads `false` on both mounts leaves an input
    // the browser has physically checked exactly as it was. Pressing it then
    // fires no `change` event at all, and there is nothing for a handler to fix.
    store.select('LargeHardpoint1');
    const fixture = TestBed.createComponent(ModuleReplacement);
    fixture.componentRef.setInput('slot', slotFor('LargeHardpoint1'));
    fixture.detectChanges();

    const choice = firstChoice(fixture.componentInstance);
    const radioFor = (key: string): HTMLInputElement | null =>
      [
        ...(fixture.nativeElement as HTMLElement).querySelectorAll<HTMLInputElement>(
          'input.candidate__radio',
        ),
      ].find((input) => input.value === key) ?? null;

    fixture.componentInstance.choose(choice.key);
    fixture.detectChanges();
    expect(radioFor(choice.key)?.checked).toBe(true);

    // The Commander marks a different mount in the ledger. No revision is spent
    // — nothing about the build changed — so only the mount tells the surface
    // that the row it had marked is no longer the row in front of it.
    store.select('LargeHardpoint2');
    fixture.componentRef.setInput('slot', slotFor('LargeHardpoint2'));
    fixture.detectChanges();

    expect(radioFor(choice.key)?.checked).toBe(false);
  });

  it('spends no revision on picking a row, and one on fitting it, as a layer', () => {
    // Canvas 1d is where the two-control bar is, because at that width the
    // chooser is a screen of its own and leaving it has to be a decision.
    const fixture = asLayer(open(FIXTURE_SLOTS.hardpoint));
    const revision = active.revision();
    const choice = firstChoice(fixture.componentInstance);

    fixture.componentInstance.choose(choice.key);

    expect(fixture.componentInstance.canFit()).toBe(true);
    expect(active.revision()).toBe(revision);

    fixture.componentInstance.fit();

    expect(active.revision()).toBe(revision + 1);
  });

  it('drops a pick the build has moved out from under, and says so', () => {
    const fixture = asLayer(open(FIXTURE_SLOTS.hardpoint));
    const choice = firstChoice(fixture.componentInstance);

    fixture.componentInstance.choose(choice.key);
    // Something else edits the build. The pick was about a revision that is no
    // longer on screen, so it stops being a pick rather than becoming a fit of
    // a record the Almanac would refuse.
    store.dispatch({ kind: 'remove', slotKey: FIXTURE_SLOTS.fittedOptional });

    expect(fixture.componentInstance.stale()).toBe(true);
    expect(fixture.componentInstance.selectedChoiceKey()).toBeNull();
    expect(fixture.componentInstance.canFit()).toBe(false);
    expect(fixture.componentInstance.state()).toBe('stale');
  });

  it('opens the fitted module\u2019s family alone, and closes it without a revision', () => {
    const fixture = open(FIXTURE_SLOTS.fittedHardpoint);
    const instance = fixture.componentInstance;
    const revision = active.revision();

    const open_ = instance.families().filter((family) => family.open);
    expect(open_.length).toBe(1);
    // It is the family holding the row the list marks as fitted (FR-021).
    const fittedSymbol = instance.fittedSymbol();
    expect(open_[0]!.choices.some((choice) => choice.module.symbol === fittedSymbol)).toBe(true);

    instance.toggleFamily(open_[0]!.familyId);
    fixture.detectChanges();

    expect(instance.families().every((family) => !family.open)).toBe(true);
    // View state, and nothing more: no revision, no history, no rebuilt list.
    expect(active.revision()).toBe(revision);
    expect(built(instance)).toBe(instance.resultCount());
  });

  it('opens every family a search matched, and reseeds when it is cleared', () => {
    const fixture = open(FIXTURE_SLOTS.fittedHardpoint);
    const instance = fixture.componentInstance;
    const seeded = instance.families().filter((family) => family.open).length;

    instance.search('cannon');
    fixture.detectChanges();

    const families = instance.families();
    expect(families.length).toBeGreaterThan(0);
    // No match is behind a closed control, and a family with none is absent.
    expect(families.every((family) => family.open)).toBe(true);

    instance.clear();
    fixture.detectChanges();

    expect(instance.families().filter((family) => family.open).length).toBe(seeded);
  });

  it('leaves the build and the query alone when it is cancelled', () => {
    const fixture = asLayer(open(FIXTURE_SLOTS.hardpoint));
    const revision = active.revision();

    store.setQuery('multi');
    fixture.componentInstance.choose(firstChoice(fixture.componentInstance).key);
    fixture.componentInstance.cancel();

    expect(active.revision()).toBe(revision);
    expect(store.query()).toBe('');
    expect(fixture.componentInstance.selectedChoiceKey()).toBeNull();
  });
});
