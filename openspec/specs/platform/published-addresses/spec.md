## Purpose

Every address the application serves states its subject to a reader that runs no script, and to a
Commander's first frame. This capability owns the per-address metadata each screen publishes, the
same-origin files that describe the application, and the documents the build prerenders.

## Requirements

### Requirement: Per-address metadata

Every addressable screen MUST publish, as part of the same commit that publishes the root language,
direction and document title, a description of itself and the canonical address of its route, both
resolved in the committed locale. A screen whose subject is one hull MUST name that hull in both,
from the package's own name for it rather than from a table kept here; where the subject cannot be
resolved from the package, the address MUST publish the nearest enclosing identity rather than a
sentence with an unfilled variable in it.

Source: 011/FR-027, 011/SC-008.

#### Scenario: A screen publishes its own metadata

- **WHEN** an addressable screen is published
- **THEN** the same commit publishes the root language, the direction, the document title, a
  description of the screen and the canonical address of its route
- **AND** the description and the canonical are resolved in the committed locale

#### Scenario: A screen whose subject is one hull

- **WHEN** a screen's subject is one hull
- **THEN** its title and description name that hull from the package's own name for it

#### Scenario: The subject cannot be resolved from the package

- **WHEN** a screen's subject cannot be resolved from the package
- **THEN** the address publishes the nearest enclosing identity
- **AND** it does not publish a sentence with an unfilled variable in it

### Requirement: Same-origin files describing the application

The application MUST ship, as same-origin static files, a crawl policy that permits indexing, a
sitemap naming every address the application serves — one per hull included, enumerated from the
installed package rather than written down by hand — a web app manifest carrying an icon at 192 and
at 512 square plus a maskable one, an image for a link preview, and machine-readable structured data
describing the application.

Source: 011/FR-027.

#### Scenario: The published files are fetched

- **WHEN** a reader fetches the application's own files
- **THEN** the crawl policy, the sitemap, the web app manifest, the link preview image and the
  structured data are served from the same origin

#### Scenario: The sitemap is built

- **WHEN** the sitemap is written
- **THEN** it names every address the application serves, one per hull included
- **AND** the hull addresses are enumerated from the installed package rather than written by hand

#### Scenario: The manifest icons

- **WHEN** the web app manifest is read
- **THEN** it carries an icon at 192 square, an icon at 512 square and a maskable one

### Requirement: The document served before the application starts

The document served before the application starts MUST carry the complete set of metadata for the
address it is served at, in bundled English, so a reader that executes no script is neither served a
document that says nothing nor served the application's own title in place of the page's.

Source: 011/FR-027.

#### Scenario: A reader that executes no script

- **WHEN** a reader that executes no script fetches an address
- **THEN** the document carries that address's complete set of metadata in bundled English
- **AND** it carries neither nothing nor the application's own title in place of the page's

### Requirement: Canonical addresses and the production site

A canonical address MUST name the production site rather than wherever the document happens to be
served from, and MUST NOT carry a build: the payload lives in the fragment, and a canonical per build
is a canonical per nothing. A deployment that is not the production site MUST ask not to be indexed.
Every file that repeats the production address or the route list MUST be reconciled by the policy
checker rather than by hand.

Source: 011/FR-027.

#### Scenario: A canonical address is published

- **WHEN** any address publishes its canonical
- **THEN** the canonical names the production site rather than where the document is served from
- **AND** it carries no build

#### Scenario: A deployment that is not production

- **WHEN** a deployment other than the production site is published
- **THEN** it asks not to be indexed

#### Scenario: A file repeats the production address or the route list

- **WHEN** a file repeats the production address or the route list
- **THEN** the policy checker reconciles it rather than a person

### Requirement: Game names in the head carry no disclosure

The head is the one place where canonical package text carries no untranslated disclosure. Every
value in it — the document's title, its description, and the card title, description and image
alternative that restate them — is a bare string with no element structure to hang a `lang` boundary
or an associated control on, and a disclosure written into the sentence would be read out as part of
the page's name in every search result and every link preview. A hull name is a proper noun the game
does not translate, the sentence around it is in the committed locale, and the document's own `lang`
states which that is. This exception MUST cover the head and nothing else: the same name on the
screen behind it MUST follow the presenter order in full.

