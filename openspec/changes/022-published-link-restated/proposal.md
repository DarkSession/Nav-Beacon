## Why

A Commander who opens the saved builds while the build's link is still being published loses that
link from the address. The workspace comes back with `/outfitting` and no build on it, and stays
that way until the next edit. The Commander loses nothing on the screen in front of them, and a
build that holds a record loses nothing on a reload either: it is autosaved and restored under
`ship-builder/build-lifecycle`, "Autosave of the active build" (001/FR-008). A build that holds no
record has only the address to be restored from, and loses that. What is lost is the
address. Copied from the bar, opened in another tab or handed to somebody else, it carries no
build. The in-app control that copies a link is unaffected, because it hands over the published
URL rather than reading the address bar. That is why this goes unnoticed until somebody copies
from the bar.

`LibraryPresence.raise` pushes a history entry at the address as it stands. `FragmentPublisher`
reaches its `replaceFragment` only after a dynamic import of the codec and its table and an
encode. Raised inside that window, the layer's entry is the current one when the publication
lands: the fragment is written onto the layer's address, and the workspace's own entry never
receives it. `lower()` returns to that entry with `back()`, and the publisher republishes only
from its effect on the revision and the loadout, so nothing states the fragment again.

The window is one lazy chunk plus one encode. It is short, but a cold or slow connection makes it
long enough for a Commander to open the saved builds inside it. The build itself is safe, because
an absent fragment is ignored on ingest. The address is wrong, and the application states that a
published link describes the build that is open.

## What Changes

- The published link is stated again when the address comes back carrying nothing. While a
  build's link is published, the workspace's address carries that link; an address that comes
  back empty — from history, or from anything else that moves the fragment out from under a
  publication — has it restored in place, with no history entry added.
- A fragment the address already carries is left alone, whichever kind it is. Another build link
  is how a Commander reaches another build, and a restoration that wrote over an incoming link
  would put every build link out of reach. Any other fragment is left as it stands, because the
  address is shared with whatever else uses it and the application already declines to interpret
  or clear a fragment that is not a build link. So only an address carrying nothing at all is
  restored.
- Restoration is bounded to the document the link was published onto, exactly as publication
  already is. A Commander who publishes a link and then leaves the workspace does not have that
  link restored onto whatever screen they went to.
- Neither the saved-builds layer nor any other feature asks for the restoration. It belongs to
  the capability that owns the address.

The change declares requirement `022/FR-001`:

- **FR-001** While a build's link is published, the address carries it. An address carrying no
  fragment has the published link stated again in place, at the document it was published onto,
  without a history entry and without disturbing the build.

A restoration adds no history entry, and `022/FR-001` is what states that. The standing
requirement `ship-builder/build-link`, "Link validation and history" (001/FR-020) does not carry
it: that requirement speaks about publishing a link, and a restoration is not a publication. The two rules
have the same mechanism, `replaceState`, and different occasions.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `ship-builder/build-link`: gains a requirement that the address keeps the published link — that
  a published link is stated again where the address carries no fragment, that a fragment of any
  kind already on the address is left as it stands, that restoring adds no history entry and is
  bounded to the document the link belongs to, that a restored link is not read back as an
  arrival, and that nothing is stated where no link is published.

## Impact

- `src/app/application/build-link/fragment-publisher.ts` gains the watcher that restores a lost
  link, beside the publication it already owns.
- `src/app/features/build-library/library-presence.ts` is unchanged. This is the design question
  the issue was opened for, answered in design.md: the library does not reach into the build
  link, and the workspace is not the only way an address can lose a publication.
- Nothing a Commander sees changes except the address bar, which now shows what it already
  claimed to show. No new words, so no catalogue keys.
- Two library journeys wait for the address to carry the build before opening the layer, which is
  correct for what they read. No journey in the suite holds this race open, so this change brings
  its own reproducing coverage rather than relying on theirs.

Closes #86.
