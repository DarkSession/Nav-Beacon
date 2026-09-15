## MODIFIED Requirements

### Requirement: Starting an empty bench

The application MUST offer a way to start an empty bench while the bench is open. Starting
one MUST leave the bench in the state it holds before a suit is chosen, with the suit gate
standing and every region drawn and inert.

Starting an empty bench MUST clear the loadout's name, the saved record the loadout belongs
to, the undo and redo history, the loadout the address carries, and, where the loadout holds
a record, this tab's claim on it. It MUST NOT be confirmed: a loadout that holds a record
stays as that record, so there is nothing to lose and nothing to ask about. The record itself
MUST stay where it is, so a page built in this tab afterwards MUST open on an empty bench and
MUST NOT restore the loadout that was cleared. Starting an empty bench while the bench is
already empty MUST change nothing.

A loadout still at its suit's default — the loadout the bench holds when that suit is chosen
and nothing else is done — is in no record and MUST be cleared on the same terms, without
being confirmed and without being kept. It carries no choice a Commander made, and the same
suit at the same grade is reached again by choosing that suit, so there is nothing to lose
here either. The saved list MUST then hold no entry for it.

Where the loadout on the bench carries a choice and is in no record — the store refuses
writes, the store is full, a write failed, or autosave is paused because the record was
discarded elsewhere — the bench MUST stay as it is. Nothing keeps the loadout in those states,
so clearing the bench would lose work rather than cost nothing, and what the bench already
states about storing is the reason.

Source: 017/FR-006, 024/FR-002.

#### Scenario: A loadout is on the bench

- **WHEN** a Commander starts an empty bench while a loadout is on it
- **THEN** the bench holds no loadout and the suit gate stands
- **AND** the Commander is asked nothing

#### Scenario: The loadout that was on the bench

- **WHEN** a Commander starts an empty bench while a loadout that carries a choice is on it
- **THEN** the loadout that was on the bench is still listed as its record
- **AND** a named record it was opened from is unchanged

#### Scenario: A loadout at its suit's default is cleared

- **WHEN** a Commander starts an empty bench while the loadout on it is still at its suit's
  default
- **THEN** the bench holds no loadout and the Commander is asked nothing
- **AND** the saved list holds no entry for the loadout that was cleared

#### Scenario: The store cannot hold the loadout

- **WHEN** a Commander starts an empty bench while a loadout that carries a choice is on it
  and the store refuses writes, a write failed or autosave is paused
- **THEN** the loadout stays on the bench
- **AND** the bench still states what it says about storing

#### Scenario: The address after an empty bench is started

- **WHEN** a Commander starts an empty bench
- **THEN** the address carries no loadout

#### Scenario: The history after an empty bench is started

- **WHEN** a Commander starts an empty bench and then asks to undo
- **THEN** there is nothing to undo, because the choices before it belong to a loadout that
  is no longer on the bench

#### Scenario: The page is built again after an empty bench is started

- **WHEN** a Commander starts an empty bench and a page is built again in the same tab
- **THEN** the bench opens empty rather than restoring the loadout that was cleared
- **AND** the record that loadout was autosaved into, where it held one, is still listed

#### Scenario: The bench is already empty

- **WHEN** a Commander starts an empty bench while the bench holds no loadout
- **THEN** nothing changes and nothing is written
