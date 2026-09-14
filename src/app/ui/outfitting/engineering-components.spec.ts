import type { GameTextPresentation } from '../../i18n/game-text.presenter';
import {
  accessibleName,
  element,
  query,
  renderComponent,
  textOf,
} from '../components/ui-component.spec-helpers';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import germanCatalogue from '../../i18n/locales/de.json';
import type { MessageCatalogue } from '../../i18n/locale-registry';
import { LocaleStore } from '../../i18n/locale.store';
import { AnnouncementService } from '../announcements/announcement.service';
import { AttributeComparison } from './attribute-comparison';
import { BlueprintChoiceList } from './blueprint-choice-list';
import { ExperimentalEffectList } from './experimental-effect-list';
import { FixedExperimentalEffect } from './fixed-experimental-effect';
import { GradeSelector } from './grade-selector';
import { IngressRefusalNotice } from './ingress-refusal-notice';
import { sortMaterialLines } from './material-lines';
import { PowerControls } from './power-controls';
import { ShipIdentityFields } from './ship-identity-fields';

/**
 * What the engineering primitives promise a reader.
 *
 * The recurring subject is honesty about absence and about direction: `[]` and
 * `null` never look alike, a value the Almanac does not publish is a word
 * rather than a zero, and nothing anywhere says which way is better —
 * because nothing in the package says so either (FR-007, FR-013).
 */

const LOCALIZED: GameTextPresentation = {
  text: 'Overcharged',
  language: 'en',
  translationState: 'localized',
  disclosureKey: null,
};

function named(text: string): GameTextPresentation {
  return { ...LOCALIZED, text };
}

describe('blueprint choice list', () => {
  const CHOICES = [
    { fdname: 'Weapon_Overcharged', name: named('Overcharged'), route: 'ordinary', applied: true },
    { fdname: 'Weapon_LongRange', name: named('Long Range'), route: 'mercenary', applied: false },
  ];

  it('opens with the explicit no-blueprint option, at every width', () => {
    const fixture = renderComponent(BlueprintChoiceList, { choices: CHOICES });

    const options = queryAll(fixture, '.blueprint');
    // First, and always present. It is the only route to clearing ordinary
    // engineering, so a composition without it would be a width that cannot
    // clear (engineering editor design, "Clearing engineering").
    expect(options[0]?.classList.contains('blueprint--none')).toBe(true);
    // The name and nothing else: neither canvas writes a line under it.
    expect(textOf(options[0]!)).toContain('None');
  });

  it('offers no separate clear control anywhere', () => {
    const fixture = renderComponent(BlueprintChoiceList, { choices: CHOICES });

    expect(queryAll(fixture, 'button')).toHaveLength(0);
  });

  it('states which recipe is applied rather than only colouring it', () => {
    const fixture = renderComponent(BlueprintChoiceList, { choices: CHOICES });

    expect(textOf(element(fixture))).toContain('Applied');
  });

  it('discloses what clearing would also cost, on the option that would do it', () => {
    const fixture = renderComponent(BlueprintChoiceList, {
      choices: CHOICES,
      clearConsequence: 'This also removes the purchase record.',
    });

    expect(textOf(query(fixture, '.blueprint--none'))).toContain('removes the purchase record');
  });

  it('carries no derived claim about what a recipe does', () => {
    const fixture = renderComponent(BlueprintChoiceList, { choices: CHOICES });

    // The canvas draws `DAMAGE ▲ · THERMAL LOAD ▲`. The Almanac publishes no
    // such description, so writing one would be a private claim about game
    // mechanics (FR-007).
    const text = textOf(element(fixture));
    expect(text).not.toContain('▲');
    expect(text).not.toContain('▼');
  });
});

