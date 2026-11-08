import { Component } from '@angular/core';
import { element, query, renderComponent, textOf } from '../ui-component.spec-helpers';
import { FitText } from './fit-text';

/** A caller that draws its own content in place of the text. */
@Component({
  imports: [FitText],
  template: `<ednb-fit-text [text]="'Supercruise Assist'"
    ><b class="own" lang="en">Supercruise Assist</b></ednb-fit-text
  >`,
})
class ProjectingHost {}

/**
 * What a cut label promises a reader.
 *
 * jsdom draws nothing and has no `ResizeObserver`, so the test supplies both:
 * an observer it can fire, and the widths the browser would report.
 */
describe('fit text', () => {
  const LABEL = 'Sustained weapon fire';

  /** Installs an observer that reports a box `width` wide when fired. */
  function declareDelivery() {
    const own = Object.getOwnPropertyDescriptor(globalThis, 'ResizeObserver');
    const callbacks: ResizeObserverCallback[] = [];
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
      constructor(callback: ResizeObserverCallback) {
        callbacks.push(callback);
      }
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    };

    return {
      deliver: (width: number) => {
        for (const callback of callbacks) {
          callback(
            [{ contentRect: { width, height: 20 } }] as unknown as ResizeObserverEntry[],
            {} as ResizeObserver,
          );
        }
      },
      undo: () => {
        if (own === undefined) {
          delete (globalThis as { ResizeObserver?: unknown }).ResizeObserver;
          return;
        }
        Object.defineProperty(globalThis, 'ResizeObserver', own);
      },
    };
  }

  /** States what the renderer will not: how wide the whole text is. */
  function declareWhole(fixture: ReturnType<typeof render>, whole: number): void {
    Object.defineProperty(query(fixture, '.fit-text__value'), 'scrollWidth', {
      configurable: true,
      value: whole,
    });
  }

  function render(text = LABEL) {
    return renderComponent(FitText, { text });
  }

  let delivery: ReturnType<typeof declareDelivery>;
  beforeEach(() => (delivery = declareDelivery()));
  afterEach(() => delivery.undo());

  it('draws no mark while the whole text fits', () => {
    const fixture = render();
    declareWhole(fixture, 100);
    delivery.deliver(100);
    fixture.detectChanges();

    expect(element(fixture).querySelector('.fit-text__more')).toBeNull();
    expect(element(fixture).querySelector('[role="tooltip"]')).toBeNull();
    expect(element(fixture).hasAttribute('data-text-reachable')).toBe(false);
    expect(fixture.componentInstance.cut()).toBe(false);
  });

  it('draws the mark, with the whole text as its tip, while the text is cut', () => {
    const fixture = render();
    declareWhole(fixture, 300);
    delivery.deliver(100);
    fixture.detectChanges();

    const mark = query(fixture, '.fit-text__more');
    expect(textOf(mark.querySelector('.tooltip__trigger'))).toBe('…');
    expect(textOf(mark.querySelector('[role="tooltip"]'))).toBe(LABEL);
    expect(element(fixture).hasAttribute('data-text-reachable')).toBe(true);
    expect(fixture.componentInstance.cut()).toBe(true);
  });

  it('never breaks a word, so a word too long for its box is cut rather than split', () => {
    const fixture = render();
    fixture.detectChanges();

    const value = query(fixture, '.fit-text__value');
    expect(getComputedStyle(value).overflowWrap).toBe('normal');
    expect(getComputedStyle(value).overflowX).toBe('clip');
  });

  it('takes the mark away once the box holds the whole text again', () => {
    const fixture = render();
    declareWhole(fixture, 300);
    delivery.deliver(100);
    fixture.detectChanges();
    expect(element(fixture).querySelector('.fit-text__more')).not.toBeNull();

    // A box as wide as the whole text, even though the `…` still takes part of
    // it: the text fits once the mark is gone.
    delivery.deliver(300);
    fixture.detectChanges();

    expect(element(fixture).querySelector('.fit-text__more')).toBeNull();
    expect(element(fixture).hasAttribute('data-text-reachable')).toBe(false);
  });

  it('measures a new text in an unchanged box', () => {
    const fixture = render('Idle');
    declareWhole(fixture, 40);
    delivery.deliver(100);
    fixture.detectChanges();
    expect(fixture.componentInstance.cut()).toBe(false);

    fixture.componentRef.setInput('text', LABEL);
    fixture.detectChanges();
    declareWhole(fixture, 300);
    delivery.deliver(100);
    fixture.detectChanges();

    expect(textOf(query(fixture, '.fit-text__more [role="tooltip"]'))).toBe(LABEL);
  });

  it('draws a plain mark, and no tooltip, where the caller hands back the whole text', () => {
    const fixture = renderComponent(FitText, { text: LABEL, tipped: false });
    declareWhole(fixture, 300);
    delivery.deliver(100);
    fixture.detectChanges();

    const mark = query(fixture, '.fit-text__more');
    expect(textOf(mark)).toBe('…');
    expect(mark.getAttribute('aria-hidden')).toBe('true');
    expect(element(fixture).querySelector('ednb-tooltip')).toBeNull();
    expect(element(fixture).querySelector('[role="tooltip"]')).toBeNull();
    expect(element(fixture).hasAttribute('data-text-reachable')).toBe(true);
    expect(fixture.componentInstance.cut()).toBe(true);
  });

  it('draws a plain mark, and no tooltip, where there is no text for a tip to show', () => {
    const fixture = renderComponent(FitText, { text: '' });
    declareWhole(fixture, 300);
    delivery.deliver(100);
    fixture.detectChanges();

    expect(textOf(query(fixture, '.fit-text__more'))).toBe('…');
    expect(element(fixture).querySelector('ednb-tooltip')).toBeNull();
    expect(element(fixture).querySelector('[role="tooltip"]')).toBeNull();
  });

  it('draws no plain mark while the whole text fits', () => {
    const fixture = renderComponent(FitText, { text: LABEL, tipped: false });
    declareWhole(fixture, 100);
    delivery.deliver(100);
    fixture.detectChanges();

    expect(element(fixture).querySelector('.fit-text__more')).toBeNull();
    expect(fixture.componentInstance.cut()).toBe(false);
  });

  it('draws projected content in place of the text, and cuts it with the text as the tip', () => {
    const fixture = renderComponent(ProjectingHost);
    Object.defineProperty(query(fixture, '.fit-text__value'), 'scrollWidth', {
      configurable: true,
      value: 300,
    });
    delivery.deliver(100);
    fixture.detectChanges();

    const value = query(fixture, '.fit-text__value');
    expect(value.querySelector('.own')?.getAttribute('lang')).toBe('en');
    expect(textOf(value)).toBe('Supercruise Assist');
    expect(textOf(query(fixture, '.fit-text__more [role="tooltip"]'))).toBe('Supercruise Assist');
  });

  it('keeps the whole text in the accessibility tree, and hides only the mark', () => {
    const fixture = render();
    declareWhole(fixture, 300);
    delivery.deliver(100);
    fixture.detectChanges();

    const value = query(fixture, '.fit-text__value');
    expect(textOf(value)).toBe(LABEL);
    expect(value.closest('[aria-hidden="true"]')).toBeNull();
    expect(query(fixture, '.fit-text__more').getAttribute('aria-hidden')).toBe('true');
  });
});