Source: 011/FR-027.

#### Scenario: A hull name in the head

- **WHEN** the head states a hull name
- **THEN** it carries no untranslated disclosure
- **AND** the sentence around it is in the committed locale, which the document's own `lang` states

#### Scenario: The same hull name on the screen

- **WHEN** the screen behind the head states the same hull name
- **THEN** it follows the presenter order in full

### Requirement: Main content in the served response

Every content-bearing advertised address MUST answer with a document whose main content is present in
the served response, without script execution.

Source: 015/FR-001, 015/SC-001.

#### Scenario: A reader that runs no script fetches a content-bearing address

- **WHEN** a reader that executes no script fetches a content-bearing address
- **THEN** the response body states that address's subject

### Requirement: The figures a hull's document states

A hull's document MUST state at least that hull's manufacturer, size, maximum speed, base shield,
hull mass, crew, mass lock, hardpoint counts by class, and internal capacity by size. These are the
figures a reader must be able to find; a document states whatever else its screen states, and every
figure in it is governed alike by the requirement that figures come from the pinned package.

Source: 015/FR-002, 015/SC-002.

#### Scenario: A hull's address is fetched with no script

- **WHEN** a reader that executes no script fetches a hull's address
- **THEN** the response body states that hull's manufacturer, size, maximum speed, base shield, hull
  mass, crew, mass lock, hardpoint counts by class, and internal capacity by size

### Requirement: The hull catalogue's document

The hull catalogue's document MUST name every hull it lists and MUST link to each hull's own address.

Source: 015/FR-003.

#### Scenario: The catalogue's address is fetched with no script

- **WHEN** a reader that executes no script fetches the hull catalogue's address
- **THEN** the response body names every hull the catalogue lists
- **AND** it links to each hull's own address

### Requirement: Every figure comes from the pinned package

Every figure in a document MUST be the value the pinned `@elite-dangerous-almanac/core` reports,
presented but never altered, rounded, re-derived or substituted. Where the package reports a value as
unavailable, the document MUST state the absence rather than a plausible number.

Source: 015/FR-004.

#### Scenario: A document is compared against the package

- **WHEN** a hull's document is compared against the pinned package
- **THEN** every figure matches
- **AND** none is rounded, substituted or invented

#### Scenario: The package reports a value as unavailable

- **WHEN** the package reports a value as unavailable
- **THEN** the document states the absence rather than a plausible number

### Requirement: The head on all 53 advertised addresses

Every one of the 53 advertised addresses MUST carry the per-address head — title, description,
canonical, `og:url` and card image — byte-for-byte what that machinery produces, whether or not a
body was generated for it. The head is applied to the generated document rather than to a
content-free shell.

Source: 015/FR-005.

#### Scenario: Any advertised address is fetched

- **WHEN** a reader that executes no script fetches any of the 53 advertised addresses
- **THEN** the response carries that address's own title, description, canonical, `og:url` and card
  image

#### Scenario: An address with a generated document

- **WHEN** an address has a generated document
- **THEN** its head is applied to that document rather than to a content-free shell

### Requirement: The generated set follows the package

The set of generated documents MUST be derived from the installed package and the advertised address
list, never from a hand-maintained list of hulls.

Source: 015/FR-006, 015/SC-009.

#### Scenario: A package pin move changes the hull set

- **WHEN** a package pin move adds or removes a hull
- **THEN** the generated set changes with no hand edit
- **AND** a mismatch fails the build

### Requirement: No Commander data in a document

A document MUST NOT contain a build, a saved record, any other Commander data, or any runtime
environment configuration.

Source: 015/FR-007, 015/SC-008.

#### Scenario: A generated document is inspected

- **WHEN** any generated document is inspected by the automated check
- **THEN** it contains no build, no saved record, no Commander data and no runtime environment
  configuration

### Requirement: Content in the first frame

The first frame of an advertised address MUST show that address's content rather than an empty shell.

