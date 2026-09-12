import { ShipLoadout } from '@elite-dangerous-almanac/core/ships/ship-loadout';
import { getShipBySymbol } from '@elite-dangerous-almanac/core/ships/ships';
import type { LoadoutEvent } from '@elite-dangerous-almanac/core/ships/slef';
import type {
  IngressResult,
  PartialEngineeringFailure,
  SourcePartialEngineering,
} from './build-ingress-result';

/**
 * The one gate every incoming build passes through.
 *
 * Opening a record, loading a link, importing SLEF and restoring on reload all
 * arrive here, and all of them get the same steps in the same order. Having one
 * pipeline rather than four is the reason no ingress path can activate a build
 * that skipped a check, and the reason a refusal costs the Commander nothing:
 * everything happens on a candidate the application is not looking at yet.
 *
 * Creating a stock hull does not come through, and does not need to: it is the
 * package's own default loadout, built on `getShipBySymbol(symbol).symbol`, so
 * its hull is already a package identity, it carries no partial roll to
 * complete and no fixed mount to populate (import contract, "Normalization
 * boundary").
 *
 * The order matters and is not incidental:
 *
 * 1. record what the source said about partial rolls, while it is still
 *    readable;
 * 2. construct through the package, which refuses an unknown hull and returns
 *    every fixed mount already populated with the hull default;
 * 3. correlate the recorded partials with what actually came back, by exact
 *    slot and symbol, and set aside the modules the package locked as final
 *    articles — their engineering is the article, not a roll;
 * 4. complete each remaining one through the package, accepting only
 *    `normalized`;
 * 5. return the whole candidate, or refuse the whole candidate.
 *
 * There is no repair pass at step 2 and no fixed-mount branch anywhere. The
 * package's answer *is* the build, and a defaulted mount is ordinary build
 * state from the moment it arrives (FR-010, constitution II). There is likewise
 * no "fix just the quality" branch at step 4: a partial the package declines to
 * identify refuses the candidate rather than being written down at a value
 * nobody computed (FR-013).
 *
 * Step 2 also settles the engineering a source states without its modifiers,
 * which is how Inara and other SLEF producers write every engineered module:
 * the package rolls the recipe at the grade and quality the block names, so the
 * module arrives with the package's own modifiers rather than the figures of an
 * unengineered one. Where it can resolve neither a recipe nor a catalogued
 * article, it reports `unresolvedEngineering` in `importOutcomes` and the
 * module keeps unengineered figures. Since Almanac 0.2.2 two further entries sit
 * beside it. `ambiguousEngineering` reports the reading the package took rather
 * than a change it made: a catalogued article answered to the recipe as well as
 * the module's own menu did, and the article passed over rides on the outcome
 * for `setPreEngineeredVariant`. `rerolledEngineering` does name a change — a
 * stated modifier block that moved no stat the module carries is gone from the
 * build and the recipe stated beside it was rolled in its place, which is the
 * same reading of a stated recipe as the roll above rather than a normalization
 * of its own (`docs/slef-interchange.md`). Nothing here reads any of the three.
 * `unresolvedEngineering` is moot: such a module is either carrying a partial
 * quality, in which case step 4 refuses the whole candidate over the package's
 * own `unsupported`, or it is not, in which case there is nothing to say. The
 * other two are not moot, and go unread for want of a surface rather than for
 * want of something to say. Both resolve a recipe the module's own menu offers,
 * so a partial quality on either completes at step 4 and the candidate is
 * accepted: an ambiguous roll arrives with the article it passed over riding on
 * the outcome, and a reroll arrives with the block the source wrote gone from
 * the build. Neither has an engineering-provenance surface to be offered or
 * stated on.
 */
export function normalizeIncomingBuild(event: LoadoutEvent): IngressResult {
  // Step 1. Read the source's partial rolls before construction consumes them.
  const partials = sourcePartials(event);

  // Step 2. Construct, on the package's own identity for the hull the source
  // named. The package owns the hull check and the fixed defaults.
  let candidate: ShipLoadout;
  try {
    candidate = ShipLoadout.fromLoadout(withPackageHullIdentity(event));
  } catch (error) {
    return { kind: 'unusable', reason: error instanceof Error ? error.message : String(error) };
  }

  return completePartials(candidate, partials);
}

/**
 * The same gate, for a candidate the package has already built.
 *
 * Opening a stored record and loading a build link both reconstruct through the
 * package from a modelled snapshot rather than from a journal event, so there
 * is no source event left to read step 1 off. The partials are read from the
 * built candidate instead — which is the same evidence, one step later — and
 * steps 3 to 5 are the identical code below. Two entry points, one pipeline: a
 * second implementation is exactly how one ingress path ends up skipping a
 * check the others make (contract, "Mandatory ingress normalization").
 */
