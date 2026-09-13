# Manual protocol: screen-reader journeys

**Protocol id**: `screen-reader`
**Covers**: 011 FR-006, FR-007, FR-008, FR-009, FR-010, FR-013, FR-020, FR-023, FR-025,
FR-026, SC-001; 017 FR-001, FR-002, FR-003, FR-004, FR-005, SC-001, SC-002; 018 FR-002,
FR-006, FR-007; 024 FR-001, FR-005, FR-006, FR-009, FR-010, FR-013, FR-016, FR-018, FR-022
**Version**: 15

## What is automated, and what is left

Three layers, and only the third needs a person.

**Structure, names, roles, states and relationships** are automated. `e2e/screen-reader.spec.ts`
asserts the accessibility tree itself — the exact structure a reader walks — with
`toMatchAriaSnapshot`, alongside the named assertions in `e2e/accessibility/assertions.ts` and an axe
scan of every product and preview state in all ten projects. That is what catches a page which
passes every rule and still presents as "button, button, button".

**Actual speech** is automatable but not from this repository's Linux container. `guidepup` drives
NVDA on Windows and VoiceOver on macOS and captures the spoken phrase log, which turns "the reader
said this" into a diff. It needs a Windows runner in CI. TalkBack has no comparable driver, so the
Android configuration stays manual regardless.

**Whether what is said means anything** is a judgment no capture can make. A reader can announce a
correct name, in the correct order, with the correct state, and still leave a Commander unable to
work out what the screen is for. That is what this protocol exists for, and it is one observation
per configuration rather than twelve.

## Configurations to run

| Configuration | Reader                | Browser            | Device                                                                                |
| ------------- | --------------------- | ------------------ | ------------------------------------------------------------------------------------- |
| desktop       | NVDA                  | Firefox            | Windows desktop                                                                       |
| mobile        | TalkBack              | Chromium           | Android phone                                                                         |
| tablet        | TalkBack or VoiceOver | Chromium or Safari | Tablet, whenever composition or interaction differs materially from both of the above |

The tablet run is required whenever the composition differs — the shell changes
between the compact and medium modes, so it does.

## Environment to record

Operating system and version; browser and version; screen-reader name and
version; device and viewport; orientation; the application build's git SHA; the
date of the run.

## Steps

Run each step in each configuration. Record what was actually announced, not a
paraphrase of what should have been. Steps 1-6 and 8 are asserted structurally
by the automated suite: confirm them, and record a row only where a real reader
disagrees or where the announcement is correct but unusable.

1. **Landmark discovery.** List the landmarks with the reader's landmark
   listing. Expect exactly one banner, one main and at most one navigation. The
   shell publishes no contentinfo. Each must be findable and named where it has
   a name.
2. **Heading discovery.** List the headings. Expect exactly one level-1 heading
   naming the current screen, and levels that descend without skipping.
3. **Matching names.** Move through every control. Expect the announced name to
   contain the words visible on screen. A control announced as something other
   than what it reads is a failure even if both are sensible.
4. **State.** For every control that has one, expect the state to be announced:
   selected, expanded, pressed, checked, invalid, busy, disabled. Expect the
   state to change audibly when it changes visually.
5. **Errors and descriptions.** Move to a field with a description and to a
   field with an error. Expect both to be announced with the field, not as
   separate orphaned text somewhere else on the page.
6. **Layer isolation.** Open a layer. Expect the reader to be moved into it,
   expect its title to be announced, and expect content behind it to be
   unreachable — including by landmark and heading navigation. Dismiss it and
   expect to be returned to the control that opened it.
7. **Urgency and replay.** Trigger a blocking error. Expect one assertive
   announcement, promptly. Then trigger a settled change. Expect one polite
   announcement that does not interrupt. Then, without touching that change,
   change the browser's language setting: expect **silence**, because the event
   already happened and nothing about it moved. Expect unaffected values never
   to be announced. An action the Commander takes a second time is a second
   event and is not this step's silence — step 22 reads that one.