Source: 015/FR-008, 015/SC-004.

#### Scenario: A Commander opens a content-bearing address

- **WHEN** the first frame of a content-bearing address paints
- **THEN** it shows the address's content rather than an empty shell

### Requirement: An invisible takeover

When the application takes over from the document, content visible to the Commander MUST NOT move
position, blank, or disappear and return. Exactly three exceptions exist — the stored catalogue view,
the replacement of bundled English by the committed locale, and the disclosure that replacement adds
— and nothing else may claim any of them. Across the takeover, visible content MUST move by zero
pixels on all five layout profiles in both orientations, measured as a cumulative layout shift of 0
from first paint to interactive, and no frame between first paint and interactive may be emptier than
the frame before it. Each of the two measured exceptions is measured separately rather than folded
into that number.

Source: 015/FR-009, 015/SC-003.

#### Scenario: The application takes over

- **WHEN** the application takes over from the document
- **THEN** no content the Commander can see moves position
- **AND** the page does not blank, and no content disappears and returns

#### Scenario: The shift across the takeover is measured

- **WHEN** the takeover is measured on any of the five layout profiles in either orientation
- **THEN** the cumulative layout shift from first paint to interactive is 0

### Requirement: A stored catalogue view at takeover

When a Commander has a stored catalogue view, the takeover MUST apply it, and MUST do so in the
takeover frame itself rather than a frame later. A Commander with no stored view MUST see no change
at all. This exception covers the catalogue's stored filter, sort and anchor and nothing else.

Source: 015/FR-009a.

#### Scenario: A returning Commander with a stored view

- **WHEN** a Commander with a stored catalogue filter, sort and anchor opens the catalogue
- **THEN** the document states the default view
- **AND** the stored view is applied in the takeover frame itself

#### Scenario: A Commander with no stored view

- **WHEN** a Commander with no stored view opens the catalogue
- **THEN** they see no change across the takeover

### Requirement: The first frame is laid out for its viewport

The first frame MUST be laid out correctly for the viewport it is painted at, on every one of the five
layout profiles in both orientations, without being corrected to a different composition after
takeover. Composition that the build cannot know MUST NOT decide the first frame; where the running
application later refines the composition by measurement, that refinement MUST NOT move content the
Commander can already see.

Source: 015/FR-010.

#### Scenario: The first frame at a layout profile

- **WHEN** the first frame paints on any of the five layout profiles in either orientation
- **THEN** it is laid out correctly for that viewport
- **AND** it is not corrected to a different composition after takeover

#### Scenario: The application refines the composition by measurement

- **WHEN** the running application refines the composition by measurement
- **THEN** the refinement moves no content the Commander can already see

### Requirement: The first frame is drawn in the application's own typefaces

A served document MUST be drawn in the application's own typefaces from the frame it first
paints. The stylesheet that declares those faces MUST be applied before the document paints,
and the document MUST ask for a face of every family it draws with beside the document
itself, so that a face arrives with that stylesheet rather than behind it.

A face is asked for by the document from an address relative to the deployment base, in
anonymous mode, and it is one the applied stylesheet declares.

The faces are declared `font-display: swap`, which is the limit of this requirement: a
Commander on a connection slow enough that a face has not arrived by the paint reads the
text in a fallback family and reads it again in the family the document asks for. Readable
text is worth that over invisible text. What the requirement holds is that nothing in the
served output puts a face behind the paint that the connection alone would not.

Source: 019/FR-001.

#### Scenario: A Commander opens an advertised address

- **WHEN** the first frame of an advertised address paints, with the faces it asked for
  arrived
- **THEN** it is drawn in the typefaces the application declares
- **AND** it is drawn in no family it did not ask for beside the document

#### Scenario: A document is served

- **WHEN** a published document is served
- **THEN** every stylesheet it applies is applied before it paints
- **AND** it asks for a face of every family it draws with, each one declared by that
  stylesheet

### Requirement: Bundled English, replaced by the committed locale

