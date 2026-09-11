## MODIFIED Requirements

### Requirement: Import and export run in the browser

SLEF import and export MUST run entirely in the browser and MUST transmit no SLEF payload. After an
import is accepted and browser persistence creates a build record, the separate
`platform/cross-device-records` capability MAY synchronise only that record for a signed-in
Commander. The remote record MUST NOT contain the SLEF document, import provenance or capture-only
fields.

Source: 004/FR-014, 004/SC-004, 020/FR-007, 020/FR-012.

#### Scenario: The largest hull is exchanged

- **WHEN** the package hull with the most slots, with every slot fitted and every supported modelled
  field populated, is imported and then exported
- **THEN** each operation completes within 500 ms as a domain operation in the `.devcontainer/`
  reference environment
- **AND** no network request is made by the import or export

#### Scenario: An accepted SLEF import becomes a synchronised record

- **WHEN** browser persistence stores an accepted imported build for a signed-in Commander
- **THEN** only the resulting record can enter the separate synchronisation request
- **AND** no SLEF document, import provenance or capture-only field enters that request
