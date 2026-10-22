import type { Page } from '@playwright/test';
import { PRODUCT_URL } from './servers';

/**
 * Watching a page from the frame the document painted, rather than from the
 * frame the application finished in.
 *
 * Since feature 015 an advertised address answers with a document the build
 * rendered, so there is a whole readable page before any of this application
 * exists. Everything that page promises — that it states its subject, that the
 * takeover neither blanks it nor moves it, that a returning Commander gets
 * their own address back and not the start page — is a claim about frames, and
 * a claim about frames cannot be checked by looking at the end.
 *
 * So the recorder is installed before the page runs, samples on every animation
 * frame, and is read once the takeover is done.
 */

/** One sample, taken on one animation frame. */
export interface Frame {
  /** How much text a Commander can see, in characters. */
  readonly length: number;
  /** Whether the address's subject is among it. */
  readonly subject: boolean;
  /** Where the measured boxes are, in the order `MEASURED` names them. */
  readonly boxes: readonly (readonly [number, number, number, number] | null)[];
  /**
   * Whether the takeover has finished, so nothing is still waiting on it.
   *
   * A document with a rendered body is read by the held presses alone. A
   * document with no rendered body holds none, so this reads true there from the
   * first frame, for the reason `waitForTakeover` gives. A journey that meets
   * one asks the question there instead.
   */
  readonly takenOver: boolean;
  /**
   * Whether the document has finished arriving.
   *
   * A generated hull document is a quarter of a megabyte, and a browser paints
   * long before it has read all of it: the earliest frames hold a catalogue
   * that is 18 rows long on its way to 49, and the page grows underneath them.
   * That is the document downloading, not the takeover moving anything, and the
   * two are only told apart by knowing which frames are which.
   */
  readonly parsed: boolean;
  /**
   * Whether the typeface the page asked for has arrived.
   *
   * The faces are same-origin subsets declared `font-display: swap`. The ones a
   * served document draws with are preloaded and arrive with the stylesheet, so
   * a document normally paints in them; a face that arrives late still paints in
   * a system fallback first and re-paints in Barlow a moment later. Where the
   * two disagree on metrics the page changes height under that swap — measured
   * on Firefox at 1112px, ten pixels across the catalogue — and it does so
   * whether or not this application ever loads, which is what makes it the
   * network rather than the takeover. Recorded so a frame that fails a reading
   * can say whether the page was wearing what it asked for when it was taken,
   * which is what tells a swap apart from something moving.
   *
   * Not a boundary, the way `parsed` is one. The verdict covers every face at
   * once and turns back over for a face the application asks for after the
   * document had all of its own, so a window that begins where it turns over
   * can begin anywhere (`markTheDocumentsLastFrame`).
   */
  readonly dressed: boolean;
}

/**
 * What the boxes are measured on, and why these four.
 *
 * Where the shell's bar sits, where the screen's content begins, where the
 * screen itself sits inside it, and where the page ends. A composition
 * corrected after the fact moves at least one of them; a document that stated a
 * measurement the build could not have taken moves the first two, because both
 * of `sticky-banner.ts`'s bindings drive offsets between them.
 *
 * Named by position rather than by tag, because the three screens do not share
 * a tag: the route's own `<h1>` lives in the shell's banner, not in `main`
 * (011/FR-008). `main > *:last-child` rather than `main > *`, because the first
 * child of `main` is the router's own outlet anchor — a zero-height comment
 * marker whose box never moves no matter what happens to the page.
 */
export const MEASURED = ['header', 'main', 'main > *:last-child', 'body'] as const;

/**
 * The announcements whose whole purpose is to stop being true.
 *
 * The build renders every hull illustration in its pending state, because a
 * build has no image to wait for and no load event to hear. In a browser the
 * picture arrives, the pending state ends, and the line that announced the wait
 * retires with it — 25 characters of text, visually hidden, that leave the page
 * a second after it painted.
 *
 * That is the illustration arriving, which is the opposite of the content
 * disappearing that FR-009 forbids: nothing a Commander is reading is lost and
 * nothing moves, because the plate reserves its area at a fixed ratio either
 * way. So it is subtracted before anything here is measured — named and
 * bounded, the way the stored catalogue view and the language are.
 */
const RETIRING = ['Loading the illustration'] as const;

/**
 * Installs the recorder.
 *
 * `innerText` rather than `textContent`, because the question is what a
 * Commander can see: the shell draws both bar compositions and the catalogue
 * draws both of its views into every document, hiding one of each, and
 * `textContent` would count the hidden half.
 *
 * The subject is matched without regard to case, because `innerText` reports
 * what the screen shows and half of what this application shows is set in
 * capitals by `text-transform`. A test that insisted on "Anaconda" would be
 * asserting a typographic choice rather than the presence of the hull.
 */
