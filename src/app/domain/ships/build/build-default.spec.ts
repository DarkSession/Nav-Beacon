import { ShipLoadout } from '@elite-dangerous-almanac/core/ships/ship-loadout';
import {
  getPreEngineeredVariants,
  type PreEngineeredVariant,
} from '@elite-dangerous-almanac/core/ships/pre-engineered';
import { FIXTURE_HULL, FIXTURE_SLOTS, UNKNOWN_HULL } from '../outfitting/outfitting.fixtures';
import { atPackageDefault } from './build-default';
import { suppliedFit } from './supplied-fit';
import type { BuildSnapshotV1 } from './build-snapshot';
import { toBuildSnapshotV1 } from './build-snapshot.serializer';

/**
 * What a record is worth keeping is decided here.
 *
 * The question is asked of the state alone, so every route into a build — the
 * hull catalogue, a link, a SLEF paste, a journal event — gets the same answer
 * for the same build (024/FR-001).
 */

function withReplacedModule(): ShipLoadout {
  const build = ShipLoadout.default(FIXTURE_HULL);
  const fitted = build.fittedModuleAt(FIXTURE_SLOTS.fittedHardpoint);
  const other = build
    .modulesForSlot(FIXTURE_SLOTS.fittedHardpoint)
    .find((module) => module.symbol !== fitted?.symbol);
  if (other === undefined) {
    throw new Error(
      `The installed Almanac offers one module alone for ${FIXTURE_HULL}'s ` +
        `${FIXTURE_SLOTS.fittedHardpoint}. Pick a mount with a choice from the package ` +
        'rather than writing one here.',
    );
  }
  build.setModule(FIXTURE_SLOTS.fittedHardpoint, other);
  return build;
}

/**
 * The same build as a game journal writes it.
 *
 * A journal states `On` and `Priority` on every module and names the ship on
 * every event, writing both blank for a ship that carries neither. None of that
 * is a decision, and a build that arrives this way is the same build as one
 * created from the catalogue (024/FR-001).
 */
function asJournalWritesIt(build: ShipLoadout): BuildSnapshotV1 {
  return toBuildSnapshotV1(
    ShipLoadout.fromLoadout({
      event: 'Loadout',
      timestamp: '3311-01-01T00:00:00Z',
      ...build.toLoadoutEvent({ explicitPower: true }),
      ShipName: '',
      ShipIdent: '',
    } as Parameters<typeof ShipLoadout.fromLoadout>[0]),
  );
}

/**
 * A mount the hull is supplied with, and a pre-engineered article for what is
 * already in it.
 *
 * Asked of the Almanac rather than named here: which supplied modules publish a
 * variant is the package's own state, and an article fitted over a *different*
 * module would be answered by the fit alone and say nothing about the article.
 */
function suppliedArticle(build: ShipLoadout): [string, PreEngineeredVariant] {
  for (const slot of build.slots()) {
    const symbol = slot.module?.symbol;
    if (symbol === undefined) {
      continue;
    }
    const variant = (getPreEngineeredVariants(symbol) ?? [])[0];
    if (variant !== undefined) {
      return [slot.key, variant];
    }
  }
  throw new Error(
    `The installed Almanac publishes no pre-engineered variant for any module ${FIXTURE_HULL} ` +
      'is supplied with. Pick a hull that has one from the package rather than writing one here.',
  );
}

/** The question as the store asks it: the build, and the fit its hull ships with. */
function atDefault(snapshot: BuildSnapshotV1): boolean {
  return atPackageDefault(snapshot, suppliedFit(snapshot.shipSymbol));
}