describe('grade selector', () => {
  it('hatches the grades below the one a recipe starts at, and keeps them pressable', () => {
    // A bespoke Mercenary recipe starts at the grade the article was bought
    // at. The cells below it are still drawn — the article carries them — and
    // refused, so the bar never says the article is a grade short (wave 4).
    const fixture = renderComponent(GradeSelector, {
      grades: [1, 2, 3, 4, 5],
      lowest: 2,
      selected: 5,
    });

    const cells = queryAll(fixture, '.grade');
    expect(cells).toHaveLength(5);
    // Hatched, not refused: an article bought at grade 2 can still be taken
    // back down to 1, so the cell has to be pressable (wave 5).
    expect(cells[0]!.getAttribute('data-unavailable')).toBe('true');
    expect((cells[0]!.querySelector('input') as HTMLInputElement).disabled).toBe(false);
    expect(cells[1]!.getAttribute('data-unavailable')).toBe('false');

    // And the cell says which it is. The hatch is drawn to the non-text
    // contrast floor, but a mark is not a statement: nothing else on the cell
    // distinguishes a grade the recipe cannot reach from one it can, and a
    // state carried by the drawing alone is the one thing never allowed
    // (constitution V).
    const nameOf = (cell: Element): string =>
      (cell.querySelector('input') as HTMLInputElement).getAttribute('aria-label') ?? '';
    expect(nameOf(cells[0]!)).not.toBe(nameOf(cells[1]!));
    expect(nameOf(cells[0]!).length).toBeGreaterThan(nameOf(cells[1]!).length);
    expect(nameOf(cells[0]!)).toContain('1');
    expect(nameOf(cells[1]!)).toContain('2');
  });

  it('names each cell, so a bare number is never the whole label', () => {
    const fixture = renderComponent(GradeSelector, { grades: [1, 2], selected: 1 });

    expect(accessibleName(query(fixture, '.grade__radio'))).toBe('Grade 1');
  });

  it('states the chosen grade beside the label, not by the fill alone', () => {
    const fixture = renderComponent(GradeSelector, { grades: [1, 2, 3], selected: 3 });

    // The number is beside the legend, not inside the cells: the canvas draws
    // the bar bare, and every cell still names its own grade to a reader.
    expect(textOf(query(fixture, '.grades__selected'))).toBe('3');
    expect(
      (query(fixture, '.grade[data-selected="true"] .grade__radio') as HTMLInputElement).checked,
    ).toBe(true);
  });

  it('draws canvas 1d’s numbered buttons where the editor is a layer', () => {
    // Canvas 1c fills a bare bar to the chosen grade; canvas 1d draws five
    // numbered buttons with only the chosen one filled. Built as 1c's control
    // alone, the phone showed a row of five identical amber blocks with no
    // digit on any of them (Commander request 2026-08-26).
    const fixture = renderComponent(GradeSelector, {
      grades: [1, 2, 3, 4, 5],
      selected: 3,
      asSteps: true,
    });

    expect(queryAll(fixture, '.grade__number').map((cell) => textOf(cell))).toEqual([
      '1',
      '2',
      '3',
      '4',
      '5',
    ]);
    // One button is the chosen one. Filling the four below it would be four
    // buttons claiming to be pressed.
    expect(
      queryAll(fixture, '.grade')
        .filter((cell) => cell.getAttribute('data-filled') === 'true')
        .map((cell) => textOf(cell)),
    ).toEqual(['3']);
    // And the grade is not also written beside the legend: the cells say it.
    expect(queryAll(fixture, '.grades__selected')).toHaveLength(0);
  });

  it('exposes no quality or roll control of any kind', () => {
    const fixture = renderComponent(GradeSelector, { grades: [1, 2, 3, 4, 5], selected: 5 });

    const text = textOf(element(fixture)).toLowerCase();
    expect(text).not.toContain('roll');
    expect(text).not.toContain('quality');
    expect(element(fixture).querySelector('input[type="range"]')).toBeNull();
  });
});

describe('experimental effect list', () => {
  const EFFECTS = [
    {
      fdname: 'special_corrosive_shell',
      name: named('Corrosive Shell'),
      description: named('Rounds reduce the target’s hull resistance.'),
      applied: true,
    },
  ];

  it('opens with the explicit no-effect option', () => {
    const fixture = renderComponent(ExperimentalEffectList, { effects: EFFECTS });

    const options = queryAll(fixture, '.effect');
    expect(options[0]?.classList.contains('effect--none')).toBe(true);
    expect(textOf(options[0]!)).toContain('None');
  });

  it('shows the package’s own description rather than one of ours', () => {
    const fixture = renderComponent(ExperimentalEffectList, { effects: EFFECTS });

    expect(textOf(element(fixture))).toContain('reduce the target’s hull resistance');
  });

  it('draws no description line for an effect the catalogue has none for', () => {
    // Reversed 2026-08-26. The line used to stand in with `Name unavailable`,
    // on the reading that going quiet hides a gap. It is not a name, and the
    // option is already named on the line above it. The catalogue carries a
    // description for every effect it knows, so this is the floor for a symbol
    // it does not (Commander request).
    const fixture = renderComponent(ExperimentalEffectList, {
      effects: [
        {
          ...EFFECTS[0]!,
          description: {
            text: null,
            language: null,
            translationState: 'unavailable',
            disclosureKey: 'game-text.unavailable',
          },
        },
      ],
    });

    expect(queryAll(fixture, '.effect__description')).toHaveLength(0);
    // The effect is still named, and a name the catalogue has lost still says so.
    expect(textOf(query(fixture, '.effect__name')).length).toBeGreaterThan(0);
  });
});

describe('fixed experimental effect', () => {
  it('states a localized effect and its fixed restriction', () => {
    const fixture = renderComponent(FixedExperimentalEffect, { effect: named('Screening Shell') });

    expect(textOf(element(fixture))).toContain('Screening Shell');
    expect(textOf(element(fixture))).toContain('fixed and cannot be changed');
  });

  it('discloses canonical text in its actual language', () => {
    const fixture = renderComponent(FixedExperimentalEffect, {
      effect: {
        text: 'Screening Shell',
        language: 'en',
        translationState: 'canonical',
        disclosureKey: 'game-text.untranslated.description',
      },
    });
    const value = query(fixture, '.game-text__value');

    expect(value.getAttribute('lang')).toBe('en');
    expect(value.getAttribute('aria-describedby')).not.toBeNull();
    expect(textOf(query(fixture, '.game-text__disclosure'))).toContain('original language');
  });

  it('states unavailable text without exposing an identity', () => {
    const fixture = renderComponent(FixedExperimentalEffect, {
      effect: {
        text: null,
        language: null,
        translationState: 'unavailable',
        disclosureKey: 'game-text.unavailable',
      },
    });

    expect(textOf(element(fixture))).toContain('Name unavailable');
    expect(textOf(element(fixture))).not.toContain('special_');
  });

  it('ships its fixed-state text in German', () => {
    expect(germanCatalogue['outfitting.engineering.effect.fixed']).toBeTruthy();
    expect(germanCatalogue['outfitting.engineering.effect.fixed-description']).toBeTruthy();
  });
});