8. **Text equivalents.** Find every status, tone, selected state and metric.
   Expect the meaning to be in words. Nothing may be carried by colour, shape,
   position or motion alone.
9. **Language switching.** Open the Language action and choose the other
   language. Expect the interface to change language completely, expect the
   reader to switch voice or pronunciation to match the new root language, and
   expect no fragment of the previous language to remain.
10. **Canonical game text.** Find a game noun the package does not translate
    into the active language. Expect it to be announced in the language it is
    actually in, and expect the untranslated disclosure to be announced with it.
    Then find a value the package cannot supply: expect it to be announced as
    unavailable, never as a raw symbol and never as a zero.
11. **Quick navigation.** Move by heading, by landmark, by form control and by
    the reader's own gestures on touch. Expect every capability to be reachable
    this way.
12. **Touch completion.** On the touch configurations, complete one full journey
    with single touches only. Expect no hover step and no multi-pointer gesture
    to be required.
13. **Cost and materials.** Open a build, engineer one module, and find the
    `COST` and `MATERIALS` blocks. Expect each block to be reachable and named.
    In `COST`, expect all four rows to be announced as label-and-value pairs —
    hull, modules, total, rebuy — with the currency announced, and expect the
    total and the rebuy to be distinguishable by what is said rather than by
    how they look. In `MATERIALS`, expect the blueprint count, every material's
    name, rarity and quantity, and the type and unit totals. Fit a Mercenary
    article and expect its Merc Coin row to be announced by name, not by its
    colour, and never as credits. Expect **no** control anywhere in either
    block: nothing to expand, nothing to activate, nothing to trace.
14. **Hull anatomy.** Open a build and find the `HULL ANATOMY` region. Expect
    each plate to be reachable and announced with the hull's name and which way
    up it is. Move through the mounts: expect each one to be announced as a
    button naming the mount the way the ledger row beside it names it, its kind
    — hardpoint or utility mount — which side it is on, whether it is fitted or
    empty, and whether it is engineered or stock. Expect nothing about a mount
    to depend on its colour, its dashes or where it sits on the hull. Activate
    one and expect the matching ledger row to become selected, and the anatomy
    mount to be announced as pressed; expect **no second reading** of the same
    facts anywhere else on the screen. On `Federation_Corvette`, find
    `Medium Hardpoint 1`, which the package draws on both sides: expect two
    occurrences that differ only in the side they name, and expect selecting
    either to press both. Select an internal mount from the ledger and expect
    nothing on the plates to change. Finally, with the developer tools offline
    or the network disconnected, open a hull whose schematics have not been
    seen: expect each plate to announce that it is temporarily unavailable and
    to offer a retry, expect one announcement per side rather than one per
    mount, and expect the complete ledger to remain fully operable.

15. **Importing and exporting a build.** Find the `IMPORT` action from the
    shipyard, with no build open. Activate it and expect a dialog announced by
    name, with its description read, and the page behind it unreachable. Find
    the payload field: expect its visible label to be announced, and expect the
    one status line to be reachable and to say what the draft measures against
    the limit. Paste something that is not JSON and submit: expect the refusal
    to be announced **once**, expect it to be associated with the field so
    landing on the payload reads it, and expect the field to be announced as
    invalid. Paste a payload the Almanac rejects: expect each diagnostic to be
    announced as five labelled facts — entry, property, code, constraint and
    reason — expect the property path and the code to be read left to right
    even in a right-to-left interface, and expect an untranslated reason to be
    announced in the language it is actually in with its disclosure. Import a
    valid payload: expect one polite announcement naming the hull, expect
    **no** announcement of the payload itself or of the diagnostic list, and
    expect to land in the workspace. Then open `EXPORT`: expect the format list
    to be announced as a group with the selected format's state said in words,
    expect the payload field to be announced as read-only rather than
    unavailable, and expect the entry count and size to be reachable. Activate
    `COPY` and expect one polite announcement of the result — never the payload
    — and expect a second press to be answered in its own right: the same
    sentence again, because a Commander who was unsure of the first press has
    no other way to learn it was received (step 22 reads that judgment).
    Activate
    `DOWNLOAD` and expect it to be announced as handed to the browser, never as
    saved. Where the platform offers `SHARE`, expect a cancelled share to be
    announced as nothing sent. In every one of these states expect the payload
    to remain reachable and selectable.

