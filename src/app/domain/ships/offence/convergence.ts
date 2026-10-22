import {
  getShipGunsight,
  projectGunsight,
  type GunsightOffset,
} from '@elite-dangerous-almanac/core/ships/gunsights';
import { getModuleBySymbol, type ModuleMount } from '@elite-dangerous-almanac/core/ships/modules';
import { getShipSlots } from '@elite-dangerous-almanac/core/ships/ships';
import { enumerateSlots } from '@elite-dangerous-almanac/core/ships/slots';
import type { FittedWeaponMetrics } from '@elite-dangerous-almanac/core/ships/build-metrics';

/**
 * `SHOT CONVERGENCE`: where this build's shots land on the plane a target sits
 * on, as canvas 1c draws it (@649971) and canvas 1d draws it again (@1039230).
 *
 * The geometry is the package's. `SHIP_GUNSIGHTS` publishes every player-flyable
 * hull's hardpoint offsets from the cockpit in metres, and `projectGunsight`
 * turns those offsets into angular tangents at a chosen range. This file places
 * every one of the hull's hardpoints, armed or empty, asks the package where
 * their shots go, and says how far apart the armed ones are; it derives no
 * offset and models no ballistics.
 *
 * Every hardpoint and not only the armed ones, because the plate is a picture
 * of the *hull*: an offset is a property of the mount, which the package
 * publishes whether or not a Commander has filled it, and a Commander choosing
 * what to fit is asking where a shot from that mount would go. The empty ones
 * are drawn as the mounts they are and are named as empty in words, and no
 * figure about the group is measured across them — nothing is fired from an
 * empty hardpoint, so a spread that counted one would be a spread nobody has.
 *
 * A hull the catalogue does not carry, or one whose gunsight does not line up
 * with its hardpoints, is `unavailable` rather than a partial diagram: a
 * convergence drawn from some of the mounts would be a spread nobody has.
 */
export type Convergence =
  | { readonly kind: 'unavailable' }
  | {
      readonly kind: 'available';
      /** Every hardpoint the catalogue places, armed or empty, in the hull's own order. */
      readonly mounts: readonly ConvergenceMount[];
    };

/** One of the hull's hardpoints, at the offset the package publishes for it. */
export interface ConvergenceMount {
  /** The hull's own slot key. It names the mount, so an empty one has it too. */
  readonly slot: string;
  /** The mount's 1-based place in the hull's own hardpoint order — the canvas's numeral. */
  readonly hardpoint: number;
  /** The package's own offset pair, in metres. */
  readonly offset: GunsightOffset;
  /** Distance from the cockpit's axis, in metres. */
  readonly offsetMetres: number;
  /**
   * The weapon fitted here, or `null` where the hardpoint is empty.
   *
   * Nested rather than flattened, because the three fields under it exist
   * together or not at all: a mount with a name and no symbol is not a state
   * this hull can be in, and an optional field each would let a surface read
   * one of them off an empty mount and print it.
   */
  readonly weapon: ConvergenceWeapon | null;
}

/** The weapon on an armed hardpoint, as the package records it. */
export interface ConvergenceWeapon {
  /** The weapon's display name, as the package returns it. */
  readonly name: string;
  /** The weapon's internal symbol, so a surface can name it in the Commander's language. */
  readonly symbol: string;
  /** How the weapon is aimed, or `null` where the module record states no mount. */
  readonly mount: ModuleMount | null;
}

/**
 * The half field of view the canvas's plate spans, in milliradians.
 *
 * The canvas's own script fixes it (`wireConvergence`, `FOV = 40`) and draws
 * both rings and every dot against it. It is a property of the drawing, not of
 * the build: it decides how much sky the plate shows, and nothing else — a
 * build never widens it to fit, which is why a shot outside it is left off the
 * plate rather than accommodated.
 *
 * The 2026-08-25 canvas revision cut it from `115`, so the same offsets now
 * subtend nearly three times as much of the plate.
 */
export const FIELD_OF_VIEW_MILLIRADIANS = 40;

/**
 * How far from the plate's centre a mark may be drawn, as a fraction of the
 * half plate.
 *
 * It is the canvas's own margin — `clamp(50 ± mrad / FOV * 50, 4, 96)` keeps
 * every dot 4% inside the frame — read as a bound on which marks belong on the
 * plate rather than as a place to pin the ones that do not. A shot further
 * off-axis than this is **not drawn** (Commander request 2026-08-27): held at
 * the margin it was a mark standing where its shot does not go, and a row of
 * them along the frame at a short range read as a spread the build does not
 * have. The mount keeps its sentence beside the plate, which states the offset
 * and the angle it actually has, so nothing is lost but a misleading dot
 * (FR-011).
 */
