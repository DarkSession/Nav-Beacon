## Context

See proposal.md — Why.

The format already reserves what this change needs. `equipment-link-codec.ts` writes a 10-bit table
version as the first field of every payload and reads it back on decode. What it does with the value
is compare it to the one table the module imported and refuse anything else, so the payload layout
needs no change at all.

What is built around that field is the obstacle. The codec derives its constants once, at module
load, from the single imported table: `SUIT_BITS`, `WEAPON_BITS`, `GRADE_BITS`,
`SUIT_MODIFICATION_BITS`, `WEAPON_MODIFICATION_BITS`, `MODIFICATION_SLOTS` and the `MOUNTS` list.
Every one of them is therefore recoverable from whichever table a payload names, which is what makes
a backward-compatible registry possible at all. What stays in the module is what no table moves: the
10-bit version field, the `e.` prefix and the 500-character bound are the same for every version.

Decoding resolves an identity out of the table by index, and the table holds what the package held
when it was generated. Whether the installed package still publishes that identity is settled after
decoding, by `reconstructLoadout` in `LoadoutLinkCoordinator`, and this change does not touch that
step.

This change introduces no screen. The one surface it touches is the equipment bench's own refusal
text, which `LinkErrorMapper` already states from a catalogue key; the requirement mapping is the
`equipment/link` entry in `e2e/coverage-ledger.ts`.

## Goals / Non-Goals

**Goals:**

- Every published `e.` link keeps opening, with no cut-over and no dead links.
- The registry is the one place a committed table is registered, and a registered version with no
  corpus entry fails the suite.

**Non-Goals:**

- Publishing equipment table 2. Nothing in the installed package has moved an equipment identity;
  this change builds the mechanism, and the first upgrade that needs it uses it.
- Changing the payload layout, the `e.` prefix, the Base70 alphabet or the CRC envelope.
- Revisiting the build-link codec, which already carries this behaviour.

## Decisions

**The codec becomes a factory over a table, as the build-link codec is.**
`createEquipmentLinkCodec(tableVersion, table)` returns the encode and decode pair with the widths
derived inside it. This is the same shape as `createBuildLinkCodec`, so the two codecs stay legible
side by side, and it is what turns module-level constants into per-version ones. The alternative —
threading a table argument through every existing function — leaves the widths recomputed on each
call and reads worse at every call site.

**Loading stays synchronous, unlike the build-link loader.** The build-link loader is async because
each table it may need is about 198 KB, and deferring one is worth an `await` at every call site.
The equipment table is 3,021 bytes against `codec-table-1.json` at 198,777, so it takes about
sixty-five equipment versions to cost one build-link table. Paying for that with `async` would push
a promise through `loadout-link.coordinator.ts`, the bench page and their suites for no measurable
gain. The registry therefore holds one codec per version, each built by
`createEquipmentLinkCodec` from a statically imported table.

This is a deliberate divergence from the sibling codec rather than an oversight, and the reason is
size. `docs/equipment-link-codec.md` records the same choice. If the equipment table ever approaches
the build-link table's order of magnitude, the decision is worth revisiting, and moving to the async
shape then is the refactor `build-link-codec-loader.ts` already demonstrates.

**The registry is a parameter with a default, which is the seam a test supplies a codec through.**
`decodeEquipmentLinkFragment(fragment, codecs = EQUIPMENT_CODECS_BY_TABLE_VERSION)` reads the
version field and selects from the map it was given. A suite that wants a second version passes a
map holding version 1 beside a codec it built itself, and the function under test is the shipped
one, not a copy of its selection. `LoadoutLinkCoordinator` already documents this technique for its own
`encode` and `decode` properties, so it is the established seam in this area rather than a new one.
The map stays a `ReadonlyMap` and no production path mutates it.

The corpus guard reads the registry's own keys, as `build-link-published-links.spec.ts` reads its
hand-written table map: a registered version with no corpus entry fails the suite. No suite under
`src/` enumerates files, so the guard does not either. A version registered in the map a suite
passed in is a local argument and never reaches the registry, so the two cannot interfere.