export function normalizeReconstructedBuild(candidate: ShipLoadout): IngressResult {
  // The hull identity the event door resolves, checked rather than assumed on
  // the doors that arrive already built. There is nothing to resolve here — a
  // constructed candidate's hull cannot be renamed without rebuilding it — so
  // a candidate that did not come through a door that resolved it is refused
  // instead. Reading a package answer, not repairing one: whoever built this
  // is where the identity belongs (constitution II).
  //
  // No door reaches this today — the snapshot reconstructor resolves the hull
  // and the link codec names it from a table of the package's own symbols — so
  // it is an invariant stated where it can be checked rather than a Commander's
  // outcome. Its `reason` is an English sentence, which the sibling ingress
  // paths also write — `record-open.service.ts`, `fleet-copy.service.ts`,
  // `build-link.coordinator.ts`, `stock-build.creator.ts`. Only the first is
  // both reachable in ordinary use and rendered to a Commander, framed by
  // `library.open.failed`, so only that one is owed a catalogued message.
  // `fleet-copy.service.ts` renders into that same frame but cannot reach its
  // own refusal: an owned ship states completed grades and no roll quality
  // (020/FR-015), so the gate finds nothing partial there to complete.
  // `build-link.coordinator.ts` publishes a `LinkFailure` code the message
  // layer frames and never renders its `reason`, and `stock-build.creator.ts`
  // writes its reasons behind the same kind of guard as this one. This reason
  // is not owed a catalogue entry because no door reaches it, and a translated
  // string for a state nobody can arrive at is a string never read — not
  // because of where it would be rendered, which is that same frame. The other
  // `unusable` reason here is no precedent either: that one is the package's
  // own diagnostic, which principle VI leaves to the package. A door that
  // stopped resolving would make this Commander-facing and would need a code
  // the message layer can frame
  // (constitution VI).
  if (getShipBySymbol(candidate.shipSymbol)?.symbol !== candidate.shipSymbol) {
    return {
      kind: 'unusable',
      reason:
        `Reconstructed build carries "${candidate.shipSymbol}", ` +
        `which is not the package's identity for that hull.`,
    };
  }

  return completePartials(candidate, builtPartials(candidate));
}

/** Steps 3 to 5, shared by both entry points. */
function completePartials(
  candidate: ShipLoadout,
  partials: readonly SourcePartialEngineering[],
): IngressResult {
  // Correlate, then complete. Every failure is collected rather than thrown on
  // the first one, so a refusal can name every affected slot at once.
  const failures: PartialEngineeringFailure[] = [];

  for (const source of partials) {
    const fitted = candidate.fittedModuleAt(source.slotKey);

    // The module the source described is not the module that came back — it was
    // emptied as unresolvable, or defaulted away by a fixed mount. Its partial
    // roll went with it, so there is nothing left to complete.
    if (fitted === null || !sameIdentity(fitted.symbol, source.moduleSymbol)) {
      continue;
    }

    // A final article is not a roll. The package identifies the article the
    // module was acquired as, bakes its fixed modifiers in during construction
    // and locks it against further engineering, so the `Quality` the source
    // stated is a figure the game writes for a finished module rather than a
    // grade waiting to be completed. Asking the package to complete it answers
    // `finalArticle` — a correct refusal of a question that should not have
    // been asked — and treating that as a normalization failure would refuse
    // every build carrying a pre-engineered Guardian weapon or a fixed
    // Enzyme/AX reward. Whether an article is final is the package's own
    // `engineeringLocked`, read from what it fitted; nothing here recognises a
    // symbol or a blueprint (constitution II, FR-013).
    if (fitted.preEngineeredVariant?.engineeringLocked === true) {
      continue;
    }

    // Only a roll that survived construction still needs completing. The
    // package may already have resolved it, in which case asking again would
    // get `unchanged` and be read as a contract failure.
    const currentQuality = fitted.engineering?.Quality;
    if (currentQuality === undefined || !isPartialQuality(currentQuality)) {
      continue;
    }

    const result = candidate.completeEngineeringGrade(source.slotKey);
    switch (result.kind) {
      case 'normalized':
        // A completed grade is what the application models, so reaching one is
        // not an event. Nothing is recorded and nothing is said.
        break;
      case 'unsupported':
        failures.push({
          source,
          reason: 'packageResult',
          code: result.code,
          params: result.params,
        });
        break;
      default:
        // `unchanged` here would mean the package saw nothing to complete on a
        // module we had just read a partial quality from. That is the two halves
        // of the released contract disagreeing, not a Commander's problem.
        failures.push({ source, reason: 'packageContract', code: null, params: null });
        break;
    }
  }

  if (failures.length > 0) {
    return { kind: 'refused', failures };
  }

  return { kind: 'accepted', candidate };
}

