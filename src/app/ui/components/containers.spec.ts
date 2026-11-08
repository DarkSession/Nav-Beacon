import { Collection } from './collection/collection';
import { Disclosure } from './disclosure/disclosure';
import { Layer } from './layer/layer';
import { MetricGroup } from './metric-group/metric-group';
import { Panel } from './panel/panel';
import { DataTable } from './table/data-table';
import { TabGroup } from './tab-group/tab-group';
import { Tooltip } from './tooltip/tooltip';
import {
  describedText,
  element,
  query,
  renderComponent,
  textOf,
} from './ui-component.spec-helpers';

describe('Panel', () => {
  it('names the region by its visible heading', () => {
    const fixture = renderComponent(Panel, { heading: 'Power and heat' });
    const region = query(fixture, 'section');
    const heading = query(fixture, '[role="heading"]');

    expect(region.getAttribute('aria-labelledby')).toBe(heading.getAttribute('id'));
    expect(textOf(heading)).toBe('Power and heat');
  });

  it('nests at the heading level it is given rather than imposing one', () => {
    const fixture = renderComponent(Panel, { heading: 'Power', headingLevel: 3 });

    expect(query(fixture, '[role="heading"]').getAttribute('aria-level')).toBe('3');
  });

  it('associates a description with the region', () => {
    const fixture = renderComponent(Panel, {
      heading: 'Power',
      description: 'Draw against output.',
    });

    expect(describedText(query(fixture, 'section'))).toContain('Draw against output.');
  });

  it('does not claim a description it does not have', () => {
    const fixture = renderComponent(Panel, { heading: 'Power' });

    expect(query(fixture, 'section').getAttribute('aria-describedby')).toBeNull();
  });
});

describe('TabGroup', () => {
  const tabs = [
    { id: 'power', label: 'Power' },
    { id: 'defence', label: 'Defence' },
  ];

  it('exposes a named tablist with the selected tab', () => {
    const fixture = renderComponent(TabGroup, {
      label: 'Build sections',
      tabs,
      selectedId: 'power',
    });
    const list = query(fixture, '[role="tablist"]');

    expect(list.getAttribute('aria-label')).toBe('Build sections');
    expect(element(fixture).querySelector('[role="tab"]')?.getAttribute('aria-selected')).toBe(
      'true',
    );
  });

  it('never points aria-controls at a panel it does not own', () => {
    const fixture = renderComponent(TabGroup, {
      label: 'Build sections',
      tabs,
      selectedId: 'power',
    });

    for (const tab of element(fixture).querySelectorAll('[role="tab"]')) {
      expect(tab.getAttribute('aria-controls')).toBeNull();
    }
  });

  it('relates a tab to a panel the consumer does own', () => {
    const fixture = renderComponent(TabGroup, {
      label: 'Build sections',
      tabs: [{ id: 'power', label: 'Power', panelId: 'power-region' }],
      selectedId: 'power',
    });

    expect(query(fixture, '[role="tab"]').getAttribute('aria-controls')).toBe('power-region');
  });

  it('carries the selected state in text, not only in colour', () => {
    const fixture = renderComponent(TabGroup, {
      label: 'Build sections',
      tabs,
      selectedId: 'power',
      selectedLabel: 'Selected',
    });

    expect(textOf(query(fixture, '.tab__state'))).toBe('Selected');
  });

  it('uses pressed rather than selected for a segmented control', () => {
    const fixture = renderComponent(TabGroup, {
      label: 'Sort by',
      tabs,
      selectedId: 'power',
      presentation: 'segmented',
    });
    const first = element(fixture).querySelector('button');

    expect(element(fixture).querySelector('[role="tablist"]')).toBeNull();
    expect(first?.getAttribute('aria-pressed')).toBe('true');
    expect(first?.getAttribute('aria-selected')).toBeNull();
  });

  it('emits the chosen tab', () => {
    const fixture = renderComponent(TabGroup, {
      label: 'Build sections',
      tabs,
      selectedId: 'power',
    });
    const emitted: string[] = [];
    fixture.componentInstance.selected.subscribe((id) => emitted.push(id));

    fixture.componentInstance.select(tabs[1] as { id: string; label: string });

    expect(emitted).toEqual(['defence']);
  });

  it('emits nothing for a disabled tab', () => {
    const fixture = renderComponent(TabGroup, {
      label: 'Build sections',
      tabs,
      selectedId: 'power',
    });
    let emissions = 0;
    fixture.componentInstance.selected.subscribe(() => (emissions += 1));

    fixture.componentInstance.select({ id: 'defence', label: 'Defence', disabled: true });

    expect(emissions).toBe(0);
  });
});