**A payload naming an unregistered version is refused with the error the codec already has.**
`BuildLinkCodecError` with `unsupportedTableVersion` is what the decoder raises today for exactly
this case, and the refusal reaches the Commander through `LinkErrorMapper` as every other one
does.

The internal message names the version read and the versions carried. `LinkErrorMapper` documents
that a `BuildLinkCodecError` message is never rendered — it is an English string for whoever reads a
stack trace — so naming versions in it costs no catalogue entry and no interpolation.

What the Commander reads does cost one. `link.error.unsupportedTableVersion` says "This build link
was made by a newer version of the application", which is the ship builder's noun on the loadout
bench. `EQUIPMENT_MESSAGE_KEYS` in `LinkErrorMapper` holds the codes whose ship wording is wrong for
a loadout, and the 013 contract's rule is that the envelope which refused selects the wording. One
table leaves the code unreachable for equipment, so the wrong wording is never read; this change
makes it a path a Commander meets and an end-to-end test opens.
`link.error.equipment.unsupportedTableVersion` is therefore added in both shipped locales.

**Export and publication always name the current table version.** The bench encodes with the current
table whatever version it read, so a loadout that arrived on an older link is shared in the version
this release writes, and an older table is only ever read. This matches the ship builder, and it is
what keeps the older tables read-only in practice as well as by rule. It applies to the fragment the
bench publishes after every choice, not only to the export layer, because that fragment is published
from the moment the loadout reaches the bench.

**A loadout the current table cannot represent publishes no link.** Where an older table named an
identity the current one does not hold, `encodeEquipmentLinkFragment` raises `unknownIdentity` with
the mount, or with `suit` where what refused sits on the suit rather than on a mount: the suit
itself, its grade, or one of its modifications.
`LoadoutLinkCoordinator` already holds a `refused` link state for this, so publishing nothing and
taking the fragment down are stated rather than built. Telling the Commander is built here: the
refusal reached the export layer and no further, and a bench that silently stops publishing says
nothing a Commander could act on. Substituting a neighbouring identity is forbidden by
constitution IV, and publishing nothing is what leaves the loadout on the bench intact.

**A refusal is worded for the direction the link was going.** Every equipment refusal the bench
could show until now was about a link that arrived and could not be read. This one is about a
loadout that could not be written, and nothing arrived: a Commander told their own loadout could not
be read would go looking for a link that never existed. The mapper therefore takes the direction
alongside the tool, and `link.error.equipment.outgoing.*` carries the four codes the encoder raises.
Where no outgoing wording is stated the incoming key stands, so the split adds wording rather than
replacing any.

**The corpus is real fragments, not regenerated ones.** A fixture holds published `e.` fragments per
version with the loadout each opens to. Regenerating the expected value from the changed code would
make the test agree with whatever that code does; a literal fragment captured from the shipped
application is the only thing that proves an old link still opens. The build-link change established
this shape and the equipment corpus mirrors it.

## Risks / Trade-offs

**The corpus starts with version 1 only, so version selection is unexercised across versions until a
real table 2 exists** → A suite builds a test-only table and passes it through the registry
parameter, which exercises the shipped selection without committing a table. The guard fails the
suite where a real version arrives with no corpus entry. The coverage ledger does not register an
assertion that a link from an earlier published table opens: version 1 is current, so no journey can
produce such a link, and the change that mints table 2 is where that assertion belongs.

**A synchronous registry means every published table is in the initial bundle** → Accepted at the
size stated in the decision above. What a link may cost is a separate bound, and
`equipment-link-codec.spec.ts` already asserts the largest loadout the format can state against it.

## Migration Plan

None. No published link changes meaning, no stored loadout is touched, and the payload layout is
unchanged. Version 1 is the only published version and it stays readable.

Rollback is reverting the commit. Every link names version 1, which both the reverted code and this
one decode.
