# Ship-link codec

## Purpose

The ship-link codec serialises the smallest non-derivable representation of a ship loadout into a
URL fragment. It is an application-owned interchange format for sharing builds; it is not a second
implementation of SLEF.

It is one of two link codecs. The equipment builder publishes its own, `e.`-prefixed and specified
in [equipment-link-codec.md](./equipment-link-codec.md); the two share the Base70 radix, the CRC-32
envelope and the bit packer in `src/app/domain/build-link/`, and nothing above them.

SLEF import, build reconstruction, calculated statistics, and SLEF export remain the responsibility
of `@elite-dangerous-almanac/core`. The codec carries only the state needed to reconstruct the same
application loadout after invariant-quality normalisation: hull, optional ship labels, outfittable
module identities, explicit power settings, and engineering choices. Every blueprint grade is
treated as complete at 100% quality, so engineering quality is not link state. Almanac construction
always supplies the hull's default armour, seven core internals, and cargo hatch. Armour and core
internals remain codec-visible because they can be replaced; the cargo-hatch identity is implied by
the hull and only its variable power state is carried. The codec deliberately omits calculated
values, catalogue and purchase prices, aggregate module value, hull value, rebuy, health, and
ammunition.

The format is designed around these constraints:

- links must remain compact for minimal, stock, and fully engineered ships;
- every accepted link must decode deterministically and losslessly for every field the application
  models;
- alternate encodings of the same table-indexed protocol state must be rejected;
- published table versions must remain protocol-decodable indefinitely;
- old tables must not accumulate in the application's initial JavaScript bundle; and
- malformed, corrupted, unsupported, or ambiguous input must fail instead of being guessed.

## Representation layers

The complete fragment is built in layers:

```text
#b.<encoded payload>
    │
    └─ Base70 digits with a Base62-only terminal digit
       └─ payload bytes: [table version + adaptive build state] [CRC-32, little-endian]
          └─ identities resolved through the selected immutable JSON table
             └─ decoded and reconstructed through @elite-dangerous-almanac/core
```

The application hash marker `#` belongs to the URL and is not part of the codec value. Codec APIs
produce and accept `b.<encoded payload>`; the decoder also tolerates a leading `#` for integration
convenience.

### Outer envelope and table dispatch

`b.` permanently identifies the current Base70/Base62-terminal envelope. After decoding only that
generic radix layer, the asynchronous loader reads the first ten bits of the payload and dynamically
imports the matching immutable JSON table. The binary codec is shared by every table snapshot.

The table-version field has 1,024 values. Table `0` is reserved. Tables `1` and `2` are defined,
each the catalogue plus the pinned symbol models described below, and table `2` is current: a new
link names it. A catalogue update keeps the `b.` prefix and binary layout, publishes a new immutable
numbered JSON table, and makes that number current for new links. Older table files remain
available for existing links. Two or three new table snapshots per year do not require cloned codec
implementations.

A future prefix such as `c.` is appropriate for an incompatible binary layout or outer envelope.
Prefixes identify codecs, while the embedded field identifies data tables; neither is a release
counter. Once published, each prefix and referenced table remains available for its existing links.

### Radix envelope

The payload bytes are interpreted as one unsigned big-endian integer and encoded with this
70-character fragment-safe alphabet:

```text
0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-.!_/:@,
```

Leading zero bytes are represented by leading `0` digits. The terminal digit uses only Base62
alphanumerics, preventing bare-link autolinkers from dropping trailing punctuation. Decoding must
re-encode to the exact original text, which rejects invalid characters, redundant leading zeros,
and other non-canonical integer spellings. Underscore is URI-unreserved; comma is permitted in a
fragment but cannot appear as the terminal digit. Dollar is deliberately absent because paired
dollar signs delimit inline mathematics in GitHub Markdown.

The binary body is followed by its four-byte, little-endian CRC-32. The checksum is verified before
the table-indexed parser or the Almanac sees the data. A complete codec value is limited to 500
characters, `b.` counted among them, which leaves 498 encoded digits.

That is the bound FR-021 states. The requirement was amended to say so: it had been written over a
complete URL, which no codec can enforce, since the origin, path and `#` around a value belong to
wherever the application is deployed. Stating it over the value makes it a bound the layer that has
to satisfy it can actually see. What the URL adds is still real — on the `https://ships.example/#`
origin the tests use, 23 characters — but a deployment long enough for that to matter is the sharing
feature's to notice.

## Binary body

The first ten bits are always the directly readable codec-table version. The next fixed-width hull
tag also selects the body representation. For a table with `h` hulls, its width is
`ceil(log2(h + 1))`:

- tag values below `h` select bit packing and are the hull index;
- tag values from `h` upward select arithmetic coding and carry the hull-index remainder across the
  unused tag values; the arithmetic stream begins with the corresponding quotient when needed.

For both defined tables, `h = 48`, so their six-bit values `0..47` are packed hulls and `48..63`
are arithmetic markers. This uses capacity the hull tag already needed and preserves small packed
bodies exactly.
That no-penalty reuse applies when `h` is not a power of two; a future power-of-two hull count makes
the combined tag one bit wider than a packed hull index alone. The writer finalises both
representations and uses arithmetic coding only when its padded body is strictly shorter; a tie uses
bit packing.

Packed fields are written least-significant bit first within each field and byte. Arithmetic output
bits continue immediately after the hull tag, without byte alignment. Both forms pad the final
partial byte with zero bits, and exact canonical reserialization rejects non-zero or additional
trailing data.

| Order | Field               | Representation                                                                  |
| ----: | ------------------- | ------------------------------------------------------------------------------- |
|     1 | Codec-table version | 10 raw bits; currently `1`                                                      |
|     2 | Representation/hull | Fixed-width packed hull index or arithmetic marker described above              |
|     3 | Ship-name presence  | Boolean                                                                         |
|     4 | Ship-ident presence | Boolean                                                                         |
|     5 | Ship name           | When present: tagged varuint length followed by compact symbols or UTF-8        |
|     6 | Ship ident          | When present: tagged varuint length followed by compact symbols or UTF-8        |
|     7 | Pristine default    | Boolean; when set, the hull's pinned stock loadout ends the logical symbol list |
|     8 | Module layout       | When non-pristine: cost-selected baseline or absolute outfittable modules       |
|     9 | Power states        | Explicit values for every module the catalogue does not price at zero draw      |
|    10 | Engineering states  | Engineering presence, identities, grades, and experimental effects              |

### Arithmetic representation