/**
 * The same component in canvas 1c's shape, which is the application's own
 * control rather than the platform's.
 *
 * A native `<select>` option holds one run of text, so the package's
 * description had to be glued onto the name and the menu became thirteen
 * sentences (Commander request 2026-08-30). What a drawn menu owes in return is
 * everything the platform was providing: the roles, the open state, the way
 * out, and a name that is disclosed rather than assumed — which is what this
 * suite holds it to.
 */
describe('experimental effect menu', () => {
  const EFFECTS = [
    {
      fdname: 'special_corrosive_shell',
      name: named('Corrosive Shell'),
      description: named('Rounds reduce the target’s hull resistance.'),
      applied: true,
    },
    {
      fdname: 'special_auto_loader',
      name: named('Auto Loader'),
      description: named('Reloads the weapon while it continues firing.'),
      applied: false,
    },
  ];

  function renderMenu(inputs: Record<string, unknown> = {}) {
    return renderComponent(ExperimentalEffectList, {
      asDropdown: true,
      effects: EFFECTS,
      ...inputs,
    });
  }

  function openMenu(fixture: ComponentFixture<ExperimentalEffectList>) {
    query(fixture, '.menu__trigger').click();
    fixture.detectChanges();
    return fixture;
  }

  it('draws a trigger and no list until the trigger is pressed', () => {
    const fixture = renderMenu();

    const trigger = query(fixture, '.menu__trigger');
    expect(trigger.getAttribute('aria-haspopup')).toBe('listbox');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(queryAll(fixture, '.menu__list')).toHaveLength(0);
    // Nothing to control while there is no list: an `aria-controls` pointing at
    // an element that is not in the document is a broken reference.
    expect(trigger.getAttribute('aria-controls')).toBeNull();
  });

  it('names the chosen effect on the trigger while the list is shut', () => {
    const fixture = renderMenu({ selected: 'special_auto_loader' });

    expect(textOf(query(fixture, '.menu__value'))).toContain('Auto Loader');
  });

  it('reads as the no-effect option when nothing is chosen, never as a symbol', () => {
    const fixture = renderMenu({ selected: null });

    const value = textOf(query(fixture, '.menu__value'));
    expect(value).toContain('None');
    expect(value).not.toContain('special_');
  });

  it('draws the trigger’s name through the game-text component', () => {
    // The one place in this control where the disclosure could be dropped: a
    // name printed as plain text presents an untranslated noun as a translation
    // (constitution VI, FR-020). The options were always drawn this way.
    const fixture = renderMenu({ selected: 'special_corrosive_shell' });

    expect(query(fixture, '.menu__value').querySelector('ednb-game-text')).not.toBeNull();
  });

  it('opens a listbox whose options carry the package’s two lines', () => {
    const fixture = openMenu(renderMenu({ selected: 'special_corrosive_shell' }));

    const list = query(fixture, '.menu__list');
    expect(list.getAttribute('role')).toBe('listbox');
    expect(query(fixture, '.menu__trigger').getAttribute('aria-expanded')).toBe('true');
    expect(query(fixture, '.menu__trigger').getAttribute('aria-controls')).toBe(list.id);

    const options = queryAll(fixture, '.menu__option');
    // The way out, then the package's own two.
    expect(options).toHaveLength(EFFECTS.length + 1);
    expect(options[0]?.classList.contains('menu__option--none')).toBe(true);
    expect(textOf(options[1]!)).toContain('Corrosive Shell');
    expect(textOf(options[1]!)).toContain('reduce the target’s hull resistance');
  });

  it('says which option is the selected one', () => {
    const fixture = openMenu(renderMenu({ selected: 'special_auto_loader' }));

    const selected = queryAll(fixture, '.menu__option').filter(
      (option) => option.getAttribute('aria-selected') === 'true',
    );
    expect(selected).toHaveLength(1);
    expect(textOf(selected[0]!)).toContain('Auto Loader');
  });

  it('marks the no-effect option as selected when nothing is chosen', () => {
    const fixture = openMenu(renderMenu({ selected: null }));

    const none = query(fixture, '.menu__option--none');
    expect(none.getAttribute('aria-selected')).toBe('true');
  });

  it('names both the trigger and the list from the control’s own label', () => {
    const fixture = openMenu(renderMenu());

    const label = query(fixture, '.menu__label');
    const trigger = query(fixture, '.menu__trigger');
    // The label says which choice this is and the trigger says what it holds;
    // either alone is half the answer.
    expect(trigger.getAttribute('aria-labelledby')).toBe(`${label.id} ${trigger.id}`);
    expect(query(fixture, '.menu__list').getAttribute('aria-labelledby')).toBe(label.id);
  });

  it('takes the focus when it opens, and names the option it is on', () => {
    const fixture = openMenu(renderMenu({ selected: null }));

    const list = query(fixture, '.menu__list');
    expect(list.getAttribute('tabindex')).toBe('0');
    expect(document.activeElement).toBe(list);
    // Opened on the applied option, which with nothing chosen is the way out.
    expect(list.getAttribute('aria-activedescendant')).toBe(
      query(fixture, '.menu__option--none').id,
    );
  });

  it('opens on the applied option rather than at the top of the list', () => {
    const fixture = openMenu(renderMenu({ selected: 'special_auto_loader' }));

    const active = query(fixture, '.menu__list').getAttribute('aria-activedescendant');
    expect(queryAll(fixture, '.menu__option')[2]?.id).toBe(active);
  });

  it('walks the options with the arrows, and reaches the ends', () => {
    const fixture = openMenu(renderMenu({ selected: null }));
    const list = query(fixture, '.menu__list');
    const idAt = (index: number) => queryAll(fixture, '.menu__option')[index]?.id;

    press(fixture, 'ArrowDown');
    expect(list.getAttribute('aria-activedescendant')).toBe(idAt(1));

    press(fixture, 'End');
    expect(list.getAttribute('aria-activedescendant')).toBe(idAt(2));

    // The ends hold rather than wrapping, which is what a native menu does.
    press(fixture, 'ArrowDown');
    expect(list.getAttribute('aria-activedescendant')).toBe(idAt(2));

    press(fixture, 'Home');
    expect(list.getAttribute('aria-activedescendant')).toBe(idAt(0));

    press(fixture, 'ArrowUp');
    expect(list.getAttribute('aria-activedescendant')).toBe(idAt(0));
  });

  it('takes the option the list is on with Enter, and with Space', () => {
    for (const key of ['Enter', ' ']) {
      const fixture = openMenu(renderMenu({ selected: null }));
      const chosen: (string | null)[] = [];
      fixture.componentInstance.chosen.subscribe((value) => chosen.push(value));

      press(fixture, 'ArrowDown');
      press(fixture, key);

      expect(chosen).toEqual(['special_corrosive_shell']);
      expect(queryAll(fixture, '.menu__list')).toHaveLength(0);
    }
  });

  it('leaves on Escape without taking anything, and gives the trigger back', () => {
    const fixture = openMenu(renderMenu({ selected: null }));
    const chosen: (string | null)[] = [];
    fixture.componentInstance.chosen.subscribe((value) => chosen.push(value));

    press(fixture, 'ArrowDown');
    press(fixture, 'Escape');

    expect(chosen).toEqual([]);
    expect(queryAll(fixture, '.menu__list')).toHaveLength(0);
    // Focus left inside a box that is no longer drawn is focus a reader has to
    // find again from the top of the page.
    expect(document.activeElement).toBe(query(fixture, '.menu__trigger'));
  });

  it('shuts when the focus leaves it, so Tab does not leave a list behind', () => {
    const fixture = openMenu(renderMenu());

    // `Tab` is the page's, so the focus goes on and nothing here stops it. What
    // must not happen is the list staying drawn over the card behind it.
    query(fixture, '.menu__list').dispatchEvent(
      new FocusEvent('focusout', { bubbles: true, relatedTarget: document.body }),
    );
    fixture.detectChanges();

    expect(queryAll(fixture, '.menu__list')).toHaveLength(0);
  });

  it('stays open when the focus leaves the document altogether', () => {
    const fixture = openMenu(renderMenu());

    // A null `relatedTarget` is another window or the browser's own chrome. The
    // Commander has not moved on from the menu and comes back to it.
    query(fixture, '.menu__list').dispatchEvent(
      new FocusEvent('focusout', { bubbles: true, relatedTarget: null }),
    );
    fixture.detectChanges();

    expect(queryAll(fixture, '.menu__list')).toHaveLength(1);
  });

  it('leaves Tab to the page, so the list is not a trap', () => {
    const fixture = openMenu(renderMenu());
    const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });

    query(fixture, '.menu__list').dispatchEvent(event);
    fixture.detectChanges();

    expect(event.defaultPrevented).toBe(false);
  });

  it('names each option by its name line and describes it by the package’s', () => {
    // The whole reason this control is drawn rather than taken from the
    // platform: a native option holds one run of text, so the description could
    // only be read as part of the name.
    const fixture = openMenu(renderMenu());
    const option = queryAll(fixture, '.menu__option')[1]!;

    expect(option.getAttribute('aria-labelledby')).toBe(
      option.querySelector('.menu__option-name')?.id,
    );
    expect(option.getAttribute('aria-describedby')).toBe(
      option.querySelector('.menu__option-description')?.id,
    );
  });

  it('describes an option by nothing where the catalogue has no description', () => {
    const fixture = openMenu(
      renderMenu({
        effects: [
          {
            ...EFFECTS[0]!,
            description: {
              text: null,
              language: null,
              translationState: 'unavailable',
              disclosureKey: 'game-text.unavailable',
            },
          },
        ],
      }),
    );

    expect(queryAll(fixture, '.menu__option')[1]?.getAttribute('aria-describedby')).toBeNull();
  });

  it('draws no description line for an option the catalogue has none for', () => {
    const fixture = openMenu(
      renderMenu({
        effects: [
          {
            ...EFFECTS[0]!,
            description: {
              text: null,
              language: null,
              translationState: 'unavailable',
              disclosureKey: 'game-text.unavailable',
            },
          },
        ],
      }),
    );

    expect(queryAll(fixture, '.menu__option-description')).toHaveLength(0);
    // The option after the way out is the effect's own, and it is still named.
    const option = queryAll(fixture, '.menu__option')[1]!;
    expect(textOf(option)).toContain('Corrosive Shell');
  });

  it('shuts on a second press of the trigger', () => {
    const fixture = openMenu(renderMenu());

    query(fixture, '.menu__trigger').click();
    fixture.detectChanges();

    expect(queryAll(fixture, '.menu__list')).toHaveLength(0);
  });

  it('shuts on a press outside it, and leaves a press inside alone', () => {
    const fixture = openMenu(renderMenu());

    element(fixture).dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    fixture.detectChanges();
    expect(queryAll(fixture, '.menu__list')).toHaveLength(1);

    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    fixture.detectChanges();
    expect(queryAll(fixture, '.menu__list')).toHaveLength(0);
  });

  it('emits the chosen effect and shuts, because choosing is the edit', () => {
    const fixture = openMenu(renderMenu({ selected: null }));
    const chosen: (string | null)[] = [];
    fixture.componentInstance.chosen.subscribe((value) => chosen.push(value));

    queryAll(fixture, '.menu__option')[2]?.click();
    fixture.detectChanges();

    expect(chosen).toEqual(['special_auto_loader']);
    expect(queryAll(fixture, '.menu__list')).toHaveLength(0);
  });

  it('emits the removal through the no-effect option', () => {
    const fixture = openMenu(renderMenu({ selected: 'special_auto_loader' }));
    const chosen: (string | null)[] = [];
    fixture.componentInstance.chosen.subscribe((value) => chosen.push(value));

    query(fixture, '.menu__option--none').click();

    expect(chosen).toEqual([null]);
  });

  it('comes back shut when the editor changes shape', () => {
    const fixture = openMenu(renderMenu());

    fixture.componentRef.setInput('asDropdown', false);
    fixture.detectChanges();
    fixture.componentRef.setInput('asDropdown', true);
    fixture.detectChanges();

    expect(queryAll(fixture, '.menu__list')).toHaveLength(0);
  });

  it('draws the card list rather than the menu in the other shape', () => {
    const fixture = renderComponent(ExperimentalEffectList, {
      asDropdown: false,
      effects: EFFECTS,
    });

    expect(queryAll(fixture, '.menu')).toHaveLength(0);
    expect(queryAll(fixture, '.effect').length).toBeGreaterThan(0);
  });
});