export const PLATE_MARGIN_FRACTION = 0.92;

/**
 * The target ranges the `RANGE` track runs between, its step, and where it opens.
 *
 * Three of the four are the canvas's own. `wireConvergence` declares
 * `MIN = 500, MAX = 5000`, opens at `1500` and quantises to `50`, so the minimum,
 * the step and the initial value here are the drawing's rather than a departure
 * from it. (Its *earlier* track — `100`–`2000` on a `25` step, opening at `600` —
 * is the 2026-08-25 canvas; the 2026-08-26 revision is what moved it, and it is
 * what the two 2,000 m arguments elsewhere in this feature's record were written
 * against.)
 *
 * The ceiling is a preference and not a fact about the package: it was 5,000 m
 * between 2026-08-26 and 2026-08-27, and 3,000 m is what was asked for on the
 * 27th. It is **not** every weapon's reach — the package publishes 4,000 m for a
 * multi-cannon and 4,500 m for a cannon, and both fit this hull — so a build
 * carrying one can be fired further than this track goes. What the track is for
 * is watching the shots close on the axis, and a mount's offset subtends less
 * and less of the plate as the range grows, so the steps past 3,000 m are the
 * ones that move the marks least (`design/canvas-contract.md`, review notes 18
 * and 21).
 *
 * It is a property of the drawing like the field of view, and a departure from
 * the canvas recorded as one (`design/canvas-contract.md`, review note 18). It
 * changes no figure: every reading the block gives is the package's answer at
 * whatever distance the track is set to.
 */
export const TARGET_RANGE = { min: 500, max: 3000, step: 50, initial: 1500 } as const;

/** Radians to milliradians, so the conversion is named rather than a loose 1000. */
const MILLIRADIANS_PER_RADIAN = 1000;

/** Where the shots land at one range, and how far apart they are there. */
export interface ConvergenceView {
  readonly targetRangeMetres: number;
  /** Every placed hardpoint, armed or empty, in the hull's own order. */
  readonly points: readonly ConvergencePoint[];
  /** The canvas's two dashed rings, inner first. */
  readonly rings: readonly ConvergenceRing[];
  /** The outer ring's angular radius, and what it spans on the plane at this range. */
  readonly ringMilliradians: number;
  readonly ringMetres: number;
}

/**
 * One dashed ring, as a fraction of the plate it is drawn on.
 *
 * Only a width, since the 2026-08-25 canvas revision: the script sizes a ring's
 * height as `mrad / FOV * 100 * aspect` where `aspect` is the box's own
 * `offsetWidth / offsetHeight`, and a height that is a fraction of the box's
 * height multiplied by the box's width over its height is the same number of
 * pixels as the width. The ring is a pixel circle, so the plate draws it as one
 * and no second fraction is needed here.
 */
export interface ConvergenceRing {
  readonly milliradians: number;
  /** Diameter over the plate's width, in `[0, 1]`. */
  readonly width: number;
}

/** One hardpoint, placed on the plate. */
export interface ConvergencePoint {
  /** The hull's own 1-based hardpoint place — the number this mount's sentence names. */
  readonly hardpoint: number;
  /** The mount this mark stands for. Its `weapon` is `null` where it is empty. */
  readonly mount: ConvergenceMount;
  /**
   * Fraction of the plate's half width; positive points right.
   *
   * The shot's own angle over the plate's field of view, and nothing else: it
   * is not held to `[-1, 1]`, because a shot can be further off-axis than the
   * plate shows. `onPlate` is what says whether this one belongs on the
   * drawing.
   */
  readonly horizontal: number;
  /** Fraction of the plate's half height; positive points up. Unbounded alike. */
  readonly vertical: number;
  /**
   * Whether this mount's mark stands, whole, inside the plate's frame.
   *
   * `false` where the shot is further off-axis than `PLATE_MARGIN_FRACTION` on
   * either axis. How many that is depends on the hull and the range: at the
   * track's shortest, three of the reference hull's eight, and nothing at all on
   * thirty-six of the package's forty-nine hulls, three of which drop a
   * majority. The mount is
   * then not drawn at all — it is still in this list, and still stated in words
   * beside the plate, because where the shot really goes is the reading (FR-011).
   */
  readonly onPlate: boolean;
  /** How far off the axis this shot lands, in milliradians. The true angle. */
  readonly milliradians: number;
}

/**
 * Place every one of a hull's hardpoints on its gunsight, and say which are armed.
 *
 * The gunsight is indexed in the hull's own hardpoint order, so the enumerated
 * slots are walked in that order and a weapon is matched onto one by its journal
 * slot key rather than by reading a number out of that key — the package
 * documents ten hulls where those two disagree.
 *
 * The list is the hull's, not the build's: every placed hardpoint is returned,
 * and the ones a Commander has not filled come back with no weapon on them. The
 * three figures beside the list are measured across the armed ones alone,
 * because they are figures about where shots go.
 */