describe('Collection', () => {
  const items = [
    {
      id: 'a',
      label: 'Anaconda explorer',
      detail: 'Exploration',
      activatable: true,
      selected: true,
    },
    { id: 'b', label: 'Krait combat', activatable: true },
  ];

  it('renders a semantic list so a reader is told the set size', () => {
    const fixture = renderComponent(Collection, { label: 'Saved builds', items });

    expect(query(fixture, 'ul').getAttribute('aria-label')).toBe('Saved builds');
    expect(element(fixture).querySelectorAll('li').length).toBe(2);
  });

  it('exposes the selected item and names the state in text', () => {
    const fixture = renderComponent(Collection, {
      label: 'Saved builds',
      items,
      selectedLabel: 'Selected',
    });
    const first = element(fixture).querySelector('li');

    expect(first?.getAttribute('aria-current')).toBe('true');
    expect(textOf(first)).toContain('Selected');
  });

  it('associates an item detail with its activation target', () => {
    const fixture = renderComponent(Collection, { label: 'Saved builds', items });

    expect(describedText(query(fixture, 'button'))).toContain('Exploration');
  });

  it('states an empty collection in text rather than rendering nothing', () => {
    const fixture = renderComponent(Collection, {
      label: 'Saved builds',
      items: [],
      emptyLabel: 'No saved builds yet.',
    });

    expect(element(fixture).querySelector('ul')).toBeNull();
    expect(textOf(query(fixture, '.collection__empty'))).toBe('No saved builds yet.');
  });

  it('emits the activated item', () => {
    const fixture = renderComponent(Collection, { label: 'Saved builds', items });
    const emitted: string[] = [];
    fixture.componentInstance.activated.subscribe((id) => emitted.push(id));

    query(fixture, 'button').click();

    expect(emitted).toEqual(['a']);
  });

  it('emits nothing for a disabled item', () => {
    const fixture = renderComponent(Collection, {
      label: 'Saved builds',
      items: [{ id: 'a', label: 'A', activatable: true, disabled: true }],
    });
    let emissions = 0;
    fixture.componentInstance.activated.subscribe(() => (emissions += 1));

    fixture.componentInstance.activate({ id: 'a', label: 'A', disabled: true });

    expect(emissions).toBe(0);
  });

  it('renders a non-activatable item as text rather than a control', () => {
    const fixture = renderComponent(Collection, {
      label: 'Saved builds',
      items: [{ id: 'a', label: 'A' }],
    });

    expect(element(fixture).querySelector('button')).toBeNull();
    expect(textOf(query(fixture, '.collection__label'))).toBe('A');
  });
});

describe('DataTable', () => {
  const columns = [
    { key: 'module', label: 'Module', rowHeader: true },
    { key: 'draw', label: 'Draw', unit: 'MW', numeric: true },
  ];
  const rows = [{ id: '1', cells: { module: 'Power Plant', draw: '12.4' } }];

  it('names the table with a visible caption', () => {
    const fixture = renderComponent(DataTable, { caption: 'Power draw', columns, rows });

    expect(textOf(query(fixture, 'caption'))).toBe('Power draw');
  });

  it('scopes header cells to their column and row', () => {
    const fixture = renderComponent(DataTable, { caption: 'Power draw', columns, rows });
    const columnHeaders = element(fixture).querySelectorAll('thead th');
    const rowHeader = query(fixture, 'tbody th');

    for (const header of columnHeaders) {
      expect(header.getAttribute('scope')).toBe('col');
    }
    expect(rowHeader.getAttribute('scope')).toBe('row');
    expect(textOf(rowHeader)).toContain('Power Plant');
  });

  it('relates every value cell to its column header', () => {
    const fixture = renderComponent(DataTable, { caption: 'Power draw', columns, rows });
    const cell = query(fixture, 'tbody td');
    const header = element(fixture).querySelectorAll('thead th')[1];

    expect(cell.getAttribute('headers')).toBe(header?.getAttribute('id'));
  });

  it('renders the unit with its column so a value is never a bare number', () => {
    const fixture = renderComponent(DataTable, { caption: 'Power draw', columns, rows });

    expect(textOf(query(fixture, '.table__column-unit'))).toBe('MW');
  });

  it('owns its overflow in a labelled region rather than pushing the page sideways', () => {
    const fixture = renderComponent(DataTable, { caption: 'Power draw', columns, rows });
    const scroller = query(fixture, '.table-scroller');

    expect(scroller.getAttribute('role')).toBe('group');
    expect(scroller.getAttribute('aria-labelledby')).toBe(
      query(fixture, 'caption').getAttribute('id'),
    );
  });

  it('states an empty table in text', () => {
    const fixture = renderComponent(DataTable, {
      caption: 'Power draw',
      columns,
      rows: [],
      emptyLabel: 'No modules are fitted.',
    });

    expect(textOf(query(fixture, '.table__empty'))).toBe('No modules are fitted.');
  });
});