describe('attribute comparison', () => {
  const ROWS = [
    { key: 'damage', label: 'Damage', stock: '5.72', modified: '6.90' },
    { key: 'mass', label: 'Mass t', stock: null, modified: '4.00' },
    { key: 'jitter', label: 'Jitter °', stock: '0.50', modified: null },
  ];

  it('relates every figure to its attribute through a row header', () => {
    const fixture = renderComponent(AttributeComparison, { rows: ROWS });

    const header = query(fixture, '.comparison__attribute');
    expect(header.tagName).toBe('TH');
    expect(header.getAttribute('scope')).toBe('row');
    expect(queryAll(fixture, 'th[scope="col"]').map((cell) => textOf(cell))).toEqual([
      'Attribute',
      'Stock',
      'Modified',
    ]);
  });

  it('says a value is unavailable rather than writing a zero', () => {
    const fixture = renderComponent(AttributeComparison, { rows: ROWS });

    const cells = queryAll(fixture, '.comparison__value');
    expect(textOf(cells[2]!)).not.toBe('0');
    // The cell holds a figure, so it states the absence of a figure. `Name
    // unavailable` is what a lost piece of game *text* says, and a stock column
    // reporting it told a Commander their multi-cannon had no name.
    expect(query(fixture, '.comparison__value .unavailable')).toBeTruthy();
    expect(textOf(cells[2]!)).toBe('Unavailable');
    // Both columns say it the same way.
    expect(textOf(cells[5]!)).toBe('Unavailable');
  });

  it('marks a direction the canvas’s way, and never by colour alone', () => {
    const fixture = renderComponent(AttributeComparison, {
      rows: [
        { ...ROWS[0]!, direction: 'better' },
        {
          key: 'thermalLoad',
          label: 'Thermal load',
          stock: '0.33',
          modified: '0.41',
          direction: 'worse',
        },
      ],
    });

    const cells = queryAll(fixture, '.comparison__value--modified');
    expect(cells[0]!.getAttribute('data-direction')).toBe('better');
    expect(textOf(cells[0]!)).toContain('▲');
    expect(textOf(cells[0]!)).toContain('Improved');
    expect(cells[1]!.getAttribute('data-direction')).toBe('worse');
    expect(textOf(cells[1]!)).toContain('▼');
    expect(textOf(cells[1]!)).toContain('Worsened');
  });

  it('marks nothing where either side is unpublished', () => {
    const fixture = renderComponent(AttributeComparison, { rows: ROWS });

    const text = textOf(element(fixture));
    expect(text).not.toContain('▲');
    expect(text).not.toContain('▼');
  });
});

