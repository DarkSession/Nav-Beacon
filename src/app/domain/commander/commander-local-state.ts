export const COMMANDER_LOCAL_STATE_FORMAT = 'ednb.commander-state';
export const COMMANDER_LOCAL_STATE_VERSION = 1;

export interface CachedCommanderAccount {
  readonly customerId: string;
  readonly commanderName: string;
}

export type RecordAccountBinding = string | 'local-only';

export interface CommanderLocalState {
  readonly format: typeof COMMANDER_LOCAL_STATE_FORMAT;
  readonly version: typeof COMMANDER_LOCAL_STATE_VERSION;
  readonly account: CachedCommanderAccount | null;
  readonly fleetCache: readonly never[];
  readonly syncRevision: number;
  readonly pendingOperationIds: readonly string[];
  readonly recordBindings: Readonly<Record<string, RecordAccountBinding>>;
}

export function emptyCommanderLocalState(): CommanderLocalState {
  return {
    format: COMMANDER_LOCAL_STATE_FORMAT,
    version: COMMANDER_LOCAL_STATE_VERSION,
    account: null,
    fleetCache: [],
    syncRevision: 0,
    pendingOperationIds: [],
    recordBindings: {},
  };
}

export function parseCommanderLocalState(value: unknown): CommanderLocalState | null {
  if (!isObject(value) || value['format'] !== COMMANDER_LOCAL_STATE_FORMAT) {
    return null;
  }
  if (value['version'] !== COMMANDER_LOCAL_STATE_VERSION) {
    return null;
  }
  const account = parseAccount(value['account']);
  const fleetCache = value['fleetCache'];
  const syncRevision = value['syncRevision'];
  const pendingOperationIds = value['pendingOperationIds'];
  const recordBindings = value['recordBindings'];
  if (account === undefined || !Array.isArray(fleetCache) || fleetCache.length > 0) {
    return null;
  }
  if (!Number.isSafeInteger(syncRevision) || (syncRevision as number) < 0) {
    return null;
  }
  if (!isStringArray(pendingOperationIds) || !isBindings(recordBindings)) {
    return null;
  }
  return {
    format: COMMANDER_LOCAL_STATE_FORMAT,
    version: COMMANDER_LOCAL_STATE_VERSION,
    account,
    fleetCache: [],
    syncRevision: syncRevision as number,
    pendingOperationIds,
    recordBindings,
  };
}

function parseAccount(value: unknown): CachedCommanderAccount | null | undefined {
  if (value === null) {
    return null;
  }
  if (!isObject(value)) {
    return undefined;
  }
  const keys = Object.keys(value).sort();
  if (keys.join(',') !== 'commanderName,customerId') {
    return undefined;
  }
  const customerId = value['customerId'];
  const commanderName = value['commanderName'];
  if (
    typeof customerId !== 'string' ||
    !/^[1-9]\d*$/.test(customerId) ||
    typeof commanderName !== 'string' ||
    commanderName.trim().length === 0
  ) {
    return undefined;
  }
  return { customerId, commanderName };
}

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isBindings(value: unknown): value is Readonly<Record<string, RecordAccountBinding>> {
  return (
    isObject(value) &&
    Object.values(value).every(
      (binding) =>
        binding === 'local-only' || (typeof binding === 'string' && /^[1-9]\d*$/.test(binding)),
    )
  );
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
