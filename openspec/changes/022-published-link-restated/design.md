## Context

See proposal.md — Why, for the defect and the window it lives in. What matters here is the shape
of the three moving parts.

`HistoryLocationAdapter` holds the fragment as a signal, set from `hashchange` and from its own
`replaceFragment`. `FragmentPublisher.publish` captures `currentDocument()` before its `await` and
discards a publication whose document changed, which is what stops a finished encode from landing
on a screen the Commander walked to. `BuildLinkCoordinator.listen` watches the same fragment
signal and turns an incoming build link into a build, with `markPublished` telling it which
fragment is the application's own output rather than something to ingest.

The defect appears because `LibraryPresence.raise` pushes a history entry at the same document.
The publication's document guard sees no change, because path and query are identical, so the
fragment is written, correctly, onto whichever entry is current. That is the layer's. `lower()`
goes `back()` to the workspace's entry, which never received it, and the fragment signal drops to
empty. Nothing republishes: the publisher's effect watches the revision and the loadout, and
neither moved.

The equipment bench is not affected and needs nothing. `LoadoutLinkCoordinator.publish` is
synchronous. It encodes in the calling frame, with no dynamic import and no `await`, so its
fragment is on the address before any layer can be raised over it.

## Goals / Non-Goals

**Goals:**

- The address carries the published link whenever one is published, whatever moved it away.
- An incoming build link still reaches the Commander's build.
- No history entry for a restoration.

**Non-Goals:**

- Changing when a link is published, or what it contains.
- Changing how `LibraryPresence` raises or lowers the layer. It behaves correctly; the address it
  pushes is the one a Commander would copy while the layer is up.
- Closing the window itself by making the codec load eagerly. That would trade a rare wrong
  address for a slower first frame on every visit, and the first frame belongs to
  `openspec/changes/archive/015-prerendered-documents/`.
- Any change to the equipment bench's link. `LoadoutLinkCoordinator.publish` encodes in the
  calling frame, so there is no window for a history move to land in and nothing to restore. If
  that bench ever gains an asynchronous encode, `equipment-builder` needs this requirement of
  its own; it is not inherited.

## Screens

None. This change introduces no screen and alters nothing drawn. The only visible surface it
touches is the address bar, which is not composed from the design system. The feedback a
Commander already gets about their link — published, encoding, refused — is unchanged, because
`link()` is not what is wrong: it says `published` throughout, and the address disagrees with it.

## Decisions

### The restoration belongs to the publisher, not to the library

This is the question the issue was opened for, and the answer is that the library does not ask for
anything.

`LibraryPresence` is a build-library feature. It already states, in its own words, that it must
not reach forward into the features drawn over it, and the ownership checkers under
`scripts/policy/` hold that line. Having `lower()` call the publisher would make the library the
one surface that knows the ship builder publishes a link at all, for a defect the library did not
cause: it pushed the address it was given.

The sequencing is against it too. `lower()` calls `Location.back()`, which does not change the
address before it returns — the fragment arrives with the event. A library asking the publisher to
state the link "after `back()`" would be asking it to wait on an event the library would have to
learn to recognise, and to get the order right every time.

It would also fix one caller. The address can lose a publication whenever history moves, and the
saved builds are one of several surfaces that move it. Stating the rule where the address is owned
covers any other surface without that surface being changed.

So: the publisher watches the fragment, and states its published link again when the address comes
back without it.

Alternative considered: the coordinator's `listen()` effect, which already watches the fragment.
Rejected because that effect is the ingress — it exists to turn what arrives into a build — and
writing the address from inside it would put egress and ingress in one place, where the guard
separating them is `#settled`.

Alternative considered: closing the window by ordering — having `raise` wait until the address
carries the build, or publishing before the entry is pushed. Rejected because it puts the
obligation on every caller: each surface that pushes a history entry would have to know a
publication might be in flight and wait for it. It cannot be made complete, since the window
belongs to the publisher rather than to any one caller, and waiting would make a Commander opening
their saved builds wait on an encode that has nothing to do with the list they asked for.

### Only an empty address is restored

The address comes back in one of three states, and only one of them is the defect.

Empty is the defect: the workspace's own entry never received the publication, and nothing else
put anything there. The link is stated again.

A different build link is an arrival. A pasted link moves the fragment to another build's value,
and a watcher that restored on any mismatch would write the open build back over it, so a build
link could never be opened from a running workspace. The ingress owns that fragment.

Any other fragment is left as it stands. `FragmentPublisher.#clearBuildFragment` already holds
that line: it returns early rather than clear a fragment that is not a build link, because the
address is shared with whatever else uses it and this application neither interprets nor removes
what it did not write. Restoring over such a fragment would remove it just as clearing would.

The watcher therefore tests emptiness itself. `recognizeBuildLinkFragment` answers `unrelated` for
an empty fragment and for a foreign one alike, so it can say whether a fragment is a build link but
not whether there is a fragment at all. The recogniser is asked the first question and the watcher
answers the second.

Alternative considered: telling the two apart by ownership rather than by emptiness — restoring
over anything this application wrote and leaving anything it did not. Rejected because a loadout
link is a fragment this application owns and is not a build link, so ownership would put the
equipment bench's published link at risk of being overwritten by the ship builder.

### Restoration is bounded to the document the link was published onto

