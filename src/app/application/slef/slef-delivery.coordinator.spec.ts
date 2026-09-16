import { TestBed } from '@angular/core/testing';
import { ShipLoadout } from '@elite-dangerous-almanac/core/ships/ship-loadout';
import { ActiveBuildStore } from '../active-build/active-build.store';
import { FragmentPublisher } from '../build-link/fragment-publisher';
import { DownloadAdapter } from '../../platform/browser/download.adapter';
import { NavigatorAdapter } from '../../platform/browser/navigator.adapter';
import { FIXTURE_HULL } from '../../domain/ships/outfitting/outfitting.fixtures';
import { SlefDeliveryCoordinator, detectDeliveryCapability } from './slef-delivery.coordinator';
import { SlefExportCoordinator } from './slef-export.coordinator';
import { SlefStore } from './slef.store';
import { suppliedFit } from '../../domain/ships/build/supplied-fit';

/** A navigator whose every capability and outcome the test decides. */
class FakeNavigator {
  clipboard = true;
  share = true;
  files = true;
  copyResult: boolean | Error = true;
  shareResult: 'shared' | 'cancelled' | 'failed' = 'shared';
  copiedText: string | null = null;
  sharedData: ShareData | null = null;

  clipboardAvailable(): boolean {
    return this.clipboard;
  }
  canShare(): boolean {
    return this.share;
  }
  canShareFiles(): boolean {
    return this.files;
  }
  async copyText(text: string): Promise<boolean> {
    this.copiedText = text;
    return this.copyResult === true;
  }
  async shareData(data: ShareData): Promise<'shared' | 'cancelled' | 'failed'> {
    this.sharedData = data;
    return this.shareResult;
  }
}

class FakeDownload {
  ok = true;
  fileSupported = true;
  dispatched: { payload: string; filename: string; mimeType: string } | null = null;

  dispatch(payload: string, filename: string, mimeType: string): boolean {
    this.dispatched = { payload, filename, mimeType };
    return this.ok;
  }
  toFile(payload: string, filename: string, mimeType: string): File | null {
    return this.fileSupported ? new File([payload], filename, { type: mimeType }) : null;
  }
}

class StubPublisher {
  publishedUrl(): string | null {
    return null;
  }
}

