import { TestBed } from '@angular/core/testing';
import { ShipLoadout } from '@elite-dangerous-almanac/core/ships/ship-loadout';
import { mapOwnedShip, type OwnedShip } from '../../domain/commander/fleet/owned-ship';
import { toBuildSnapshotV1 } from '../../domain/ships/build/build-snapshot.serializer';
import { provideLocalization } from '../../i18n/i18n.providers';
import { provideIsolatedLocaleEnvironment } from '../../i18n/testing/localization-harness';
import { ClockAdapter } from '../../platform/browser/clock.adapter';
import { BroadcastChannelAdapter } from '../../platform/browser/broadcast-channel.adapter';
import { UuidAdapter } from '../../platform/browser/uuid.adapter';
import { MemoryStorage, provideMemoryStorage } from '../../platform/storage/storage.spec-helpers';
import { ActiveBuildStore } from '../active-build/active-build.store';
import { FleetCopyService } from './fleet-copy.service';
import { ownedShipPayload } from './fleet.spec-helpers';

class SilentChannel {
  readonly available = false;
  post(): void {}
  subscribe(): () => void {
    return () => {};
  }
}

class CountingUuid {
  #next = 0;

  create(): string {
    this.#next += 1;
    return `new-${this.#next}`;
  }
}

class FixedClock {
  instant = new Date('2026-09-11T10:00:00.000Z');

  now(): Date {
    return this.instant;
  }

  timestamp(): string {
    return this.instant.toISOString();
  }
}

/** One owned ship, rebuilt through the one mapping the fleet uses. */
function ownedShip(shipId = 12, hullSymbol = 'Anaconda'): OwnedShip {
  const mapped = mapOwnedShip(ownedShipPayload(shipId, hullSymbol));
  if (!mapped.ok) {
    throw new Error(`The fixture did not rebuild: ${mapped.failure}`);
  }
  return mapped.ship;
}

function setup() {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      provideLocalization(),
      ...provideIsolatedLocaleEnvironment(),
      ...provideMemoryStorage(new MemoryStorage()),
      { provide: BroadcastChannelAdapter, useValue: new SilentChannel() },
      { provide: UuidAdapter, useValue: new CountingUuid() },
      { provide: ClockAdapter, useValue: new FixedClock() },
    ],
  });
  return {
    copy: TestBed.inject(FleetCopyService),
    active: TestBed.inject(ActiveBuildStore),
  };
}

describe('FleetCopyService', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('commits the copy as the build this page is holding', async () => {
    const { copy, active } = setup();

    const result = await copy.copy(ownedShip());

    expect(result.kind).toBe('committed');
    expect(active.loadout()?.shipSymbol).toBe('Anaconda');
  });

  it('mints no record identity, so autosave gives the copy one of its own', async () => {
    const { copy, active } = setup();

    await copy.copy(ownedShip());

    // Nothing names it, nothing autosaves into anything yet, and it arrives
    // dirty — which is what makes autosave write a record of its own rather
    // than over one that exists (020/FR-017, 001/FR-008).
    expect(active.autosaveRecordId()).toBeNull();
    expect(active.sourceNamed()).toBeNull();
    expect(active.provenance()).toBe('working');
    expect(active.dirty()).toBe(true);
  });

  it('hands the builder a build of its own, not the fleet entry', async () => {
    const { copy, active } = setup();
    const ship = ownedShip();

    await copy.copy(ship);

    expect(active.loadout()).not.toBe(ship.loadout);
  });

  it('leaves the owned ship exactly as it was when the copy is edited', async () => {
    const { copy, active } = setup();
    const ship = ownedShip();
    const before = JSON.stringify(toBuildSnapshotV1(ship.loadout));

    await copy.copy(ship);
    const held = active.loadout();
    if (held === null) {
      throw new Error('The copy was not committed.');
    }
    const slot = toBuildSnapshotV1(held).modules[0].slot;
    held.setModuleEnabled(slot, false);

    // A build is edited in place, so this is the assertion that the builder was
    // handed a copy: the edit reached the copy and nothing reached the fleet
    // entry (020/FR-017).
    expect(JSON.stringify(toBuildSnapshotV1(ship.loadout))).toBe(before);
    expect(JSON.stringify(toBuildSnapshotV1(held))).not.toBe(before);
  });

  it('names the hull for the copy from the package, never from the payload', async () => {
    const { copy, active } = setup();

    await copy.copy(ownedShip(4, 'SideWinder'));

    expect(active.hullName()).toBe(ShipLoadout.default('SideWinder').shipName ?? 'Sidewinder');
  });
});