16. **A newly published version.** With the application open, have a newer
    version published behind it. A modal layer comes up, announced by name
    (**Updating**), saying that a newer version was published and that this
    session is restarting on it. Expect that layer to take focus, expect the page behind it to
    be unreachable by heading, landmark or gesture while it stands, and expect
    to find **nothing to press inside it** — no dismiss, no confirm, no "not
    now". The restart is not a question and the layer offers no answer to one.

    Nothing is published to the live region while it stands, and that is
    deliberate rather than an omission: the layer is modal, so the outlet
    inside the frame is inert and out of the tree, and a sentence put there
    would be one no reader is offered. The layer is the announcement. So expect
    to hear its title and description **once**, from the layer, and expect
    **no** second sentence about a published version alongside it.

    Stay on it and expect the page to restart by itself, about a second in,
    with nothing having been activated. This is the step that carries the cost
    of excluding WCAG 2.2.1 for this mechanism (constitution V): a time limit no
    reader can extend or turn off. The layer is not a passage to be finished —
    the owner's decision of 2026-08-28 shortened it to the moment before the
    restart, and the half a reader is meant to take in is the **Updated** layer
    the restarted session draws, which has no clock on it at all. So what to
    check here is that the announcement is heard **at all** before the page
    goes: that the layer takes focus and its title reaches the reader. If it
    does not, that is a number to revisit, and `UPDATE_OVERLAY_MS` in
    `src/app/application/updates/application-update.store.ts` is where it lives.
    Record what was heard alongside the verdict.

    The session that comes up says so, in a second modal layer rather than in
    the live region: expect **Updated** announced by name as it takes focus,
    naming the version now running, and expect that text to be readable in
    place rather than only having been spoken. It carries one named control
    (**Continue**), which dismisses the layer and nothing else. Left alone, it
    goes by itself after about six seconds — the second and last time limit in
    this application, named in constitution V beside the restart — so what to
    check is whether the title, the sentence and the version all reach the
    reader inside that window at their own rate and verbosity. If they do not,
    that is a number to revisit, and `UPDATE_APPLIED_NOTICE_MS` in
    `src/app/application/updates/application-update.store.ts` is where it lives.
    When it goes by itself, focus returns to where the layer took it from — for
    a layer opened at start-up that is the document body, with nothing said
    about the move. Record what the reader does at that moment: whether it
    reads on, falls silent, or starts the page again. Expect the notice **not**
    to come back on the next navigation, or on the next load of that session.

    Then the state where the restart could not be carried out: the layer comes
    down without the page starting over, and the shell is left carrying a
    polite notice that a newer version was published, beside a named control
    (**Update now**) with its description. This is the one moment the live
    region has something to say, because it is the first moment a reader can
    reach it — so expect the notice spoken once, politely, without cutting off
    what is being read; expect it to stay findable on the page rather than only
    having been spoken; and expect the control announced as a button named the
    way it reads on screen. Expect the notice **not** to be spoken again when a
    further version is published behind the first, however many times the layer
    goes up and comes back down.

    Then the unrepairable state, which the shell exposes as an alert rather
    than as a status. Expect the notice to be spoken once as it arrives, expect
    the assertive outlet's summary to be heard as a second, **different**
    sentence rather than the same one again, and expect the two together to
    make clear both what is wrong and what to do about it. This step is the one
    that settles a judgment the code cannot make for itself: whether a `status`
    inserted with its text is reliably spoken and an `alert` is, which is why
    the polite path repeats its notice in the outlet and the assertive path
    does not. `updateStatus` in `src/app/app.ts` chooses the tone, and the
    version effect in the same file's constructor chooses what each outlet
    carries. If a reader disagrees on either half, record the announcement
    verbatim — the split is a decision to revisit, not a rule.