export function projectConvergence(
  shipSymbol: string,
  weapons: readonly FittedWeaponMetrics[],
): Convergence {
  const gunsight = getShipGunsight(shipSymbol);
  const layout = getShipSlots(shipSymbol);
  if (gunsight === null || layout === null) {
    return { kind: 'unavailable' };
  }

  const hardpoints = enumerateSlots(layout).filter((slot) => slot.kind === 'hardpoint');
  if (hardpoints.length !== gunsight.length) {
    return { kind: 'unavailable' };
  }

  const fitted = new Map(weapons.map((weapon) => [weapon.slot.toLowerCase(), weapon]));
  const mounts = hardpoints.flatMap((slot, index) => {
    const offset = gunsight[index];
    if (offset === undefined) {
      return [];
    }
    const weapon = fitted.get(slot.key.toLowerCase());
    return [
      {
        slot: slot.key,
        hardpoint: index + 1,
        offset,
        offsetMetres: Math.hypot(offset[0], offset[1]),
        weapon:
          weapon === undefined
            ? null
            : {
                name: weapon.name,
                symbol: weapon.symbol,
                mount: getModuleBySymbol(weapon.symbol)?.mount ?? null,
              },
      },
    ];
  });

  return { kind: 'available', mounts };
}

/**
 * Ask the package where those mounts' shots land at one range.
 *
 * Every mount is placed, the empty ones included: `projectGunsight` is being
 * asked where a mount points, which it answers from the offset alone. Only the
 * `APPARENT SPREAD` is narrowed to the armed ones, because that is the one
 * figure here that reports a group rather than a mark.
 *
 * The plate is the canvas's, and since the 2026-08-25 revision it is square in
 * *angle*: half a field of view either side of the axis on both axes, whatever
 * shape the box itself is. Only the rings are corrected for the box's pixel
 * aspect, and the plate draws that correction rather than this function.
 *
 * Both coordinates come back as a fraction of the half plate, so the template
 * positions a dot without knowing the plate's size. A mount whose shot falls
 * outside the frame's own margin comes back `onPlate: false` and is not drawn,
 * because the field of view is a property of the drawing and never moves to
 * accommodate a build.
 */
export function convergenceAt(
  convergence: Extract<Convergence, { kind: 'available' }>,
  targetRangeMetres: number,
): ConvergenceView {
  // One call for the whole plate: the package is asked where a set of offsets
  // lands, and asking it twice for one drawing would be two projections of the
  // same plate.
  const projected = projectGunsight(
    convergence.mounts.map((mount) => mount.offset),
    targetRangeMetres,
  );

  const angles = convergence.mounts.map((mount, index) => {
    const point = projected[index];
    return {
      hardpoint: mount.hardpoint,
      mount,
      across: (point?.horizontalTangent ?? 0) * MILLIRADIANS_PER_RADIAN,
      up: (point?.verticalTangent ?? 0) * MILLIRADIANS_PER_RADIAN,
    };
  });

  const ringMilliradians = (FIELD_OF_VIEW_MILLIRADIANS * 2) / 3;
  const ring = (milliradians: number): ConvergenceRing => ({
    milliradians,
    width: milliradians / FIELD_OF_VIEW_MILLIRADIANS,
  });

  const place = ({ hardpoint, mount, across, up }: (typeof angles)[number]): ConvergencePoint => {
    const horizontal = across / FIELD_OF_VIEW_MILLIRADIANS;
    const vertical = up / FIELD_OF_VIEW_MILLIRADIANS;
    return {
      hardpoint,
      mount,
      horizontal,
      vertical,
      onPlate: fitsOnPlate(horizontal) && fitsOnPlate(vertical),
      milliradians: Math.hypot(across, up),
    };
  };

  return {
    targetRangeMetres,
    points: angles.map(place),
    rings: [ring(FIELD_OF_VIEW_MILLIRADIANS / 3), ring(ringMilliradians)],
    ringMilliradians,
    ringMetres: (ringMilliradians / MILLIRADIANS_PER_RADIAN) * targetRangeMetres,
  };
}

/**
 * Whether a mark at this fraction of the half plate stands inside the frame.
 *
 * The canvas's own `4%` margin, read as a bound rather than as a clamp: a mark
 * beyond it is left off the drawing instead of being pinned to the edge. Only
 * the dot is decided here — the angle the shot actually makes is carried
 * separately and stated in words beside the plate, which is the reading either
 * way (FR-011).
 */
function fitsOnPlate(fraction: number): boolean {
  return Math.abs(fraction) <= PLATE_MARGIN_FRACTION;
}
