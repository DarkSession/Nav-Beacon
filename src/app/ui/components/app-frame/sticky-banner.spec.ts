import {
  ChangeDetectionStrategy,
  Component,
  DOCUMENT,
  ElementRef,
  viewChild,
  type Signal,
} from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { renderComponent } from '../ui-component.spec-helpers';
import { observeBanner } from './sticky-banner';
import { declareMeasurement, declareResizeObserver } from '../../measurement.spec-helpers';

/**
 * The banner keeps the top of the screen only while it can afford to.
 *
 * The property under test is that the threshold is the bar's share of the
 * window rather than a viewport size: the same window, the same bar and a
 * Commander who has doubled their text size is a bar that has wrapped, and the
 * decision has to move with it. A viewport-only rule keeps a five-row German
 * command bar frozen over more than half a tablet.
 */

@Component({
  selector: 'ednb-sticky-banner-host',
  template: '<header #banner></header>',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
class StickyBannerHost {
  protected readonly banner = viewChild<ElementRef<HTMLElement>>('banner');
  readonly #banner = observeBanner(this.banner);
  readonly released: Signal<boolean> = this.#banner.released;
  readonly height: Signal<number | null> = this.#banner.height;
}

const HEIGHT = Object.getOwnPropertyDescriptor(window, 'innerHeight');

/** The undo for whatever this test declared, run after it. */
let restore: (() => void) | null = null;

/**
 * Sets the bar's measured height, since jsdom lays nothing out on its own.
 *
 * Declared through `measurement.spec-helpers`, which owns the rule about which
 * prototype the patch goes on and what putting it back means — undoing one of
 * these by assignment leaves the genuine method behind as an own property,
 * shadowing the level other specs patch.
 */
function withBarHeight(height: number): void {
  restore?.();
  restore = declareMeasurement({ height, bottom: height });
}

/** The window the bar is taking a share of. */
function withWindowHeight(height: number): void {
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: height });
}

/** The root text size the threshold is measured against. */
function withRootFontSize(px: number): void {
  document.documentElement.style.fontSize = `${px}px`;
}

