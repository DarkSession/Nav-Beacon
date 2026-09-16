import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { ShipLoadout } from '@elite-dangerous-almanac/core/ships/ship-loadout';
import { FIXTURE_HULL } from '../../../domain/ships/outfitting/outfitting.fixtures';
import { provideLocalization } from '../../../i18n/i18n.providers';
import {
  MemoryStorage,
  provideMemoryStorage,
} from '../../../platform/storage/storage.spec-helpers';
import { provideIsolatedLocaleEnvironment } from '../../../i18n/testing/localization-harness';
import { DocumentAdapter } from '../../../platform/browser/document.adapter';
import { NavigatorAdapter } from '../../../platform/browser/navigator.adapter';
import { ActiveBuildStore } from '../../../application/active-build/active-build.store';
import { SlefStore } from '../../../application/slef/slef.store';
import { ExportDialog } from './export.dialog';
import { suppliedFit } from '../../../domain/ships/build/supplied-fit';

class SilentDocumentAdapter {
  commitRootState(): void {}
}

/** A platform that can do everything, so what is under test is the host. */
class FakeNavigator {
  languages(): readonly string[] {
    return ['en'];
  }
  clipboardAvailable(): boolean {
    return true;
  }
  canShare(): boolean {
    return true;
  }
  canShareFiles(): boolean {
    return true;
  }
  async copyText(): Promise<boolean> {
    return true;
  }
  async shareData(): Promise<'shared'> {
    return 'shared';
  }
}

/**
 * `<dialog>` without the native modal methods, which jsdom does not implement.
 *
 * The layer calls them the moment it opens; what these tests are about is what
 * the host decides, not what the browser does with a dialog element.
 */
function stubNativeDialog(): void {
  const prototype = HTMLDialogElement.prototype as unknown as Record<string, unknown>;
  prototype['showModal'] = function showModal(this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  prototype['close'] = function close(this: HTMLDialogElement) {
    this.removeAttribute('open');
  };
}

describe('the export layer’s host', () => {
  let store: SlefStore;
  let active: ActiveBuildStore;

  function render() {
    const fixture = TestBed.createComponent(ExportDialog);
    fixture.detectChanges();
    return fixture;
  }

  function commit(): void {
    active.commit({
      loadout: ShipLoadout.default(FIXTURE_HULL),
      suppliedFit: suppliedFit(ShipLoadout.default(FIXTURE_HULL).shipSymbol),
      hullName: 'Anaconda',
      provenance: 'working',
      sourceNamed: null,
      autosaveRecordId: null,
      baseline: null,
    });
  }

  beforeEach(() => {
    stubNativeDialog();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: 'outfitting', children: [] }]),
        provideLocalization(),
        ...provideIsolatedLocaleEnvironment(),
        // The import coordinator reaches the record repository to store a batch.
        ...provideMemoryStorage(new MemoryStorage()),
        { provide: DocumentAdapter, useValue: new SilentDocumentAdapter() },
        { provide: NavigatorAdapter, useClass: FakeNavigator },
      ],
    });
    store = TestBed.inject(SlefStore);
    active = TestBed.inject(ActiveBuildStore);
  });

  it('offers the two drawn formats, and no others', () => {
    const fixture = render();

    expect(fixture.componentInstance.modes().map((mode) => mode.value)).toEqual(['slef', 'link']);
  });

  it('starts on the format the canvas draws first and draws selected', () => {
    const fixture = render();

    expect(fixture.componentInstance.selectedMode()).toBe('slef');
    expect(fixture.componentInstance.selectedModes()).toEqual(['slef']);
  });

  it('composes the two-region layer canvas 1c draws', () => {
    const fixture = render();
    const host = fixture.nativeElement as HTMLElement;

    // The width step is what makes room for two regions beside each other, the
    // flush body is what lets the rule between them run the height of the
    // panel, and the arrangement is the canvas's list of plates.
    expect(host.querySelector('dialog')?.className).toContain('layer--wide');
    expect(host.querySelector('.layer__body')?.className).toContain('layer__body--flush');
    expect(host.querySelector('.choice-group__options')?.getAttribute('data-layout')).toBe('cards');
    // The canvas draws no question above the list; a reader still gets one.
    expect(host.querySelector('legend')?.className).toContain('field__label--hidden');
    expect(host.querySelector('legend')?.textContent?.trim().length).toBeGreaterThan(0);
  });

  it('moves the selection, and treats anything else as the link', () => {
    const fixture = render();

    fixture.componentInstance.selectMode(['slef']);
    expect(store.exportMode()).toBe('slef');

    fixture.componentInstance.selectMode(['something-else']);
    expect(store.exportMode()).toBe('link');
  });

  it('prepares the payload once the layer is actually on screen', () => {
    commit();
    store.selectExportMode('slef');
    const fixture = render();
    expect(store.artifact()).toBeNull();

    store.openLayer('export');
    fixture.detectChanges();

    // Deferred on purpose: the shell must not load the serializer to find out
    // that a control it draws was never pressed.
    expect(store.artifact()).not.toBeNull();
  });

  it('generates nothing for a format that is not the payload', () => {
    commit();
    store.selectExportMode('link');
    const fixture = render();

    store.openLayer('export');
    fixture.detectChanges();

    // The link mode is feature 001's panel; producing a SLEF payload for it
    // would be work for a control nobody pressed.
    expect(store.artifact()).toBeNull();
  });

  it('never shows a payload for a build that has since been edited', () => {
    commit();
    store.selectExportMode('slef');
    const fixture = render();

    store.openLayer('export');
    fixture.detectChanges();
    const first = store.artifact();
    expect(first).not.toBeNull();

    // Closed, edited, opened again — the ordinary way a stale payload would
    // reach a Commander under the current build's own title.
    store.closeLayer();
    fixture.detectChanges();
    active.touch();
    store.openLayer('export');
    fixture.detectChanges();

    expect(store.artifact()).not.toBeNull();
    expect(store.artifact()?.revision).toBe(active.revision());
    expect(store.artifact()).not.toBe(first);
  });

  it('makes the payload again when the build is replaced underneath the layer', () => {
    commit();
    store.selectExportMode('slef');
    const fixture = render();
    store.openLayer('export');
    fixture.detectChanges();

    // Another tab replaces the build. The layer does not tell the Commander to
    // make the export again through a control it does not draw; it makes it.
    active.touch();
    fixture.detectChanges();

    expect(store.artifact()?.revision).toBe(active.revision());
  });

  it('offers the payload as the link panel’s own way out of a refusal', () => {
    commit();
    const fixture = render();

    fixture.componentInstance.chooseSlef();

    expect(store.exportMode()).toBe('slef');
  });
});