17. **Help, licences and provenance.** From a capability with no build open,
    discover the frame's Help entry: in the banner row where there is room for
    it and inside the named action layer where there is not — and expect to
    find **no** second help control anywhere else, on any capability, plate,
    rail or layer.

    Listen to what the banner row's entry is called. Since 2026-08-26 it is
    drawn there as a `?` rather than as words, so this step is the one that
    proves the mark did not become the name: expect a button announced as
    **Help**, expect nothing announced as "question mark" or as a graphic, and
    expect the action-layer entry to be announced by that same name. If a
    reader announces the glyph, or announces nothing, the mark has taken over
    the name and that is a defect against 012/FR-001, not a preference. Activate it and expect one dialog announced by name, with
    the content behind it unreachable by heading, landmark or gesture.

    Walk the headings inside it. Expect the reference's own three sections in
    the reference's own order — `ABOUT`, `FAQ`, `LICENCE` — and expect each of
    the questions to be a heading **under** the `FAQ` heading rather than
    beside it, so heading navigation reaches the questions as a list of
    questions. In `ABOUT`, expect the purpose, the maintainer and where the
    source is to be read as three sentences in that order before any fact is
    reached, and expect the source sentence to carry a link announced by the
    site it reaches. Then expect exactly two identity facts, each announced as
    its own term and value, and expect the two terms to distinguish which
    version is which without seeing them side by side; expect nothing to be
    said about what kind of build it is. In `FAQ`, expect each answer to be
    read with the question it answers. In `LICENCE`, expect four summary lines
    announced as a list of four separate claims, then the Frontier notice
    announced in the language it is actually in — expect the reader to switch
    voice or pronunciation for it while the interface is in another language,
    and expect **no** sentence anywhere telling you what language it is in or
    where it came from.

    Expect exactly one control in the whole modal: its close. Expect three
    links and no more — the source in `ABOUT`, and the two licence documents in
    `LICENCE` — each announced by the words on screen and nothing else, and
    expect nothing else announced as leaving the application or as needing a
    network. Close it and expect to be returned to the control that opened it,
    with the capability beneath unchanged.

    The judgment this step exists for: whether a Commander who has only heard
    this modal comes away knowing what the application is, which versions they
    are running, that the game data is Frontier's, and where the terms and the
    source can be read. That is a question about meaning, and no snapshot of
    the accessibility tree can answer it.

18. **Drives & Mass.** Open a build and open the `DRIVES` mode of the anatomy
    region. Expect two regions, each announced by its own heading — thruster
    load and Frame Shift Drive — and expect each heading to carry the fitted
    module's own identity so a Commander knows which mount the figures below it
    belong to, without seeing them side by side.

    In the thruster card, expect the headline mass to be announced with its
    unit and with the load it was weighed at, and expect the position on the
    curve to be announced as a share of the module's optimal mass rather than
    as a bare percentage. Walk the three legend rows: expect each to be
    announced as a name, the canvas's qualifier and a figure with its unit —
    hull with the bulkhead, modules with how many are fitted, fuel with the
    bare word `Tank` and **no** capacity beside it. Expect the bar itself to be
    announced as nothing at all: every part of it is decoration, and its
    meaning is the three figures already read. Then the speed envelope: expect
    all five readings — top speed, boost, pitch, roll and yaw — each announced
    with its own unit, and expect metres per second and degrees per second to
    be distinguishable by what is said.

    Switch the thrusters off through the ledger's own power control and come
    back. Expect the envelope to be replaced by the package's own reasons,
    announced as a named list; expect the card to say the mount is switched off
    rather than absent; and expect **no** speed anywhere — a hull catalogue
    figure standing in here would be announced as an answer and is exactly what
    FR-005 forbids. Expect the curve marks and the drive card beside it to
    survive: what was lost is the build's mobility, not the module's stats.

    In the drive card, expect the three head cells — jump laden, jump unladen
    and mass lock — to be announced as label-and-value pairs, and expect the
    two jump figures to be recognisable as the ends of the three ranges read
    below them rather than as a separate answer. Expect each range row to be
    announced as its load and one figure in light years. Expect the legend
    under them to be announced as three more pairs — optimal mass, fuel per
    jump, total range with the jumps that tank makes. Where the drive is
    Overcharge-capable, expect the badge's meaning to be announced **once**, in
    words, and never as the three letters alone.

    Finally the status rail. Find the `JUMP`, `SPEED` and `MASS` cells: expect
    each to be announced with its unit, expect **no** control among them, and
    expect each to say the same figure the card in the `DRIVES` mode says. Two
    different numbers for one quantity, on one screen, both sounding like
    answers, is the failure FR-009 exists to prevent — and a reader hearing
    them minutes apart is the observation that catches it.

    The judgment this step exists for: whether a Commander who has only heard
    these two cards can say what their ship weighs, how fast it flies, how far
    it jumps, and which of those the application could not answer. Every figure
    here is a number with a unit, qualified by a load and an allocation set
    somewhere else, and whether that survives being spoken in sequence is a
    question no snapshot of the accessibility tree can answer.

