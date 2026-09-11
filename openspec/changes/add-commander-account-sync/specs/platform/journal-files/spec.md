## MODIFIED Requirements

### Requirement: A Commander supplies journal files by selection or by drop

The application MUST accept journal files two ways: a file control the Commander opens, and a drop
target the Commander drags files onto. Both MUST take several files at once, and both MUST accept the
extensions the game writes and the extensions an exported payload carries: `.log`, `.json` and
`.txt`.

The drop target MUST state that it is one and MUST show that it has taken a drag before the drop.
The file control MUST be operable without a pointer and MUST carry its own label.

A file MUST be read in the browser. The scan MUST NOT send a file, a line, an event or an import
candidate to any origin. After the package accepts a candidate and browser persistence creates a
ship-build or equipment-loadout record, the separate `platform/cross-device-records` capability MAY
synchronise only that record for a signed-in Commander. The remote record MUST NOT contain journal
provenance, a source file name, a raw line or an event field outside its record contract.

Source: 016/FR-001, 020/FR-007, 020/FR-012.

#### Scenario: Files are selected

- **WHEN** a Commander opens the file control and selects three journal files
- **THEN** all three are scanned

#### Scenario: Files are dropped

- **WHEN** a Commander drags files over the drop target
- **THEN** the target states that it will take them
- **AND** dropping them scans the same way selecting them does

#### Scenario: Nothing leaves the device

- **WHEN** a Commander imports from journal files
- **THEN** the scan makes no network request

#### Scenario: Accepted imports become synchronised records

- **WHEN** browser persistence stores accepted imported ship-build and equipment-loadout records for
  a signed-in Commander
- **THEN** only the resulting records can enter the separate synchronisation request
- **AND** no source file, line, event or journal provenance enters that request