/**
 * The one order both material lists are read in.
 *
 * The Engineer panel and the status rail draw the same materials for the same
 * build, so they share this comparator rather than each having one — ruling G,
 * `openspec/changes/archive/009-cost-and-materials/design/reference-review.md`.
 */
describe('material line order', () => {
  const line = (symbol: string, grade: number | null, text: string | null = symbol) => ({
    symbol,
    name: { ...named(''), text } as GameTextPresentation,
    grade,
    count: '1',
  });
  const collator = new Intl.Collator('en', { sensitivity: 'base', numeric: true });
  const symbols = (lines: readonly { readonly symbol: string }[]) =>
    lines.map((entry) => entry.symbol);

  it('puts the commonest rarity first', () => {
    const sorted = sortMaterialLines(
      [line('Tungsten', 4), line('Iron', 1), line('Zinc', 2)],
      collator,
    );

    expect(symbols(sorted)).toEqual(['Iron', 'Zinc', 'Tungsten']);
  });

  it('sorts a material the package grades no rarity for last', () => {
    // An unknown rarity is not a common one. Sorting `null` as zero would head
    // the shopping list with the material a Commander knows least about.
    const sorted = sortMaterialLines(
      [line('Unknown', null), line('Tungsten', 4), line('Iron', 1)],
      collator,
    );

    expect(symbols(sorted)).toEqual(['Iron', 'Tungsten', 'Unknown']);
  });

  it('breaks a rarity tie with the collator it is given', () => {
    // Names that order one way under the application's collator and the other
    // way under a bare `localeCompare`. The collator is numeric-aware, so it
    // reads the digits as numbers; string comparison puts `10` before `2`.
    const sorted = sortMaterialLines([line('B', 2, 'Item 10'), line('A', 2, 'Item 2')], collator);

    // Proves the passed collator is the one doing the work. `localeCompare`
    // with no locale reads the *browser's* language, which is a different one
    // from the language on screen whenever a Commander has chosen one — the
    // drift this comparator was extracted to end.
    expect('Item 10'.localeCompare('Item 2')).toBeLessThan(0);
    expect(symbols(sorted)).toEqual(['A', 'B']);
  });

  it('falls back to the symbol for a material the package cannot name', () => {
    const sorted = sortMaterialLines([line('Zinc', 3, null), line('Iron', 3, null)], collator);

    // Two nameless rows would otherwise compare equal and order differently on
    // each render. The symbol is the row's own identity and the only other
    // stable thing about it.
    expect(symbols(sorted)).toEqual(['Iron', 'Zinc']);
  });

  it('leaves the caller’s list alone', () => {
    const given = [line('Tungsten', 4), line('Iron', 1)];

    sortMaterialLines(given, collator);

    expect(symbols(given)).toEqual(['Tungsten', 'Iron']);
  });
});