19. **The equipment bench.** Open `/equipment` from the tool navigation with
    nothing saved. Expect the bench itself to be announced — every region
    present and named: the loadout, the item beside it, the Commander's stats
    and the material requirements where the width allows all four, and the tab
    strip naming the same regions where it does not.

    On the empty bench, expect the ledger to be walkable before any suit is
    chosen: the three groups — suit, weapons and suit tools — each announced
    with its own count, the suit row announced as empty and required first, and
    every mount announced as locked in words. Expect exactly one live choice in
    the whole screen: the four suits, under a heading that says it is the first
    step. Expect **no** grade ladder and **no** modification slot to be
    reachable at all — they are drawn as previews of controls that do not exist
    yet, and a reader that reaches them has been handed five radio buttons that
    answer nothing. Expect one link out, to the saved builds, announced by the
    words on screen.

    Choose a suit. Expect the bench to fill in: the stats to be announced as
    changed, once, politely, and the item column to become the suit. Expect the
    grade ladder to be announced as five choices with the current one selected,
    and expect changing it to change the figures audibly without the reader
    losing its place.

    Walk the mounts. Expect each to be announced with its mount name and what
    is in it, or as an empty mount, and expect a mount this suit does not have
    to say so **in words** — held, with the reason — rather than by being
    quieter than the others. Do the same in the modification slots: expect a
    slot the current grade cannot take to announce the grade it requires, and
    expect a fitted modification that changes no number to say that rather than
    to sound like it did nothing.

    Open a chooser. Expect the reader to be moved into it, its title to name
    what is being chosen and which mount or slot it is for, the fitted entry to
    be announced as fitted, and the content behind it unreachable. Dismiss it
    and expect to be returned to the control that opened it.

    In the stats, expect shield strength, regeneration and firepower to be
    announced as label-and-value pairs each with its unit, and the four
    resistances to be announced as a damage type and a figure. Expect the bars
    themselves to be announced as nothing at all: their meaning is the figures
    already read. In the material requirements, expect the total to be
    announced as types and units, expect the note about what the total covers
    to be read with it, and expect a loadout with no modifications to say there
    is nothing to gather rather than to present an empty list.

    At the narrow width, drill into a row from the tab strip. Expect the item
    view to be reached under the same tab the ledger was, expect a way back to
    be announced, and expect the tab strip never to claim a region that is not
    on screen.

    Then the two ways out. Open the export layer: expect the three formats to
    be announced as one named group of three choices, each with the sentence
    that describes it, expect the text itself to be reachable and readable, and
    expect copy and download to be announced by what they do. Finally, open an
    address carrying a loadout this build cannot read. Expect one assertive
    announcement saying the link was refused, and expect the bench beneath it
    to be announced as unchanged — not as empty, and not as something a
    Commander must now repair.

    The judgment this step exists for: whether a Commander who has only heard
    this bench can say what they are wearing, what they are carrying, what it
    cannot do, and what the next choice in front of them is. Half of this
    screen's meaning is which of two dozen small controls is live right now,
    and whether that survives being spoken one control at a time is a question
    no snapshot of the accessibility tree can answer.

