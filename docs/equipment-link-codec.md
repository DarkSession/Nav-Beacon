# Equipment-link codec

## Purpose

The equipment-link codec serialises one planned on-foot Commander — a suit, its grade, its
modifications and what is on its weapon mounts — into a URL fragment. It is the equipment
builder's counterpart to the [ship-link codec](./ship-link-codec.md), and a codec of its own
rather than a mode of that one.

It is separate for one reason: a fragment claims itself by its prefix. `b.` says a ship builder
minted the value and `e.` says an equipment builder did, so neither decoder is ever offered the
other's link and neither has to guess. What the two share is everything below the format — the
Base70 alphabet, the CRC-32 envelope and the bit packer — which lives in
`src/app/domain/build-link/` and is described under [Shared floor](#shared-floor) below.

The codec carries only what a Commander chose. Shield strength, resistances, firepower, material
requirements and upgrade costs are `@elite-dangerous-almanac/core`'s answers about that choice
(constitution II), recomputed on the way back in and never carried in the link.

## Representation layers

```text
#e.<encoded payload>
    │
    └─ Base70 digits with a Base62-only terminal digit
       └─ payload bytes: [table version + bit-packed loadout] [CRC-32, little-endian]
          └─ identities resolved through equipment-link-table-1.json
             └─ read back through @elite-dangerous-almanac/core
```

The `#` belongs to the URL and is not part of the codec value. The encoder produces
`e.<encoded payload>`; the decoder also accepts a leading `#`.

## Binary body

The body is bit-packed, little-endian within each byte, with no alignment between fields. It is
not arithmetically coded. A fully engineered hull is hundreds of choices and needs the ship
codec's adaptive model to stay inside its budget; a loadout is a suit, at most three weapons and
their modification slots, and packs into a handful of bytes without one.

Fields are written in this order, with widths derived from the table the payload names:

| Field                 | Width  | Meaning                                                          |
| --------------------- | ------ | ---------------------------------------------------------------- |
| table version         | 10     | Which table decodes the rest. Table `1` is the only one minted.  |
| suit                  | 2      | Index into `SUITS`.                                              |
| suit grade            | 3      | A grade the suit publishes, stated rather than indexed.          |
| suit modification × 4 | 4 each | `0` for an empty slot, otherwise `SUIT_MODIFICATIONS` index + 1. |
| mount × 3             | —      | One per key in `MOUNTS`, whichever suit is worn.                 |

Every loadout writes the catalogue's whole mount set — `MOUNTS`, which is `MOUNT_SLOTS` entries
long — rather than the mounts the encoded suit happens to offer. A weapon on a mount the suit has
no room for is _held_: it is carried, it is stated by nothing, and it is back in effect the moment
a suit offering that mount is worn again (013/FR-007, FR-018a). A payload sized to the suit could
not say that. Each mount is:

| Field                   | Width  | Meaning                                                     |
| ----------------------- | ------ | ----------------------------------------------------------- |
| weapon                  | 4      | `0` for an empty mount, otherwise `WEAPONS` index + 1.      |
| weapon grade            | 3      | Present only when a weapon is fitted.                       |
| weapon modification × 4 | 5 each | Present only when a weapon is fitted. `0` is an empty slot. |

The whole of the format is that. The Flight Suit with nothing on it is 43 bits and encodes as
`e.T._otnWnXKrn` — 14 characters. The largest loadout the catalogue can state — the Dominator at
grade 5, all three mounts filled at grade 5, every modification slot held — is 112 bits and
encodes in 25 characters, against a 500-character bound. A suit offering fewer than three mounts
pays eight bits for the two empty mount fields, which is what buys held content. The bound is what the application will
attempt to read at all; it is not a budget this format was drawn against, and there is no
capacity script for it because nothing here approaches it.

### Modification slots are addressed, not listed

Every one of an item's four modification slots is written, held or not. Which slot a modification
is in is part of what the loadout says: the slots a grade unlocks are its first ones, so an item
at grade 3 holds what is in slots 1 and 2 and has locked whatever is in 3 and 4 (013/US2). A list
that closed up around a cleared slot would move a modification from a locked slot into an
unlocked one, and the loadout a link restored would not be the loadout it was made from.

It is also what leaves the format one spelling per loadout: there is no second way to say which
slot is empty, so no canonical-ordering rule is needed to keep alternate encodings out.

Every item writes all four fields, whatever its own grades unlock. The count could follow the
item — the table names its slot count, and the mount count already works that way — but it
cannot follow the grade, because a lowered grade locks a slot without emptying it. One
format-wide
constant is the cheaper of the two, and it costs only the Flight Suit sixteen bits it never uses.
The mount count works the same way and for the same reason: it is the catalogue's, not the suit's.
A modification in a slot the item never unlocks is refused rather than encoded, so the spare
fields cannot say anything: see `SUIT_SLOTS` below.

## The table

`src/app/domain/equipment/loadout-link/equipment-link-table-1.json` is generated from the
installed package by `scripts/generate-equipment-link-codec-tables.mjs` (`pnpm run
codec:tables:equipment`). Every identity in a link is a position in it, so the table — not the
release that happens to be installed — is what a published link means.

It holds the identities:

- `SUITS` — `Suit.family`, the identity a suit keeps at every grade
- `WEAPONS` — `PersonalWeapon.symbol`
- `SUIT_MODIFICATIONS`, `WEAPON_MODIFICATIONS` — the recipe keys, split by `target`

and what the codec needs to refuse a loadout that cannot exist:

- `SUIT_GRADES`, `WEAPON_GRADES` — the grades each item publishes
- `MOUNTS` — every mount key the catalogue offers, in the game's own order, which is how many
  mount fields every loadout writes; `MOUNT_SLOTS` is its length
- `MOUNT_KINDS` — which kind of weapon each of those mounts takes
- `SUIT_MOUNTS` — which of `MOUNTS` each suit offers, by index
- `WEAPON_MOUNTS` — which kind of mount each weapon fits
- `MODIFICATION_SLOTS` — the most slots any grade of any item unlocks, which is how many
  modification fields every item writes
- `SUIT_SLOTS`, `WEAPON_SLOTS` — how many slots each item's own grades ever unlock
- `WEAPON_MODIFICATION_SETS` — which recipes each weapon can take

`WEAPON_MODIFICATION_SETS` earns its place. Greater Range, Headshot Damage and Improved Hip Fire
Accuracy are three recipes each, one per damage technology, and a weapon takes exactly one of the
three. The pairing is the library's: the generator asks `resolvePersonalModificationForWeapon` and
pins the answer. Without it a link could carry `weapon_range_kinetic` on a plasma rifle and this
codec would have no way to know.

`SUIT_MOUNTS` refuses nothing. A weapon on a mount the worn suit does not offer is held rather
than refused, so what a mount field is checked against is `MOUNT_KINDS` — a rifle on
`SecondaryWeapon` is still not a loadout the game can hold. It is in the table as the catalogue
fact table 1 was minted against, so a release that moves a suit's mounts cannot change what an
already-published link said the suit was.

`SUIT_SLOTS` earns its place for one item. Every suit and every weapon reaches four slots except
the Flight Suit, whose one grade unlocks none, so without it a modified Flight Suit — a Commander
the game cannot produce — would encode and decode happily. `WEAPON_SLOTS` is eleven fours and
refuses nothing today; it is there because the next weapon the game ships need not be.

Reading any of this from the package at decode time would make an old link's meaning depend on
the release installed, which is the thing a pinned table exists to prevent.

### Versioning

A published table is immutable. The application is published, so table 1 is what the `e.` links
already shared name, and the file that number points at is what those links mean. The ship codec's
rule applies unchanged: a changed content hash is a new encoding and belongs under the next table
number, with the old file kept for the links already published.

A payload names the table that decodes it. The version field is the body's first ten bits, so it is
readable before a table is chosen: `equipment-link-codec-loader.ts` reads it, selects the codec
registered under that number, and refuses a number this application does not carry.
`createEquipmentLinkCodec` derives every field width from the table it was handed and reads no
version but its own, so an earlier table stays readable exactly as it was minted. A link is always
written with the newest table, whatever version it arrived on.

The registry is synchronous where the ship builder's is asynchronous, and the reason is size: one
equipment table is 3,021 bytes where one build-link table is about 198 KB. The bundle carries one
equipment table, so every published table loads with the application and a link opens without a
fetch. The choice is worth revisiting when the equipment tables together approach the size of a
single build-link table.

The generator holds the published files to that promise. It hashes each committed table's payload
back before it writes anything, and refuses once a hash has moved or a file has gone, so neither a
regenerated table nor a hand-edited one passes quietly — the declared hash is never the evidence,
because an edit can carry it. Raising `TABLE_VERSION` mints the next file and leaves every earlier
one untouched. `scripts/generate-equipment-link-codec-tables.test.mjs` pins those refusals and the
minting path, and the unit suite pins the hash again from the application's side.

`published-equipment-links.fixture.json` is the other half of the promise: fragments that have been
shared, transcribed from the run that produced them and filed under the table version each one
names. The suite beside it opens every entry on the loadout it was shared as, and fails until a
newly minted version has an entry of its own.

## Refusals

Every refusal is a `BuildLinkCodecError` carrying a code and, where there is one, the mount it is
about. Encode and decode refuse the same things for the same reasons, so a fragment this
application produced is one it accepts:

| Code                      | Raised for                                                                  |
| ------------------------- | --------------------------------------------------------------------------- |
| `unsupportedEnvelope`     | A fragment that is not `e.`-prefixed — a ship link, or an unrelated anchor. |
| `invalidEncoding`         | A value that is empty, longer than the bound, or not Base70.                |
| `integrityCheckFailed`    | A body whose CRC-32 does not match.                                         |
| `unsupportedTableVersion` | A table number this build cannot read.                                      |
| `unknownIdentity`         | A suit, weapon or recipe this release does not publish.                     |
| `invalidPayload`          | A loadout the game cannot hold, and a body of the wrong length.             |

The one place the two directions differ is a value longer than the bound, which the decoder
refuses as `invalidEncoding` and the encoder as `invalidPayload`. Nothing reaches it: the largest
loadout the catalogue can state is 25 characters against a bound of 500.

The line between the last two is which question failed. A recipe the catalogue does not hold at
all is an unknown identity; a recipe it holds for other weapons is a payload the item cannot
hold — the same refusal as a rifle on a sidearm mount, an unpublished grade, one recipe fitted
twice, a modification in a slot the item never unlocks, or a loadout naming a number of mounts
that is not the catalogue's.

The ship codec draws that line elsewhere: an identity that is absent from its contextual set is
`unknownIdentity` there, whichever reason it is absent for. The equipment codec splits the two
because `link.error.unknownIdentity` tells a Commander the link "names a hull or module that is
not available here", which is untrue of a recipe this release publishes and the bench can show.
The bench says it in its own words instead: `link.error.equipment.unknownIdentity` names a suit,
weapon or modification this version does not have. Each codec is right about its own links.

### Length is checked twice, and the reader is the second check

The envelope bounds the value's length; the reader bounds the body. The ship codec re-serialises
what it decoded and compares bytes, so it detects a body that says more or less than the format
does as a side effect. This codec does not re-serialise, so `RawBitReader`'s truncation check and
`done` are its only defence against a body with a spare byte, ones in the last byte's spare bits,
or a field that runs off the end. All three are refused, and all three are tested — without them
one loadout would have several spellings, and a short body would decode as zeros into a loadout
nobody made.

### Naming the mount

A refusal names `suit`, or one of `MOUNTS`: `PrimaryWeapon1`, `PrimaryWeapon2`,
`SecondaryWeapon`. Those are Frontier's own journal `SlotName`s, published on `Suit.mounts[].key`,
so a mount is addressed by the game's own key like a ship's slot and never by a positional index
(constitution II).

They are identities, not text. Whatever renders a refusal names the mount in the Commander's
language first, through `getPersonalMountName` in `i18n/suits`, the way
`src/app/ui/outfitting/slot-naming.ts` names a ship's mounts. Interpolating `PrimaryWeapon1` into
a notice would ship an untranslated string (constitution VI, 013/FR-021). `suit` is this
application's own message, because the refusal is about the suit rather than about a mount.

## Shared floor

`src/app/domain/build-link/` holds what both codecs stand on, and neither owns:

- `build-link-radix.ts` — the Base70 alphabet with its Base62-only terminal digit
- `build-link-bits.ts` — `RawBitWriter` and `RawBitReader`
- `build-link-envelope.ts` — the CRC-32 envelope, the prefix check and the length bound,
  parameterised by a `LinkEnvelope`
- `build-link-codec-error.ts` — the error type and its codes

A codec supplies its prefix and its bound and gets envelope handling that is identical on both
sides by construction. It is the reason the equipment codec and the registry beside it come to
under 500 lines together: the parts that are hard to get right were already written and already
tested.

## What is deliberately not in the format

- **Anything the library can answer.** Stats, resistances, firepower, material requirements and
  costs are recomputed from the identities.
- **Suit tools.** Every suit carries the tools its family carries and no choice is made about
  them, so there is nothing for a link to say (013/FR-005a).
- **A loadout name.** The ship codec carries optional labels; a loadout has none to carry yet.
- **Engineering quality.** As on the ship side, a grade is complete or it is not reached.

## Status

The codec has a consumer: the equipment builder at `/equipment` mints and reads `e.` fragments.
The bench has shipped, so table 1 is published: a changed content hash is table 2, with this file
kept for the links already out. Almanac 0.2.13 leaves the table's content unchanged, so table 1 is
still the only minted table. Minting the next one is a raised `TABLE_VERSION`, a row in the
registry, a row in the corpus suite's table map and a corpus entry.