describe('MetricGroup', () => {
  const metrics = [
    {
      id: 'range',
      label: 'Jump range',
      value: '20.45',
      unit: 'ly',
      condition: 'Laden',
      description: 'Maximum single jump.',
    },
    { id: 'total', label: 'Total range', value: null, unavailableLabel: 'Unavailable' },
  ];

  it('renders a description list, pairing each term with its value', () => {
    const fixture = renderComponent(MetricGroup, { label: 'Jump summary', metrics });

    expect(query(fixture, 'dl').getAttribute('aria-label')).toBe('Jump summary');
    expect(element(fixture).querySelectorAll('dt').length).toBe(2);
  });

  it('relates a value to its unit, condition and description', () => {
    const fixture = renderComponent(MetricGroup, { label: 'Jump summary', metrics });
    const value = query(fixture, '.metric__value');
    const described = describedText(value);

    expect(described).toContain('ly');
    expect(described).toContain('Laden');
    expect(described).toContain('Maximum single jump.');
  });

  it('states an unavailable value instead of substituting a zero', () => {
    const fixture = renderComponent(MetricGroup, { label: 'Jump summary', metrics });
    const values = element(fixture).querySelectorAll('.metric__value');

    expect(textOf(values[1] ?? null)).toContain('Unavailable');
    expect(textOf(values[1] ?? null)).not.toContain('0');
  });

  it('states an empty group in text', () => {
    const fixture = renderComponent(MetricGroup, {
      label: 'Jump summary',
      metrics: [],
      emptyLabel: 'Nothing to show.',
    });

    expect(textOf(query(fixture, '.metric-group__empty'))).toBe('Nothing to show.');
  });

  it('describes a value by nothing when it has no unit, condition or description', () => {
    const fixture = renderComponent(MetricGroup, {
      label: 'Counts',
      metrics: [{ id: 'a', label: 'Hardpoints', value: '4' }],
    });

    expect(query(fixture, '.metric__value').getAttribute('aria-describedby')).toBeNull();
  });

  it('pads each cell 6 by 8 pixels only when asked, and changes nothing else', () => {
    const plain = renderComponent(MetricGroup, { label: 'Jump summary', metrics });
    const dense = renderComponent(MetricGroup, { label: 'Jump summary', metrics, dense: true });
    const cell = (fixture: typeof plain) => getComputedStyle(query(fixture, '.metric'));

    expect(cell(plain).paddingBlock).toBe('var(--ednb-space-lg)');
    expect(cell(plain).paddingInline).toBe('var(--ednb-space-lg)');
    expect(cell(dense).paddingBlock).toBe('var(--ednb-space-xs)');
    expect(cell(dense).paddingInline).toBe('var(--ednb-space-sm)');
    expect(cell(dense).backgroundColor).toBe(cell(plain).backgroundColor);
    expect(cell(dense).rowGap).toBe(cell(plain).rowGap);
    expect(element(dense).querySelectorAll('dt').length).toBe(2);
  });

  it('draws each label through a fit text only when asked', () => {
    const plain = renderComponent(MetricGroup, { label: 'Jump summary', metrics });
    const fitted = renderComponent(MetricGroup, {
      label: 'Jump summary',
      metrics,
      fitLabels: true,
    });

    expect(element(plain).querySelector('ednb-fit-text')).toBeNull();
    expect(element(plain).classList).not.toContain('metric-group--fit');
    const labels = [...element(fitted).querySelectorAll('dt')];
    expect(labels.map((label) => label.querySelector('ednb-fit-text') !== null)).toEqual(
      labels.map(() => true),
    );
    expect(labels.map((label) => textOf(label))).toEqual(
      [...element(plain).querySelectorAll('dt')].map((label) => textOf(label)),
    );
    expect(element(fitted).classList).toContain('metric-group--fit');
  });
});

describe('Disclosure', () => {
  it('exposes the expanded state and controls its content', () => {
    const fixture = renderComponent(Disclosure, { label: 'Why?', expanded: true });
    const trigger = query(fixture, 'button');
    const content = query(fixture, '.disclosure__content');

    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(trigger.getAttribute('aria-controls')).toBe(content.getAttribute('id'));
  });

  it('hides collapsed content from the accessibility tree, not just from view', () => {
    const fixture = renderComponent(Disclosure, { label: 'Why?', expanded: false });

    expect(query(fixture, 'button').getAttribute('aria-expanded')).toBe('false');
    expect(query(fixture, '.disclosure__content').hasAttribute('hidden')).toBe(true);
  });

  it('emits the state it is asking to move to', () => {
    const fixture = renderComponent(Disclosure, { label: 'Why?', expanded: false });
    const emitted: boolean[] = [];
    fixture.componentInstance.toggled.subscribe((value) => emitted.push(value));

    query(fixture, 'button').click();

    expect(emitted).toEqual([true]);
  });

  it('emits nothing while disabled', () => {
    const fixture = renderComponent(Disclosure, { label: 'Why?', disabled: true });
    let emissions = 0;
    fixture.componentInstance.toggled.subscribe(() => (emissions += 1));

    fixture.componentInstance.toggle();

    expect(emissions).toBe(0);
  });
});