A document MUST be written in bundled English. When the committed locale is not English, the
application replaces the document's text with the committed locale's text once that catalogue
arrives. The replacement changes words only, and MUST NOT reorder anything on the page or remove
anything from it. It MAY reflow, because a translation is not the same length as its source. This
is a named exception to the invisible takeover and to the measured zero-pixel outcome.

The replacement is carried by what the application renders. The shell it draws carries it, and so
does each screen it presents. Content held from the served document is not rendered by the
application, so the replacement does not reach it, and it MUST stay in the bundled English it was
served in. That held content says which language it is in is "What an address served is held until
a screen replaces it". This requirement states the English; the language is stated there. The
catalogue is applied by rendering in it, so where the screen's code is what failed to arrive there
is nothing that can apply it to that screen's content, and a translation the application does not
have is one it may not write.

Source: 015/FR-011.

#### Scenario: A Commander whose committed locale is not English

- **WHEN** a Commander whose committed locale is German opens a content-bearing address
- **THEN** the document paints English content immediately

#### Scenario: The takeover presents a screen to carry the replacement

- **WHEN** a Commander whose committed locale is German opens a content-bearing address
- **AND** the takeover presents a screen
- **THEN** that screen carries the committed locale's text once that catalogue arrives

#### Scenario: The replacement lands

- **WHEN** the committed locale's text replaces the document's text
- **THEN** nothing on the page is reordered or removed
- **AND** the page may reflow because a translation is not the same length as its source

#### Scenario: No screen is presented to carry the replacement

- **WHEN** a Commander whose committed locale is German is left on content the address served,
  because no screen was presented
- **THEN** that content holds the English words it was served with, untranslated

### Requirement: The disclosure beside an untranslated game name

The one thing the replacement MAY add is the disclosure that accompanies a game name shown in its
original language. A Commander reading in a language the game's own nouns are not published in is
told so beside each one, and in bundled English there is nothing to disclose because English is the
original. So a document read in another language gains one such note per untranslated name and gains
nothing else. A value shown in a language the Commander did not ask for MUST say so, so the
disclosure MUST NOT be suppressed. This exception covers that disclosure and nothing else.

The disclosure belongs to a replacement that lands, which is where the application presents the
value. Content held because no screen was presented is a document standing in bundled English,
where this requirement already says there is nothing to disclose, so the application MUST NOT write
a disclosure into it. Nothing is suppressed: each name stands in the language of the document
around it, and that document carries its language.

Source: 015/FR-011a.

#### Scenario: A document read in another language

- **WHEN** the replacement lands in a language the game's own nouns are not published in
- **THEN** the page gains one disclosure beside each untranslated name
- **AND** it gains nothing else

#### Scenario: A document read in English

- **WHEN** a document is read in bundled English
- **THEN** there is nothing to disclose, because English is the original

#### Scenario: No replacement lands, so there is nothing to disclose

- **WHEN** a Commander whose committed locale is German is left on content the address served
- **THEN** no disclosure is written beside the game names in that content
- **AND** the names stand in the language the held content carries

### Requirement: A takeover that does not complete

If the takeover does not complete, the Commander MUST be left with the readable document rather than
an empty or broken page.

Source: 015/FR-012.

#### Scenario: The bundle is blocked or a chunk never arrives

- **WHEN** the takeover fails for any reason
- **THEN** the Commander is left with a readable document rather than a broken or empty one

### Requirement: What an address served is held until a screen replaces it

The application MUST hold what an address served until a navigation presents a screen to replace
it. A Commander arrives at what the address answered with, and the takeover MUST NOT discard that
before there is something to put in its place.

The hold MUST end only where a screen is presented, and it ends there. While it stands, a
navigation that ends any other way MUST leave the Commander on the content the address served.
That is a navigation that failed, one cancelled with nothing taking over, and one cancelled and
replaced by a navigation that then ended without presenting a screen. A redirect, or an address
that resolves elsewhere, counts once with whatever replaces it, so the hold does not end there.
Where what takes over is the address already open, which the application answers without
navigating, no screen is presented and the hold stands. What is said about any of those outcomes
is `openspec/specs/platform/navigation-waiting/`, "A screen that never arrives is stated, not
silently abandoned" and "The statement ends with the navigation", and this requirement adds
nothing to either.