describe('SLEF delivery', () => {
  let navigator: FakeNavigator;
  let download: FakeDownload;
  let active: ActiveBuildStore;
  let store: SlefStore;
  let coordinator: SlefDeliveryCoordinator;

  beforeEach(() => {
    navigator = new FakeNavigator();
    download = new FakeDownload();
    TestBed.configureTestingModule({
      providers: [
        { provide: NavigatorAdapter, useValue: navigator },
        { provide: DownloadAdapter, useValue: download },
        { provide: FragmentPublisher, useValue: new StubPublisher() },
      ],
    });
    active = TestBed.inject(ActiveBuildStore);
    store = TestBed.inject(SlefStore);
    coordinator = TestBed.inject(SlefDeliveryCoordinator);

    active.commit({
      loadout: ShipLoadout.default(FIXTURE_HULL),
      suppliedFit: suppliedFit(ShipLoadout.default(FIXTURE_HULL).shipSymbol),
      hullName: 'Anaconda',
      provenance: 'working',
      sourceNamed: null,
      autosaveRecordId: null,
      baseline: null,
    });
    TestBed.inject(SlefExportCoordinator).generate();
  });

  describe('capability detection', () => {
    it('reads the platform, never the viewport', () => {
      expect(
        detectDeliveryCapability(
          navigator as unknown as NavigatorAdapter,
          download as unknown as DownloadAdapter,
          store.artifact(),
        ),
      ).toEqual({ clipboard: 'available', download: 'available', share: 'file' });
    });

    it('falls back to text sharing when the platform refuses the file', () => {
      navigator.files = false;

      expect(coordinator.refreshCapability().share).toBe('text');
    });

    it('hides sharing entirely where the platform has no share sheet', () => {
      navigator.share = false;

      expect(coordinator.refreshCapability().share).toBe('unavailable');
    });

    it('keeps download available even where the share sheet takes files', () => {
      expect(coordinator.refreshCapability().download).toBe('available');
    });

    it('reports an absent clipboard without authorizing anything automatically', () => {
      navigator.clipboard = false;

      expect(coordinator.refreshCapability().clipboard).toBe('unavailable');
      expect(navigator.copiedText).toBeNull();
      expect(download.dispatched).toBeNull();
    });
  });

  describe('copy', () => {
    it('says copied only after the clipboard promise resolves', async () => {
      const outcome = await coordinator.copy();

      expect(outcome).toEqual({ action: 'copy', status: 'copied' });
      expect(navigator.copiedText).toBe(store.artifact()?.payload);
    });

    it('keeps the payload and the alternatives after a failure', async () => {
      navigator.copyResult = false;

      await coordinator.copy();

      expect(store.artifact()).not.toBeNull();
      expect(coordinator.download().status).toBe('dispatched');
    });

    it('names no cause it did not observe', async () => {
      // The platform answers a copy with a bare false. Reporting that as a
      // denied permission would be the application inventing a reason; the
      // guard against the deprecated fallback is the ownership policy's
      // `no deprecated clipboard fallback` rule, which reads the source.
      navigator.copyResult = false;

      const outcome = await coordinator.copy();

      expect(outcome).toEqual({ action: 'copy', status: 'failed', reason: 'failed' });
    });
  });

  describe('download', () => {
    it('hands over the exact bytes, filename and type', () => {
      const artifact = store.artifact();

      const outcome = coordinator.download();

      expect(outcome).toEqual({ action: 'download', status: 'dispatched' });
      expect(download.dispatched).toEqual({
        payload: artifact?.payload,
        filename: 'build.slef.json',
        mimeType: 'application/json;charset=utf-8',
      });
    });

    it('reports a setup failure and never claims the file was saved', () => {
      download.ok = false;

      const outcome = coordinator.download();

      expect(outcome).toEqual({ action: 'download', status: 'setupFailed', reason: 'failed' });
    });
  });

  describe('share', () => {
    it('prefers a file when the platform says it can take one', async () => {
      const outcome = await coordinator.share();

      expect(outcome).toEqual({ action: 'share', status: 'shared' });
      expect(navigator.sharedData).toHaveProperty('files');
    });

    it('falls back to text rather than not sharing at all', async () => {
      navigator.files = false;

      await coordinator.share();

      expect(navigator.sharedData).toEqual({ text: store.artifact()?.payload });
    });

    it('treats a dismissed chooser as neutral, not as a failure', async () => {
      navigator.shareResult = 'cancelled';

      expect(await coordinator.share()).toEqual({ action: 'share', status: 'cancelled' });
      expect(store.artifact()).not.toBeNull();
    });

    it('reports a genuine failure, and never retries or picks a target', async () => {
      navigator.shareResult = 'failed';

      expect(await coordinator.share()).toEqual({
        action: 'share',
        status: 'failed',
        reason: 'failed',
      });
    });

    it('does nothing at all where the platform has no share sheet', async () => {
      navigator.share = false;

      expect(await coordinator.share()).toEqual({
        action: 'share',
        status: 'failed',
        reason: 'unsupported',
      });
      expect(navigator.sharedData).toBeNull();
    });
  });

  describe('a stale artifact', () => {
    it('is refused by every action rather than delivered or regenerated', async () => {
      active.touch();

      expect(await coordinator.copy()).toEqual({
        action: 'copy',
        status: 'failed',
        reason: 'unsupported',
      });
      expect(coordinator.download()).toEqual({
        action: 'download',
        status: 'setupFailed',
        reason: 'unsupported',
      });
      expect(await coordinator.share()).toEqual({
        action: 'share',
        status: 'failed',
        reason: 'unsupported',
      });
      expect(navigator.copiedText).toBeNull();
      expect(download.dispatched).toBeNull();
      expect(store.artifact()).toBeNull();
    });
  });
});
