import { Injectable, Injector, inject } from '@angular/core';
import { WorkingRecordAutosave } from '../build-library/working-record.autosave';
import { RecordSynchronisationLoader } from '../synchronisation/record-synchronisation.loader';
import { ClockAdapter } from '../../platform/browser/clock.adapter';
import { PageLifecycleAdapter } from '../../platform/browser/page-lifecycle.adapter';
import { UuidAdapter } from '../../platform/browser/uuid.adapter';
import { LocalRecordRepository } from '../../platform/storage/local-record.repository';
import { LoadoutStore } from './loadout.store';

/**
 * Keeping the loadout on this page's bench recoverable.
 *
 * The shared autosave, bound to the bench's own store. Everything it does is in
 * `WorkingRecordAutosave`; what is here is which work it keeps.
 */
@Injectable({ providedIn: 'root' })
export class LoadoutAutosaveService extends WorkingRecordAutosave {
  constructor() {
    super(
      inject(LoadoutStore),
      inject(LocalRecordRepository),
      inject(PageLifecycleAdapter),
      inject(UuidAdapter),
      inject(ClockAdapter),
      inject(RecordSynchronisationLoader),
      inject(Injector),
    );
  }
}