Where an address served the application's own shell, nothing is held: the shell is what the
Commander keeps, because the shell is what they were given. That is every address the build
generates no document for, and it is the same answer wherever else the shell is what arrived. The
shell is the readable document "A takeover that does not complete" (015/FR-012) leaves such a
Commander with, so that requirement is met there without anything being held.

What the address served MUST be kept until the hold ends. It MUST be kept as the address served
it: not rebuilt, not recomputed, not written again. Where a navigation
ends without presenting a screen, it is what the Commander is left on, and it MUST carry the
language it was served in.

Putting held content back MUST be invisible, on the same terms as the takeover itself: no content
the Commander can see may move position, no frame may be emptier than the frame before it, and the
content MUST NOT blank and return. This requirement claims none of
the three exceptions the invisible takeover names, so a removal and a restore that a Commander
could see would breach it.

A screen that is presented replaces what the address served, and holding MUST NOT move anything
visible or blank the page while it does. A navigation that fails after a screen has been presented
MUST leave the Commander on the screen they are on, and nothing the address served may be put back
over it.

Source: 023/FR-001.

#### Scenario: A navigation fails before any screen is presented

- **WHEN** a navigation fails before any screen has been presented in the session, at an address
  that served a generated document
- **THEN** the Commander is left on the content that address served

#### Scenario: A navigation is cancelled with nothing taking over

- **WHEN** a navigation is cancelled before any screen has been presented in the session, and
  nothing takes over from it
- **THEN** the Commander is left on the content the address served

#### Scenario: A navigation is replaced, and the replacement presents no screen

- **WHEN** a navigation is cancelled or redirected to another address before any screen has been
  presented in the session
- **AND** the navigation that replaces it ends without presenting a screen
- **THEN** the Commander is left on the content the address they opened served

#### Scenario: What takes over is the address already open

- **WHEN** a navigation is cancelled before any screen has been presented in the session, and what
  takes over is the address already open, which the application answers without navigating
- **THEN** the Commander is left on the content the address served

#### Scenario: Held content is put back without a visible change

- **WHEN** content the address served is put back
- **THEN** no content the Commander can see moves position
- **AND** no frame is emptier than the frame before it
- **AND** the content does not blank and return

#### Scenario: A navigation presents a screen

- **WHEN** a navigation presents a screen while content the address served is kept
- **THEN** the screen replaces that content
- **AND** keeping it adds no movement and no emptier frame to what the takeover already does

#### Scenario: The address served the shell

- **WHEN** a navigation fails before any screen has been presented in the session, at an address
  that served the application's own shell
- **THEN** the Commander is left on that shell
- **AND** no content is put back over it

#### Scenario: Held content is not rebuilt

- **WHEN** content the address served is held
- **THEN** it is kept as the address served it
- **AND** no figure in it is recomputed and no sentence is written for it

#### Scenario: Held content states the language it is in

- **WHEN** held content is in a language other than the one the application is running in
- **THEN** the held content states the language it was served in

#### Scenario: A navigation fails after a screen has been presented

- **WHEN** a navigation fails after a screen has been presented in this session
- **THEN** the Commander is left on the screen they are on
- **AND** nothing the address served is put back

### Requirement: Offline after first load

Every capability MUST remain usable offline after first load, unchanged.

Source: 015/FR-013, 015/SC-006.

#### Scenario: A Commander goes offline

- **WHEN** a Commander who has loaded the application once goes offline
- **THEN** every capability remains usable
- **AND** every offline journey that passes still passes

### Requirement: The generated document or the cached shell

A Commander who has opened the application before MUST receive the generated document when they have
a network, and a readable cached shell when they do not. Which of the two answers an address MUST NOT
depend on the order things happened in.

Source: 015/FR-014.

#### Scenario: A returning Commander with a network

- **WHEN** a Commander who has opened the application before opens an address with a network
- **THEN** they receive the generated document

#### Scenario: A returning Commander with no network