describe('the sticky banner', () => {
  let observed: (() => void) | null = null;

  beforeEach(() => {
    // The measurement under test observes resizes; the initial reading is the
    // synchronous one, which is what these thresholds are about. A no-op
    // observer keeps that path honest without simulating a resize.
    observed = declareResizeObserver();
  });

  afterEach(() => {
    document.documentElement.style.fontSize = '';
    restore?.();
    restore = null;
    if (HEIGHT !== undefined) {
      Object.defineProperty(window, 'innerHeight', HEIGHT);
    }
    observed?.();
    observed = null;
  });

  it('keeps its place while it leaves a viewport that can still be stacked in', () => {
    withRootFontSize(16);
    withWindowHeight(834);
    // The bar every screen draws at an ordinary text size, which leaves far
    // more than the 480px that 30rem is here.
    withBarHeight(74);

    const fixture = renderComponent(StickyBannerHost);

    expect(fixture.componentInstance.released()).toBe(false);
  });

  it('releases once what it leaves below is a short viewport', () => {
    withRootFontSize(16);
    withWindowHeight(834);
    withBarHeight(400);

    const fixture = renderComponent(StickyBannerHost);

    expect(fixture.componentInstance.released()).toBe(true);
  });

  it('releases the same bar in the same window once the text is doubled', () => {
    // The failing case, in its own terms: a tablet held in landscape, a bar
    // that wrapped to five rows of German, and a threshold that has doubled
    // with the Commander's text rather than staying at load-time pixels.
    withRootFontSize(32);
    withWindowHeight(834);
    withBarHeight(462);

    const fixture = renderComponent(StickyBannerHost);

    expect(fixture.componentInstance.released()).toBe(true);
  });

  it('publishes the height the bar actually came out at, not the declared one', () => {
    // The reading every sticky region below the bar offsets by. A wrapped bar
    // is taller than the declared floor — at a doubled text size and at 400%
    // zoom it wraps — and a region handed the declared figure freezes behind
    // the bar and stands its own foot short of the screen's by the difference.
    //
    // Measured at a height the token layer never declares, so a reading that
    // was really the declared figure could not pass this.
    withRootFontSize(16);
    withWindowHeight(1000);
    withBarHeight(118);

    const fixture = renderComponent(StickyBannerHost);

    expect(fixture.componentInstance.height()).toBe(118);
  });

  it('measures nothing at all until the host has been rendered once', () => {
    // The guard 015 needs, in the terms this file already uses.
    //
    // The build renders these components to produce the document each address
    // answers with, and it cannot lay anything out: under its DOM emulation
    // `getBoundingClientRect` is not a function, so a reading taken before the
    // first render throws there rather than returning something wrong. The
    // deferral to `afterNextRender` is what keeps that call from happening, and
    // `afterNextRender` never runs in that renderer at all.
    //
    // Asserted as "no reading was taken" rather than "no error was thrown",
    // because the prerenderer swallows component errors: an unguarded version
    // exits 0 and publishes 51 documents rendered from a broken pass.
    withRootFontSize(16);
    withWindowHeight(834);
    withBarHeight(74);

    // Counted on `HTMLElement.prototype`, layered over the declared height,
    // because that is the level `declareMeasurement` patches — a counter on
    // `Element.prototype` would sit underneath it and never be called. Undone
    // by descriptor for the reason that file gives at length.
    let readings = 0;
    const declared = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      'getBoundingClientRect',
    );
    const measure = HTMLElement.prototype.getBoundingClientRect;
    Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
      configurable: true,
      writable: true,
      value: function counted(this: Element): DOMRect {
        readings += 1;
        return measure.call(this);
      },
    });

    try {
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({ imports: [StickyBannerHost] });
      const fixture = TestBed.createComponent(StickyBannerHost);

      // Constructed, so the effect and the deferral are both registered, but
      // never rendered — which is as far as the build ever gets.
      expect(readings).toBe(0);
      expect(fixture.componentInstance.height()).toBeNull();
      expect(fixture.componentInstance.released()).toBe(false);

      // And once it is rendered, the reading happens. Without this half the
      // test above would pass just as well against a measurement that never
      // works at all.
      fixture.detectChanges();

      expect(readings).toBeGreaterThan(0);
      expect(fixture.componentInstance.height()).toBe(74);
    } finally {
      if (declared === undefined) {
        delete (HTMLElement.prototype as { getBoundingClientRect?: unknown }).getBoundingClientRect;
      } else {
        Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', declared);
      }
    }
  });

  it('publishes no measurement where the document has no window', () => {
    // The build's renderer, from the other direction: a document without a
    // `defaultView`. `released` and `height` keep their initial values, so
    // `AppFrame` publishes neither host binding into the document and the token
    // layer's declared height stands (015/FR-009, research decision 6).
    withRootFontSize(16);
    withWindowHeight(834);
    withBarHeight(74);

    // The real document with its window masked, rather than a stub object:
    // Angular's own renderer calls `querySelector` on whatever `DOCUMENT`
    // provides, so a plain `{ defaultView: null }` fails before the component
    // under test is ever constructed. Functions are bound back to the genuine
    // document, because jsdom refuses a foreign receiver.
    const windowless = new Proxy(document, {
      get(target, key) {
        if (key === 'defaultView') {
          return null;
        }
        const value = Reflect.get(target, key) as unknown;
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [StickyBannerHost],
      providers: [{ provide: DOCUMENT, useValue: windowless }],
    });
    const fixture = TestBed.createComponent(StickyBannerHost);
    fixture.detectChanges();

    expect(fixture.componentInstance.height()).toBeNull();
    expect(fixture.componentInstance.released()).toBe(false);
  });

  it('holds its place in a renderer with no resize observer', () => {
    delete (globalThis as { ResizeObserver?: unknown }).ResizeObserver;
    withRootFontSize(16);
    withWindowHeight(834);
    withBarHeight(74);

    const fixture = renderComponent(StickyBannerHost);

    // The measurement still happens; only the watching does not. A renderer
    // that cannot observe is not a reason to freeze a bar over the page, nor
    // to release one that fits.
    expect(fixture.componentInstance.released()).toBe(false);
  });
});