20. **The tool bar's own controls.** From any screen inside a tool, find the
    mark on the leading edge of the bar. Expect it to be announced as a link
    named for where it goes — the entry point — rather than as an image, a
    graphic or nothing at all. Follow it and expect to land on the entry point.
    Find it again there and activate it: expect the screen not to be announced
    as changed and expect the reader not to be moved.

    Then the tools. Expect both to be announced as links, and the one whose
    screen is open to be announced as the current item as well: current is a
    state on a control here, not a substitute for one. Activate the current
    tool from a screen its re-entry does not lead to — a hull, or a build —
    and expect to land on that tool's own screen. Activate it again where its
    re-entry already stands and expect nothing: no navigation, no announcement,
    and no movement of the reader's place.

    On the bench, activate the equipment tool and expect the bench to be
    announced as empty with the suit gate standing, and expect **no** question
    to be asked about the loadout that was on it.

    The judgment this step exists for: whether a control that is deliberately
    silent reads as working or as broken. Two of the five activations above do
    nothing on purpose, and a Commander who hears nothing has to be able to
    tell that from a Commander who hears nothing because the control failed.

21. **A screen that is on its way.** With the connection throttled hard enough
    that a screen takes a second or two to arrive, ask for one from the entry
    point. Expect the reader to be moved into the statement that the
    application is waiting, expect that statement to be the sentence rather
    than a description of a graphic, and expect the mark beside it to be
    announced as nothing at all. Try to reach the screen behind it: expect
    nothing there to be reachable, and expect no control on the statement
    itself. When the screen arrives, expect the statement to be gone and the
    reader to be on the screen that opened.

    Then the failure. Ask for a screen whose code cannot be fetched — pull the
    connection at the moment of the press. Expect one polite announcement
    saying the screen could not be opened, arriving without cutting off what
    was being said, and expect the same words to be findable on the page
    afterwards and re-readable. Expect no reason to be stated, and expect the
    screen the Commander is on to be usable.

    Then the same failure again, with the connection still down: ask for a
    second screen, one whose code has not been fetched either. Expect a second
    polite announcement, in the same words as the first. This is the reading
    nothing automated can take. The words do not move between the two, so what
    is being confirmed is that the reader is told a second time at all.

    And the mark itself, in both engines with the platform's reduced-motion
    preference on: expect it to stand still. It carries its own animation
    inside its own drawing, which the page's rule cannot reach, so this is
    where the fix in that drawing is confirmed rather than assumed.

    The judgment this step exists for, and it is four. Whether a still mark on
    a subdued screen still reads as "the application is working" rather than as
    "the application has stopped". Whether the softened ground leaves enough of
    the screen behind visible to say which screen is being waited on — the
    automated reading can only say the ground is translucent, not that the step
    is right. And whether a Commander who has only heard this can tell a
    navigation that is still running from one that has failed — including two
    failures in a row, where the second says nothing new and the only thing
    separating them is that it is said.

22. **The same thing, twice.** Two readings of one contract, and the reason this
    step exists is that in both of them the second sentence is identical to the
    first. Nothing automated can judge whether hearing it again is an answer or
    a nuisance.

    First, narrowing. On the shipyard, choose Medium, then Small, then Large,
    then clear the filter. The three pad classes are in that order because each
    shows fewer hulls than the one before it, so each press is a narrowing
    rather than a move in whichever direction the Almanac happens to decide.
    Expect one polite announcement per press, each naming how many hulls are
    shown out of how many, arriving without cutting off what the reader was
    saying. Expect the fourth — the widening — to be announced too: a list
    growing back is news in the same way a list shrinking is.

    Then a refusal. In the import layer, paste a payload the Almanac refuses
    and press the action. Expect one polite announcement saying the payload was
    not imported, and expect the detail to be findable on the layer afterwards
    and re-readable at the reader's own pace. Press the action a second time
    without changing anything. Expect a second announcement, in the same words.

    The judgment this step exists for, and it is two. Whether the count read
    out on every press is help or chatter — a Commander stepping through four
    pad classes hears four sentences, and if that is a nuisance the message
    changes rather than the policy. And whether a Commander who pressed a
    refused action twice can tell, from speech alone, that the second press was
    received: the words do not move between the two, so what is being confirmed
    is that anything is said at all.