describe('Tooltip', () => {
  const mouse = (type: 'pointerenter' | 'pointerleave') =>
    new PointerEvent(type, { pointerType: 'mouse' });
  const touch = (type: 'pointerenter' | 'pointerleave') =>
    new PointerEvent(type, { pointerType: 'touch' });
  /**
   * `Escape`, delivered the way a browser delivers it.
   *
   * On the document, because a key goes to whatever holds the focus and bubbles
   * from there — and a tip a hover opened holds no focus at all. Dispatching on
   * the host instead would prove only that a host listener fires, which is the
   * one thing the browser will never do in that state.
   */
  const escape = () =>
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  const expanded = (fixture: ReturnType<typeof renderComponent<Tooltip>>) =>
    query(fixture, 'button').getAttribute('aria-expanded');

  it('relates the gloss to the word it explains whether or not it is drawn', () => {
    const fixture = renderComponent(Tooltip, {
      label: 'Idle',
      tip: 'Hardpoints stowed, no throttle',
    });
    const trigger = query(fixture, 'button');
    const tip = query(fixture, '[role="tooltip"]');

    // Undrawn, not absent. A gloss behind a pointer is unreachable by touch and
    // unreliable to a screen reader, which is why this component exists at all.
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(trigger.getAttribute('aria-describedby')).toBe(tip.getAttribute('id'));
    expect(textOf(tip)).toBe('Hardpoints stowed, no throttle');
  });

  it('draws other words where asked, and still tells a reader the gloss alone', () => {
    const fixture = renderComponent(Tooltip, {
      label: 'Sustained weapon fire',
      tip: 'Trigger held down continuously',
      drawnTip: 'Sustained weapon fire: Trigger held down continuously',
    });
    const tip = query(fixture, '[role="tooltip"]');
    const drawn = tip.querySelector('[aria-hidden="true"]');
    const told = tip.querySelector('.tooltip__told');

    expect(textOf(drawn)).toBe('Sustained weapon fire: Trigger held down continuously');
    expect(textOf(told)).toBe('Trigger held down continuously');
    expect(told?.closest('[aria-hidden="true"]')).toBeNull();
    expect(query(fixture, 'button').getAttribute('aria-describedby')).toBe(tip.id);
  });

  it('draws the gloss alone where no other words are asked for', () => {
    const fixture = renderComponent(Tooltip, { label: 'Idle', tip: 'Hardpoints stowed' });
    const tip = query(fixture, '[role="tooltip"]');

    expect(tip.querySelector('[aria-hidden="true"]')).toBeNull();
    expect(tip.querySelector('.tooltip__told')).toBeNull();
    expect(textOf(tip)).toBe('Hardpoints stowed');
  });

  it('draws the gloss for a mouse that arrives, and takes it back when it leaves', () => {
    const fixture = renderComponent(Tooltip, { label: 'Idle', tip: 'Hardpoints stowed' });
    const host = fixture.nativeElement as HTMLElement;

    host.dispatchEvent(mouse('pointerenter'));
    fixture.detectChanges();
    expect(expanded(fixture)).toBe('true');

    host.dispatchEvent(mouse('pointerleave'));
    fixture.detectChanges();
    expect(expanded(fixture)).toBe('false');
  });

  it('opens on a press, which is what touch has instead of a hover', () => {
    const fixture = renderComponent(Tooltip, { label: 'Idle', tip: 'Hardpoints stowed' });
    const host = fixture.nativeElement as HTMLElement;

    // A tap fires `pointerenter` too. Admitted as a hover it would open the tip
    // and the press that follows would shut it again, so the tip would never
    // open on a touch device at all.
    host.dispatchEvent(touch('pointerenter'));
    fixture.detectChanges();
    expect(expanded(fixture)).toBe('false');

    query(fixture, 'button').click();
    fixture.detectChanges();
    expect(expanded(fixture)).toBe('true');

    query(fixture, 'button').click();
    fixture.detectChanges();
    expect(expanded(fixture)).toBe('false');
  });

  it('draws the gloss for focus, and takes it back when focus leaves', () => {
    const fixture = renderComponent(Tooltip, { label: 'Idle', tip: 'Hardpoints stowed' });
    const host = fixture.nativeElement as HTMLElement;

    // The other half of "on hover or focus". A press clears it rather than
    // adding to it, because a browser focuses the button it is pressed on and
    // two reasons to stay open would make the second press do nothing.
    host.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    fixture.detectChanges();
    expect(expanded(fixture)).toBe('true');

    query(fixture, 'button').click();
    fixture.detectChanges();
    expect(expanded(fixture)).toBe('true');

    query(fixture, 'button').click();
    fixture.detectChanges();
    expect(expanded(fixture)).toBe('false');

    host.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    host.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    fixture.detectChanges();
    expect(expanded(fixture)).toBe('false');
  });

  it('dismisses on escape while a hover holds it open, with the focus elsewhere', () => {
    const fixture = renderComponent(Tooltip, { label: 'Idle', tip: 'Hardpoints stowed' });
    const host = fixture.nativeElement as HTMLElement;

    host.dispatchEvent(mouse('pointerenter'));
    fixture.detectChanges();
    expect(expanded(fixture)).toBe('true');

    // Success criterion 1.4.13's dismissal, and the case it exists for: a tip
    // the pointer opened, with nothing inside it focused for a key to reach.
    escape();
    fixture.detectChanges();
    expect(expanded(fixture)).toBe('false');

    // The pointer leaving is what forgets it, so the next hover works.
    host.dispatchEvent(mouse('pointerleave'));
    host.dispatchEvent(mouse('pointerenter'));
    fixture.detectChanges();
    expect(expanded(fixture)).toBe('true');
  });

  it('does not bring a dismissed gloss back when the pointer leaves a focused trigger', () => {
    const fixture = renderComponent(Tooltip, { label: 'Idle', tip: 'Hardpoints stowed' });
    const host = fixture.nativeElement as HTMLElement;

    host.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    host.dispatchEvent(mouse('pointerenter'));
    fixture.detectChanges();
    expect(expanded(fixture)).toBe('true');

    escape();
    fixture.detectChanges();
    expect(expanded(fixture)).toBe('false');

    // Two reasons were holding it open and only one has gone. Forgetting the
    // dismissal here would put back, unasked, exactly what was just dismissed.
    host.dispatchEvent(mouse('pointerleave'));
    fixture.detectChanges();
    expect(expanded(fixture)).toBe('false');

    // Once the other one goes too, the dismissal has nothing left to hold.
    host.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    host.dispatchEvent(mouse('pointerenter'));
    fixture.detectChanges();
    expect(expanded(fixture)).toBe('true');
  });

  it('ignores an escape meant for something else', () => {
    const fixture = renderComponent(Tooltip, { label: 'Idle', tip: 'Hardpoints stowed' });
    const host = fixture.nativeElement as HTMLElement;

    // The key is heard on the document, so every tooltip on the page hears
    // every `Escape`. One pressed at a dialog must not leave the six glosses of
    // a heat profile refusing the hover that comes next.
    escape();
    fixture.detectChanges();

    host.dispatchEvent(mouse('pointerenter'));
    fixture.detectChanges();
    expect(expanded(fixture)).toBe('true');
  });

  it('takes the next hover after an escape that shut a pinned tip', () => {
    const fixture = renderComponent(Tooltip, { label: 'Idle', tip: 'Hardpoints stowed' });
    const host = fixture.nativeElement as HTMLElement;

    // A press pins, and clears the hover and the focus so it is pinning rather
    // than racing them. So once the pointer moves on, the pin is the only thing
    // holding the tip open.
    host.dispatchEvent(mouse('pointerenter'));
    query(fixture, 'button').click();
    host.dispatchEvent(mouse('pointerleave'));
    fixture.detectChanges();
    expect(expanded(fixture)).toBe('true');

    // Unpinning it is therefore the last reason going, and nothing is left on
    // the way to notice — no pointer to leave, no focus to lose. A dismissal
    // held past this would outlive the tip it dismissed and swallow the hover
    // that came next.
    escape();
    fixture.detectChanges();
    expect(expanded(fixture)).toBe('false');

    host.dispatchEvent(mouse('pointerenter'));
    fixture.detectChanges();
    expect(expanded(fixture)).toBe('true');
  });

  it('lets a press shut a tip that was drawn open', () => {
    const fixture = renderComponent(Tooltip, {
      label: 'Idle',
      tip: 'Hardpoints stowed',
      open: true,
    });

    expect(expanded(fixture)).toBe('true');

    query(fixture, 'button').click();
    fixture.detectChanges();

    // Seeded rather than asserted: an input that went on asserting itself would
    // make the trigger a control that does nothing.
    expect(expanded(fixture)).toBe('false');
  });

  it('offers a smaller trigger for a word that sits in a running line', () => {
    // The heat profile's glosses are hung on the words of a caption, so a
    // trigger at the 44 px baseline pushes the lines of that caption apart.
    // The dense variant takes the 24 px floor of success criterion 2.5.8
    // instead — asked for by the component that projects the word, never
    // decided here, because a trigger standing on its own has the room.
    const fixture = renderComponent(Tooltip, {
      label: 'Idle',
      tip: 'Hardpoints stowed',
      dense: true,
    });

    expect(query(fixture, 'button').classList.contains('tooltip__trigger--dense')).toBe(true);

    const roomy = renderComponent(Tooltip, { label: 'Idle', tip: 'Hardpoints stowed' });
    expect(query(roomy, 'button').classList.contains('tooltip__trigger--dense')).toBe(false);
  });

  /**
   * A platform with a top layer, which this suite's DOM is not.
   *
   * `showPopover` is what the component asks for before it raises anything, so
   * the two calls are stood up here and recorded. What is being checked is the
   * contract around them — raised once while it is drawn, put back whole when
   * it is not — rather than what a browser does with a popover, which is the
   * browser's own business and is checked on a real one end to end.
   */
  const withATopLayer = (bubble: HTMLElement) => {
    const calls: string[] = [];
    Object.assign(bubble, {
      showPopover: () => calls.push('show'),
      hidePopover: () => calls.push('hide'),
    });
    return calls;
  };

  it('raises the gloss into the top layer while it is drawn, and puts it back', () => {
    const fixture = renderComponent(Tooltip, { label: 'Idle', tip: 'Hardpoints stowed' });
    const host = fixture.nativeElement as HTMLElement;
    const bubble = query(fixture, '[role="tooltip"]');
    const calls = withATopLayer(bubble);

    host.dispatchEvent(mouse('pointerenter'));
    fixture.detectChanges();

    // `manual`, not `auto`: this component already governs when the tip closes,
    // and an `auto` popover would shut every other one that is open and answer
    // `Escape` behind the component's own dismissal.
    expect(bubble.getAttribute('popover')).toBe('manual');
    expect(bubble.classList.contains('tooltip__tip--floating')).toBe(true);
    expect(calls).toEqual(['show']);

    host.dispatchEvent(mouse('pointerleave'));
    fixture.detectChanges();

    // Put back rather than merely hidden. Closed, the gloss is the same
    // screen-reader-only text it is everywhere else in this system, and a
    // popover attribute left behind would take it out of the page's flow.
    expect(bubble.getAttribute('popover')).toBe(null);
    expect(bubble.classList.contains('tooltip__tip--floating')).toBe(false);
    expect(calls).toEqual(['show', 'hide']);
  });

  it('draws the gloss in place where the platform offers no top layer', () => {
    const fixture = renderComponent(Tooltip, { label: 'Idle', tip: 'Hardpoints stowed' });
    const host = fixture.nativeElement as HTMLElement;
    const bubble = query(fixture, '[role="tooltip"]');

    host.dispatchEvent(mouse('pointerenter'));
    fixture.detectChanges();

    // The raise is an improvement on the placement, never a condition of it:
    // where there is nothing to raise into, the bubble is drawn where it is
    // written and the gloss is read exactly as before.
    expect(expanded(fixture)).toBe('true');
    expect(bubble.classList.contains('tooltip__tip--shown')).toBe(true);
    expect(bubble.hasAttribute('popover')).toBe(false);
    expect(bubble.classList.contains('tooltip__tip--floating')).toBe(false);
  });
});