describe('power controls', () => {
  const NAMES = { slotLabel: 'Core · Size 8', moduleLabel: 'Power Plant 8A' };

  it('names both the module and its mount, so forty rows stay distinguishable', () => {
    const fixture = renderComponent(PowerControls, { ...NAMES, enabled: true, priority: 2 });

    expect(accessibleName(query(fixture, '.power__toggle'))).toBe(
      'Power Plant 8A in Core · Size 8 is powered',
    );
    expect(accessibleName(query(fixture, '.power__priority'))).toBe(
      'Power priority for Power Plant 8A in Core · Size 8',
    );
  });

  it('presents the package’s zero-based group one-based, as the game does', () => {
    const fixture = renderComponent(PowerControls, { ...NAMES, priority: 0 });

    const options = queryAll(fixture, 'option');
    // Bare numbers, because the chip the canvas draws holds a number and no
    // word beside it. The control's name says what the number is.
    expect(options.map((option) => textOf(option))).toEqual(['1', '2', '3', '4', '5']);
    // The package's 0 is the Commander's 1.
    expect(options[0]?.getAttribute('value')).toBe('0');
  });

  it('emits the package’s own number, not the one on screen', () => {
    const fixture = renderComponent(PowerControls, { ...NAMES, priority: 0 });
    const emitted: unknown[] = [];
    fixture.componentInstance.intent.subscribe((intent) => emitted.push(intent));

    const select = query(fixture, '.power__priority') as HTMLSelectElement;
    select.value = '4';
    select.dispatchEvent(new Event('change'));

    expect(emitted).toEqual([{ kind: 'setPriority', priority: 4 }]);
  });

  it('draws an unstated group as the one the package puts it in', () => {
    const fixture = renderComponent(PowerControls, { ...NAMES, priority: undefined });

    const select = query(fixture, '.power__priority') as HTMLSelectElement;
    // Group 1, not a dash. `PowerConsumer.priority` documents the absent case
    // as defaulting to 1, and `powerBudget()` has already put this module in
    // band 1 — where the power panel lists it and where it is shed. The chip
    // was the one place in the application saying otherwise, and the package
    // resets the group on every fresh mount, so it said it about every module
    // a Commander fitted (ruled 2026-08-26).
    expect(select.value).toBe('0');
    expect(textOf(select.options[0]!)).toBe('1');
    expect(select.options).toHaveLength(5);
    expect(select.options[0]!.disabled).toBe(false);
  });

  it('offers the same five groups whether or not the source stated one', () => {
    const stated = renderComponent(PowerControls, { ...NAMES, priority: 2 });
    const unstated = renderComponent(PowerControls, { ...NAMES, priority: undefined });

    const drawn = (fixture: typeof stated) =>
      [...(query(fixture, '.power__priority') as HTMLSelectElement).options].map((option) =>
        textOf(option),
      );

    expect(drawn(unstated)).toEqual(drawn(stated));
  });

  it('reads an absent power field as on, the way the package does', () => {
    const fixture = renderComponent(PowerControls, { ...NAMES, enabled: undefined });

    expect((query(fixture, '.power__toggle') as HTMLInputElement).checked).toBe(true);
  });

  it('draws only what the package permits on this mount', () => {
    const fixture = renderComponent(PowerControls, {
      ...NAMES,
      canSetEnabled: false,
      canSetPriority: true,
    });

    expect(element(fixture).querySelector('.power__toggle')).toBeNull();
    expect(element(fixture).querySelector('.power__priority')).not.toBeNull();
  });
});