export async function recordFrames(page: Page, subject: string): Promise<void> {
  await page.addInitScript(
    ([wanted, measured, retiring]: [string, readonly string[], readonly string[]]) => {
      const frames: unknown[] = [];
      (window as unknown as { __frames: unknown[] }).__frames = frames;
      // Cut by search rather than by pattern: the phrases are words, and a
      // word compiled into a regular expression is a word whose punctuation
      // has become syntax.
      const without = (text: string, phrase: string) => {
        const lowered = text.toLowerCase();
        const wanted = phrase.toLowerCase();
        let cut = '';
        let from = 0;
        for (let at = lowered.indexOf(wanted); at !== -1; at = lowered.indexOf(wanted, from)) {
          cut += text.slice(from, at);
          from = at + wanted.length;
        }
        return cut + text.slice(from);
      };
      const read = () => {
        let text = (document.body.innerText || '').replace(/\s+/g, ' ').trim();
        for (const phrase of retiring) {
          text = without(text, phrase);
        }
        return text.replace(/\s+/g, ' ').trim();
      };
      const record = () => {
        if (document.body) {
          const text = read();
          frames.push({
            length: text.length,
            subject: text.toLowerCase().includes(wanted.toLowerCase()),
            boxes: measured.map((selector) => {
              const element = document.querySelector(selector);
              if (!element) {
                return null;
              }
              const box = element.getBoundingClientRect();
              return [
                Math.round(box.x),
                Math.round(box.y),
                Math.round(box.width),
                Math.round(box.height),
              ];
            }),
            takenOver: document.querySelectorAll('[jsaction]').length === 0,
            parsed: document.readyState !== 'loading',
            dressed: document.fonts.status === 'loaded',
          });
        }
        requestAnimationFrame(record);
      };
      requestAnimationFrame(record);
    },
    [subject, MEASURED, RETIRING] as [string, readonly string[], readonly string[]],
  );
}

/** Everything the recorder has seen so far. */
export function frames(page: Page): Promise<readonly Frame[]> {
  return page.evaluate(() => (window as unknown as { __frames: Frame[] }).__frames ?? []);
}

/**
 * Marks the frame the document has had last, for a reading that starts there.
 *
 * A measurement of the takeover is a measurement from the last frame the
 * document had to itself through every frame after it, so something has to say
 * which frame that is. A journey whose takeover presents a screen reads it off
 * the page: the presses the document holds for replay leave it, and `takenOver`
 * turns over on the frame they do.
 *
 * Where the takeover presents no screen there is nothing that turns over. The
 * copy put back carries the served document's own presses, as it must, being
 * what the address served rather than a rewriting of it. The page's own verdict
 * on its typeface is no marker either: `document.fonts.status` is one verdict
 * over every face at once, and on Firefox it read `loading` through every frame
 * the document had on its own — so a window that began where it turned `loaded`
 * began after the failure had already been stated, and measured nothing.
 *
 * So the moment is marked where it is known rather than read off the page: by
 * the journey holding the application's own code back, at the moment it lets it
 * go.
 */
export async function markTheDocumentsLastFrame(page: Page): Promise<void> {
  await page.evaluate(() => {
    const recorded = (window as unknown as { __frames?: readonly Frame[] }).__frames ?? [];
    (window as unknown as { __from?: number }).__from = recorded.length;
  });
}

/**
 * Every frame from the one the document had to itself last, onwards.
 *
 * Everything the recorder has, where the mark was never set — a journey that
 * lets the application go the moment it asks marks nothing, and has no window
 * of its own to measure in.
 */
export async function framesSinceTheDocumentWasAlone(page: Page): Promise<readonly Frame[]> {
  const recorded = await frames(page);
  const released = await page.evaluate(
    () => (window as unknown as { __from?: number }).__from ?? 0,
  );
  return recorded.slice(Math.max(0, released - 1));
}

/**
 * The text of the frame the document painted, before anything else ran.
 *
 * Recorded rather than read afterwards, because by the time a test can ask, the
 * application has answered — and the question is what was there before it did.
 *
 * A frame is skipped only while the document is still being parsed and has
 * nothing in it yet. The callback is asked for before the body has been parsed
 * as well as after, and under load it is answered there first: the document has
 * a body, the body has no text in it, and recording that would say the first
 * frame showed nothing when what it describes is when the recorder was asked.
 *
 * An empty frame after the parse is kept, and has to be. That is what a hull's
 * address answered by the body-less shell looks like — the failure both of the
 * journeys reading these frames exist to catch — and a recorder that dropped
 * every empty frame would report the application's own later render as the
 * first thing a Commander saw.
 *
 * `recordList` reads the same two facts and requires both, which is right for
 * what it watches: on the catalogue an empty frame can only be the document not
 * being there yet. Here it can also be the shell answering, which is the
 * evidence rather than the noise, so the two are combined the other way.
 *
 * Lower-cased for the same reason `recordFrames` matches without case: what is
 * being asked is whether a word was on the screen, not how it was set.
 */