The arithmetic branch is a 64-bit integer Witten–Neal–Cleary coder with inclusive `low` and `high`
intervals and deterministic E1/E2/E3 renormalisation. Every logical value is encoded against its
actual cardinality: booleans use `2`, bytes use `256`, contextual identities use the size of
their candidate set, and an eligible combination rank uses its exact combination count. A table
without pinned symbol models prices every symbol uniformly; a table that pins models gives the
symbols named in its `MODELS` block non-uniform interval shares, as described under
[Pinned symbol models](#pinned-symbol-models). For a weighted symbol the `s` and `s + 1` terms in
the update below become the symbol's cumulative frequency bounds and `N` its weight total; the
uniform case is the special case where every weight is one.

The immutable arithmetic constants are:

```text
P    = 2^64
MAX  = P - 1
HALF = P / 2
Q1   = P / 4
Q3   = 3 * P / 4
low  = 0
high = MAX
```

For a symbol `s` in a uniform alphabet of cardinality `N`, `2 <= N <=
Number.MAX_SAFE_INTEGER` and `0 <= s < N`, the encoder updates the inclusive interval with exact
`BigInt` arithmetic:

```text
range   = high - low + 1
newHigh = low + floor(range * (s + 1) / N) - 1
newLow  = low + floor(range * s / N)
```

After each update, renormalisation repeats the first applicable case:

```text
E1: high < HALF              => emit 0 and all pending complements
E2: low >= HALF              => emit 1 and all pending complements; subtract HALF
E3: low >= Q1 and high < Q3  => increment pending underflow; subtract Q1
otherwise                    => stop renormalising
```

Each completed E1/E2/E3 step then sets `low = 2 * low` and `high = 2 * high + 1`. Emitting a bit
also emits every pending-underflow bit as its complement, then clears the pending count. Arithmetic
stream bits are stored in emission order at successive physical bit positions; because physical
positions increase least-significant position first within a byte, they are not reversed or grouped
as a multi-bit integer.

The decoder initialises `code` from the first 64 arithmetic stream bits in emission order, shifting
the previous code left before adding each bit. Missing physical bits are zero. It selects the next
symbol with:

```text
range = high - low + 1
s     = floor((((code - low + 1) * N) - 1) / range)
```

It applies the same interval update. During E2 it subtracts `HALF` from `low`, `high`, and `code`;
during E3 it subtracts `Q1` from all three. Every completed renormalisation step doubles `low` and
sets `high = 2 * high + 1` and `code = 2 * code + nextBit`.

Termination increments the pending-underflow count once. If `low < Q1`, it emits `0` followed by
pending `1` bits; otherwise it emits `1` followed by pending `0` bits. The grammar supplies the
symbol count, so no EOF symbol or eight-byte code flush is needed. Exact body reserialization makes
virtual zero extension safe: truncated input, alternate termination, extra bytes, a non-preferred
representation, and non-zero padding all fail canonical validation.

The pristine marker describes the ordinary base: every module matches the pinned default and every
fitted module has absent power and engineering state.

## Adaptive encodings

Each adaptive structure computes its exact packed-bit cost before choosing a representation.
Decoders repeat that choice and reject any more expensive encoding, including non-preferred ties.
The packed cost is the deliberate stable proxy even when the final body uses arithmetic coding.
This makes the format canonical while allowing sparse and dense builds to use different layouts.

### Index sets

Slot sets are shared by module layout, power overrides, and engineering presence. A two-bit mode
selects one of four forms:

| Mode | Form             | Data                                                        |
| ---: | ---------------- | ----------------------------------------------------------- |
|    0 | Bitmap           | One bit for every candidate                                 |
|    1 | Included indexes | Count followed by strictly increasing fixed-width indexes   |
|    2 | Excluded indexes | Count followed by the strictly increasing complement        |
|    3 | Combination rank | Count, then `ceil(log2(C(n,k)))` bits of lexicographic rank |

Equal-cost modes prefer bitmap, then included indexes, then excluded indexes, then combination
rank. A universe containing zero or one candidate explicitly uses bitmap mode; it does not rely on
that tie order to avoid a one-cardinality bounded symbol. Here `n` is the candidate count and `k` is
the selected count. A zero-bit rank represents the only possible subset when `C(n,k) = 1`. The
combination count for the largest 38-slot hull remains a safe JavaScript integer. The arithmetic
primitive can encode any safe-integer cardinality, but the codec rejects a logical symbol when its
packed width would exceed 31 bits because canonical selection requires both renderers to succeed.
The shared index-set grammar likewise makes mode 3 eligible only when its bit-packed rank fits in at
most 31 bits. With the pinned maximum of 38 slots, any wider rank already loses to the bitmap after
including its count. The packed reader rejects such a mode before reading its rank; the arithmetic
path rejects it during canonical reserialization. The complement form is especially effective for
nearly complete loadouts: all 38 outfittable Anaconda slots can be represented as zero exclusions
instead of a 38-bit occupancy map.

### Module layout and identities

A non-pristine build first chooses between two complete layout strategies:

- **baseline-relative:** start with the hull's pinned stock loadout, encode the set of changed slots,
  then encode presence and identity only for those changes; or
- **absolute:** start empty, encode the set of occupied slots, then encode their identities.

The lower exact bit cost wins; a tie uses baseline-relative mode. The fully fitted reference
Anaconda is cheaper relative to its default loadout than from empty, so the codec selects the stock
baseline.

Module identity is constrained by hull and slot. A default identity has a one-bit shortcut. Other
identities use the pinned slot-specific candidate set when possible; a fixed-width global table
index is a fallback only when the identity is absent from that context. Each candidate set is
ordered by how likely its entries are to be fitted, which costs no bits of its own — the order is
table data — and makes an early position cheaper under `CONTEXT_INDEX_DECAY`. A contextual
candidate set containing one module consumes no index bits. The decoder rejects a global identity
that could have used the contextual form.

Sequences of two or more identities also compare direct encoding with backward references. The
first identity is literal. Later values can identify the immediately previous value or an earlier
distinct identity; otherwise they remain literal. Reference mode is selected only when it is
strictly smaller, so it can never add overhead to a build that does not repeat modules.

### Power state

Power data includes every occupied outfittable module and hull-implied component except those the
pinned catalogue prices at no draw at all. The rule is the mount card's: a module the Almanac prices
at zero — the detailed surface scanner, the planetary approach suites, the experimental module
stabilisers — has nothing to power and nothing to group, and any redundant `On` or `Priority` fields
in an imported event are discarded rather than encoded. A module whose draw the Almanac does not
publish keeps its state, because not having read a figure is not the same as having read a zero
(constitution IV). Every power plant, fuel tank, cargo rack, hull and module reinforcement,
passenger cabin and bulkhead falls in that second class; a table that treated them as passive
returned a shared build with the priority its author had set on the plant unset (reported
2026-08-26). The cargo hatch draws power and therefore has no presence or identity bit but retains an
enabled state and priority at a stable position.

Data begins with a one-bit `has overrides` marker. An override exists when either `on` or priority is
explicitly present, including priority `0`; absence remains distinct from an explicit value. When
overrides exist, a two-bit, exact-cost-selected mode chooses among:

- a fixed representation which detects uniform and all-defined fields across the sequence;
- a sparse representation relative to absent `on` and priority fields; and
- a journal baseline of `on = true` and `priority = 1`, with independent index sets and values only
  for fields which differ.

The journal baseline retains the distinction between an absent field and an explicit value; it is
selected only when cheaper than the other lossless forms. Equal costs prefer fixed, then sparse,
then journal-baseline mode. The mappings reserve invalid codes so the decoder can reject
out-of-range state:

- `on`: absent = `0`, off = `1`, on = `2`, with `3` invalid;
- priority: absent = `0`, priorities `0` through `4` = `1` through `5`, with `6` and `7` invalid.

### Engineering state

Engineering presence is measured only across fitted modules which have an ordinary blueprint or
pre-engineered variant in the pinned tables. One bit distinguishes all eligible modules from an
explicit index set.

For multiple engineered modules, an ordinary engineering record may refer backward to an identical
ordinary record already written **for the same fitted module**. Each module owns its dictionary: the
distinct ordinary records already written for it, in first-appearance order. A single mode flag
covers the whole group, the direct and reference forms are costed in full, and reference mode is
used only when smaller.

Keying the dictionary on the module rather than on the build is what makes a reference cheap. A
mount repeats its own roll — eight identical shield boosters, a rack of one weapon — far more often
than two different modules happen to carry the same record, so an index into one module's short list
is a fraction of an index into every record in the build. Where a module's dictionary is empty no
flag is written at all, because a literal is the only thing that can follow; where it holds one
entry the flag alone identifies the record and no index follows. A literal that restates a record
already in its module's dictionary is rejected as non-canonical, and an index the dictionary does
not hold is refused by the bounded symbol itself.

Fixed pre-engineered records do not participate in these dictionaries because their identities carry
different reconstruction semantics: such a record is always written out, with the flag reading
false where the module's dictionary is not empty.

An ordinary record contains:

- a blueprint index, normally constrained to the fitted module's candidate set;
- a grade, with the common maximum grade represented by one bit; when a blueprint has exactly two
  grades, that maximum/non-maximum bit identifies both and no bounded grade index follows; and
- an optional experimental effect, normally constrained to the module's candidate set.

Pre-engineered records use a pinned contextual identity composed from module, blueprint, grade, and
acquisition method. The pinned default experimental effect is implied unless explicitly changed.
Their modifier arrays are not encoded, because decoding regenerates them from the pinned identity.
A module therefore takes this record only while that regeneration would reproduce the engineering it
carries; see the Mercenary case below.

The Almanac publishes a modifier signature for all 79 fixed variants, which makes those articles
identifiable and shareable. It identifies the 25 Mercenary-system variants by their
purchase-exclusive blueprint rather than by that signature, so they are identifiable and shareable
on a route of their own. The codec continues to take every identity from the package and re-derives
nothing from blueprint metadata itself.

The difference between the two identification routes matters to the encoder. A reward article is
recognised _from_ its published block, so a module carrying that identity is carrying that state and
the record restores exactly what identified it. A Mercenary article is recognised from a blueprint
instead, so its identity says nothing about its state, and it is the one fixed variant that can hold
engineering the record cannot describe: its purchase is grade 1 while the same blueprint crafts
grades 2 to 5 with the identity surviving the upgrade, so the fitted grade can be past the one the
record replays.

For a Mercenary article, therefore, the record is used only when decoding it would reproduce the
module's engineering: the same grade, and either the same modifiers or none stated at all. A capture
stating none says nothing the record can contradict — the Almanac reads the purchase untouched
either way and derives the same article — which is how an exchange carrying only the blueprint and
the grade, a SLEF export among them, still shares. Reward articles keep taking the record whenever
the package identifies them. Anything a record cannot describe is written as an ordinary
record containing its blueprint and grade, and the Almanac re-derives the purchase identity on
reconstruction. The two forms stay unambiguous because no Mercenary blueprint offers grade 1 as a
craftable grade, so the purchase grade is unspellable in the ordinary form and grades 2 to 5 are
unspellable in the pre-engineered one.

Where neither form fits, the encoder refuses, naming the slot. That covers a purchase whose capture
states modifiers the record cannot account for — there is no craftable grade 1 to fall back to.

It used to cover more. A module's blueprint candidate set was its own engineering menu and nothing
else, and six of the modules sold pre-engineered have no menu at all: the two small mining tools,
the enzyme missile rack, two cargo racks, and the class-2 size-5 module reinforcement package. Their
sets were empty, and an empty set is not merely a missing blueprint index — it removes the
discriminator, because the reader infers the pre-engineered form from the table alone when no
ordinary form is available. So an ordinary record could not be written for them at any grade, the
encoder refused, and a Commander who engineered one watched the build's link disappear.

Since 2026-08-22 each module's set is its own menu plus the blueprints its pre-engineered variants
carry. The six gain a set of exactly their variants' blueprints — no menu is invented, only the
blueprint a climbed article has to name — and with it the discriminator that tells the two forms
apart. Every one of the 25 Mercenary articles shares at every craftable grade, as do the
community-goal and tech-broker variants on those same modules. The record layouts are unchanged.

Festive launchers are normal fixed pre-engineered variants in the Almanac model. They therefore use
the same contextual pre-engineered identity as every other fixed article; the codec has no separate
decorative state or application-specific modifier resolver.

### Scalar values

Engineering quality consumes no bits. The application models every selected or imported grade as
complete at quality `1`; a partial value in an imported journal or SLEF capture is deliberately
normalised rather than retained in the link model.

Ship name and ident use a tagged varuint header. In compact form, the header is
`2 * character count + 1`, followed by one six-bit index per character into this exact ordered
alphabet:

```text
ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 -
```

Every other value uses strict UTF-8: its header is `2 * UTF-8 byte count`, followed by that many
bytes. Thus an odd header identifies compact character count and an even header identifies UTF-8
byte count. A compact value is limited to 32 characters and a fallback value to 32 UTF-8 bytes, a
bound derived from the link budget below rather than chosen for its own sake.
The encoder rejects ill-formed UTF-16 such as lone surrogates, and the decoder rejects
malformed UTF-8 rather than replacing it with U+FFFD. It also rejects a UTF-8 spelling when every
decoded character belongs to the compact alphabet, because that spelling is non-canonical.

## Pinned symbol models

Real builds are heavily skewed: grades are usually maximal, engineered modules usually carry an
experimental effect, identities almost always resolve through their contextual candidate set, and
explicit enabled states are usually `on`. A table may therefore pin an optional `MODELS` block of
integer frequency weights, and the arithmetic renderer prices each modelled symbol by its weight's
share of the list total instead of uniformly. Each defined table pins the block below alongside its
catalogue; the models change nothing about the binary grammar, only how the arithmetic rendering
prices its symbols.

Because the weights are data in the versioned, immutable table, canonicality is untouched: encoder
and decoder read the same frozen numbers, and the decoder's exact reserialization check works
exactly as before. Three design constraints keep the mechanism safe:

- **Bit packing ignores models entirely.** Packed bodies are unchanged, and the packed-bit cost
  proxy that selects every adaptive layout (index-set modes, baseline-versus-absolute, references)
  is model-independent. Layout choices are therefore identical with and without models.
- **The canonical body is still the shorter of the packed and arithmetic renderings.** A model that
  mispredicts a build can only push that build back to its packed rendering; it can never produce a
  link longer than bit packing.
- **Models are optional table data.** A table without a `MODELS` block behaves exactly as before
  models existed. A table that pins different weights is a new table number like any other
  catalogue change, covered by the existing content-hash discipline.

### Modelled symbols

| Model                   | Symbol                                                          |
| ----------------------- | --------------------------------------------------------------- |
| `GRADE_IS_MAX`          | The ordinary record's maximum-grade boolean                     |
| `EXPERIMENTAL_PRESENT`  | The ordinary record's experimental-effect presence boolean      |
| `CONTEXT_HIT`           | Contextual-set membership of module/blueprint/effect identities |
| `ENGINEERING_REFERENCE` | The engineering record's back-reference flag                    |
| `IDENTITY_REPEATED`     | The module sequence's "an earlier distinct identity" flag       |
| `IDENTITY_IS_DEFAULT`   | The absolute layout's "matches the slot default" flag           |
| `BASELINE_SLOT_PRESENT` | The baseline layout's per-changed-slot occupancy flag           |
| `POWER_ON`              | Explicit enabled states (absent / off / on)                     |
| `POWER_PRIORITY`        | Explicit priorities (absent / 0–4)                              |
| `CONTEXT_INDEX_DECAY`   | Geometric prior over contextual-set positions                   |
| `CONTEXT_INDEX_FLOOR`   | Smallest weight that decay may reach                            |
| `CONTEXT_ADAPTATION`    | Per-run adaptive contexts over back-reference indexes           |
| `NAME_CHARACTERS`       | Per-character weights for the ship name (English-like)          |
| `IDENT_CHARACTERS`      | Per-character weights for the ship ident (callsign-like)        |

Every model from `ENGINEERING_REFERENCE` to `BASELINE_SLOT_PRESENT`, and `CONTEXT_INDEX_FLOOR`
beside them, is optional: a table that omits one prices that symbol uniformly, and a floor a table
omits is one. The four structural flags are modelled and the module sequence's "same as previous"
flag deliberately is not — how often a loadout repeats the article in the mount before it is a
property of the build rather than of builds, so a static prior loses on one reference or the other
(the Corvette repeats on 9 of its 36 mounts, the Anaconda on 18 of its 25), and a per-run adaptive
context on a two-valued flag is misled by its own first few symbols. Both alternatives were
measured, and uniform coding matched or beat each of them on both references.

The weight lists are integers; a symbol's interval is its weight's share of the list total. The
coder's 64-bit state keeps floor-division exact for totals far above the enforced weight-total
cap. The ship name and ident use separate character models because they are written in different
languages: names read like English while idents read like callsigns (uppercase, digits, dash), and
a single English-weighted model measurably penalised idents.

### Adaptive contexts

`CONTEXT_ADAPTATION` adds deterministic within-stream learning: a back-reference index is coded
against a per-run frequency context that starts uniform and bumps the coded symbol's weight by the
pinned increment after each use, so a target referenced repeatedly in one build gets cheaper each
time. Encoder, decoder, and canonical reserialization replay the identical symbol sequence, which
is all the mechanism needs — no new canonicality machinery. Adaptation lives only in the two
renderers and the arithmetic reader, never at symbol-capture or cost-model time, so the packed
render and every packed-cost layout decision stay model-independent. Contexts are keyed by the
identity of their dictionary array, so per-run back-reference dictionaries key their own context
on both sides.

Two measured findings shaped the design:

- **Candidate-set literals must not adapt.** A draft that adapted every contextual-set index made
  the reference Corvette grow by five characters: the grammar's back-referencing already dedupes
  repeats out of the literal streams, so what remains is repetition-poor, and each new distinct
  value paid for the counts accumulated by earlier ones. The insight generalises: adaptive models
  fight explicit dictionary coding unless they are confined to the streams where repetition
  survives — the reference indexes themselves.
- **The increment must stay small.** Per-module engineering dictionaries hold the repetition the
  reference streams used to carry, so at increment 8 every reference link is exactly the length
  switching adaptation off gives it, while increments of 32 and above cost the diverse-reference
  Corvette a character by penalising each new reference target. The table pins 8: the largest
  increment the corpus does not pay for, and the one that still prices a build whose repeated
  modules or repeated records fill a dictionary the corpus does not.

### What the pinned models deliberately leave open

- **Identity weights are a hand-ranked order, not a measured one.** The module and blueprint
  candidate sets are ordered by how likely a Commander is to fit the article — a slot-sized module
  before an undersized one, a popular family before a rare one, rating A before E, and the popular
  blueprint of an engineering domain first — and `CONTEXT_INDEX_DECAY` prices that order. The
  ranking is a prior over the package's own records: the generator reads the size, class, mount and
  family the package publishes and ranks those values, so nothing here is game data this repository
  keeps. Where the prior is wrong a link pays for it, which the reference Anaconda shows: it fills
  large mounts with deliberately undersized modules, and the order costs it three characters while
  the Corvette gains six. `CONTEXT_INDEX_FLOOR` is what bounds that cost: at the pinned 3/4 decay
  the last of the 464 candidates in the largest module set costs 18.0 bits with no floor, against
  8.9 for uniform coding, and 9.2 with the pinned floor of 2,048 — while the first candidate still
  costs 4.2. Explicit per-set weights, or an order measured against a usage corpus rather than
  estimated, remain table-generation work.
- **Experimental-effect sets keep catalogue order.** The package publishes a name, a modifier block
  and a description for each effect and nothing that separates a popular one from a rare one, so
  ranking them would mean inventing game knowledge rather than reading the package's records. The
  decay's floor is what keeps the pinned decay from taxing an unordered set.
- **Weights are hand-estimated.** The pinned skews are defensible priors validated against the
  reference corpus, not corpus-derived measurements. Better-measured weights belong under the next
  table number, like any other table change.
- **Grammar-conditional models** (for example, conditioning an experimental effect on its
  blueprint) are out of scope; the mechanism supports them by pinning more weight tables, at more
  table bytes.

### Measured results

`build-link-codec-models.spec.ts` pins both columns of the table below and asserts that no reference
or hull link lengthens while the engineered references shrink. The comparison baseline is the same
table with its `MODELS` block removed: bit packing ignores models, so the baseline reproduces every
packed body — and with it every minimal and stock reference — byte for byte, which the spec asserts
character for character across all 48 hulls.

| Reference build              | Without models | With models | Saving |
| ---------------------------- | -------------: | ----------: | -----: |
| Minimal Sidewinder           |             16 |          16 |      — |
| Stock Krait Mk II            |             10 |          10 |      — |
| Engineered Anaconda          |             73 |          64 | −12.3% |
| Supplied engineered Corvette |            102 |          80 | −21.6% |
| Named stock Krait Mk II      |             38 |          34 | −10.5% |

The win concentrates exactly where links are longest — dense engineered builds — while minimal and
stock links keep their packed rendering unchanged. The popularity-ordered candidate sets and their
decay carry the Corvette, whose engineering and outfitting are both diverse; the structural flag
weights carry both engineered references; and the split character models carry the labels: a single
English model saved the named build one character because the callsign-style ident paid for rare
letters and digits; ident-specific weights recover the rest.

## Reconstruction and validation

The decoder creates the minimal loadout event, then reconstructs ordinary engineering through
`ShipLoadout.applyBlueprint()`. That Almanac operation regenerates the journal modifier array and
all effective module statistics from blueprint, grade, invariant quality `1`, and experimental effect.
Pre-engineered modifiers are likewise obtained from the Almanac's supported journal resolver.

Calculated module values, hull value, aggregate module value, rebuy, and modifier arrays are never
link state. Catalogue prices are recalculated by the Almanac when exporting SLEF. A captured
purchase price or other provenance belongs in a SLEF document, not a build link.

Validation occurs at every layer:

1. Check the permanent envelope prefix and encoded-length bound.
2. Decode and canonically re-encode the Base70/Base62-terminal text.
3. Verify CRC-32 before parsing the body.
4. Select the immutable JSON table named by the ten-bit table version.
5. Parse a table-indexed intermediate representation while validating every identity, contextual
   candidate, mode, range, count, and ordered index.
6. Reject non-zero padding and trailing data.
7. Finalise both packed and arithmetic forms, select the strictly shorter padded body (packed on a
   tie), and require that canonical body to match the input exactly.
8. Only after protocol validation, reconstruct the `ShipLoadout` through the Almanac.

Canonicality therefore depends only on the immutable decoder and tables, not on Almanac object
normalisation. The final intermediate-state reserialization is authoritative; inner readers retain
structural bounds and reference checks but do not duplicate the writer's adaptive cost model.
Corruption tests also exercise re-checksummed body mutations so structurally valid but non-canonical
alternatives cannot bypass the CRC check. Almanac reconstruction fidelity remains a separately
tested compatibility property, and a reconstruction failure is reported separately from malformed
protocol data.

This distinction preserves old links across package upgrades. Two different canonical protocol
states may reconstruct to the same current `ShipLoadout` when a newer Almanac supplies defaults that
an older state omitted. The decoder accepts both protocol states; encoding either reconstructed
loadout emits the single canonical link for the current package result.

## Growth limits and the link budget

No table dimension is capped by the codec. Every width is derived from the table a link names, so
a bigger catalogue widens fields rather than breaking the format, and the binary layout keeps
working until a bounded symbol would need more than 31 bits — the packed writer's limit, which both
renderers must satisfy. That puts every structural ceiling around 2^31: 2,147,483,647 hulls (the
representation tag is `ceil(log2(h + 1))` raw bits), 2^31 modules, blueprints, experimental effects
or candidates per set, and 2^31 − 1 mounts on one hull. Grades are bounded at five by the game's own
range, which the generator checks. The ten-bit table-version field is the one small structural
limit: 1,023 snapshots, two of them spent.

What growth actually costs is link length, and links are bounded. Five hundred characters, two of
them `b.`, hold 381 payload bytes: a 377-byte body plus its four-byte CRC-32, or 3,016 bits. The
reference builds use a fraction of it — under the pinned symbol models the engineered Anaconda
body is 352 bits and the supplied Corvette 448, about 12 bits for each of the Corvette's 37
represented outfittable modules. Without models the same two links run 73 and 102 characters
against the models' 64 and 80.

The table below is the growth this format promises to absorb. `CODEC_TABLE_CAPACITY` in
[`scripts/build-link-codec-capacity.mjs`](../scripts/build-link-codec-capacity.mjs) holds these
numbers, and generation refuses a table that exceeds one.

| Dimension                           | Table 2 | Budgeted for | Encoded width at that size   |
| ----------------------------------- | ------: | -----------: | ---------------------------- |
| Hulls                               |      48 |          128 | 8-bit representation tag     |
| Modules                             |   1,204 |        2,048 | 11-bit global fallback index |
| Blueprints                          |     114 |          256 | 8-bit global fallback index  |
| Experimental effects                |      86 |          256 | 8-bit global fallback index  |
| Outfittable mounts on one hull      |      38 |           48 | 48-bit bitmap, 6-bit indexes |
| Hull-implied components on one hull |       1 |            4 | power state only             |
| Grades on one blueprint             |       5 |            5 | 1 bit, or 3 below the top    |
| Largest module candidate set        |     469 |        1,024 | 10 bits per fitted module    |
| Largest blueprint candidate set     |      10 |           32 | 5 bits per engineered module |
| Largest experimental candidate set  |      12 |           32 | 5 bits per engineered module |
| Largest pre-engineered set          |       6 |           32 | 5 bits per engineered module |

Those numbers are a promise, so generation prices them as though a table had already grown into
every one: **339 of the 377 bytes** a codec value holds, for a build with every mount filled and
engineered, every identity reached through its widest index, and both labels at their unit bound in
UTF-8. The table as it actually stands prices at 272, and both figures print on every run. Two
properties of the writer keep so blunt a bound sound: each adaptive structure is written in
whichever mode costs least, so pricing one arbitrary mode can only over-count, and the canonical
body is the shorter of the packed and arithmetic renderings, so the packed cost bounds both. Real
builds sit far below either figure — the supplied Corvette carrying a 32-byte name and a 32-byte
ident encodes to 166 of the 500 characters.

Pricing capacity rather than the current table is what makes the budget honest, and it is the
constraint that sets both the mount and label limits. Mounts are much the most expensive dimension
at roughly 44 bits each, and the two limits trade directly against one another: 64 mounts, an
earlier draft of this table, needs 427 bytes at the 32-unit label bound and 493 at a 64-unit one —
either way beyond a link. The pair had to give, and it gave on labels, because of an asymmetry in
which of them can move later. `MAX_STRING_UNITS` is shared by every table's decoder, so raising it
is free while lowering it would strand links already published; a mount count is data, and refusing
to mint a table for a hull the game has actually shipped is the worse failure. So the label bound is
set low now — 32 units, which is 32 compact characters, 16 accented Latin characters or 10 CJK
characters, since the fallback form counts UTF-8 bytes — and the mounts keep their headroom. Should
the game ship a hull past 48 mounts, versioning the label bound per table is the move that buys
capacity back without touching a published link's decoder.

## Versioned tables and lazy loading

A table pins hulls, hull-specific outfittable slots, the cargo hatch, stock modules, module
identities, blueprints and their grades, experimental effects, contextual candidate sets,
power-drawing module identities, pre-engineered identities, and the `MODELS` block of pinned symbol
weights. Stable game identities originate from the package; indexes exist only inside the selected
table.

Two tables are defined. `codec-table-1.json` is published: links name it, so its content is fixed
and `pnpm run codec:tables` refuses to run at all if it has moved. `codec-table-2.json` is current,
reproduced by `@elite-dangerous-almanac/core@0.2.13`, and a new link names it. A catalogue change
publishes the next numbered JSON table while retaining every earlier table unchanged; it does not
duplicate or version the codec logic. Minting a table touches two files in the codec, plus the pins
the suites carry. The two are: raise `TABLE_VERSION` in
[`scripts/generate-build-link-codec-tables.mjs`](../scripts/generate-build-link-codec-tables.mjs),
and give
[`build-link-codec-loader.ts`](../src/app/domain/ships/build-link/build-link-codec-loader.ts) the
new `CURRENT_TABLE_VERSION` and a `loadTables` case for the new file. The retired number needs no
edit: the generator derives the versions it must leave alone from the current table number, so a
table cannot leave the guarded set by being deleted or forgotten. The suites then need the new
table's content hash and its re-pinned corpus values, the retired table's hash pinned beside them,
the table each of them reads named, and a link written with the new table added to the published-link
corpus: the build states which pin failed and where.

The public asynchronous loader initially imports only the generic envelope, radix, and CRC code.
It radix-decodes the envelope and verifies CRC-32 once before using the table-version field, then
passes that verified body through the asynchronous table load without decoding it again. Encoding
dynamically loads the shared codec and current table. Decoding then imports only the matching JSON
file alongside the shared codec. Adding table snapshots to the loader therefore does not place
every historical table in the initial bundle.

A table's identity is its content, not the release it was generated from, and
`$generated.contentHash` — a SHA-256 over the table with its `$generated` block removed — is what
states that identity. That block is excluded because it holds the table's label and the hash itself
rather than any encoded value, and it holds nothing else: a table records what it encodes and the
fingerprint of that content, not the release or the script it came from. Which Almanac version
reproduces a given table is recorded here and in git history, where it can be corrected without
touching a frozen artefact. `pnpm run codec:tables` hashes the committed payload, verifies its
declared hash and compares that actual content with the freshly generated content. It **refuses to
write when either check differs**, because every published link names the table version that decodes
it, so a table whose content moved is a new encoding and belongs under the next number with this one
retained. The refusal has no override: a published table is never written again, and the message
names the next table number instead. Every published table is re-hashed on the same run, before the
current table is written, so an edit to one of those files fails the build rather than reaching a
link that was shared against it. `pnpm run codec:capacity` reads every committed table for the same
reason: a published table has to stay inside the budget its links were measured against.

The current application dependency is exactly pinned to Almanac `0.2.13`.

Table 1 holds the catalogue at content hash
`c3d1b5811a5eccec4e2101b82c68cf1960f7328435e8232b21082a58aabec370`, which is the content it was
published with, and which `@elite-dangerous-almanac/core@0.2.12` reproduces. That release is
recorded because table 1 cannot be regenerated under the current one, so it is the only way to
check the file against the package it came from. Table 1 is never regenerated in place, and the
build refuses to write it: links name it, and a table whose content moved is a new encoding under
the next number.

Table 2 holds the same catalogue under Almanac 0.2.13, where it differs in the frame shift drive
mounts. Outfitting sells a Supercruise Overcharge drive only at the size of the mount being
outfitted, so `modulesForSlot` offers no SCO drive to a frame shift drive mount larger than its own
class. Each frame shift drive candidate set therefore holds its own class's SCO drives and the
plain drives at or below the mount, where table 1 also lists the SCO drives of every smaller class.
No symbol leaves `MODULES` and no global index moves, so a link naming table 1 still names the same
articles; it names them at the positions table 1 records, which is why that table stays in the
repository. Running `pnpm run codec:tables` reproduces table 2 at content hash
`12ae153d8e2296e6fef7dc4bb408adfa766498c08c06804a293884c209d32a90`, at the same capacity — 272 of
the 377 bytes a 500-character value carries.

Every table a link can name carries links of its own in
[`published-build-links.fixture.json`](../src/app/domain/ships/build-link/published-build-links.fixture.json),
each pinned to the build it opens.
[`build-link-published-links.spec.ts`](../src/app/domain/ships/build-link/build-link-published-links.spec.ts)
reads every entry twice: once through the loader, which picks the table out of the payload the way
an arriving link is read, and once against the table the corpus files it under, which is what proves
the entry is filed where it belongs. It then rewrites each one with the current table and reads the
rewrite back on the same build, because a link is allowed to arrive in an older format and leave in
the newest one. The suite fails until a newly minted table has both a row of its own and a link, so
the corpus gains a version whenever `CURRENT_TABLE_VERSION` does and never loses one.

A build the catalogue does not fit is refused rather than approximated. Outfitting sells a
Supercruise Overcharge drive only at the mount's own size, so a link naming table 1 that fits one to
a larger frame shift drive mount decodes to `reconstructionFailed`: the package declines the fit,
and nothing here substitutes a neighbouring article for it (constitution IV). A drive at the mount's
own size fits as it always did.

Every future Almanac upgrade must reproduce the current committed table and pass the frozen
literal-link reconstruction corpus. A protocol fixture is never regenerated to make an upgrade
pass: a fixture that moved would mean a shared link had changed meaning. Changed table content uses
the next table number.

Note that the generator writes raw `JSON.stringify` output while the committed file
is Prettier-formatted, so an upgrade check must compare against `pnpm run codec:tables`, which pairs
the two: a bare generator run differs from the committed file in whitespace alone, which reads
alarmingly like drift. Frozen tables preserve
protocol interpretation, but full `ShipLoadout` reconstruction also depends on compatible Almanac
identities and behaviour; an incompatible upgrade requires retaining a compatible reconstruction
path for the affected table version.

## Reference corpus

The frozen corpus produces these encoded data lengths under table 2, the table a new link names.
Each value and length includes the `b.` protocol prefix. Every value carries the table-version
field, so no value here is also a table 1 value; the table 1 spellings are frozen in
[`build-link-codec.spec.ts`](../src/app/domain/ships/build-link/build-link-codec.spec.ts), which
reads one of them back through the loader. Four of the five differ from their table 1 spelling in
that field alone. The Corvette differs in its body as well, because its drive sits at a moved
position in the mount's candidate set, which is the whole reason table 2 exists. Only the Krait Mk
II value changes length, because at ten characters its packed body sits on a Base70 digit boundary:

| Reference build               | Base70 encoded data                                                                | Data length |
| ----------------------------- | ---------------------------------------------------------------------------------- | ----------: |
| Minimal Sidewinder            | `b.2vapm0exwB0@N0`                                                                 |          16 |
| Stock Krait Mk II             | `b.1QXDMzG/i`                                                                      |          11 |
| Festive flak Krait            | `b.9021d@0BPKJ:r/5IwZe`                                                            |          21 |
| Full engineered Anaconda*     | `b.DgYsVh0,YFsU1l1OYC_AKTIZyFMvwucN86-gU,6@zqrfHVWvZ!!6aN:LoGQ6@F`                 |          64 |
| Supplied engineered Corvette† | `b.3I7-5N665Yh9e/6bitRTwUjU7j67P_6EFdsgeuHEMYDI@@.!ylVeQ-TlQ21ch3tmnG,jAHbyOL.gka` |          80 |

\* All 38 outfittable slots are occupied, every currently offered fixture blueprint is applied, and
the fixed cargo hatch has an explicit power state. Cargo racks remain stock because Almanac 0.1.4
does not offer the fixed `CargoRack_IncreasedCapacity` reward as ordinary engineering.

† All 37 outfittable modules present in the supplied journal event are represented, plus the fixed
cargo hatch's power state. Sixteen cosmetic and livery slots are outside the outfitting feature's
scope and are not part of the codec model. Identifying ship metadata and all calculated, health,
ammo, engineer, localisation, and purchase fields were removed from the checked-in reference.

The every-hull baseline corpus covers minimal and stock configurations for all 48 catalogue hulls.
Its longest minimal value is 18 characters (the Anaconda). The festive literal covers an otherwise
unengineered Krait Mk II whose medium hardpoint carries a
package-owned green flak-launcher variant. The sanitised real engineered Federal Corvette produces
80 characters of encoded data, 102 without the symbol models. Its source capture records a partial
quality on one small hardpoint even though its modifier values match the completed grade-5 roll.
The codec deliberately normalises that field to quality `1`; the fixture is not treated as an
independent oracle for effective-stat reconstruction.

Compact minimal JSON plus raw DEFLATE is unsuitable for this data model. The same engineered
Anaconda produced about 1,167 characters of encoded data; the current specialised codec produces
64 under the pinned symbol models, including its `b.` prefix.

## Complete reference build definitions

These definitions list every field the codec models. The engineering column also displays invariant
quality `Q1` to make the reconstructed result explicit, but that value is not encoded. Tables
contain outfittable modules; the fixed cargo hatch is listed separately because only its power
state is variable. `—` means the optional value is absent; it is different from an explicit `on`,
`off`, or priority `0`. Calculated modifier arrays are deliberately not repeated because the
decoder rebuilds them through the Almanac.

<details>
<summary>Minimal Sidewinder</summary>

- Hull: `SideWinder`
- Ship name: absent
- Ship ident: absent
- Required outfittable modules: package-default armour and seven core internals
- Optional outfittable modules: none
- Fixed cargo-hatch power: enabled absent, priority absent

</details>

<details>
<summary>Stock Krait Mk II</summary>

- Hull: `Krait_MkII`
- Ship name: absent
- Ship ident: absent

| Slot                   | Module                            | Enabled | Priority | Engineering |
| ---------------------- | --------------------------------- | ------: | -------: | ----------- |
| MediumHardpoint1       | Hpt_PulseLaser_Fixed_Small        |       — |        — | —           |
| MediumHardpoint2       | Hpt_PulseLaser_Fixed_Small        |       — |        — | —           |
| Armour                 | Krait_MkII_Armour_Grade1          |       — |        — | —           |
| PowerPlant             | Int_Powerplant_Size7_Class1       |       — |        — | —           |
| MainEngines            | Int_Engine_Size6_Class1           |       — |        — | —           |
| FrameShiftDrive        | Int_Hyperdrive_Size5_Class1       |       — |        — | —           |
| LifeSupport            | Int_LifeSupport_Size4_Class1      |       — |        — | —           |
| PowerDistributor       | Int_PowerDistributor_Size7_Class1 |       — |        — | —           |
| Radar                  | Int_Sensors_Size6_Class1          |       — |        — | —           |
| FuelTank               | Int_FuelTank_Size5_Class3         |       — |        — | —           |
| Slot01_Size6           | Int_ShieldGenerator_Size6_Class1  |       — |        — | —           |
| Slot02_Size6           | Int_CargoRack_Size5_Class1        |       — |        — | —           |
| Slot03_Size5           | Int_CargoRack_Size5_Class1        |       — |        — | —           |
| Slot04_Size5           | Int_CargoRack_Size4_Class1        |       — |        — | —           |
| Slot08_Size2           | Int_CargoRack_Size1_Class1        |       — |        — | —           |
| Slot09_Size1           | Int_SuperCruiseAssist             |       — |        — | —           |
| PlanetaryApproachSuite | int_planetapproachsuite_advanced  |       — |        — | —           |

Fixed cargo-hatch power: enabled absent, priority absent.

</details>

<details>
<summary>Fully outfitted and engineered Anaconda</summary>

- Hull: `Anaconda`
- Ship name: absent
- Ship ident: absent

| Slot                   | Module                            | Enabled | Priority | Engineering                                                          |
| ---------------------- | --------------------------------- | ------: | -------: | -------------------------------------------------------------------- |
| SmallHardpoint1        | Hpt_PulseLaser_Fixed_Small        |     off |        0 | Weapon_Sturdy G5 Q1 + special_weapon_toughened                       |
| SmallHardpoint2        | Hpt_PulseLaser_Fixed_Small        |      on |        1 | Weapon_Sturdy G5 Q1 + special_weapon_toughened                       |
| Armour                 | Anaconda_Armour_Grade1            |       — |        — | Armour_Thermic G5 Q1 + special_armour_thermic                        |
| PowerPlant             | Int_Powerplant_Size8_Class1       |       — |        — | PowerPlant_Stealth G5 Q1 + special_powerplant_toughened              |
| MainEngines            | Int_Engine_Size7_Class1           |      on |        4 | Engine_Tuned G5 Q1 + special_engine_toughened                        |
| FrameShiftDrive        | Int_Hyperdrive_Size6_Class1       |      on |        0 | FSD_Shielded G5 Q1 + special_fsd_toughened                           |
| LifeSupport            | Int_LifeSupport_Size5_Class1      |      on |        1 | LifeSupport_Shielded G5 Q1                                           |
| PowerDistributor       | Int_PowerDistributor_Size8_Class1 |     off |        2 | PowerDistributor_Shielded G5 Q1 + special_powerdistributor_toughened |
| Radar                  | Int_Sensors_Size8_Class1          |      on |        3 | Sensor_WideAngle G5 Q1                                               |
| FuelTank               | Int_FuelTank_Size5_Class3         |       — |        — | —                                                                    |
| Slot01_Size7           | Int_CargoRack_Size6_Class1        |       — |        — | —                                                                    |
| Slot02_Size6           | Int_CargoRack_Size5_Class1        |       — |        — | —                                                                    |
| Slot03_Size6           | Int_ShieldGenerator_Size6_Class1  |      on |        2 | ShieldGenerator_Thermic G5 Q1 + special_shield_toughened             |
| Slot05_Size5           | Int_CargoRack_Size4_Class1        |       — |        — | —                                                                    |
| Slot13_Size2           | Int_CargoRack_Size1_Class1        |       — |        — | —                                                                    |
| Slot14_Size1           | Int_SuperCruiseAssist             |      on |        0 | —                                                                    |
| PlanetaryApproachSuite | int_planetapproachsuite_advanced  |       — |        — | —                                                                    |
| HugeHardpoint1         | Hpt_PulseLaser_Fixed_Small        |      on |        3 | Weapon_Sturdy G5 Q1 + special_weapon_toughened                       |
| LargeHardpoint1        | Hpt_PulseLaser_Fixed_Small        |      on |        4 | Weapon_Sturdy G5 Q1 + special_weapon_toughened                       |
| LargeHardpoint2        | Hpt_PulseLaser_Fixed_Small        |      on |        0 | Weapon_Sturdy G5 Q1 + special_weapon_toughened                       |
| LargeHardpoint3        | Hpt_PulseLaser_Fixed_Small        |     off |        1 | Weapon_Sturdy G5 Q1 + special_weapon_toughened                       |
| MediumHardpoint1       | Hpt_PulseLaser_Fixed_Small        |      on |        2 | Weapon_Sturdy G5 Q1 + special_weapon_toughened                       |
| MediumHardpoint2       | Hpt_PulseLaser_Fixed_Small        |      on |        3 | Weapon_Sturdy G5 Q1 + special_weapon_toughened                       |
| TinyHardpoint1         | Hpt_ChaffLauncher_Tiny            |      on |        4 | Misc_Shielded G5 Q1                                                  |
| TinyHardpoint2         | Hpt_ChaffLauncher_Tiny            |      on |        0 | Misc_Shielded G5 Q1                                                  |
| TinyHardpoint3         | Hpt_ChaffLauncher_Tiny            |      on |        1 | Misc_Shielded G5 Q1                                                  |
| TinyHardpoint4         | Hpt_ChaffLauncher_Tiny            |      on |        2 | Misc_Shielded G5 Q1                                                  |
| TinyHardpoint5         | Hpt_ChaffLauncher_Tiny            |     off |        3 | Misc_Shielded G5 Q1                                                  |
| TinyHardpoint6         | Hpt_ChaffLauncher_Tiny            |      on |        4 | Misc_Shielded G5 Q1                                                  |
| TinyHardpoint7         | Hpt_ChaffLauncher_Tiny            |      on |        0 | Misc_Shielded G5 Q1                                                  |
| TinyHardpoint8         | Hpt_ChaffLauncher_Tiny            |      on |        1 | Misc_Shielded G5 Q1                                                  |
| Slot04_Size6           | Int_FuelTank_Size1_Class3         |       — |        — | —                                                                    |
| Slot06_Size5           | Int_FuelTank_Size1_Class3         |       — |        — | —                                                                    |
| Slot07_Size5           | Int_FuelTank_Size1_Class3         |       — |        — | —                                                                    |
| Military01             | Int_ShieldCellBank_Size1_Class1   |     off |        0 | ShieldCellBank_Specialised G4 Q1 + special_shieldcell_toughened      |
| Slot08_Size4           | Int_FuelTank_Size1_Class3         |       — |        — | —                                                                    |
| Slot09_Size4           | Int_FuelTank_Size1_Class3         |       — |        — | —                                                                    |
| Slot10_Size4           | Int_FuelTank_Size1_Class3         |       — |        — | —                                                                    |

Fixed cargo-hatch power: on, priority `2`.

</details>

<details>
<summary>Supplied engineered Federal Corvette (sanitised)</summary>

- Hull: `federation_corvette`
- Ship name: removed from the reference
- Ship ident: removed from the reference

| Slot                   | Module                                   | Enabled | Priority | Engineering                                                          |
| ---------------------- | ---------------------------------------- | ------: | -------: | -------------------------------------------------------------------- |
| HugeHardpoint1         | hpt_beamlaser_gimbal_huge                |      on |        1 | Weapon_Efficient G5 Q1 + special_thermal_vent                        |
| HugeHardpoint2         | hpt_beamlaser_gimbal_huge                |      on |        1 | Weapon_Efficient G5 Q1 + special_thermal_vent                        |
| LargeHardpoint1        | hpt_drunkmissilerack_fixed_medium        |      on |        3 | Weapon_HighCapacity G5 Q1 + special_drag_munitions                   |
| MediumHardpoint1       | hpt_beamlaser_gimbal_medium              |      on |        3 | Weapon_LongRange G5 Q1 + special_regeneration_sequence               |
| MediumHardpoint2       | hpt_beamlaser_gimbal_medium              |      on |        3 | Weapon_LongRange G5 Q1 + special_regeneration_sequence               |
| SmallHardpoint1        | hpt_multicannon_gimbal_small             |      on |        1 | Weapon_HighCapacity G5 Q1 + special_corrosive_shell                  |
| SmallHardpoint2        | hpt_multicannon_gimbal_small             |      on |        2 | Weapon_HighCapacity G5 Q1 + special_emissive_munitions               |
| TinyHardpoint1         | hpt_shieldbooster_size0_class5           |      on |        2 | ShieldBooster_Resistive G5 Q1 + special_shieldbooster_chunky         |
| TinyHardpoint2         | hpt_shieldbooster_size0_class5           |      on |        2 | ShieldBooster_HeavyDuty G5 Q1 + special_shieldbooster_chunky         |
| TinyHardpoint3         | hpt_shieldbooster_size0_class5           |      on |        1 | ShieldBooster_Resistive G5 Q1 + special_shieldbooster_chunky         |
| TinyHardpoint4         | hpt_shieldbooster_size0_class5           |      on |        2 | ShieldBooster_Resistive G5 Q1 + special_shieldbooster_chunky         |
| TinyHardpoint5         | hpt_shieldbooster_size0_class5           |      on |        1 | ShieldBooster_Resistive G5 Q1 + special_shieldbooster_chunky         |
| TinyHardpoint6         | hpt_shieldbooster_size0_class5           |      on |        2 | ShieldBooster_Kinetic G5 Q1 + special_shieldbooster_chunky           |
| TinyHardpoint7         | hpt_shieldbooster_size0_class5           |      on |        2 | ShieldBooster_HeavyDuty G5 Q1 + special_shieldbooster_chunky         |
| TinyHardpoint8         | hpt_shieldbooster_size0_class5           |      on |        0 | ShieldBooster_HeavyDuty G5 Q1 + special_shieldbooster_chunky         |
| Armour                 | federation_corvette_armour_grade3        |      on |        1 | Armour_HeavyDuty G5 Q1 + special_armour_chunky                       |
| PowerPlant             | int_powerplant_size8_class5              |      on |        1 | PowerPlant_Boosted G5 Q1 + special_powerplant_cooled                 |
| MainEngines            | int_engine_size7_class5                  |      on |        0 | Engine_Dirty G5 Q1 + special_engine_overloaded                       |
| FrameShiftDrive        | int_hyperdrive_overcharge_size6_class3   |      on |        0 | FSD_LongRange G5 Q1 + special_fsd_heavy                              |
| LifeSupport            | int_lifesupport_size5_class2             |      on |        1 | Misc_LightWeight G5 Q1                                               |
| PowerDistributor       | int_powerdistributor_size8_class5        |      on |        1 | PowerDistributor_HighFrequency G5 Q1 + special_powerdistributor_fast |
| Radar                  | int_sensors_size8_class5                 |      on |        1 | Sensor_LongRange G5 Q1                                               |
| FuelTank               | int_fueltank_size5_class3                |      on |        1 | —                                                                    |
| Slot01_Size7           | int_shieldgenerator_size7_class3_fast    |      on |        1 | ShieldGenerator_Thermic G5 Q1 + special_shield_regenerative          |
| Slot02_Size7           | int_shieldcellbank_size7_class5          |      on |        3 | ShieldCellBank_Specialised G4 Q1 + special_shieldcell_oversized      |
| Slot03_Size7           | int_shieldcellbank_size7_class5          |      on |        3 | ShieldCellBank_Specialised G4 Q1 + special_shieldcell_oversized      |
| Slot04_Size6           | int_fuelscoop_size6_class5               |      on |        4 | —                                                                    |
| Slot05_Size6           | int_fighterbay_size6_class1              |      on |        3 | —                                                                    |
| Slot06_Size5           | int_cargorack_size5_class1               |      on |        1 | —                                                                    |
| Slot07_Size5           | int_guardianfsdbooster_size5             |      on |        3 | —                                                                    |
| Slot08_Size4           | int_fsdinterdictor_size4_class2          |      on |        4 | FSDinterdictor_Expanded G5 Q1                                        |
| Slot09_Size4           | int_fueltank_size4_class3                |      on |        1 | —                                                                    |
| Slot10_Size3           | int_dronecontrol_collection_size3_class5 |      on |        3 | Misc_LightWeight G5 Q1                                               |
| Slot11_Size1           | int_dockingcomputer_advanced             |      on |        4 | —                                                                    |
| Military01             | int_hullreinforcement_size5_class2       |      on |        1 | HullReinforcement_HeavyDuty G5 Q1 + special_hullreinforcement_chunky |
| Military02             | int_hullreinforcement_size5_class2       |      on |        1 | HullReinforcement_HeavyDuty G5 Q1 + special_hullreinforcement_chunky |
| PlanetaryApproachSuite | int_planetapproachsuite_advanced         |       — |        — | —                                                                    |

Fixed cargo-hatch power: on, priority `4`.

</details>

## Design rationale

The four-byte CRC-32 is retained for corruption detection. Engineering quality is invariant at `1`
and omitted. Adaptive layouts, identity back-references, engineering-record back-references, and
index-set complements are used only when their exact packed-bit cost is lower; ties keep the simpler
canonical form.

The specialised grammar is materially smaller than compressing a general-purpose JSON
representation. Current sizes are pinned by the [reference corpus](#reference-corpus) and codec
tests rather than copied into a second historical benchmark table.

Base70 uses underscore and comma but excludes dollar, tilde, asterisk, and plus. Keeping an
alphanumeric terminal digit prevents punctuation trimming without giving GitHub a pair of dollar
signs it could interpret as inline mathematics. The radix conversion uses bounded byte/digit
arithmetic rather than a whole-payload `BigInt`.

## Known limitations and integration work

The codec is currently a domain implementation, not the feature UI or complete URL lifecycle. It
does not update `location.hash`, manage browser history, import pasted links, or present localised
diagnostics. Those responsibilities belong to the sharing feature which consumes this format.

FR-021's other half is among them: SLEF has to be used when a build cannot meet the limit, and
making that offer belongs to the sharing feature rather than the codec, which can only refuse. The
same feature owns whatever its deployed origin costs on top of a codec value — 23 characters on the
`https://ships.example/#` origin the tests use, against which the largest reference build spends 80
of its 500.

Almanac 0.1.4 models festive modules as fixed pre-engineered variants and exposes journal-shaped
modifier reconstruction for known fixed articles. The application does not reimplement or adjust
those values or ordinary blueprint arithmetic.