describe('ingress refusal notice', () => {
  const FAILURE = {
    source: {
      slotKey: 'MainEngines',
      moduleSymbol: 'Int_Engine_Size7_Class5',
      blueprintFdname: 'Engine_Dirty',
      effectFdname: null,
      grade: 5,
      quality: 0.42,
    },
    reason: 'packageResult',
    code: 'unsupportedEngineering',
    params: null,
  };

  /** The same refusal at another mount, for reading a batch as one event. */
  const refused = (slotKey: string) => ({
    ...FAILURE,
    source: { ...FAILURE.source, slotKey },
  });

  it('names every affected mount, module, roll and package reason', () => {
    const fixture = renderComponent(IngressRefusalNotice, {
      failures: [FAILURE],
      slotLabels: { MainEngines: 'Thrusters' },
    });

    const text = textOf(element(fixture));
    expect(text).toContain('Thrusters');
    expect(text).toContain('Int_Engine_Size7_Class5');
    expect(text).toContain('42%');
    expect(text).toContain('unsupportedEngineering');
    expect(text).toContain('Engine_Dirty');
  });

  it('says the build was never activated', () => {
    const fixture = renderComponent(IngressRefusalNotice, { failures: [FAILURE] });

    expect(textOf(element(fixture)).toLowerCase()).toContain('exactly as it was');
  });

  it('renders nothing when nothing was refused', () => {
    const fixture = renderComponent(IngressRefusalNotice, { failures: [] });

    expect(element(fixture).querySelector('.notice')).toBeNull();
  });

  it('announces a refused batch once, naming how much there is to read', () => {
    // The lines stay on the page, one per module, where they can be found and
    // read one at a time. What a reader is interrupted with is one sentence
    // saying how many there are — four separate announcements would be a list
    // read out over a screen that is still rendering (011/FR-009).
    const fixture = renderComponent(IngressRefusalNotice, { failures: [] });
    const announcements = TestBed.inject(AnnouncementService);
    const announce = vi.spyOn(announcements, 'announce');

    fixture.componentRef.setInput('unannounced', true);
    fixture.componentRef.setInput('failures', [
      FAILURE,
      refused('SmallHardpoint1'),
      refused('Slot01_Size6'),
      refused('PowerPlant'),
    ]);
    fixture.detectChanges();

    expect(announce).toHaveBeenCalledTimes(1);
    // Four modules under one framing line, which is what there is to read.
    expect(announcements.assertive()).toContain('5 to read');
  });

  it('says nothing about a refusal a reader has already been told about', () => {
    // The record holding the refusal is the application's and the workspace is
    // a route, so a refusal still standing when the screen is opened again
    // arrives with the screen. That is initial content (011/FR-009).
    renderComponent(IngressRefusalNotice, { failures: [FAILURE], unannounced: false });

    expect(TestBed.inject(AnnouncementService).assertive()).toBe('');
  });

  it('states a refusal it is created with, where nobody has been told yet', () => {
    // A record carrying a roll the package cannot complete is refused while the
    // workspace is still being built, so this notice is created with the
    // refusal already on it and never sees it arrive. Silence here would lose
    // the event outright: the Commander asked for the build and it was refused
    // (011/FR-009).
    renderComponent(IngressRefusalNotice, { failures: [FAILURE], unannounced: true });

    expect(TestBed.inject(AnnouncementService).assertive()).toContain('2 to read');
  });

  it('says it has spoken, so the screen it is on can remember', () => {
    // The count is a rule about what is drawn and belongs here; the memory has
    // to outlive a component the next visit rebuilds, and belongs to the store.
    const fixture = renderComponent(IngressRefusalNotice, { failures: [] });
    const spoken = vi.fn();
    fixture.componentInstance.announced.subscribe(spoken);

    fixture.componentRef.setInput('unannounced', true);
    fixture.componentRef.setInput('failures', [FAILURE]);
    fixture.detectChanges();

    expect(spoken).toHaveBeenCalledTimes(1);
  });

  it('announces a second refusal, and says nothing more for a committed locale', () => {
    const fixture = renderComponent(IngressRefusalNotice, { failures: [] });
    const announcements = TestBed.inject(AnnouncementService);

    fixture.componentRef.setInput('unannounced', true);
    fixture.componentRef.setInput('failures', [FAILURE]);
    fixture.detectChanges();
    const first = announcements.assertiveEvent();
    expect(first).not.toBeNull();

    // A second link opened, refused for the same reason. The same sentence and
    // a second event: ingress hands over a new set of failures per candidate.
    fixture.componentRef.setInput('failures', [FAILURE]);
    fixture.detectChanges();
    const second = announcements.assertiveEvent();
    expect(second?.identity, 'the second refusal was published as the first').not.toBe(
      first?.identity,
    );

    // The sentence is resolved inside `untracked`, so the effect depends on the
    // refusal and not on the catalogue behind it.
    TestBed.inject(LocaleStore).commitCandidate(
      {
        requested: 'de',
        catalogue: germanCatalogue as unknown as MessageCatalogue,
        source: 'asset',
        failure: null,
      },
      'browser',
    );
    fixture.detectChanges();

    expect(announcements.assertiveEvent()).toBe(second);
  });
});

