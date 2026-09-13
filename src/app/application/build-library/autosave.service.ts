import { Injectable, Injector, inject } from '@angular/core';
import { RecordSynchronisationLoader } from '../synchronisation/record-synchronisation.loader';
import { ClockAdapter } from '../../platform/browser/clock.adapter';
import { PageLifecycleAdapter } from '../../platform/browser/page-lifecycle.adapter';
import { UuidAdapter } from '../../platform/browser/uuid.adapter';
import { LocalRecordRepository } from '../../platform/storage/local-record.repository';
import { ActiveBuildStore } from '../active-build/active-build.store';
import { WorkingRecordAutosave } from './working-record.autosave';

/**
 * Keeping this page's build recoverable.
 *
 * The shared autosave, bound to the ship tool's own store. Everything it does
 * is in `WorkingRecordAutosave`; what is here is which work it keeps.
 */
@Injectable({ providedIn: 'root' })
export class AutosaveService extends WorkingRecordAutosave {
  constructor() {
    super(
      inject(ActiveBuildStore),
      inject(LocalRecordRepository),
      inject(PageLifecycleAdapter),
      inject(UuidAdapter),
      inject(ClockAdapter),
      inject(RecordSynchronisationLoader),
      inject(Injector),
    );
  }
}