23. **The Commander account.** An account is optional, so start where a
    Commander starts: without one. Find the account entry on the banner row
    where there is room for it and inside the named action layer where there is
    not, and expect a button announced by the words it reads as. Activate it
    and expect one dialog announced by name, with the page behind it
    unreachable by heading, landmark or gesture.

    Walk it with no account. Expect the state to be announced in words —
    signed out — expect what an account would hold to be read as a named list
    **before** anything is signed in to rather than after, and expect the
    sentence saying which actions need a network to be read with it rather than
    left below the controls where a reader meets it only after choosing. Then
    activate the sign-in: expect to be told that this leaves the application,
    before it happens.

    Come back signed in. Expect the state to change audibly from signed out to
    signed in, expect the Commander's name to be announced as the account's own
    value rather than as a heading or as a bare string on its own, and expect
    nothing about the identity to depend on where it sits. Find the deletion
    control and activate it. Expect a second dialog announced by its own
    question, expect the reader to be moved into it, and expect what leaves the
    account and what stays in this browser to be announced as two separate
    statements rather than as one sentence a reader has to split. Expect the
    destructive answer and the way back to be told apart by what is said rather
    than by colour, emphasis or order. Answer **no** and expect to be returned
    to the account dialog and to the control that asked.

    Then the record the two copies disagree about. With one record saved here
    that the account no longer holds, open the saved builds. Expect the
    question announced as a layer of its own, expect the record it is about to
    be named inside it, and expect the three answers to be announced as three
    named controls rather than as two and a dismissal. Leave it without
    answering and expect nothing to have been decided — expect the record to be
    announced as still here, and as no longer being sent anywhere. Raise it
    again and answer it: expect one polite announcement of what became of that
    record, and expect the list beneath to be announced as changed once rather
    than read again from the top.

    Then the ships the Commander owns. Open the owned-ships view and expect the
    region announced by name. Expect each ship announced as one control
    carrying its model, the name the Commander gave it and its identification
    plate, and expect a ship with no name of its own to be announced by its
    model rather than by a gap. Expect the interval the journal was read over to
    be announced in words with the list rather than as a stray date beside it.
    Ask for a refresh: expect one polite announcement of the outcome; expect a
    refresh Frontier is holding to be announced as waiting rather than as
    failed; and expect a refresh that stopped to say that the ships on screen
    are the ones last accepted. In every one of those states expect the ships
    already accepted to stay announced, and expect **nothing** to be announced
    as current unless the service answered that it is.

    The judgment this step exists for: whether a Commander who has only heard
    these three layers can say whether they are signed in, what the account
    holds, which of two copies of a record they have just chosen, and how much
    of their fleet the application actually knows about. Three of those are
    statements about something that is not on the screen — a copy held
    somewhere else, an interval a journal was read over, a refresh that has not
    finished — and whether that survives being spoken one control at a time is
    a question no snapshot of the accessibility tree can answer.

## Recording the result

Append one row per configuration, orientation and step to
`results/screen-reader.md`, with the expected speech or behaviour, what was
actually announced, and pass or fail. A failure records the announcement
verbatim. Do not merge configurations into one row: what NVDA says and what
TalkBack says are different observations. Do not merge orientations either —
the shell folds and unfolds between them, so what a reader walks past to reach
the same control is a different screen, and on a desktop window a portrait run
means resizing it to a portrait aspect.