describe('Layer', () => {
  it('associates its visible title with the dialog', () => {
    const fixture = renderComponent(Layer, {
      title: 'Import a build',
      dismissLabel: 'Close',
      open: false,
    });
    const dialog = query(fixture, 'dialog');

    expect(dialog.getAttribute('aria-labelledby')).toBe(query(fixture, 'h2').getAttribute('id'));
    expect(textOf(query(fixture, 'h2'))).toBe('Import a build');
  });

  it('associates a description when it has one', () => {
    const fixture = renderComponent(Layer, {
      title: 'Import a build',
      description: 'Paste a SLEF payload.',
      dismissLabel: 'Close',
      open: false,
    });

    expect(describedText(query(fixture, 'dialog'))).toContain('Paste a SLEF payload.');
  });

  it('draws a detail inside the title bar and associates it too', () => {
    const fixture = renderComponent(Layer, {
      title: 'Cargo Rack',
      detail: 'Optional Internal 1 (Size 7)',
      description: 'Paste a SLEF payload.',
      dismissLabel: 'Close',
      open: false,
    });

    // In the bar with the title, not under it: a name is part of what the bar
    // says the screen is about, and prose is not.
    const detail = query(fixture, '.layer__detail');
    expect(query(fixture, '.layer__header').contains(detail)).toBe(true);
    expect(textOf(detail)).toBe('Optional Internal 1 (Size 7)');

    // Both supporting texts reach a reader, in the order they are drawn.
    const described = describedText(query(fixture, 'dialog'));
    expect(described).toContain('Optional Internal 1 (Size 7)');
    expect(described).toContain('Paste a SLEF payload.');
  });

  it('names nothing where it was given no supporting text', () => {
    const fixture = renderComponent(Layer, {
      title: 'Import a build',
      dismissLabel: 'Close',
      open: false,
    });

    expect(query(fixture, 'dialog').getAttribute('aria-describedby')).toBeNull();
    expect(element(fixture).querySelector('.layer__detail')).toBeNull();
  });

  it('uses a native dialog, so background content is genuinely inert', () => {
    const fixture = renderComponent(Layer, {
      title: 'Import a build',
      dismissLabel: 'Close',
      open: false,
    });

    expect(query(fixture, 'dialog').tagName).toBe('DIALOG');
  });

  it('keeps one state and intent contract across every presentation', () => {
    for (const presentation of ['dialog', 'sheet', 'full-height'] as const) {
      const fixture = renderComponent(Layer, {
        title: 'Import a build',
        dismissLabel: 'Close',
        open: false,
        presentation,
      });

      expect(query(fixture, 'dialog').className).toContain(`layer--${presentation}`);
      expect(query(fixture, 'dialog').getAttribute('aria-labelledby')).not.toBeNull();
    }
  });

  it('emits dismissal intent rather than closing itself', () => {
    const fixture = renderComponent(Layer, {
      title: 'Import a build',
      dismissLabel: 'Close',
      open: false,
    });
    let dismissals = 0;
    fixture.componentInstance.dismissed.subscribe(() => (dismissals += 1));

    query(fixture, '.layer__dismiss').click();

    expect(dismissals).toBe(1);
  });

  it('draws no way out at all when its dismiss label is null', () => {
    // One input rather than two, because a label and a separate flag can
    // disagree and this cannot. The input is required, so a layer with no way
    // out says so with `null` rather than by omission — the caller states the
    // decision instead of inheriting it. Exactly one layer does: the overlay
    // that stands while a published version restarts the page under it, where
    // there is nothing to cancel because the restart is not a question
    // (011/FR-025).
    const fixture = renderComponent(Layer, {
      title: 'Updating',
      description: 'This session is restarting on the newer version.',
      dismissLabel: null,
      open: false,
    });

    expect(fixture.componentInstance.dismissible()).toBe(false);
    expect(query(fixture, 'dialog').querySelector('.layer__dismiss')).toBeNull();
    // And the title and description still reach a reader, which is the whole
    // point of drawing it as a layer.
    expect(describedText(query(fixture, 'dialog'))).toContain('restarting on the newer version');
  });

  it('treats a blank label as no way out rather than as a nameless one', () => {
    // The template draws no control for a blank label, so a layer that still
    // counted itself dismissable would close on Escape and on the ground while
    // showing nothing to press — the split the single input exists to prevent.
    let dismissals = 0;
    const fixture = renderComponent(Layer, { title: 'Updating', dismissLabel: '  ', open: false });
    fixture.componentInstance.dismissed.subscribe(() => (dismissals += 1));

    expect(fixture.componentInstance.dismissible()).toBe(false);
    expect(query(fixture, 'dialog').querySelector('.layer__dismiss')).toBeNull();

    const cancel = new Event('cancel', { cancelable: true });
    query(fixture, 'dialog').dispatchEvent(cancel);

    expect(cancel.defaultPrevented).toBe(true);
    expect(dismissals).toBe(0);
  });

  it('refuses the native cancel a layer with no way out must not honour', () => {
    let dismissals = 0;
    const fixture = renderComponent(Layer, { title: 'Updating', dismissLabel: null, open: false });
    fixture.componentInstance.dismissed.subscribe(() => (dismissals += 1));

    // Escape reaches the element as `cancel`, and a layer that closed on it
    // would be dismissable by exactly one route and look like none.
    const cancel = new Event('cancel', { cancelable: true });
    query(fixture, 'dialog').dispatchEvent(cancel);

    expect(cancel.defaultPrevented).toBe(true);
    expect(dismissals).toBe(0);
  });

  it('ignores the ground around a layer with no way out', () => {
    let dismissals = 0;
    const fixture = renderComponent(Layer, { title: 'Updating', dismissLabel: null, open: false });
    fixture.componentInstance.dismissed.subscribe(() => (dismissals += 1));
    const dialog = query(fixture, 'dialog');
    dialog.getBoundingClientRect = () =>
      ({ left: 100, right: 200, top: 100, bottom: 200 }) as DOMRect;

    dialog.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    dialog.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 10, clientY: 10 }));

    expect(dismissals).toBe(0);
  });

  it('dismisses a click on the ground around it, and not one on itself', () => {
    let dismissals = 0;
    const fixture = renderComponent(Layer, {
      title: 'Export build',
      dismissLabel: 'Close',
      open: false,
    });
    fixture.componentInstance.dismissed.subscribe(() => (dismissals += 1));
    const dialog = query(fixture, 'dialog');
    // jsdom lays nothing out, so the panel's box is declared rather than
    // measured. What is being checked is the rule, not the renderer.
    dialog.getBoundingClientRect = () =>
      ({ left: 100, right: 300, top: 100, bottom: 300 }) as DOMRect;

    // A press and a release, because that is what a click is made of and the
    // layer reads both ends of it.
    dialog.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    dialog.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 200, clientY: 200 }));
    expect(dismissals).toBe(0);

    dialog.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    dialog.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 20, clientY: 20 }));
    expect(dismissals).toBe(1);
  });

  it('keeps a drag that began inside it, however far past the edge it ends', () => {
    // Selecting the payload in the export layer and releasing past its edge.
    // The click is dispatched at the nearest common ancestor of the two ends,
    // which is the dialog itself, and it carries the coordinates of the
    // release — so on the click alone this is a press on the ground, and it
    // discarded whatever was in the layer (reported 2026-08-26).
    let dismissals = 0;
    const fixture = renderComponent(Layer, {
      title: 'Export build',
      dismissLabel: 'Close',
      open: false,
    });
    fixture.componentInstance.dismissed.subscribe(() => (dismissals += 1));
    const dialog = query(fixture, 'dialog');
    dialog.getBoundingClientRect = () =>
      ({ left: 100, right: 300, top: 100, bottom: 300 }) as DOMRect;

    query(fixture, '.layer__title').dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    dialog.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 20, clientY: 20 }));

    expect(dismissals).toBe(0);
  });

  it('leaves a click inside the layer to whatever it landed on', () => {
    let dismissals = 0;
    const fixture = renderComponent(Layer, {
      title: 'Export build',
      dismissLabel: 'Close',
      open: false,
    });
    fixture.componentInstance.dismissed.subscribe(() => (dismissals += 1));
    query(fixture, 'dialog').getBoundingClientRect = () =>
      ({ left: 100, right: 300, top: 100, bottom: 300 }) as DOMRect;

    // A click on the title bubbles to the dialog carrying the title as its
    // target, and reports the origin because nothing positioned it. Without
    // the target check, the box check alone would dismiss the layer.
    query(fixture, '.layer__title').dispatchEvent(
      new MouseEvent('click', { bubbles: true, clientX: 0, clientY: 0 }),
    );

    expect(dismissals).toBe(0);
  });

  it('gives the dismiss control a visible label', () => {
    const fixture = renderComponent(Layer, {
      title: 'Import a build',
      dismissLabel: 'Schließen',
      open: false,
    });

    expect(textOf(query(fixture, '.layer__dismiss'))).toBe('Schließen');
  });

  it('bounds a centred layer by the width step it is given', () => {
    for (const presentation of ['dialog', 'adaptive'] as const) {
      const fixture = renderComponent(Layer, {
        title: 'Export build',
        dismissLabel: 'Close',
        open: false,
        presentation,
        width: 'wide',
      });

      expect(query(fixture, 'dialog').className).toContain('layer--wide');
    }
  });

  it('keeps the width step readable off the element whatever the presentation', () => {
    const fixture = renderComponent(Layer, {
      title: 'Export build',
      dismissLabel: 'Close',
      open: false,
      presentation: 'sheet',
      width: 'wide',
    });

    // The stylesheet pairs a step with the two presentations that have a width
    // to bound, so a sheet is unaffected by one. What was asked for still shows
    // on the element.
    expect(query(fixture, 'dialog').className).toContain('layer--sheet');
    expect(query(fixture, 'dialog').className).toContain('layer--wide');
  });

  it("hands the body's padding to its content when it is flush", () => {
    const padded = renderComponent(Layer, {
      title: 'Export build',
      dismissLabel: 'Close',
      open: false,
    });
    const flush = renderComponent(Layer, {
      title: 'Export build',
      dismissLabel: 'Close',
      open: false,
      flush: true,
    });

    expect(query(padded, '.layer__body').className).not.toContain('layer__body--flush');
    expect(query(flush, '.layer__body').className).toContain('layer__body--flush');
  });
});