describe('package default build', () => {
  it('reports the hull’s default loadout at its default', () => {
    expect(atDefault(toBuildSnapshotV1(ShipLoadout.default(FIXTURE_HULL)))).toBe(true);
  });

  it('reports a replaced module as not at the default', () => {
    expect(atDefault(toBuildSnapshotV1(withReplacedModule()))).toBe(false);
  });

  it('reports an emptied mount as not at the default', () => {
    // Emptying a mount is often a Commander's first edit, and it leaves a build
    // holding fewer modules than the hull was supplied with rather than a
    // different one in a slot. Counted before the modules are walked, because a
    // walk over what remains finds every one of them still supplied
    // (024/FR-001).
    const build = ShipLoadout.default(FIXTURE_HULL);
    expect(
      build.fittedModuleAt(FIXTURE_SLOTS.fittedOptional),
      'the fixture mount arrives filled',
    ).not.toBeNull();

    build.removeModule(FIXTURE_SLOTS.fittedOptional);
    const snapshot = toBuildSnapshotV1(build);

    expect(build.fittedModuleAt(FIXTURE_SLOTS.fittedOptional), 'the mount is emptied').toBeNull();
    expect(snapshot.modules.length).toBeLessThan(suppliedFit(snapshot.shipSymbol)!.size);
    expect(atDefault(snapshot)).toBe(false);
  });

  it('reports a module put in another power group as not at the default', () => {
    // A power group is modelled state the snapshot carries and no name reads,
    // so it is a decision on the build although the build looks the same.
    const build = ShipLoadout.default(FIXTURE_HULL);
    build.setModulePriority(FIXTURE_SLOTS.core, 2);

    expect(atDefault(toBuildSnapshotV1(build))).toBe(false);
  });

  it('reports a module switched off as not at the default', () => {
    const build = ShipLoadout.default(FIXTURE_HULL);
    build.setModuleEnabled(FIXTURE_SLOTS.core, false);

    expect(atDefault(toBuildSnapshotV1(build))).toBe(false);
  });

  it('reports the hull’s default loadout as at its default when a journal wrote it', () => {
    expect(atDefault(asJournalWritesIt(ShipLoadout.default(FIXTURE_HULL)))).toBe(true);
  });

  it('reports a journal-written build carrying a replaced module as not at the default', () => {
    // The stated power on every module must not be able to hide a real choice.
    expect(atDefault(asJournalWritesIt(withReplacedModule()))).toBe(false);
  });

  it('reports an engineered module as not at the default', () => {
    // Engineering is a decision on a module the hull was supplied with, so the
    // fit still matches and the build is not the one the package hands out.
    const build = ShipLoadout.default(FIXTURE_HULL);
    build.applyBlueprint(FIXTURE_SLOTS.frameShiftDrive, 'FSD_LongRange', { grade: 5 });

    expect(atDefault(toBuildSnapshotV1(build))).toBe(false);
  });

  it('reports a module carrying a pre-engineered article as not at the default', () => {
    // A pre-engineered article is one a Commander went and got. This one is
    // fitted in a mount the hull was supplied with and keeps that module's
    // symbol, so the fit still matches and the article is the only thing
    // saying the build was touched.
    const build = ShipLoadout.default(FIXTURE_HULL);
    const [slot, variant] = suppliedArticle(build);
    build.setPreEngineeredVariant(slot, variant);
    const snapshot = toBuildSnapshotV1(build);
    expect(snapshot.modules.find((module) => module.slot === slot)?.symbol).toBe(variant.symbol);

    expect(atDefault(snapshot)).toBe(false);
  });

  it('reports a named ship as not at the default', () => {
    const named = { ...toBuildSnapshotV1(ShipLoadout.default(FIXTURE_HULL)), shipName: 'Gimel' };

    expect(atDefault(named)).toBe(false);
  });

  it('reports a ship carrying an ident as not at the default', () => {
    const identified = {
      ...toBuildSnapshotV1(ShipLoadout.default(FIXTURE_HULL)),
      shipIdent: 'FD-11X',
    };

    expect(atDefault(identified)).toBe(false);
  });

  it('reads one package identity spelled two ways as one identity', () => {
    // A hull symbol, a slot key and a module symbol are each unique
    // case-insensitively, and the package hands the same one back in more than
    // one spelling — the default loadout it publishes and the catalogue a build
    // link decodes into do not always agree. A Commander who opens a hull's
    // default loadout from a link is looking at the same build as one who
    // created it from the catalogue (024/FR-001).
    const snapshot = toBuildSnapshotV1(ShipLoadout.default(FIXTURE_HULL));
    const recased: BuildSnapshotV1 = {
      ...snapshot,
      shipSymbol: snapshot.shipSymbol.toUpperCase(),
      modules: snapshot.modules.map((module) => ({
        ...module,
        slot: module.slot.toUpperCase(),
        symbol: module.symbol.toUpperCase(),
      })),
    };

    expect(atDefault(recased)).toBe(true);
  });

  it('reports a hull the package publishes no default for as not at a default', () => {
    // Answered rather than thrown: there is no default to be at, so the package
    // publishes none. A record is owed for such a build like any other.
    const unknown: BuildSnapshotV1 = {
      format: 'ednb.build',
      version: 1,
      shipSymbol: UNKNOWN_HULL,
      shipName: null,
      shipIdent: null,
      modules: [],
    };

    expect(() => atDefault(unknown)).not.toThrow();
    expect(atDefault(unknown)).toBe(false);
  });
});