export async function recordFirstFrameText(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const seen: string[] = [];
    (window as unknown as { __text: string[] }).__text = seen;
    const record = () => {
      if (document.body) {
        const text = (document.body.innerText || '').replace(/\s+/g, ' ').trim().toLowerCase();
        if (text !== '' || document.readyState !== 'loading') {
          seen.push(text);
        }
      }
      requestAnimationFrame(record);
    };
    requestAnimationFrame(record);
  });
}

/** Every frame's text, in order, lower-cased. */
export function frameTexts(page: Page): Promise<readonly string[]> {
  return page.evaluate(() => (window as unknown as { __text: string[] }).__text ?? []);
}

/**
 * Opens an address with the application's bundle unreachable.
 *
 * A Commander on a connection that drops the bundle and a reader that runs no
 * script at all are the same case: the document is all they will ever have
 * (015/FR-012). Inline scripts still run — the replay contract among them —
 * because blocking a request is what a broken connection does, not turning
 * scripting off.
 */
export async function openWithoutTheBundle(page: Page, path: string): Promise<void> {
  await page.route(/\.js(\?.*)?$/, (route) => route.abort());
  await page.goto(`${PRODUCT_URL}${path}`);
}

/**
 * Opens an address with the application's bundle held back for a moment.
 *
 * The window between the document painting and the application taking it over
 * is the window this feature exists to fill, and on a static server on the same
 * machine it can be shorter than the browser's first paint — which makes it
 * unobservable rather than absent, and makes a test that samples for it report
 * the machine's load instead of the product.
 *
 * Half a second is a slow connection, which is the case the window is for. The
 * document is unchanged and so is everything the takeover then does; the only
 * thing this decides is that there are frames to look at in between.
 */
export async function openWithADelayedBundle(page: Page, path: string): Promise<void> {
  await page.route(/\.js(\?.*)?$/, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 500));
    await route.continue();
  });
  await page.goto(`${PRODUCT_URL}${path}`);
}

/**
 * Opens an address and returns while the bundle is still on its way.
 *
 * `openWithADelayedBundle` waits for `load`, which is over only once the held
 * bundle has arrived and the application is on its way up. A journey that asks
 * a question of the document alone needs the navigation over sooner, so this
 * one returns on the commit.
 *
 * A second, which is a whole navigation and a boot on a shared machine. The
 * hold is what makes the answer the document's rather than the application's,
 * so it is set long enough to be sure of.
 */
export async function openBeforeTheBundleArrives(page: Page, path: string): Promise<void> {
  await page.route(/\.js(\?.*)?$/, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    await route.continue();
  });
  await page.goto(`${PRODUCT_URL}${path}`, { waitUntil: 'commit' });
}

/**
 * Opens an address with the bundle held back until the page is wearing the
 * typeface it asked for.
 *
 * A fixed delay is not enough for a movement measurement. The faces are
 * declared `font-display: swap`, so a subset that arrives after the paint it is
 * wanted for lays the page out again — Firefox at 1112px is ten pixels taller in
 * the fallback than in Barlow — and those re-layouts are the document settling
 * into itself, not the application moving anything. They cannot be
 * subtracted after the fact either: `document.fonts.status` is one verdict over
 * every face at once, so it still reads `loading` long after the face that
 * changed the metrics has landed, and a frame is not told apart by it.
 *
 * So the swap is put where it belongs — before the application exists — by
 * holding the bundle until the set reports itself done. `size > 0` and a face
 * that actually loaded, because a set with nothing asked of it yet reports
 * `loaded` too, and continuing on that would hold nothing back at all. Parsed
 * first, because a face is only asked for once there is text needing it, and a
 * set judged complete halfway down a document goes back to loading when the
 * rest of it arrives. The wait is capped and its failure ignored: a browser that
 * never gets a face is a Commander on a broken connection, and the test's
 * subject is the takeover either way.
 */
export async function openOnceTheTypefaceHasArrived(page: Page, path: string): Promise<void> {
  await page.route(/\.js(\?.*)?$/, async (route) => {
    await theTypefaceHasArrived(page);
    await route.continue();
  });
  await page.goto(`${PRODUCT_URL}${path}`);
}

/**
 * Returns once the page has read its document and is wearing the faces it asked
 * for, or once the wait has run out.
 *
 * This is the condition `openOnceTheTypefaceHasArrived` holds the bundle on,
 * exported on its own so a journey that builds its own route can hold the
 * bundle on the same condition. Its reasoning is that function's.
 */
export async function theTypefaceHasArrived(page: Page): Promise<void> {
  await page
    .waitForFunction(
      () =>
        document.readyState !== 'loading' &&
        document.fonts.status === 'loaded' &&
        [...document.fonts].some((face) => face.status === 'loaded'),
      undefined,
      { timeout: 10_000 },
    )
    .catch(() => undefined);
}