- **WHEN** a Commander who has opened the application before opens an address with no network
- **THEN** they receive a readable cached shell
- **AND** which of the two answers the address does not depend on the order things happened in

### Requirement: An address with no generated document

An address for which no document was generated MUST still work: the running application resolves it
and the Commander sees the screen they would otherwise have seen.

Source: 015/FR-015, 015/SC-007.

#### Scenario: An address the build generated no document for

- **WHEN** a Commander opens an address the build generated no document for
- **THEN** the running application resolves the address
- **AND** the Commander sees the screen they would otherwise have seen

### Requirement: An address that resolves to no hull

An address that resolves to no hull MUST behave as it does today and MUST NOT answer with a generated
document for a hull that does not exist.

Source: 015/FR-016.

#### Scenario: An address naming a hull that does not exist

- **WHEN** an address such as `/ships/NotAShip` is opened
- **THEN** it behaves as it does today
- **AND** it does not answer with a generated document for a hull that does not exist

### Requirement: A build stays in the fragment

A build MUST remain addressed by the URL fragment. No part of a build may move into a path or query.

Source: 015/FR-017.

#### Scenario: A shared build link is examined

- **WHEN** a Commander shares a build and the link is examined
- **THEN** the build is in the fragment
- **AND** no part of it is in the path or the query

### Requirement: Which addresses get a document

A document MUST be generated for every content-bearing advertised address: the root, the hull
catalogue and each of the 49 hulls. `/outfitting` and `/equipment` MUST NOT be generated, and MUST
keep today's behaviour and today's head unchanged. Which addresses are content-bearing is recorded
once. A bench that later gains package-derived resting content becomes content-bearing and is
generated then.

Source: 015/FR-018.

#### Scenario: The generated set is counted

- **WHEN** the generated documents are counted
- **THEN** there is one for the root, one for the hull catalogue and one for each of the 49 hulls

#### Scenario: A bench address is opened

- **WHEN** `/outfitting` or `/equipment` is opened
- **THEN** no document was generated for it
- **AND** it keeps today's behaviour and today's head

### Requirement: Accessibility of the generated first frame

WCAG 2.2 AA with the eight named exclusions (2.1.1, 2.1.2, 2.1.4, 2.2.1, 2.4.1, 2.4.3, 2.4.7, 2.4.11)
MUST hold for the generated first frame exactly as it holds for every other frame. The automated scan
MUST cover that frame, not only the settled page, for each of the 50 content-bearing addresses. The
two head-only addresses have no generated first frame to scan and keep the coverage they have. The
scan MUST run in CI, because a generated document exists only in a production build.

Source: 015/FR-019, 015/SC-005.

#### Scenario: The scan runs over the generated first frame

- **WHEN** the automated accessibility scan runs in CI over the generated first frame of all 50
  content-bearing addresses across the ten Playwright projects
- **THEN** it reports no in-scope violation

#### Scenario: Text at 200% and zoom at 400% on the first frame

- **WHEN** the first frame is read at 200% text or 400% zoom, before any script has adjusted anything
- **THEN** it holds the same accessibility requirement every other frame holds

### Requirement: The document content gate

The content of every generated document MUST be checked against the package by an automated gate, so
a document that silently stops matching the package fails the build rather than being published.

Source: 015/FR-020.

#### Scenario: A document stops matching the package

- **WHEN** a generated document's content stops matching the pinned package
- **THEN** the automated gate fails the build rather than publishing the document

### Requirement: One record of which addresses are content-bearing

Which advertised addresses are content-bearing MUST be recorded in one place that the build and the
verification gate both read, so the two cannot disagree about what should have been generated. An
advertised address that is neither generated nor recorded as content-free MUST fail the build rather
than be published silently.

Source: 015/FR-021.

#### Scenario: An advertised address is neither generated nor recorded

- **WHEN** an advertised address is neither generated nor recorded as content-free
- **THEN** the build fails rather than publishing it silently

#### Scenario: The build and the gate read the record

- **WHEN** the build writes documents and the verification gate checks them
- **THEN** both read the one record of which addresses are content-bearing