The same bound publication already keeps, for the same reason: a Commander who leaves the
workspace must not arrive at another screen carrying a build link.

The publisher records the document alongside the fragment it published, in a private field beside
`#token`. It does not go on `link()`: that model is what the application says about the build, and
where the fragment was written is bookkeeping. A restoration checks the current document against
it and does nothing when they differ.

### The restored fragment is marked as the application's own

`markPublished` before `replaceFragment`, exactly as publication does. Without it the coordinator
reads the restored fragment as an arrival and offers to replace the build with itself — which the
`UNCHANGED` path would absorb, but by way of a decode of a build already open.

### A restoration adds no history entry

`022/FR-001` carries this rule. `001/FR-020` does not: it governs the fragment a build edit
writes, and a restoration follows no edit — it puts back what the address already claimed to
hold. Both write with `replaceState`, and the mechanism is all they share. The evidence for the
restoration is registered under `022/FR-001`, so the standing requirement's assertions cannot
stand in for it.

### The adapter reads the address back when the router writes it

**Decision.** `HistoryLocationAdapter` subscribes to Angular's `Location.onUrlChange` as well as to
`hashchange`, and re-reads `location.hash` on both.

**Why.** The watcher acts on the fragment signal, and that signal has to be the address. The router
writes the whole address — path, query and fragment together — from the URL it recorded for a
history entry, and a fragment written with `history.replaceState` is in no record of its. So going
back out of the layer, the router writes `/outfitting` with no fragment, just after the watcher has
stated the link again. The router writes through `Location`, which fires no `hashchange`, so the
signal would go on reading `b.…` while the address carried nothing, and no later event would
correct it: the watcher would never run again and the address would stay wrong, which is the defect
this change exists to close.

Reading the address back on the router's own write settles it in one more pass. The watcher states
the link, the router drops it, the adapter reports the drop, the watcher states it again, and the
router has no further navigation to write. The adapter's own `replaceFragment` goes straight to
`history`, so nothing the application writes comes back through this listener and there is no loop.

**Alternative rejected: publish through the router.** The fragment could be written with
`Router.navigate([], { fragment, replaceUrl: true })`, which would put it in the record the router
restores from. That makes every keystroke of a build edit a router navigation, and it moves the
fragment out of the adapter that the build-link contract makes its only writer.

### The journey holds the window open by delaying the codec chunk

The race needs the layer raised between the lazy import and the fragment write, and a journey that
waits for neither reproduces it only by luck. The codec arrives as a lazily imported chunk, so a
`page.route` installed once the workspace has loaded catches that request and holds it while the
layer goes up. The suite already delays JavaScript this way in `e2e/first-frame.ts`.

That chunk is told from every other lazy request by its own content: the codec table carries a
content hash, and the journey reads that hash out of the table in the source tree and holds the one
chunk whose body contains it. With the chunk held the journey reads that the address carries
nothing while the layer stands, which is what says the window was open — a journey reading the
post-condition alone passes whether or not it ever held anything. The race is held open
deterministically in the unit tests as well, through the publisher's injectable `encode`, so no
coverage depends on the timing of a browser.

## Risks / Trade-offs

- **The watcher and the ingress could both write the fragment.** → They cannot both act on one
  address: the watcher acts only on an empty address, and the ingress only on an address carrying
  a build link. The narrowing is the mitigation, and it is tested in all three directions — an
  empty address restored, a different build link left alone, a fragment that is not a build link
  left alone.
- **A Commander who deletes the fragment from the address bar by hand gets it back.** → That is
  the requirement rather than a side effect: while a build is open and its link is published, the
  address describes it. Two things give an empty address without fighting the watcher, and
  neither is deleting the fragment: leaving the workspace, where the document bound keeps the link
  off the screen a Commander goes to, and deleting the record the workspace autosaves into, which
  clears the active build to the no-build state under `ship-builder/build-lifecycle`, "Naming,
  saving and removing a record" (001/FR-009). After the second there is no build and so no
  published link, and the watcher has nothing to state.
- **The window stays open; this closes its consequence.** → A publication landing on a layer's
  entry is still a publication on the wrong entry, and a Commander who copies the address _while_
  the layer is up gets a link to the build, which is the address that entry was pushed to carry
  anyway. What this closes is the workspace's own entry staying wrong after the layer comes down.
- **Back to an earlier workspace entry that had no link puts the link straight back.** → A
  Commander who walks back past the point where their build was published arrives at an empty
  address and the watcher states the link again. This is the rule the requirement asks for: while
  a build is open and its link is published, the address describes it. The build on the screen has
  not changed, so the address is still true.
- **One more effect over the fragment signal.** → It reads the fragment and the published link.
  `link()` moves twice per publication, to `encoding` and then to `published`, so the effect runs
  about twice for each one. On every run but the defect's it reads the two signals and stops.
- **The journey rests on the codec arriving as a chunk of its own.** → It holds the one chunk
  whose body carries the codec table's content hash, so a build that folded the table into a
  chunk already loaded would leave it nothing to hold. The journey reads the empty address while
  the layer stands, so that build fails it there rather than passing on the post-condition alone.
  The same window is held in the publisher's own suite through its injectable `encode`, so no
  coverage rests on a browser's timing.

## Migration Plan

None. No stored data, no address format and no catalogue key changes. A Commander mid-session
gains the behaviour on the next publication.