/** Every match, since the shared helpers only expose the first. */
function queryAll<T>(fixture: ComponentFixture<T>, selector: string): HTMLElement[] {
  return [...element(fixture).querySelectorAll<HTMLElement>(selector)];
}

/** One key, on the effect menu's list, and the redraw that follows it. */
function press<T>(fixture: ComponentFixture<T>, key: string): void {
  query(fixture, '.menu__list').dispatchEvent(
    new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }),
  );
  fixture.detectChanges();
}

describe('ship identity fields', () => {
  const NAMED = {
    name: 'Pacifier',
    fallbackName: 'Build',
    detail: 'Anaconda',
    ident: 'FD-11X',
    editing: null,
  };

  it('draws the name as the bar’s own title, with a pencil beside it', () => {
    const fixture = renderComponent(ShipIdentityFields, NAMED);

    expect(query(fixture, 'h1').textContent?.trim()).toBe('Pacifier');
    // The title is the control, as the canvas draws it. The glyph is
    // decoration; the control's whole name is words.
    // The name a Commander reads aloud is the title on it, and what the control
    // does comes after — an `aria-label` would replace the one with the other
    // (WCAG 2.5.3).
    const name = accessibleName(query(fixture, '.identity-fields__open--name'));
    expect(name).toContain('Pacifier');
    expect(name).toContain('Rename the ship');
  });

  it('reads as the screen it is on when the build has no name', () => {
    const fixture = renderComponent(ShipIdentityFields, { ...NAMED, name: null });

    expect(query(fixture, 'h1').textContent?.trim()).toBe('Build');
  });

  it('names the ID plate control with the plate it is showing', () => {
    const fixture = renderComponent(ShipIdentityFields, NAMED);

    // The plate is visible text on the control, so it has to be in the name.
    expect(accessibleName(query(fixture, '.identity-fields__ident'))).toContain('FD-11X');
  });

  it('draws no plate where the package has none', () => {
    const fixture = renderComponent(ShipIdentityFields, { ...NAMED, ident: null });

    expect(element(fixture).querySelector('.identity-fields__plate')).toBeNull();
    expect(accessibleName(query(fixture, '.identity-fields__ident'))).toBe('Change the ship ID');
  });

  it('commits what was typed on leaving the field, with no control beside it', () => {
    const fixture = renderComponent(ShipIdentityFields, { ...NAMED, editing: 'name' });
    const committed: unknown[] = [];
    fixture.componentInstance.committed.subscribe((commit) => committed.push(commit));

    // The canvas draws no Save, Clear or Cancel anywhere near the title.
    expect(query(fixture, '.identity-fields__line').querySelectorAll('button')).toHaveLength(0);

    const field = query(fixture, '.identity-fields__input') as HTMLInputElement;
    field.value = '  Pacifier II  ';
    field.dispatchEvent(new Event('change'));

    // Trimmed, because the surrounding spaces are not part of the name.
    expect(committed).toEqual([{ field: 'name', value: 'Pacifier II' }]);
  });

  it('clears to absence rather than to an empty string', () => {
    const fixture = renderComponent(ShipIdentityFields, { ...NAMED, editing: 'ident' });
    const committed: unknown[] = [];
    fixture.componentInstance.committed.subscribe((commit) => committed.push(commit));

    const field = query(fixture, '.identity-fields__input') as HTMLInputElement;
    field.value = '   ';
    field.dispatchEvent(new Event('change'));

    // Whitespace alone is absence: emptying the field is how a plate is taken
    // off. A build with an empty name and a build with none are different
    // builds (constitution IV).
    expect(committed).toEqual([{ field: 'ident', value: null }]);
  });

  it('holds each field to the length the game\u2019s own terminal takes', () => {
    const named = renderComponent(ShipIdentityFields, { ...NAMED, editing: 'name' });
    expect(query(named, '.identity-fields__input').getAttribute('maxlength')).toBe('22');

    const plated = renderComponent(ShipIdentityFields, { ...NAMED, editing: 'ident' });
    expect(query(plated, '.identity-fields__input').getAttribute('maxlength')).toBe('6');
  });

  it('clips a longer value it was opened on rather than committing it', () => {
    // `maxlength` bounds typing and pasting; it says nothing about the value the
    // field opened on, which may have come from a link or a SLEF file. Leaving
    // the field is what brings it inside the game's own limit.
    const fixture = renderComponent(ShipIdentityFields, { ...NAMED, editing: 'ident' });
    const committed: unknown[] = [];
    fixture.componentInstance.committed.subscribe((commit) => committed.push(commit));

    const field = query(fixture, '.identity-fields__input') as HTMLInputElement;
    field.value = 'FD-11X-EXTRA';
    field.dispatchEvent(new Event('change'));

    expect(committed).toEqual([{ field: 'ident', value: 'FD-11X' }]);
  });

  it('asks to be opened rather than opening itself', () => {
    const fixture = renderComponent(ShipIdentityFields, NAMED);
    const opened: unknown[] = [];
    fixture.componentInstance.opened.subscribe((field) => opened.push(field));

    (query(fixture, '.identity-fields__open--name') as HTMLButtonElement).click();
    (query(fixture, '.identity-fields__ident') as HTMLButtonElement).click();

    expect(opened).toEqual(['name', 'ident']);
  });
});