/**
 * The same event, naming its hull the way the package names it.
 *
 * A journal `Loadout` event writes the hull in lower case — `sidewinder`,
 * `federation_corvette` — and the package carries `SideWinder` and
 * `Federation_Corvette`. `ShipLoadout` keeps whatever string it was handed, so
 * a build that arrived from a journal capture or somebody else's SLEF export
 * carries a `shipSymbol` that is not the package's symbol for that hull.
 *
 * Every package lookup matches case-insensitively, which is why this stayed
 * invisible for as long as a hull symbol was only ever handed back to the
 * package. It stops being invisible the moment the application compares one
 * itself, or spells one into a path. Feature 010's plates are drawn from
 * `assets/ships/<symbol>/`, directories named for the package's own symbol, so
 * `assets/ships/sidewinder/...` is a 404 on any case-sensitive host and both
 * of an imported build's plates report as unavailable — the symptom this was
 * found by. One other reader compares a hull symbol itself rather than handing
 * it back, and it is the second symptom: `linkIdentity` in the build-link
 * coordinator folds module symbols and not the hull's. A reload restores this
 * tab's working record and then reads the fragment that arrived with the page;
 * the record said `anaconda`, the link's codec table said `Anaconda`, the two
 * identities compared unequal, and the Commander was asked whether to replace
 * their build with an identical one.
 *
 * Resolved here, at the one gate, rather than at each reader: one build carries
 * one hull identity, and a reader that has to re-resolve it is a reader that
 * can forget to. This corrects nothing the package returned — the symbol
 * written in is the package's own `Ship.symbol`, asked for by the string the
 * source used (constitution II, AGENTS.md "Identities come from the package").
 *
 * A hull the package does not carry is handed over exactly as it arrived, so
 * the refusal a Commander reads is the package's own and names what they sent.
 */
function withPackageHullIdentity(event: LoadoutEvent): LoadoutEvent {
  const hull = getShipBySymbol(event.Ship);
  return hull === null || hull.symbol === event.Ship ? event : { ...event, Ship: hull.symbol };
}

/**
 * Every partial roll a built candidate is carrying, in the build's own order.
 *
 * The equivalent of `sourcePartials` for a candidate that arrived as a modelled
 * snapshot. What it reads is the package's own fitted modules, so a roll that
 * did not survive construction is simply not here — which is the correlation
 * step already done rather than skipped.
 */
function builtPartials(candidate: ShipLoadout): readonly SourcePartialEngineering[] {
  const partials: SourcePartialEngineering[] = [];

  for (const module of candidate.fittedModules()) {
    const engineering = module.engineering;
    if (engineering === undefined || !isPartialQuality(engineering.Quality)) {
      continue;
    }
    partials.push({
      slotKey: module.slot,
      moduleSymbol: module.symbol,
      blueprintFdname: engineering.BlueprintName ?? null,
      effectFdname: engineering.ExperimentalEffect ?? null,
      grade: engineering.Level,
      quality: engineering.Quality,
    });
  }

  return partials;
}

/** Every partial roll the source stated, in source order. */
function sourcePartials(event: LoadoutEvent): readonly SourcePartialEngineering[] {
  const partials: SourcePartialEngineering[] = [];

  for (const module of event.Modules ?? []) {
    const engineering = module.Engineering;
    if (engineering === undefined) {
      continue;
    }
    // `Quality` is typed as required and is not: SLEF producers omit it, and a
    // journal capture can carry anything. The guard is on the value.
    const quality: unknown = engineering.Quality;
    if (typeof quality !== 'number' || !isPartialQuality(quality)) {
      continue;
    }

    partials.push({
      slotKey: module.Slot,
      moduleSymbol: module.Item,
      blueprintFdname: engineering.BlueprintName ?? null,
      effectFdname: engineering.ExperimentalEffect ?? null,
      grade: typeof engineering.Level === 'number' ? engineering.Level : null,
      quality,
    });
  }

  return partials;
}

/** Finite, at least 0, and strictly below 1. Nothing else is a partial roll. */
function isPartialQuality(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && value < 1;
}

/** Package identities compare case-insensitively, the way the package matches them. */
function sameIdentity(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}
