import { type Type } from '@angular/core';
import {
  COMPONENT_STATES,
  type ComponentId,
  type ComponentState,
  type ComponentVariant,
  type UiComponentContract,
} from '../component-contract';

/**
 * The component preview manifest.
 *
 * Every exported `src/app/ui/` component has exactly one declaration here, and
 * every declaration accounts for all five required states — with a fixture, or
 * with a nonempty machine-readable reason the component's contract cannot
 * represent that state (FR-004).
 *
 * The N/A escape exists for contracts that genuinely cannot hold a state (a
 * static text equivalent has no loading state). It is not a way to skip a
 * fixture that is awkward to build, and the repository policy checker treats a
 * blank or missing rationale as a failure.
 *
 * This registry is imported by the tooling-only preview application and by the
 * policy checker. It is never referenced by a product route.
 */

/** One rendered state of one component. */
export interface PreviewStateDeclaration {
  readonly state: ComponentState;
  /**
   * Immutable presentation inputs for this state, or `null` when the state is
   * declared not applicable.
   *
   * Fixtures are presentation data. A fixture may query real package data, but
   * a copied mock value never becomes an application fact (constitution II).
   */
  readonly fixture: Readonly<Record<string, unknown>> | null;
  /** Required when `fixture` is `null`; forbidden otherwise. */
  readonly naReason: string | null;
  /** Cross-cutting conditions this state is additionally rendered under. */
  readonly variants: readonly ComponentVariant[];
  /** Named behaviours shared by the policy checker and the Playwright suite. */
  readonly expectations: readonly string[];
  /**
   * True when this state may only be rendered on its own.
   *
   * A modal layer makes everything behind it inert and removes it from the
   * accessibility tree — which is exactly what it is supposed to do, and
   * exactly why it cannot share a page with the rest of the catalogue. An
   * isolated state is reached by its own address instead, so the sweep still
   * scans it.
   */
  readonly isolated?: boolean;
  /**
   * Prose the stage puts around the component, for one that lives inside it.
   *
   * Most components are the whole of what they are. An inline link is not: it
   * is a few words in a sentence, and a stage that renders it alone is
   * previewing something the product never draws — a bare link in an empty box,
   * whose wrapping, baseline and SC 2.5.8 inline exception all read differently
   * from the real thing. Two strings, before and after, so the sentence the
   * catalogue scans is the shape the product ships.
   */
  readonly sentence?: readonly [string, string];
}

/** Everything the preview application needs to render one component. */
export interface PreviewDeclaration {
  readonly componentId: ComponentId;
  /** Human-readable group, used for catalogue navigation only. */
  readonly group: string;
  readonly contract: UiComponentContract;
  /** The component actually rendered — the production export, never a copy. */
  readonly component: Type<unknown>;
  readonly states: readonly PreviewStateDeclaration[];
}

/** A problem with a declaration, named precisely enough to fix. */
export interface PreviewManifestViolation {
  readonly componentId: ComponentId;
  readonly state: ComponentState | null;
  readonly reason: string;
}

const registry = new Map<ComponentId, PreviewDeclaration>();

/**
 * Registers one component's previews.
 *
 * Called at module load from the manifest's own imports, so registration cannot
 * drift from the exported component list without the checker noticing.
 */
export function registerPreview(declaration: PreviewDeclaration): void {
  if (registry.has(declaration.componentId)) {
    throw new Error(
      `Duplicate preview declaration for component "${declaration.componentId}". ` +
        'Each exported UI component has exactly one declaration.',
    );
  }
  registry.set(declaration.componentId, declaration);
}

/** Every registered declaration, in registration order. */
export function previewDeclarations(): readonly PreviewDeclaration[] {
  return [...registry.values()];
}

/** A stable address for one component state, used by the preview app and tests. */
export function previewAddress(componentId: ComponentId, state: ComponentState): string {
  return `${componentId}--${state}`;
}

/**
 * Validates every registered declaration against the manifest rules.
 *
 * Returns the violations rather than throwing, so the checker can report all of
 * them at once instead of one per run.
 */
export function validatePreviewManifest(
  declarations: readonly PreviewDeclaration[] = previewDeclarations(),
): readonly PreviewManifestViolation[] {
  const violations: PreviewManifestViolation[] = [];

  for (const declaration of declarations) {
    const declared = new Set(declaration.states.map((state) => state.state));

    for (const required of COMPONENT_STATES) {
      if (!declared.has(required)) {
        violations.push({
          componentId: declaration.componentId,
          state: required,
          reason: 'The state has neither a fixture nor an N/A rationale.',
        });
      }
    }

    if (declared.size !== declaration.states.length) {
      violations.push({
        componentId: declaration.componentId,
        state: null,
        reason: 'The same state is declared more than once.',
      });
    }

    for (const state of declaration.states) {
      const hasFixture = state.fixture !== null;
      const hasReason = typeof state.naReason === 'string' && state.naReason.trim().length > 0;

      if (!hasFixture && !hasReason) {
        violations.push({
          componentId: declaration.componentId,
          state: state.state,
          reason: 'A state declared not applicable needs a nonempty rationale.',
        });
      }

      if (hasFixture && state.naReason !== null) {
        violations.push({
          componentId: declaration.componentId,
          state: state.state,
          reason: 'A state cannot have both a fixture and an N/A rationale.',
        });
      }

      if (hasFixture && state.expectations.length === 0) {
        violations.push({
          componentId: declaration.componentId,
          state: state.state,
          reason: 'A rendered state declares at least one named expectation.',
        });
      }
    }
  }

  return violations;
}

// ---------------------------------------------------------------------------
// Declarations
//
// One per exported `src/app/ui/` component. Every required state is accounted
// for: with a fixture, or with a machine-readable reason the component's
// contract cannot represent it.
//
// The N/A rationales below are about contracts, not convenience. A link has no
// busy state because navigation is the platform's, not the component's; a
// metric group has no error state because an absent value is an *unavailable*
// value, which is a different thing it renders honestly rather than an error it
// reports.
// ---------------------------------------------------------------------------

import { BUNDLED_ENGLISH, type MessageKey } from '../../i18n/locale-registry';
import { AnnouncementOutlet } from '../announcements/announcement-outlet';
import { ActionButton } from '../components/action/action-button';
import { ResponsiveCatalogueView } from '../components/catalogue-view/responsive-catalogue-view';
import { ChoiceDialog } from '../components/choice-dialog/choice-dialog';
import { CollectionToolbar } from '../components/collection-toolbar/collection-toolbar';
import { ConfirmDialog } from '../components/confirm-dialog/confirm-dialog';
import { RecordManager } from '../components/record-manager/record-manager';
import { ResponsiveRecordList } from '../components/record-list/responsive-record-list';
import { SavedBuildCard } from '../components/saved-build-card/saved-build-card';
import { ShareLinkPanel } from '../components/share-link-panel/share-link-panel';
import { FactList } from '../components/fact-list/fact-list';
import { HullArtwork } from '../components/hull-artwork/hull-artwork';
import { HullSchematic } from '../outfitting/hull-schematic';
import { HullSummaryCard } from '../components/hull-summary-card/hull-summary-card';
import { ActionLink } from '../components/action/action-link';
import { ActionLayer } from '../components/app-frame/action-layer';
import { AppFrame } from '../components/app-frame/app-frame';
import { ChoiceGroup } from '../components/choice-group/choice-group';
import { Collection } from '../components/collection/collection';
import { Disclosure } from '../components/disclosure/disclosure';
import { FileDrop } from '../components/file-drop/file-drop';
import { Tooltip } from '../components/tooltip/tooltip';
import { GameText } from '../components/game-text/game-text';
import { Layer } from '../components/layer/layer';
import { MetricGroup } from '../components/metric-group/metric-group';
import { Panel } from '../components/panel/panel';
import { RangeField } from '../components/range-field/range-field';
import { SelectField } from '../components/select-field/select-field';
import { StatusNotice } from '../components/status/status-notice';
import { DataTable } from '../components/table/data-table';
import { TabGroup } from '../components/tab-group/tab-group';
import { TextField } from '../components/text-field/text-field';
import { TextareaField } from '../components/textarea-field/textarea-field';
import { UnavailableValue } from '../components/unavailable-value/unavailable-value';
import { WaitingOverlay } from '../components/waiting-overlay/waiting-overlay';
import { candidateMembership } from '../../application/outfitting/candidate-membership';
import {
  applyQuery,
  groupFamilies,
  openCandidateQuery,
  type CandidateFamilyView,
} from '../../application/outfitting/candidate-query';
import {
  FIXTURE_SLOTS,
  defaultBuild,
  packageText,
} from '../../domain/ships/outfitting/outfitting.fixtures';
import { AcquisitionBadge } from '../outfitting/acquisition-badge';
import { AttributeComparison } from '../outfitting/attribute-comparison';
import { BlueprintChoiceList } from '../outfitting/blueprint-choice-list';
import { ExperimentalEffectList } from '../outfitting/experimental-effect-list';
import { FixedExperimentalEffect } from '../outfitting/fixed-experimental-effect';
import { GradeSelector } from '../outfitting/grade-selector';
import { IngressRefusalNotice } from '../outfitting/ingress-refusal-notice';
import { PowerControls } from '../outfitting/power-controls';
import { CandidateList } from '../outfitting/candidate-list';
import { ChoiceList } from '../equipment/choice-list';
import { ResistanceBar } from '../equipment/resistance-bar';
import { CandidateSearch } from '../outfitting/candidate-search';
import { EditRefusalNotice } from '../outfitting/edit-refusal-notice';
import { ModuleIdentityBadge } from '../outfitting/module-identity-badge';
import { OutfittingNotice } from '../outfitting/outfitting-notice';
import { SlotCard } from '../outfitting/slot-card';
import { SlotGroup } from '../outfitting/slot-group';
import { ShipIdentityFields } from '../outfitting/ship-identity-fields';
import { UnavailableFact } from '../outfitting/unavailable-fact';
import { DiagnosticList } from '../technical/diagnostic-list';
import { InlineLink } from '../components/inline-link/inline-link';
import { HelpDialog } from '../../features/help/help-dialog.component';
import { SaveBuildDialog } from '../../features/build-workspace/save-build.dialog';
import { HELP_MANIFEST } from '../../platform/build/help-manifest.generated';
import { HELP_TOPICS } from '../../platform/build/help-topics.generated';
import { LegalExcerpt } from '../components/legal-excerpt/legal-excerpt';
import { ToolCard } from '../components/tool-card/tool-card';
import { VersionFacts } from '../components/version-facts/version-facts';
import { ExportBuildLayer } from '../../features/slef/export-build-layer/export-build-layer';
import { JournalImportLayer } from '../../features/shared/journal-import-layer/journal-import-layer';

/** A state rendered from a fixture. */
function state(
  name: ComponentState,
  fixture: Readonly<Record<string, unknown>>,
  expectations: readonly string[],
  variants: readonly ComponentVariant[] = ['normal'],
  isolated = false,
  sentence?: readonly [string, string],
): PreviewStateDeclaration {
  return { state: name, fixture, naReason: null, variants, expectations, isolated, sentence };
}

/** A state this component's contract cannot represent, and why. */
function notApplicable(name: ComponentState, reason: string): PreviewStateDeclaration {
  return { state: name, fixture: null, naReason: reason, variants: [], expectations: [] };
}

/**
 * The cross-cutting conditions every control is rendered under.
 *
 * `reduced-motion` is on the list for components that do not animate as well as
 * for those that do, because the assertion it carries is that *nothing* changes
 * when motion is removed — which is only evidence if it is checked where a
 * regression could introduce motion, not only where motion already exists.
 */
const CONTROL_VARIANTS: readonly ComponentVariant[] = [
  'normal',
  'expanded-copy',
  'rtl',
  'reduced-motion',
  'long-identity',
];

function contract(
  componentId: string,
  semantics: UiComponentContract['semantics'],
  states: readonly ComponentState[],
  variants: readonly ComponentVariant[] = CONTROL_VARIANTS,
): UiComponentContract {
  return { componentId, semantics, states, variants };
}

registerPreview({
  componentId: 'action-button',
  group: 'Actions',
  component: ActionButton,
  contract: contract(
    'action-button',
    {
      role: 'button',
      visibleNameMatchesAccessibleName: true,
      exposedStates: ['pressed', 'busy', 'disabled'],
      relationships: [],
      textEquivalents: ['pressed state', 'busy state'],
    },
    ['default', 'loading', 'disabled'],
  ),
  states: [
    state('default', { label: 'Save build', emphasis: 'primary' }, [
      'visible name equals accessible name',
      'meets the target-size baseline',
    ]),
    notApplicable(
      'empty',
      'A button always carries a visible label; a button with no name is a defect, not a state.',
    ),
    state('loading', { label: 'Save build', busy: true, busyLabel: 'Working' }, [
      'exposes aria-busy',
      'keeps its label while busy',
    ]),
    notApplicable(
      'error',
      'A button reports no error of its own. An error belongs to the field or the operation it acts on.',
    ),
    state('disabled', { label: 'Save build', disabled: true }, [
      'exposes the disabled state natively',
      'remains readable at the audited contrast floor',
    ]),
  ],
});

registerPreview({
  componentId: 'action-link',
  group: 'Actions',
  component: ActionLink,
  contract: contract(
    'action-link',
    {
      role: 'link',
      visibleNameMatchesAccessibleName: true,
      exposedStates: ['disabled'],
      relationships: [],
      textEquivalents: ['external destination'],
    },
    ['default', 'disabled'],
  ),
  states: [
    state(
      'default',
      { label: 'Licences', href: '/licences' },
      ['visible name equals accessible name', 'is underlined, not identified by colour alone'],
      CONTROL_VARIANTS,
    ),
    notApplicable('empty', 'A link always carries a visible label and a destination.'),
    notApplicable(
      'loading',
      'Navigation belongs to the platform, so the link has no busy state of its own.',
    ),
    notApplicable('error', 'A link reports no error; a failed navigation is the route’s state.'),
    state('disabled', { label: 'Licences', href: '/licences', disabled: true }, [
      'exposes aria-disabled',
    ]),
  ],
});

registerPreview({
  componentId: 'text-field',
  group: 'Fields',
  component: TextField,
  contract: contract(
    'text-field',
    {
      role: 'textbox',
      visibleNameMatchesAccessibleName: true,
      exposedStates: ['invalid', 'busy', 'disabled'],
      relationships: ['label', 'description', 'error'],
      textEquivalents: ['invalid state'],
    },
    ['default', 'empty', 'loading', 'error', 'disabled'],
  ),
  states: [
    state(
      'default',
      { label: 'Build name', value: 'Anaconda explorer', description: 'Shown in saved builds.' },
      ['label is programmatically associated', 'description is associated by aria-describedby'],
      ['normal', 'expanded-copy', 'rtl', 'reduced-motion', 'nested-relationships'],
    ),
    state('empty', { label: 'Build name', value: '' }, [
      'renders with no value and keeps its label',
    ]),
    state('loading', { label: 'Build name', value: '', busy: true }, ['exposes aria-busy']),
    state(
      'error',
      { label: 'Build name', value: '', error: 'Enter a name for this build.' },
      ['exposes aria-invalid', 'error text is associated with the control'],
      ['normal', 'expanded-copy', 'rtl', 'reduced-motion', 'nested-relationships'],
    ),
    state('disabled', { label: 'Build name', value: 'Anaconda explorer', disabled: true }, [
      'exposes the disabled state natively',
    ]),
  ],
});

registerPreview({
  componentId: 'select-field',
  group: 'Fields',
  component: SelectField,
  contract: contract(
    'select-field',
    {
      role: 'combobox',
      visibleNameMatchesAccessibleName: true,
      exposedStates: ['invalid', 'busy', 'disabled'],
      relationships: ['label', 'description', 'error'],
      textEquivalents: ['invalid state'],
    },
    ['default', 'empty', 'loading', 'error', 'disabled'],
  ),
  states: [
    state(
      'default',
      {
        label: 'Language',
        value: 'en',
        options: [
          { value: 'en', label: 'English' },
          { value: 'de', label: 'Deutsch' },
        ],
      },
      ['label is programmatically associated', 'the selected option is exposed'],
      ['normal', 'expanded-copy', 'rtl', 'german-format'],
    ),
    state('empty', { label: 'Language', options: [] }, [
      'renders with no options and keeps its label',
    ]),
    state(
      'loading',
      { label: 'Language', options: [{ value: 'en', label: 'English' }], busy: true },
      ['exposes aria-busy'],
    ),
    state(
      'error',
      {
        label: 'Language',
        options: [{ value: 'en', label: 'English' }],
        error: 'Choose a language.',
      },
      ['exposes aria-invalid', 'error text is associated with the control'],
    ),
    state(
      'disabled',
      { label: 'Language', options: [{ value: 'en', label: 'English' }], disabled: true },
      ['exposes the disabled state natively'],
    ),
  ],
});

registerPreview({
  componentId: 'range-field',
  group: 'Fields',
  component: RangeField,
  contract: contract(
    'range-field',
    {
      role: 'slider',
      visibleNameMatchesAccessibleName: true,
      exposedStates: ['disabled'],
      relationships: ['label', 'description'],
      textEquivalents: ['value'],
    },
    ['default', 'empty', 'disabled'],
  ),
  states: [
    state(
      'default',
      {
        label: 'Target range',
        min: 100,
        max: 2000,
        step: 25,
        value: 600,
        valueText: '600 m',
        minText: '100 m',
        maxText: '2,000 m',
        description: 'The range the gunsight is drawn at.',
      },
      [
        'label is programmatically associated',
        'the formatted value is announced as well as drawn',
        'the printed ends of the scale are decorative, because the slider states its own bounds',
        'description is associated with the control',
        'the whole track is at least the shared target size',
      ],
      ['normal', 'expanded-copy', 'rtl', 'german-format'],
    ),
    state(
      'empty',
      { label: 'Target range', min: 100, max: 2000, step: 25, value: 100, valueText: '100 m' },
      [
        'keeps its label with no scale ends and no description',
        'a value at the minimum still reads as a value, not as an empty control',
      ],
    ),
    state(
      'disabled',
      {
        label: 'Target range',
        min: 100,
        max: 2000,
        step: 25,
        value: 600,
        valueText: '600 m',
        disabled: true,
      },
      ['exposes the disabled state natively'],
    ),
    notApplicable(
      'loading',
      'A slider has nothing to fetch: its bounds and its value are given to it, and a range with no value yet is a range with no reason to be on the screen.',
    ),
    notApplicable(
      'error',
      'Every value between the two bounds is a valid one, and the control cannot be moved outside them, so there is no invalid state to report.',
    ),
  ],
});

registerPreview({
  componentId: 'textarea-field',
  group: 'Fields',
  component: TextareaField,
  contract: contract(
    'textarea-field',
    {
      role: 'textbox',
      visibleNameMatchesAccessibleName: true,
      exposedStates: ['invalid', 'busy', 'disabled'],
      relationships: ['label', 'description', 'error'],
      textEquivalents: ['invalid state'],
    },
    ['default', 'empty', 'loading', 'error', 'disabled'],
  ),
  states: [
    state(
      'default',
      {
        label: 'SLEF payload',
        value: '[\n  {\n    "header": { "appName": "EDNB", "appVersion": "0.1.0" }\n  }\n]',
        description: '1 entry · 41 modules · 4.1 kB',
        technical: true,
        readonly: true,
      },
      [
        'label is programmatically associated',
        'stays resizable so 200% text does not clip',
        'a readonly payload is still selectable and still a labelled control',
        'monospaced payload text is direction-isolated',
        'byte and entry metadata is associated with the control, not only drawn beside it',
      ],
      ['normal', 'expanded-copy', 'rtl', 'reduced-motion', 'long-identity'],
    ),
    state(
      'empty',
      {
        label: 'SLEF payload',
        value: '',
        description: '0 of 65,536 bytes used',
        technical: true,
      },
      ['renders empty and keeps its label', 'an editable payload field owns its own overflow'],
    ),
    state('loading', { label: 'SLEF payload', value: '', busy: true }, ['exposes aria-busy']),
    state(
      'error',
      {
        label: 'SLEF payload',
        value: '{',
        technical: true,
        error: 'This draft is 70,001 bytes; the limit is 65,536.',
      },
      ['exposes aria-invalid', 'error text is associated with the control'],
    ),
    state('disabled', { label: 'SLEF payload', value: '', disabled: true }, [
      'exposes the disabled state natively',
    ]),
  ],
});

registerPreview({
  componentId: 'choice-group',
  group: 'Fields',
  component: ChoiceGroup,
  contract: contract(
    'choice-group',
    {
      role: 'group',
      visibleNameMatchesAccessibleName: true,
      exposedStates: ['checked', 'invalid', 'disabled'],
      relationships: ['label', 'description', 'error'],
      textEquivalents: ['checked state'],
    },
    ['default', 'empty', 'error', 'disabled'],
  ),
  states: [
    state(
      'default',
      {
        legend: 'Measured under',
        kind: 'radio',
        selected: ['laden'],
        choices: [
          { value: 'laden', label: 'Laden' },
          { value: 'unladen', label: 'Unladen', description: 'No cargo and no fuel.' },
        ],
      },
      [
        'the legend names what the group asks',
        'each choice label is associated with its control',
        'a choice description is associated by aria-describedby',
      ],
      ['normal', 'expanded-copy', 'rtl', 'reduced-motion', 'nested-relationships'],
    ),
    state('empty', { legend: 'Measured under', choices: [] }, [
      'renders with no choices and keeps its legend',
    ]),
    notApplicable(
      'loading',
      'The group renders the choices it is given. Loading belongs to whatever supplies them.',
    ),
    state(
      'error',
      {
        legend: 'Measured under',
        choices: [{ value: 'laden', label: 'Laden' }],
        error: 'Choose a measurement condition.',
      },
      ['exposes aria-invalid on the group', 'error text is associated with the group'],
    ),
    state(
      'disabled',
      { legend: 'Measured under', choices: [{ value: 'laden', label: 'Laden' }], disabled: true },
      ['the fieldset disables every choice at once'],
    ),
  ],
});

registerPreview({
  componentId: 'tab-group',
  group: 'Navigation',
  component: TabGroup,
  contract: contract(
    'tab-group',
    {
      role: 'tablist',
      visibleNameMatchesAccessibleName: true,
      exposedStates: ['selected', 'disabled'],
      relationships: [],
      textEquivalents: ['selected state'],
    },
    ['default', 'empty', 'disabled'],
  ),
  states: [
    state(
      'default',
      {
        label: 'Build sections',
        selectedId: 'power',
        selectedLabel: 'Selected',
        tabs: [
          { id: 'power', label: 'Power' },
          { id: 'defence', label: 'Defence' },
          { id: 'mobility', label: 'Mobility' },
        ],
      },
      [
        'the selected tab exposes aria-selected',
        'the selected state has visible text, not only a colour and a border',
        'a narrow container scrolls the strip instead of the document',
      ],
      ['normal', 'expanded-copy', 'rtl', 'reduced-motion', 'long-identity'],
    ),
    state('empty', { label: 'Build sections', selectedId: '', tabs: [] }, [
      'renders with no tabs and keeps its accessible name',
    ]),
    notApplicable(
      'loading',
      'Tabs render the set they are given; loading belongs to the panel each tab controls.',
    ),
    notApplicable('error', 'A tab strip reports no error; the panel it controls does.'),
    state(
      'disabled',
      {
        label: 'Build sections',
        selectedId: 'power',
        tabs: [{ id: 'power', label: 'Power' }],
        disabled: true,
      },
      ['every tab exposes the disabled state'],
    ),
  ],
});

/**
 * The same component in its other presentation, which is the only one the
 * product uses: canvas 1c's segmented strip, drawn by the anatomy's mode strip
 * and by its `TOP`/`BOTTOM` side selector alike.
 *
 * A second registration rather than a second state, because a preview state
 * name comes from a closed vocabulary and "segmented" is not a state — it is a
 * different control, with a different role, a different selected attribute and
 * a different target floor. Registering it is what puts the filled segment, the
 * dense height and the disabled-is-never-filled rule under the catalogue's own
 * contrast and expansion sweep.
 */
registerPreview({
  componentId: 'tab-group-segmented',
  group: 'Navigation',
  component: TabGroup,
  contract: contract(
    'tab-group-segmented',
    {
      role: 'group',
      visibleNameMatchesAccessibleName: true,
      exposedStates: ['pressed', 'disabled'],
      relationships: [],
      textEquivalents: ['selected state'],
    },
    ['default', 'empty', 'disabled'],
  ),
  states: [
    state(
      'default',
      {
        label: 'Anatomy view',
        presentation: 'segmented',
        selectedId: 'mounts',
        selectedLabel: 'Selected',
        tabs: [
          { id: 'mounts', label: 'Mounts' },
          { id: 'power', label: 'Power', disabled: true },
          { id: 'drives', label: 'Drives', disabled: true },
        ],
      },
      [
        'the chosen segment exposes aria-pressed rather than aria-selected',
        'the chosen segment is filled and says so in text as well',
        'a segment nobody can reach is never the filled one',
      ],
    ),
    state('empty', { label: 'Anatomy view', presentation: 'segmented', selectedId: '', tabs: [] }, [
      'renders with no segments and keeps its accessible name',
    ]),
    notApplicable(
      'loading',
      'A strip renders the set it is given; loading belongs to what the choice filters.',
    ),
    notApplicable('error', 'A strip reports no error; what it filters does.'),
    state(
      'disabled',
      {
        label: 'Anatomy view',
        presentation: 'segmented',
        selectedId: 'mounts',
        tabs: [{ id: 'mounts', label: 'Mounts' }],
        disabled: true,
      },
      ['every segment exposes the disabled state, and none is filled'],
    ),
  ],
});

registerPreview({
  componentId: 'panel',
  group: 'Containers',
  component: Panel,
  contract: contract(
    'panel',
    {
      role: 'region',
      visibleNameMatchesAccessibleName: true,
      exposedStates: [],
      relationships: ['label', 'description'],
      textEquivalents: [],
    },
    ['default', 'empty'],
  ),
  states: [
    state(
      'default',
      { heading: 'Power and heat', description: 'Draw against the plant’s output.' },
      ['the region is named by its visible heading', 'the description is associated'],
      ['normal', 'expanded-copy', 'rtl', 'reduced-motion'],
    ),
    state('empty', { heading: 'Power and heat' }, [
      'renders with no body content and stays a named region',
    ]),
    notApplicable('loading', 'The panel is a container; its content owns any loading state.'),
    notApplicable('error', 'The panel is a container; its content owns any error state.'),
    notApplicable('disabled', 'A region is not interactive, so it cannot be disabled.'),
  ],
});

registerPreview({
  componentId: 'collection',
  group: 'Containers',
  component: Collection,
  contract: contract(
    'collection',
    {
      role: 'list',
      visibleNameMatchesAccessibleName: true,
      exposedStates: ['current', 'disabled'],
      relationships: ['description'],
      textEquivalents: ['selected state'],
    },
    ['default', 'empty', 'disabled'],
  ),
  states: [
    state(
      'default',
      {
        label: 'Saved builds',
        selectedLabel: 'Selected',
        items: [
          {
            id: 'a',
            label: 'Anaconda explorer',
            detail: 'Exploration',
            activatable: true,
            selected: true,
          },
          { id: 'b', label: 'Krait combat', detail: 'Combat', activatable: true },
        ],
      },
      [
        'a semantic list states how many items there are',
        'the selected item exposes aria-current and names the state in text',
        'an item’s own controls sit beside its activation target, not inside it',
      ],
      ['normal', 'expanded-copy', 'rtl', 'reduced-motion', 'long-identity'],
    ),
    state('empty', { label: 'Saved builds', items: [], emptyLabel: 'No saved builds yet.' }, [
      'states the empty condition in text rather than rendering nothing',
    ]),
    notApplicable(
      'loading',
      'The collection renders the items it is given; loading belongs to the source.',
    ),
    notApplicable(
      'error',
      'The collection reports no error; the source that failed to supply items does.',
    ),
    state(
      'disabled',
      {
        label: 'Saved builds',
        items: [{ id: 'a', label: 'Anaconda explorer', activatable: true, disabled: true }],
      },
      ['a disabled item exposes the state natively'],
    ),
  ],
});

registerPreview({
  componentId: 'data-table',
  group: 'Containers',
  component: DataTable,
  contract: contract(
    'data-table',
    {
      role: 'table',
      visibleNameMatchesAccessibleName: true,
      exposedStates: ['selected'],
      relationships: ['label', 'unit'],
      textEquivalents: ['selected row state'],
    },
    ['default', 'empty'],
  ),
  states: [
    state(
      'default',
      {
        caption: 'Power draw by module',
        columns: [
          { key: 'module', label: 'Module', rowHeader: true },
          { key: 'draw', label: 'Draw', unit: 'MW', numeric: true },
        ],
        rows: [
          { id: '1', cells: { module: 'Power Plant', draw: '12.4' } },
          { id: '2', cells: { module: 'Thrusters', draw: '5.2' } },
        ],
      },
      [
        'a caption names the table',
        'header cells scope to their column and row so a value is heard with its label',
        'the unit is announced with every value in the column',
        'wide content scrolls inside the table’s own labelled region',
      ],
      ['normal', 'expanded-copy', 'rtl', 'german-format', 'long-identity'],
    ),
    state(
      'empty',
      {
        caption: 'Power draw by module',
        columns: [{ key: 'module', label: 'Module', rowHeader: true }],
        rows: [],
        emptyLabel: 'No modules are fitted.',
      },
      ['states the empty condition in text'],
    ),
    notApplicable(
      'loading',
      'The table renders the rows it is given; loading belongs to the source.',
    ),
    notApplicable(
      'error',
      'The table reports no error; the source that failed to supply rows does.',
    ),
    notApplicable('disabled', 'A table is not interactive, so it cannot be disabled.'),
  ],
});

registerPreview({
  componentId: 'metric-group',
  group: 'Values',
  component: MetricGroup,
  contract: contract(
    'metric-group',
    {
      role: 'group',
      visibleNameMatchesAccessibleName: true,
      exposedStates: [],
      relationships: ['label', 'description', 'unit', 'viewing-condition'],
      textEquivalents: ['unavailable value'],
    },
    ['default', 'empty'],
  ),
  states: [
    state(
      'default',
      {
        label: 'Jump summary',
        metrics: [
          {
            id: 'range',
            label: 'Jump range',
            value: '20.45',
            unit: 'ly',
            condition: 'Laden',
            description: 'Maximum single jump with a full tank.',
          },
          {
            id: 'total',
            label: 'Total range',
            value: null,
            unavailableLabel: 'Unavailable',
          },
        ],
      },
      [
        'each value is related to its unit and measurement condition',
        'an unavailable value is stated, never rendered as a zero',
        'numeric values are bidi-isolated so a right-to-left context cannot reorder them',
      ],
      ['normal', 'expanded-copy', 'rtl', 'german-format', 'unavailable-text'],
    ),
    state('empty', { label: 'Jump summary', metrics: [], emptyLabel: 'Nothing to show.' }, [
      'states the empty condition in text',
    ]),
    notApplicable(
      'loading',
      'Metrics render the values they are given; loading belongs to the source.',
    ),
    notApplicable(
      'error',
      'An absent value is an unavailable value, which this component renders honestly. It is not an error the group reports.',
    ),
    notApplicable('disabled', 'A description list is not interactive, so it cannot be disabled.'),
  ],
});

registerPreview({
  componentId: 'status-notice',
  group: 'Feedback',
  component: StatusNotice,
  contract: contract(
    'status-notice',
    {
      role: 'status',
      visibleNameMatchesAccessibleName: true,
      exposedStates: [],
      relationships: ['description'],
      textEquivalents: ['tone'],
    },
    ['default', 'loading', 'error'],
  ),
  states: [
    state(
      'default',
      { tone: 'info', message: 'This build has not been saved.' },
      ['the tone is named in text, so colour is never the only signal'],
      ['normal', 'expanded-copy', 'rtl', 'reduced-motion'],
    ),
    notApplicable('empty', 'A notice with no message is not rendered at all.'),
    state('loading', { tone: 'loading', message: 'Loading language' }, [
      'the loading tone is named in text',
    ]),
    state(
      'error',
      {
        tone: 'error',
        message: 'Power draw exceeds the plant’s output.',
        detail: 'Reduce draw or fit a larger plant.',
      },
      ['exposes an alert role', 'the detail is associated with the notice'],
      ['normal', 'expanded-copy', 'rtl', 'reduced-motion'],
    ),
    notApplicable('disabled', 'A notice is not interactive, so it cannot be disabled.'),
  ],
});

registerPreview({
  componentId: 'unavailable-value',
  group: 'Values',
  component: UnavailableValue,
  contract: contract(
    'unavailable-value',
    {
      role: 'text',
      visibleNameMatchesAccessibleName: true,
      exposedStates: [],
      relationships: ['unavailable-reason'],
      textEquivalents: ['absence of a value'],
    },
    ['default'],
  ),
  states: [
    state(
      'default',
      {
        kind: 'unavailable',
        label: 'Total range',
        reason: 'No value is available for this.',
      },
      [
        'the absence is stated in words rather than as a zero or a dash',
        'the reason is programmatically associated',
      ],
      ['normal', 'expanded-copy', 'rtl', 'unavailable-text'],
    ),
    notApplicable('empty', 'This component *is* the empty state of a value.'),
    notApplicable('loading', 'An unavailable value is settled, not pending.'),
    notApplicable(
      'error',
      'An unavailable value is not an error: the Almanac has no value to give, which is a fact rather than a failure.',
    ),
    notApplicable('disabled', 'Static text is not interactive, so it cannot be disabled.'),
  ],
});

registerPreview({
  componentId: 'disclosure',
  group: 'Containers',
  component: Disclosure,
  contract: contract(
    'disclosure',
    {
      role: 'button',
      visibleNameMatchesAccessibleName: true,
      exposedStates: ['expanded', 'disabled'],
      relationships: ['label'],
      textEquivalents: ['expanded state'],
    },
    ['default', 'empty', 'disabled'],
  ),
  states: [
    state(
      'default',
      { label: 'Why is this unavailable?', expanded: true, stateLabel: 'Showing' },
      [
        'exposes aria-expanded and controls its content',
        'is a persistent alternative to a hover tooltip, reachable by tap',
      ],
      ['normal', 'expanded-copy', 'rtl', 'reduced-motion'],
    ),
    state('empty', { label: 'Why is this unavailable?', expanded: false }, [
      'collapsed content is hidden from the accessibility tree, not merely invisible',
    ]),
    notApplicable(
      'loading',
      'The disclosure shows content it is given; loading belongs to that content.',
    ),
    notApplicable('error', 'The disclosure reports no error of its own.'),
    state('disabled', { label: 'Why is this unavailable?', disabled: true }, [
      'exposes the disabled state natively',
    ]),
  ],
});

registerPreview({
  componentId: 'tooltip',
  group: 'Containers',
  component: Tooltip,
  contract: contract(
    'tooltip',
    {
      role: 'button',
      visibleNameMatchesAccessibleName: true,
      exposedStates: ['expanded'],
      relationships: ['description'],
      textEquivalents: ['the gloss the trigger stands for'],
    },
    ['default', 'empty'],
  ),
  states: [
    state(
      'default',
      { label: 'Idle', tip: 'Hardpoints stowed, no throttle', open: true },
      [
        'the gloss is drawn beside the word it explains',
        'the drawn state is exposed as aria-expanded rather than by visibility alone',
      ],
      ['normal', 'expanded-copy', 'rtl', 'reduced-motion', 'long-identity'],
    ),
    state(
      'empty',
      { label: 'Idle', tip: 'Hardpoints stowed, no throttle' },
      [
        'an undrawn gloss is still related to its trigger by aria-describedby',
        'the gloss is reachable by press as well as by hover, so touch is not left out',
      ],
      ['normal', 'rtl'],
    ),
    notApplicable('loading', 'A gloss is text the component is handed; it never waits for one.'),
    notApplicable('error', 'A tooltip reports no error of its own.'),
    notApplicable(
      'disabled',
      'The gloss is available whether or not it is drawn, so there is nothing a disabled state could withhold.',
    ),
  ],
});

registerPreview({
  componentId: 'layer',
  group: 'Layers',
  component: Layer,
  contract: contract(
    'layer',
    {
      role: 'dialog',
      visibleNameMatchesAccessibleName: true,
      exposedStates: ['expanded'],
      relationships: ['label', 'description'],
      textEquivalents: [],
    },
    ['default', 'empty'],
  ),
  states: [
    state(
      'default',
      {
        title: 'Import a build',
        description: 'Paste a SLEF payload to load it.',
        dismissLabel: 'Close',
        open: true,
        presentation: 'dialog',
      },
      [
        'has a visible title associated with the layer',
        'background content is inert and absent from the accessibility tree',
        'dismissal restores the invoking control',
      ],
      ['normal', 'expanded-copy', 'rtl', 'reduced-motion'],
      // Isolated: an open modal makes everything behind it inert, which is
      // correct behaviour and incompatible with sharing a catalogue page.
      true,
    ),
    state(
      'empty',
      { title: 'Import a build', dismissLabel: 'Close', open: false, presentation: 'dialog' },
      ['a closed layer renders nothing and holds no focus'],
    ),
    notApplicable('loading', 'The layer is a container; its content owns any loading state.'),
    notApplicable('error', 'The layer is a container; its content owns any error state.'),
    notApplicable('disabled', 'A layer is either open or closed; it has no disabled state.'),
  ],
});

registerPreview({
  componentId: 'waiting-overlay',
  group: 'Layers',
  component: WaitingOverlay,
  contract: contract(
    'waiting-overlay',
    {
      role: 'dialog',
      // Nothing here is a control, so there is no visible name to match. What
      // names the statement is the sentence it carries for a reader, which is
      // also the text equivalent of the mark.
      visibleNameMatchesAccessibleName: false,
      exposedStates: [],
      relationships: ['label'],
      textEquivalents: ['the application is waiting'],
    },
    ['default', 'empty'],
  ),
  states: [
    state(
      'default',
      { open: true, text: BUNDLED_ENGLISH['navigation.waiting.notice'] },
      [
        'the mark stands over the whole viewport on a translucent ground',
        'the screen behind is inert and absent from the accessibility tree',
        'the sentence names the statement; the mark is exposed as decoration',
        'it carries no control, and states no proportion, percentage or remaining time',
      ],
      ['normal', 'expanded-copy', 'rtl', 'reduced-motion'],
      // Isolated, for the reason the layer's open state is: a modal makes
      // everything beside it inert, which is the behaviour under test and is
      // incompatible with sharing a catalogue page.
      true,
    ),
    state('empty', { open: false, text: BUNDLED_ENGLISH['navigation.waiting.notice'] }, [
      'a closed overlay renders nothing, holds no focus and covers nothing',
    ]),
    notApplicable(
      'loading',
      'The overlay is the loading state. It holds no content of its own that could be waited for.',
    ),
    notApplicable(
      'error',
      'The overlay reports nothing. A navigation that failed is stated by the shell, on the screen the Commander is left on.',
    ),
    notApplicable('disabled', 'The overlay carries no control, so it has nothing to disable.'),
  ],
});

registerPreview({
  componentId: 'app-frame',
  group: 'Shell',
  component: AppFrame,
  contract: contract(
    'app-frame',
    {
      role: 'banner',
      visibleNameMatchesAccessibleName: true,
      exposedStates: ['current'],
      relationships: ['label'],
      textEquivalents: ['current tool'],
    },
    ['default', 'empty', 'error'],
  ),
  states: [
    state(
      'default',
      {
        routeContext: 'Anaconda explorer',
        home: { id: 'start', label: 'Nav Beacon', href: '/', current: false },
        tools: [
          { id: 'ship', label: 'Ship Builder', href: '/ships', current: true },
          { id: 'equipment', label: 'Equipment Builder', href: '/equipment' },
        ],
        actions: [
          { id: 'library', label: 'Open saved build' },
          { id: 'save', label: 'Save', emphasis: 'primary' },
          { id: 'language', label: 'Language' },
          {
            id: 'help.open',
            label: 'Help',
            symbol: '?',
            emphasis: 'quiet',
            description: 'Opens help, version and licence information over the current view.',
          },
        ],
      },
      [
        'exposes banner, navigation and main landmarks',
        'every action keeps a text name — the Help mark carries its own as text inside the button',
        'the current tool exposes aria-current',
        'the mark is a link carrying the name of the screen it opens',
        'the tool region is the shell\u2019s navigation landmark, with a name of its own',
        'the Help entry is in the wide row and in the folded action layer, and is the only one of its kind',
      ],
      ['normal', 'expanded-copy', 'rtl', 'reduced-motion', 'long-identity', 'nested-relationships'],
      // Isolated: the frame renders the banner and main landmarks, and a page
      // may only have one of each. A shell is a whole-page component.
      true,
    ),
    state(
      'empty',
      {},
      ['renders the landmarks with no route context, tools or actions'],
      ['normal'],
      true,
    ),
    notApplicable(
      'loading',
      'The frame is always present; the route inside it owns any loading state.',
    ),
    // The composition the shell is in when the cached application cannot be
    // repaired: a named error and, beside it, the one control that recovers the
    // session. It is a rendered product state that no journey can provoke — the
    // worker decides when it happens — so this is where it is scanned.
    //
    // Content the address served standing beside that statement is not a cell
    // here, and deliberately. It is the same error state in another
    // composition rather than a state of its own, a journey can provoke it,
    // and it is scanned where it occurs: over the held content and the
    // statement together, on the production lane
    // (`e2e/prerendered-first-frame.spec.ts`, 023/FR-001).
    //
    // That change's own documents give a different reason: that no fixture
    // could show the composition at all, because the frame projects its `main`
    // and a cell is rendered with inputs alone. What was built says otherwise.
    // Held content is not projected — it arrives as the frame's `held` input
    // and the frame puts it in a box of its own — so inputs alone are what the
    // composition takes. The reason there is no cell for it is the one above.
    // Those documents are archived and are read as they stand
    // (`openspec/changes/archive/023-served-document-held/proposal.md`,
    // `design.md`, `tasks.md` task 4.1).
    state(
      'error',
      {
        routeContext: 'Anaconda explorer',
        // The shell's own messages rather than a copy of them. This is the one
        // fixture claiming to be a state the product renders, and a fixture
        // whose wording could drift from the product's would go on being
        // scanned while evidencing a composition that no longer exists.
        //
        // Two of them, which is the composition the slot was widened for: a
        // session that cannot be repaired and a screen that would not open are
        // independent facts, and a slot carrying one of them would drop the
        // other in silence (018/FR-007). The version notice leads, because it
        // is about the whole session where the failure is about one press.
        status: [
          {
            tone: 'error',
            message: BUNDLED_ENGLISH['update.unusable.notice'],
            detail: BUNDLED_ENGLISH['update.unusable.detail'],
          },
          {
            tone: 'warning',
            message: BUNDLED_ENGLISH['navigation.failed.notice'],
            detail: BUNDLED_ENGLISH['navigation.failed.detail'],
          },
        ],
        actions: [
          {
            id: 'app.update',
            label: BUNDLED_ENGLISH['update.unusable.action'],
            emphasis: 'primary',
            description: BUNDLED_ENGLISH['update.unusable.action.description'],
          },
        ],
      },
      [
        'visible feedback stays on the page to be re-read, in ordinary reading order',
        'two independent notices stand together, the one about the session first',
        'the shell landmarks and actions remain usable',
        'the recovery is a named control in the interface, never an instruction to clear a cache',
        'the action carries its own description without losing its visible name',
      ],
      ['normal'],
      true,
    ),
    notApplicable(
      'disabled',
      'The application frame is always available; it has no disabled state.',
    ),
  ],
});

registerPreview({
  componentId: 'action-layer',
  group: 'Shell',
  component: ActionLayer,
  contract: contract(
    'action-layer',
    {
      role: 'group',
      visibleNameMatchesAccessibleName: true,
      exposedStates: ['expanded', 'disabled'],
      relationships: ['label'],
      textEquivalents: ['open and close state named in the trigger text'],
    },
    ['default', 'empty', 'disabled'],
    ['normal', 'expanded-copy', 'rtl', 'reduced-motion', 'long-identity'],
  ),
  states: [
    state(
      'default',
      {
        actions: [
          { id: 'save', label: 'Save build', emphasis: 'primary' },
          { id: 'share', label: 'Copy build link' },
          { id: 'language', label: 'Language' },
        ],
        label: 'Actions',
        openLabel: 'Menu',
        closeLabel: 'Close menu',
        expanded: true,
      },
      [
        'the trigger carries visible text naming what it does now',
        'every action inside keeps its own visible label',
        'the layer is related to its trigger by aria-controls and aria-expanded',
      ],
      ['normal', 'expanded-copy', 'rtl', 'reduced-motion', 'long-identity'],
    ),
    state(
      'empty',
      {
        actions: [],
        label: 'Actions',
        openLabel: 'Menu',
        closeLabel: 'Close menu',
        expanded: true,
      },
      ['an open layer with no actions shows an empty group rather than a broken trigger'],
      ['normal'],
    ),
    notApplicable(
      'loading',
      'The layer holds actions that are already known; it never loads them itself.',
    ),
    notApplicable(
      'error',
      'The layer presents actions; an action that fails reports through the shell status.',
    ),
    state(
      'disabled',
      {
        actions: [{ id: 'save', label: 'Save build' }],
        label: 'Actions',
        openLabel: 'Menu',
        closeLabel: 'Close menu',
        expanded: false,
        disabled: true,
      },
      [
        'the trigger exposes the disabled state rather than disappearing',
        'no action inside can be activated while the layer is disabled',
      ],
      ['normal'],
    ),
  ],
});

registerPreview({
  componentId: 'game-text',
  group: 'Localization',
  component: GameText,
  contract: contract(
    'game-text',
    {
      role: 'text',
      visibleNameMatchesAccessibleName: true,
      exposedStates: [],
      relationships: ['description'],
      textEquivalents: ['untranslated state', 'unavailable value'],
    },
    ['default', 'empty'],
    [
      'normal',
      'expanded-copy',
      'rtl',
      'reduced-motion',
      'canonical-untranslated',
      'unavailable-text',
      'long-identity',
    ],
  ),
  states: [
    // The canonical case is the default fixture deliberately: it renders the
    // package text, its accurate `lang` and the associated disclosure all at
    // once, so a reviewer sees the whole provenance contract rather than the
    // one case where there is nothing to disclose.
    state(
      'default',
      {
        text: 'Mk II Cargo Rack',
        language: 'en',
        translationState: 'canonical',
        label: 'Module',
      },
      [
        'package text carries the language it is actually in, so it is pronounced correctly',
        'the untranslated state is named in words, not by styling alone',
        'the disclosure is associated with the value by aria-describedby',
        'the game noun itself is never translated by the application',
      ],
      ['normal', 'expanded-copy', 'rtl', 'canonical-untranslated', 'long-identity'],
    ),
    state(
      'empty',
      { text: null, translationState: 'unavailable', label: 'Module' },
      [
        'an absent package value is stated in words, never as a raw symbol',
        'no identity is used as display fallback',
      ],
      ['normal', 'unavailable-text'],
    ),
    notApplicable(
      'loading',
      'Package text resolves synchronously from the installed package; there is nothing to wait for.',
    ),
    notApplicable(
      'error',
      'Absent package text is an unavailable value, which this component renders, not an error it reports.',
    ),
    notApplicable('disabled', 'Text is not interactive and has no disabled state.'),
  ],
});

registerPreview({
  componentId: 'announcement-outlet',
  group: 'Feedback',
  component: AnnouncementOutlet,
  contract: contract(
    'announcement-outlet',
    {
      role: 'status',
      visibleNameMatchesAccessibleName: false,
      exposedStates: [],
      relationships: [],
      textEquivalents: [],
    },
    ['default'],
  ),
  states: [
    state('default', {}, [
      'exactly one assertive and one polite outlet exist',
      'both are visually hidden but present in the accessibility tree',
      'both are silent until a genuinely new event is published',
    ]),
    notApplicable(
      'empty',
      'An empty outlet is the resting state the default fixture already shows: the outlets are always mounted and start silent.',
    ),
    notApplicable('loading', 'An outlet publishes settled text; it has no loading state.'),
    notApplicable(
      'error',
      'An outlet carries an error’s text but has no error state of its own; the notice component renders the visible error.',
    ),
    notApplicable('disabled', 'A live region is not interactive, so it cannot be disabled.'),
  ],
});

// ---------------------------------------------------------------------------
// Feature 001 additions: the catalogue, hull-detail and decision surfaces.
// ---------------------------------------------------------------------------

/** One hull, as every catalogue fixture below shows it. */
const ANACONDA = {
  symbol: 'Anaconda',
  name: { text: 'Anaconda', language: 'en', translationState: 'localized', disclosureKey: null },
  manufacturer: {
    text: 'Faulcon DeLacy',
    language: 'en',
    translationState: 'localized',
    disclosureKey: null,
  },
  size: 'LRG',
  sizeText: 'Large',
  hardpoints: '1H 4L 2M 1S',
  hardpointsText: '1 huge, 4 large, 2 medium, 1 small',
  price: '146.97',
  selected: false,
} as const;

/** The same hull with every fact the package could fail to supply missing. */
const UNAVAILABLE_HULL = {
  ...ANACONDA,
  symbol: 'Unknown',
  size: null,
  sizeText: null,
  price: null,
} as const;

const CATALOGUE_COLUMNS = [
  {
    field: 'name',
    label: 'Ship',
    sortActionLabel: 'Sort by Ship, descending',
    sorted: true,
    direction: 'ascending',
  },
  {
    field: 'manufacturer',
    label: 'Manufacturer',
    sortActionLabel: 'Sort by Manufacturer, ascending',
    sorted: false,
    direction: 'ascending',
  },
  {
    field: 'size',
    label: 'Size',
    sortActionLabel: 'Sort by Size, ascending',
    sorted: false,
    direction: 'ascending',
  },
  {
    field: 'hardpoints',
    label: 'Hardpoints',
    sortActionLabel: 'Sort by Hardpoints, ascending',
    sorted: false,
    direction: 'ascending',
  },
  {
    field: 'price',
    label: 'Price Mcr',
    sortActionLabel: 'Sort by Price Mcr, ascending',
    sorted: false,
    direction: 'ascending',
    numeric: true,
  },
] as const;

const TOOLBAR_BASE = {
  sizeChoices: [
    { value: 'small', label: 'Small' },
    { value: 'medium', label: 'Medium' },
    { value: 'large', label: 'Large' },
  ],
  sortOptions: [
    { value: 'name', label: 'Ship', actionLabel: 'Sort by Ship, ascending' },
    { value: 'price', label: 'Price Mcr', actionLabel: 'Sort by Price Mcr, ascending' },
  ],
} as const;

registerPreview({
  componentId: 'collection-toolbar',
  group: 'Catalogue',
  component: CollectionToolbar,
  contract: contract(
    'collection-toolbar',
    {
      role: 'group',
      visibleNameMatchesAccessibleName: true,
      exposedStates: ['selected', 'invalid', 'disabled'],
      relationships: ['label', 'description'],
      textEquivalents: ['sort field and direction'],
    },
    ['default', 'empty', 'error'],
  ),
  states: [
    state(
      'default',
      {
        ...TOOLBAR_BASE,
        search: 'cutter',
        selectedSizes: ['large'],
        sort: {
          field: 'price',
          direction: 'descending',
          text: 'Sorted by Price Mcr, descending',
          toggleLabel: 'Sort by Price Mcr, ascending',
        },
      },
      [
        'the search and the size strip are the only controls the reference draws',
        'the chip carrying the order in force says what re-choosing it would do',
      ],
      ['normal', 'expanded-copy', 'rtl', 'german-format', 'long-identity'],
    ),
    state(
      'empty',
      {
        ...TOOLBAR_BASE,
        search: '',
        selectedSizes: [],
        sort: {
          field: 'name',
          direction: 'ascending',
          text: 'Sorted by Ship, ascending',
          toggleLabel: 'Sort by Ship, descending',
        },
      },
      ['keeps every control reachable with nothing selected'],
    ),
    notApplicable(
      'loading',
      'The catalogue is installed with the package, so the toolbar never waits for it.',
    ),
    state(
      'error',
      {
        ...TOOLBAR_BASE,
        search: 'no such hull',
        selectedSizes: [],
        sort: {
          field: 'name',
          direction: 'ascending',
          text: 'Sorted by Ship, ascending',
          toggleLabel: 'Sort by Ship, descending',
        },
      },
      ['a search that matches nothing leaves every control usable'],
    ),
    notApplicable(
      'disabled',
      'A toolbar with no reachable controls would leave a Commander unable to widen a search they cannot see the results of.',
    ),
  ],
});

registerPreview({
  componentId: 'responsive-catalogue-view',
  group: 'Catalogue',
  component: ResponsiveCatalogueView,
  contract: contract(
    'responsive-catalogue-view',
    {
      role: 'table',
      visibleNameMatchesAccessibleName: true,
      exposedStates: ['selected', 'current'],
      relationships: ['label'],
      textEquivalents: ['sort direction', 'selected hull', 'unavailable fact'],
    },
    ['default', 'empty'],
  ),
  states: [
    state(
      'default',
      {
        caption: 'Hulls in the Almanac',
        columns: CATALOGUE_COLUMNS,
        hulls: [ANACONDA, { ...ANACONDA, symbol: 'Adder', selected: true }, UNAVAILABLE_HULL],
        // The rail's own composition, which is the one the wide table is drawn
        // in: the screen answers this, and the manifest is named for the answer.
        restsToRead: true,
      },
      [
        'the wide composition is a real table with scoped column and row headers',
        'each column header is a named bidirectional sort button',
        'the narrow composition keeps every label as a definition list',
        'the current hull is marked with the reference lozenge and aria-current',
        'an unavailable fact is stated in words, never as a zero',
        'the manifest owns its own overflow; the document never scrolls sideways',
      ],
      ['normal', 'expanded-copy', 'rtl', 'long-identity'],
    ),
    state(
      'empty',
      {
        caption: 'Hulls in the Almanac',
        columns: CATALOGUE_COLUMNS,
        hulls: [],
        emptyLabel: 'No hull matches these filters.',
        restsToRead: true,
      },
      ['says why there is nothing to show rather than rendering an empty frame'],
    ),
    notApplicable('loading', 'The catalogue ships with the package, so the list is never pending.'),
    notApplicable(
      'error',
      'A constrained result of zero is an empty state; a catalogue that failed to load cannot occur.',
    ),
    notApplicable(
      'disabled',
      'A read-only list of hulls has no disabled state; the sort actions are always available.',
    ),
  ],
});

registerPreview({
  componentId: 'hull-summary-card',
  group: 'Catalogue',
  component: HullSummaryCard,
  contract: contract(
    'hull-summary-card',
    {
      role: 'article',
      visibleNameMatchesAccessibleName: true,
      exposedStates: ['current'],
      relationships: ['label', 'unavailable-reason'],
      textEquivalents: ['selected state', 'unavailable fact'],
    },
    ['default', 'empty'],
  ),
  states: [
    state(
      'default',
      { hull: { ...ANACONDA, selected: true } },
      [
        'each fact is paired with the label that names it, drawn or not',
        'the current state is exposed as aria-current, not only as colour',
        'the opening action names the hull it opens',
      ],
      ['normal', 'expanded-copy', 'rtl', 'canonical-untranslated', 'long-identity'],
    ),
    state(
      'empty',
      { hull: UNAVAILABLE_HULL },
      ['every absent fact is stated in words rather than as a zero'],
      ['normal', 'unavailable-text'],
    ),
    notApplicable('loading', 'A card renders facts the package already holds.'),
    notApplicable(
      'error',
      'An absent fact is an unavailable value, which the card renders; it reports no error of its own.',
    ),
    notApplicable(
      'disabled',
      'Every hull can be opened; a card that could not would hide a hull from the catalogue.',
    ),
  ],
});

registerPreview({
  componentId: 'fact-list',
  group: 'Hull',
  component: FactList,
  contract: contract(
    'fact-list',
    {
      role: 'group',
      visibleNameMatchesAccessibleName: true,
      exposedStates: [],
      relationships: ['label', 'unit', 'viewing-condition', 'unavailable-reason'],
      textEquivalents: ['unit', 'measurement condition', 'unavailable value'],
    },
    ['default', 'empty'],
  ),
  states: [
    state(
      'default',
      {
        label: 'Hull specifications',
        facts: [
          {
            id: 'maximum-speed',
            label: 'Speed',
            value: '183',
            unit: 'm/s',
            condition: 'at 4 ENG pips',
          },
          {
            id: 'hardness',
            label: 'Hull hardness',
            value: '65',
            unit: 'rating, no unit',
            condition: null,
          },
          {
            id: 'base-shield',
            label: 'Base shield strength',
            value: null,
            unit: 'MJ',
            condition: null,
          },
        ],
      },
      [
        'every value is related to its unit and its measurement condition',
        'a figure with no unit is marked as a rating rather than given one',
        'an unavailable value is stated in words, never as a zero',
      ],
      ['normal', 'expanded-copy', 'rtl', 'german-format', 'unavailable-text'],
    ),
    state(
      'empty',
      { label: 'Hull specifications', facts: [], emptyLabel: 'No figures are available.' },
      ['says there is nothing rather than rendering an empty list'],
    ),
    notApplicable(
      'loading',
      'Hull facts are installed with the package and resolve synchronously.',
    ),
    notApplicable(
      'error',
      'An absent figure is an unavailable value, not an error the list reports.',
    ),
    notApplicable('disabled', 'A list of published facts is not interactive.'),
  ],
});

registerPreview({
  componentId: 'hull-artwork',
  group: 'Hull',
  component: HullArtwork,
  contract: contract(
    'hull-artwork',
    {
      role: 'figure',
      visibleNameMatchesAccessibleName: false,
      exposedStates: [],
      relationships: ['description'],
      textEquivalents: ['the illustration itself', 'loading state', 'unavailable state'],
    },
    ['default', 'loading', 'error'],
  ),
  states: [
    state(
      'default',
      {
        source: 'assets/ships/Anaconda/illustration.png',
        label: 'Illustration of the Anaconda',
        state: 'available',
      },
      [
        'the illustration carries a text equivalent naming the hull',
        'the area is reserved at a fixed ratio so nothing shifts on load',
      ],
      ['normal', 'rtl', 'reduced-motion'],
    ),
    notApplicable(
      'empty',
      'Every hull the package carries has an illustration; an absent one is the error state, not an empty one.',
    ),
    state(
      'loading',
      {
        source: 'assets/ships/Anaconda/illustration.png',
        label: 'Illustration of the Anaconda',
        state: 'loading',
      },
      ['the pending state is stated in text', 'the reserved area holds its size'],
    ),
    state(
      'error',
      {
        source: 'assets/ships/Anaconda/illustration.png',
        label: 'Illustration of the Anaconda',
        state: 'temporarily-unavailable',
      },
      [
        'the absence is explained as temporary and the hull is still named',
        'a retry is offered that does not reload the page',
        'no action elsewhere on the screen is disabled by it',
      ],
      ['normal', 'expanded-copy', 'rtl'],
    ),
    notApplicable(
      'disabled',
      'An illustration is decoration with a text equivalent; it never gates anything, so it has nothing to disable.',
    ),
  ],
});

registerPreview({
  componentId: 'confirm-dialog',
  group: 'Decisions',
  component: ConfirmDialog,
  contract: contract(
    'confirm-dialog',
    {
      role: 'dialog',
      visibleNameMatchesAccessibleName: true,
      exposedStates: [],
      relationships: ['label', 'description'],
      textEquivalents: ['destructive intent'],
    },
    ['default', 'error'],
  ),
  states: [
    state(
      'default',
      {
        open: true,
        title: 'Delete “Anaconda explorer”?',
        description: 'This removes the Anaconda build from this browser. It cannot be undone.',
        confirmLabel: 'Delete this build',
        cancelLabel: 'Keep this build',
        dismissLabel: 'Close',
      },
      [
        'both outcomes are named in their own words, never OK and Cancel',
        'the description is associated with the dialog',
        'the background is inert and absent from the accessibility tree',
      ],
      ['normal', 'expanded-copy', 'rtl', 'long-identity'],
      true,
    ),
    notApplicable('empty', 'A confirmation always names a subject and two outcomes.'),
    notApplicable(
      'loading',
      'The decision is the Commander’s; nothing is pending while it is open.',
    ),
    state(
      'error',
      {
        open: true,
        title: 'Delete “Anaconda explorer”?',
        description: 'This removes the saved build from this browser. It cannot be undone.',
        confirmLabel: 'Delete this build',
        cancelLabel: 'Keep this build',
        dismissLabel: 'Close',
        destructive: true,
      },
      [
        'the destructive outcome is carried by the wording, not only by emphasis',
        'the record being deleted is named',
      ],
      ['normal', 'expanded-copy', 'rtl'],
      true,
    ),
    notApplicable(
      'disabled',
      'A dialog with no usable answer would trap a Commander in a decision they cannot make.',
    ),
  ],
});

registerPreview({
  componentId: 'choice-dialog',
  group: 'Decisions',
  component: ChoiceDialog,
  contract: contract(
    'choice-dialog',
    {
      role: 'dialog',
      visibleNameMatchesAccessibleName: true,
      exposedStates: [],
      relationships: ['label', 'description'],
      textEquivalents: ['which version each choice keeps'],
    },
    ['default', 'error'],
  ),
  states: [
    state(
      'default',
      {
        open: true,
        title: 'This build was changed in another tab',
        description: 'Another tab saved “Anaconda explorer” after you opened it.',
        choices: [
          {
            id: 'overwrite',
            label: 'Replace the other tab’s version',
            outcome: 'Your version is kept. The version the other tab saved is replaced.',
          },
          {
            id: 'keep-both',
            label: 'Keep both versions',
            outcome: 'Both versions are kept, as two separate saved builds.',
          },
          {
            id: 'cancel',
            label: 'Do not save',
            outcome: 'Nothing is saved. The other tab’s version is kept.',
            emphasis: 'quiet',
          },
        ],
        dismissLabel: 'Close',
      },
      [
        'each choice states which version survives, in visible associated text',
        'the choices are a semantic list',
        'the emitted value is a stable identity, never the translated label',
      ],
      ['normal', 'expanded-copy', 'rtl', 'long-identity'],
      true,
    ),
    notApplicable(
      'empty',
      'A decision with no choices is not a decision; the dialog is only shown when there are ways out.',
    ),
    notApplicable(
      'loading',
      'The decision is the Commander’s; nothing is pending while it is open.',
    ),
    state(
      'error',
      {
        open: true,
        title: 'This build was changed in another tab',
        description: 'The build changed again while you were deciding.',
        choices: [
          {
            id: 'overwrite',
            label: 'Replace the other tab’s version',
            outcome: 'Your version is kept. The newest stored version is replaced.',
          },
          {
            id: 'cancel',
            label: 'Do not save',
            outcome: 'Nothing is saved. The newest stored version is kept.',
            emphasis: 'quiet',
          },
        ],
        dismissLabel: 'Close',
      },
      [
        'a third revision refreshes the question rather than overwriting silently',
        'the refreshed outcome text names what is now stored',
      ],
      ['normal', 'expanded-copy', 'rtl'],
      true,
    ),
    notApplicable(
      'disabled',
      'A dialog with no usable answer would trap a Commander in a decision they cannot make.',
    ),
  ],
});

// ---------------------------------------------------------------------------
// Feature 001 additions: the saved-build library surfaces.
// ---------------------------------------------------------------------------

/** One hull name, presented the way the library receives it. */
const ANACONDA_NAME = ANACONDA.name;

const NAMED_BUILD = {
  id: 'record-1',
  title: 'Anaconda explorer',
  named: true,
  subject: ANACONDA_NAME,
  toolLabel: 'Ship Builder',
  modified: '2 weeks ago',
  modifiedExact: 'Edited 12 August 2026, 14:20',
  validation: { label: 'Complete', tone: 'success' },
  issues: null,
  remaining: null,
  current: false,
  currentLabel: 'Current build',
  note: 'Neutron route to Colonia. Swap the AFMU before the return leg.',
} as const;

/**
 * A build nobody has named, titled by what the build calls itself.
 *
 * Never an invented name and never one written onto the record: the ship's own
 * name, its ident, or the hull, read each time the row is drawn (FR-010).
 */
const WORKING_BUILD = {
  ...NAMED_BUILD,
  id: 'record-working',
  title: 'Vindicator',
  named: false,
  note: 'Unsaved edits to “Anaconda explorer”',
  remaining: 'Deleted in 6 days unless it is saved',
} as const;

/** The record the workspace is holding right now. */
const CURRENT_BUILD = {
  ...NAMED_BUILD,
  id: 'record-current',
  current: true,
} as const;

/**
 * A loadout, in the same row as a build.
 *
 * One library holds both tools' records, so the column beside the title carries
 * a hull for one and a suit for the other, and the row names which tool made it
 * among its read-not-drawn facts. A loadout records no verdict of its own (013
 * contracts/loadout-persistence.md).
 */
const LOADOUT_RECORD = {
  ...NAMED_BUILD,
  id: 'record-loadout',
  title: 'Silent Entry',
  subject: {
    text: 'Maverick Suit',
    language: 'en',
    translationState: 'localized',
    disclosureKey: null,
  },
  toolLabel: 'Equipment Builder',
  validation: null,
  issues: null,
  note: null,
} as const;

/** A build whose recorded verdict counted issues against it. */
const ISSUE_BUILD = {
  ...NAMED_BUILD,
  id: 'record-issues',
  validation: { label: 'Invalid', tone: 'error' },
  issues: { count: '2', label: '2 issues recorded when this build was saved' },
} as const;

/** The column headers the reference draws once over the whole body. */
const RECORD_COLUMNS = { build: 'Build', hull: 'Ship', modified: 'Edited' } as const;

registerPreview({
  componentId: 'saved-build-card',
  group: 'Library',
  component: SavedBuildCard,
  contract: contract(
    'saved-build-card',
    {
      role: 'article',
      visibleNameMatchesAccessibleName: true,
      exposedStates: [],
      relationships: ['label', 'description'],
      textEquivalents: ['validation verdict', 'current record', 'remaining life'],
    },
    ['default', 'empty', 'error'],
  ),
  states: [
    state(
      'default',
      { build: NAMED_BUILD },
      [
        'choosing the row is one action that names the record it would act on',
        'the recorded verdict is words with a tone, never a coloured dot',
        'the row reads title, hull and edited-at in the order the headers name',
        'the row names the tool that made it, read rather than drawn',
      ],
      ['normal', 'expanded-copy', 'rtl', 'german-format', 'long-identity'],
    ),
    state(
      'empty',
      { build: WORKING_BUILD },
      [
        'a build with no name is titled by what the build calls itself, set apart from a name',
        'an unnamed record says which save it holds unsaved edits to',
        'the remaining life is stated on the row, in the active locale',
      ],
      ['normal', 'expanded-copy', 'rtl'],
    ),
    notApplicable(
      'disabled',
      'A stored build a Commander could not choose would be a build stranded in their own library. The record the workspace holds is drawn in the list preview, where a marked row can be seen beside unmarked ones.',
    ),
    notApplicable(
      'loading',
      'A record is read from this browser’s own storage before the card is given it; there is nothing left to wait for.',
    ),
    state(
      'error',
      {
        build: ISSUE_BUILD,
      },
      [
        'the verdict recorded when the build was saved is stated in words',
        'the issue count is a number on a plate with its own words beside it',
      ],
      ['normal', 'expanded-copy', 'rtl'],
    ),
  ],
});

registerPreview({
  componentId: 'responsive-record-list',
  group: 'Library',
  component: ResponsiveRecordList,
  contract: contract(
    'responsive-record-list',
    {
      role: 'list',
      visibleNameMatchesAccessibleName: true,
      exposedStates: [],
      relationships: ['label'],
      textEquivalents: ['why a record cannot be opened'],
    },
    ['default', 'empty', 'error'],
  ),
  states: [
    state(
      'default',
      {
        label: 'Saved builds',
        columns: RECORD_COLUMNS,
        chosen: 'record-current',
        builds: [
          CURRENT_BUILD,
          WORKING_BUILD,
          NAMED_BUILD,
          LOADOUT_RECORD,
          ISSUE_BUILD,
          { ...NAMED_BUILD, id: 'record-2', title: 'Krait combat' },
        ],
      },
      [
        'the column headers are drawn once over the body rather than into every row',
        'named and unnamed records are one list in one order, under no group heading',
        'the record the workspace holds is marked in words as well as in the wash',
        'an unnamed row states which save its edits are of, and how long it has left',
        'the edited column reads how long ago, and the instant itself stays in words',
        'one list holds both tools\u2019 records, each row naming the tool that made it',
        'the narrow and wide compositions present the same records in the same order',
      ],
      ['normal', 'expanded-copy', 'rtl', 'long-identity'],
    ),
    state(
      'empty',
      {
        label: 'Saved builds',
        columns: RECORD_COLUMNS,
        noMatch: 'Nothing here matches “neutron”.',
        builds: [],
      },
      [
        'a search that matched nothing says so in one centred sentence on the body’s own ground',
        'nothing else is removed, so widening the search needs no separate action',
      ],
      ['normal', 'expanded-copy', 'rtl'],
    ),
    notApplicable(
      'loading',
      'The list renders the records it is given; reading them from storage belongs to the library store. A narrowed list is the default state with fewer rows — the search changes no order and moves no record — and a search that matched nothing is the empty state above.',
    ),
    state(
      'error',
      {
        label: 'Saved builds',
        columns: RECORD_COLUMNS,
        builds: [NAMED_BUILD],
        unavailableLabel: 'Builds this version cannot open',
        unavailable: [
          {
            id: 'record-future',
            explanation: 'This build was saved by a newer version of the application.',
            detail: 'Last changed 2 August 2026',
          },
        ],
      },
      [
        'a record that cannot be opened is listed with what is known about it, never hidden',
        'the explanation says why, so a Commander knows the build is still theirs',
      ],
      ['normal', 'expanded-copy', 'rtl'],
    ),
    notApplicable(
      'disabled',
      'The list is a container; a record’s own actions carry any disabled state.',
    ),
  ],
});

registerPreview({
  componentId: 'record-manager',
  group: 'Library',
  component: RecordManager,
  contract: contract(
    'record-manager',
    {
      role: 'group',
      visibleNameMatchesAccessibleName: true,
      exposedStates: ['checked'],
      relationships: ['label', 'description'],
      textEquivalents: ['why room is needed', 'what each record is'],
    },
    ['default', 'empty', 'error'],
  ),
  states: [
    state(
      'default',
      {
        reason:
          "This browser's storage is full, so nothing is being saved. Editing still works; discard a build to make room.",
        records: [
          { id: 'record-1', label: 'Anaconda explorer', detail: 'Anaconda — 12 August 2026' },
          { id: 'record-2', label: 'Krait combat', detail: 'Krait Mk II — 9 August 2026' },
          { id: 'record-3', label: 'Unnamed build', detail: 'Cutter — 2 August 2026' },
        ],
        selected: ['record-3'],
      },
      [
        'every record is listed and selected individually — nothing is preselected',
        'each record carries enough detail to decide without opening it',
        'the discard action stays inert until something is chosen',
      ],
      ['normal', 'expanded-copy', 'rtl', 'german-format', 'long-identity'],
    ),
    state('empty', { records: [], selected: [] }, [
      'says there is nothing to discard rather than offering an empty choice',
    ]),
    notApplicable(
      'loading',
      'The records were already read to reach the limit that opened this; none of them is pending.',
    ),
    state(
      'error',
      {
        reason: 'This browser has no room left to save builds. Discard one to continue.',
        records: [
          { id: 'record-1', label: 'Anaconda explorer', detail: 'Anaconda — 12 August 2026' },
        ],
        selected: [],
      },
      [
        'a full store is explained in words a Commander can act on',
        'nothing is discarded automatically, however full the store is',
      ],
      ['normal', 'expanded-copy', 'rtl'],
    ),
    notApplicable(
      'disabled',
      'The manager only opens when room has to be made; a disabled one would leave a Commander unable to make it.',
    ),
  ],
});

/** The save a build was opened from, as the layer states it. */
const SAVE_SOURCE = {
  name: 'Anaconda explorer',
  lastSaved: '2 weeks ago',
  replaceable: true,
} as const;

registerPreview({
  componentId: 'save-build-layer',
  group: 'Workspace',
  component: SaveBuildDialog,
  contract: contract(
    'save-build-layer',
    {
      role: 'dialog',
      visibleNameMatchesAccessibleName: true,
      exposedStates: ['disabled'],
      relationships: ['label', 'description'],
      textEquivalents: ['what each save mode does to the stored builds'],
    },
    ['default', 'empty', 'error', 'disabled'],
  ),
  states: [
    state(
      'default',
      {
        open: true,
        initialName: 'Anaconda explorer',
        initialNote: 'Neutron route to Colonia. Swap the AFMU before the return leg.',
        source: SAVE_SOURCE,
      },
      [
        'the two modes are bordered cards, each led by a square marker',
        'the marker is filled on the mode that is chosen and open on the other',
        'each mode states in associated words what it does to the stored builds',
        'the replacing mode says when the save it would replace was last written',
      ],
      ['normal', 'expanded-copy', 'rtl', 'long-identity'],
      // Isolated: an open modal makes everything behind it inert, which is
      // correct behaviour and incompatible with sharing a catalogue page.
      true,
    ),
    state(
      'empty',
      { open: true, initialName: '', initialNote: null, source: null },
      [
        'a build that came from nowhere is offered no mode: saving can do one thing',
        'the name starts empty rather than filled in with a name nobody gave',
        'Save build is unavailable until the build has a name',
      ],
      ['normal', 'expanded-copy', 'rtl'],
      true,
    ),
    notApplicable(
      'loading',
      'The layer writes to this browser’s own storage under a short lock; there is no wait to render.',
    ),
    state(
      'error',
      {
        open: true,
        initialName: 'Anaconda explorer',
        initialNote: null,
        source: { ...SAVE_SOURCE, replaceable: false },
        duplicateCount: 2,
      },
      [
        'a browser that cannot replace a save safely is told so, in the line the canvas draws',
        'no mode is drawn, because only one of the two is left to choose',
        'saving as a new build stays available, because only the unsafe half went',
        'the duplicate-name warning stands beside that reason rather than behind it',
      ],
      ['normal', 'expanded-copy', 'rtl'],
      true,
    ),
    state(
      'disabled',
      {
        open: true,
        initialName: '  ',
        initialNote: null,
        source: SAVE_SOURCE,
        // A write that did nothing is the one sentence on this line a
        // Commander must not read past, so the state that renders it is the
        // one the sweep measures for contrast as well as for structure.
        failure:
          'This build could not be saved and nothing was written. Your build is unchanged — try again, or free some room in this browser.',
      },
      [
        'the commit is disabled natively while there is no name to save under',
        'a save that wrote nothing says so in words rather than in colour alone',
      ],
      ['normal', 'expanded-copy', 'rtl'],
      true,
    ),
  ],
});

// ---------------------------------------------------------------------------
// Feature 001 additions: passing a build on.
// ---------------------------------------------------------------------------

/** A published link at roughly the length a real engineered build produces. */
const PUBLISHED_URL =
  'https://ships.example/outfitting#b.1QAcOnR2yV9tGm4KpZ0xLbW7fEuHsJdCiNrTaMoPqXvYbZ3g5hKlD8eF';

registerPreview({
  componentId: 'share-link-panel',
  group: 'Sharing',
  component: ShareLinkPanel,
  contract: contract(
    'share-link-panel',
    {
      role: 'region',
      visibleNameMatchesAccessibleName: true,
      exposedStates: [],
      relationships: ['label', 'description'],
      textEquivalents: ['copy outcome', 'why a link was refused'],
    },
    ['default', 'empty', 'loading', 'error', 'disabled'],
  ),
  states: [
    state(
      'default',
      { state: 'published', url: PUBLISHED_URL, shareAvailable: true },
      [
        'the link text is present and selectable before anything is pressed',
        'the value scrolls inside its own labelled region, never the document',
        'the value is reachable without a pointer',
      ],
      ['normal', 'expanded-copy', 'rtl', 'reduced-motion', 'long-identity'],
    ),
    state('empty', { state: 'absent' }, [
      'says there is no build to link to rather than showing an empty box',
    ]),
    state('loading', { state: 'encoding' }, [
      'the pending state is named in text',
      'no stale link is shown while a new one is being prepared',
    ]),
    state(
      'error',
      {
        state: 'refused',
        refusal: {
          message: 'This build link names a hull or module that is not available here.',
          detail: 'The mount involved is Slot03_Size6.',
        },
        slefAvailable: false,
      },
      [
        'the refusal is the application’s own words, never an internal exception message',
        'the mount involved is named where the codec could name one',
        'a retry is offered, and the file alternative says plainly that it is not in this version',
      ],
      ['normal', 'expanded-copy', 'rtl'],
    ),
    state(
      'disabled',
      { state: 'published', url: PUBLISHED_URL, feedback: 'copy-failed', shareAvailable: false },
      [
        'a platform that cannot copy leaves the link text on screen and selectable',
        'the failure says what to do instead rather than only that it failed',
      ],
      ['normal', 'expanded-copy', 'rtl'],
    ),
  ],
});

// ---------------------------------------------------------------------------
// Feature 002 — module outfitting and engineering
//
// The outfitting components register here, in feature 011's one registry.
// There is no second manifest, no second preview application and no
// feature-owned declaration file: a component that is not in this list is a
// component nothing sweeps (feature 002 tasks T022).
// ---------------------------------------------------------------------------

registerPreview({
  componentId: 'unavailable-fact',
  group: 'Outfitting',
  component: UnavailableFact,
  contract: contract(
    'unavailable-fact',
    {
      role: 'group',
      visibleNameMatchesAccessibleName: false,
      exposedStates: [],
      relationships: ['label', 'unit', 'unavailable-reason'],
      textEquivalents: ['an absent value, stated in words rather than shown as zero'],
    },
    ['default', 'empty'],
  ),
  states: [
    state(
      'default',
      { label: 'Power draw', value: '0.88', unit: 'MW' },
      ['the label, the value and the unit are three separate readable parts'],
      CONTROL_VARIANTS,
    ),
    state(
      'empty',
      { label: 'Weapon capacitor draw', value: null },
      [
        'an absent package value reads as unavailable, never as zero',
        'the reason is associated with the absence rather than sitting loose beside it',
      ],
      ['normal', 'expanded-copy', 'rtl', 'unavailable-text', 'long-identity'],
    ),
    notApplicable(
      'loading',
      'A fact is read from a build that is already in memory; there is no moment at which it is being fetched.',
    ),
    notApplicable(
      'error',
      'An absent value is an unavailable value, which this renders honestly. It is not an error the component reports.',
    ),
    notApplicable(
      'disabled',
      'A published fact is read, never operated, so it has no disabled state.',
    ),
  ],
});

registerPreview({
  componentId: 'outfitting-notice',
  group: 'Outfitting',
  component: OutfittingNotice,
  contract: contract(
    'outfitting-notice',
    {
      role: 'region',
      visibleNameMatchesAccessibleName: true,
      exposedStates: [],
      relationships: ['label', 'description'],
      textEquivalents: ['the notice’s tone, named in words beside its colour'],
    },
    ['default', 'empty', 'error'],
  ),
  states: [
    state(
      'default',
      {
        title: 'Imported build',
        mode: 'status',
        lines: [
          {
            id: 'MainEngines',
            messageKey: 'outfitting.notice.quality-completed',
            params: { slot: 'Thrusters', quality: '37%' },
          },
        ],
      },
      [
        'the tone is named in text and is not carried by colour alone',
        'the notice draws and does not announce; what announces is what holds the event',
      ],
      CONTROL_VARIANTS,
    ),
    state('empty', { title: 'Imported build', mode: 'status', lines: [] }, [
      'a notice with nothing to say renders nothing rather than an empty frame',
    ]),
    notApplicable(
      'loading',
      'A notice reports something that has already happened; there is no pending notice.',
    ),
    state(
      'error',
      {
        title: 'That change was not made',
        mode: 'alert',
        lines: [
          {
            id: 'HugeHardpoint1',
            messageKey: 'outfitting.refusal.packageEdit',
            detail: 'A power plant does not fit a hardpoint.',
          },
          {
            id: 'Slot03_Size6',
            messageKey: 'outfitting.refusal.packageEdit',
            detail: 'Only one shield generator can be fitted.',
          },
        ],
      },
      [
        'an alert interrupts once for the batch, not once per line',
        'every line stays on the page to be found and re-read',
        'the Almanac’s own reason is shown beside the application’s framing, never instead of it',
      ],
      ['normal', 'expanded-copy', 'rtl', 'canonical-untranslated'],
    ),
    notApplicable(
      'disabled',
      'A notice is content, not a control. Dismissing it removes it rather than disabling it.',
    ),
  ],
});

// ---------------------------------------------------------------------------
// Feature 002 — user story 1: the ledger
//
// The fixtures below are presentation values shaped like the package's, not
// copies of package data: a slot view carries whatever `slots()` returned, and
// these state the *shapes* the ledger has to render — fitted, empty,
// non-removable, the cargo hatch — so each is swept at every width and variant.
// ---------------------------------------------------------------------------

/** Package text that needs no disclosure. */
function localized(text: string): Record<string, unknown> {
  return { text, language: 'en', translationState: 'localized' };
}

/** Package text the active locale has no translation for. */
function canonical(text: string): Record<string, unknown> {
  return { text, language: 'en', translationState: 'canonical' };
}

/** Everything a mount permits. Narrowed per fixture. */
const EVERY_CAPABILITY = {
  canOpenReplacement: true,
  canFitSelection: true,
  canRemove: true,
  canOpenEngineering: true,
  canSetEnabled: true,
  canSetPriority: true,
  packageEmpty: false,
};

/** The cargo hatch: power alone, because the package offers nothing else. */
const HATCH_CAPABILITIES = {
  ...EVERY_CAPABILITY,
  canOpenReplacement: false,
  canFitSelection: false,
  canRemove: false,
  canOpenEngineering: false,
  packageEmpty: true,
};

function slotFixture(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    key: 'HugeHardpoint1',
    canonicalName: 'Huge Hardpoint 1',
    displayName: localized('Huge Hardpoint 1'),
    kind: 'hardpoint',
    size: 4,
    restriction: null,
    restrictionText: null,
    removable: true,
    immovableReason: null,
    node: 1,
    module: {
      slotKey: 'HugeHardpoint1',
      symbol: 'Hpt_MultiCannon_Gimbal_Huge',
      displayName: localized('Multi-Cannon'),
      enabled: undefined,
      priority: 0,
      article: { class: 4, rating: 'A', mount: 'Gimballed' },
      effectiveArticle: null,
      engineering: null,
      variant: null,
      entitlement: null,
      labels: [],
    },
    ...overrides,
  };
}

registerPreview({
  componentId: 'module-identity-badge',
  group: 'Outfitting',
  component: ModuleIdentityBadge,
  contract: contract(
    'module-identity-badge',
    {
      role: 'group',
      visibleNameMatchesAccessibleName: false,
      exposedStates: [],
      relationships: ['untranslated-disclosure'],
      textEquivalents: ['the class and rating code, spelled out for a reader'],
    },
    ['default', 'empty'],
  ),
  states: [
    state(
      'default',
      {
        name: localized('Multi-Cannon'),
        symbol: 'Hpt_MultiCannon_Gimbal_Huge',
        moduleClass: 4,
        rating: 'A',
        mount: 'Gimballed',
      },
      [
        'class, rating and mount are separate package values, never parsed from a symbol',
        'the code is also spelled out for anyone reading it aloud',
      ],
      CONTROL_VARIANTS,
    ),
    state(
      'empty',
      { name: canonical('Corrosion Resistant Cargo Rack'), moduleClass: null, rating: null },
      [
        'an article the package has no localized name for reads canonically, disclosed',
        'a missing class or rating leaves the code line out rather than inventing one',
      ],
      ['normal', 'expanded-copy', 'rtl', 'canonical-untranslated', 'long-identity'],
    ),
    notApplicable('loading', 'An identity is read from a build already in memory.'),
    notApplicable('error', 'An unresolved name is an unavailable name, which it renders honestly.'),
    notApplicable('disabled', 'An identity is read, never operated.'),
  ],
});

registerPreview({
  componentId: 'slot-card',
  group: 'Outfitting',
  component: SlotCard,
  contract: contract(
    'slot-card',
    {
      role: 'button',
      visibleNameMatchesAccessibleName: true,
      exposedStates: ['pressed'],
      relationships: ['label', 'description'],
      textEquivalents: [
        'selection, as pressed state and hidden text beside the amber marker',
        'the reason a mount cannot be emptied',
      ],
    },
    ['default', 'empty', 'disabled'],
  ),
  states: [
    state(
      'default',
      {
        slot: slotFixture(),
        capabilities: EVERY_CAPABILITY,
        selected: true,
        engineeringSummary: 'Overcharged G5 · Corrosive Shell',
      },
      [
        'the exact game slot key is present for assistive technology and never as visible text',
        'selection is exposed as pressed state and in words, not by the marker alone',
        'a fitted row is the module over its code line; the mount is spoken, not drawn again',
      ],
      CONTROL_VARIANTS,
    ),
    state(
      'empty',
      { slot: slotFixture({ module: null }), capabilities: EVERY_CAPABILITY },
      [
        'an empty removable mount stays visible and readable',
        'the mount still names its kind, size and node so it can be chosen',
      ],
      ['normal', 'expanded-copy', 'rtl', 'long-identity'],
    ),
    notApplicable('loading', 'A ledger row is read from the committed build; it is never pending.'),
    notApplicable(
      'error',
      'A refusal is about an attempted edit and belongs to the refusal notice, not to a row.',
    ),
    state(
      'disabled',
      {
        slot: slotFixture({
          key: 'CargoHatch',
          canonicalName: 'Cargo Hatch',
          displayName: localized('Cargo Hatch'),
          kind: 'cargoHatch',
          size: 1,
          removable: false,
          immovableReason: 'cargoHatch',
          node: 1,
          module: {
            slotKey: 'CargoHatch',
            symbol: 'ModularCargoBayDoor',
            displayName: localized('Cargo Hatch'),
            enabled: true,
            priority: 4,
            article: { class: 1, rating: 'E' },
            effectiveArticle: null,
            engineering: null,
            variant: null,
            entitlement: null,
            labels: [],
          },
        }),
        capabilities: HATCH_CAPABILITIES,
      },
      [
        'the mount carries a short marker rather than a sentence repeated down the ledger',
        'no remove action is drawn where the Almanac permits none',
      ],
      ['normal', 'expanded-copy', 'rtl'],
    ),
  ],
});

registerPreview({
  componentId: 'slot-group',
  group: 'Outfitting',
  component: SlotGroup,
  contract: contract(
    'slot-group',
    {
      role: 'region',
      visibleNameMatchesAccessibleName: true,
      exposedStates: [],
      relationships: ['label'],
      textEquivalents: ['the mount count beside the heading'],
    },
    ['default', 'empty'],
  ),
  states: [
    state(
      'default',
      {
        group: {
          kind: 'hardpoint',
          slots: [slotFixture(), slotFixture({ key: 'LargeHardpoint1' })],
        },
      },
      [
        'the kind is a heading and the mounts beneath it are a list',
        'the count is stated in words rather than only as a number',
      ],
      CONTROL_VARIANTS,
    ),
    state('empty', { group: { kind: 'utility', slots: [] } }, [
      'a kind with no mounts still names itself and its count',
    ]),
    notApplicable('loading', 'The ledger is read from the committed build.'),
    notApplicable('error', 'A group reports no error of its own.'),
    notApplicable('disabled', 'A heading and a list are content, not controls.'),
  ],
});

registerPreview({
  componentId: 'edit-refusal-notice',
  group: 'Outfitting',
  component: EditRefusalNotice,
  contract: contract(
    'edit-refusal-notice',
    {
      role: 'alert',
      visibleNameMatchesAccessibleName: true,
      exposedStates: [],
      relationships: ['label', 'description'],
      textEquivalents: ['the refusal, named in words beside its colour'],
    },
    ['default', 'empty', 'error'],
  ),
  states: [
    state('default', { failure: null }, [
      'no refusal renders nothing, so a cleared failure leaves no residue',
    ]),
    state('empty', { failure: null }, [
      'the empty and default states are the same absence, stated once',
    ]),
    notApplicable('loading', 'A refusal is the outcome of an attempt that has already finished.'),
    state(
      'error',
      {
        slotLabel: 'Huge Hardpoint 1',
        failure: {
          category: 'packageEdit',
          slotKey: 'HugeHardpoint1',
          code: 'incompatibleModule',
          constraint: 'oversized',
          params: {},
          diagnostic: null,
          framingKey: 'outfitting.refusal.packageEdit',
        },
      },
      [
        'the application frames the outcome and the Almanac supplies the reason',
        'the mount involved is named the way the ledger names it',
        'it interrupts once, because nothing happened when something was expected to',
      ],
      ['normal', 'expanded-copy', 'rtl', 'canonical-untranslated'],
    ),
    notApplicable('disabled', 'A refusal is content, not a control.'),
  ],
});

/**
 * A chooser's real contents, for the candidate previews.
 *
 * Built from the Almanac rather than written out: the states worth previewing
 * are an ordered family list, a searched subset and an empty result, and a
 * hand-shaped row would let all three drift from what the product renders.
 *
 * Taken as a specimen rather than whole. A hardpoint's expansion is hundreds of
 * rows; every catalogue sweep reads every one of them for its target size and
 * its contrast, and one component would then cost more than the rest of the
 * catalogue together. The slice is taken after ordering, so the families and
 * the order within them are the product's own.
 */
const PREVIEW_ROWS = 12;

/** How the specimen's families are opened, for the states worth previewing. */
type PreviewOpening = 'seeded' | 'all' | 'none';

function candidateFamilies(
  slotKey: string,
  query = '',
  opening: PreviewOpening = 'seeded',
): readonly CandidateFamilyView[] {
  const collator = new Intl.Collator('en', { sensitivity: 'base', numeric: true });
  const state = applyQuery(
    openCandidateQuery(
      candidateMembership(defaultBuild(), slotKey, 1, packageText('en')),
      'en',
      collator,
    ),
    query,
  );
  // The rewards are among the states worth seeing and they sit inside their own
  // family, so the specimen takes from both ends rather than the first twelve.
  const results = state.results;
  const specimen =
    results.length <= PREVIEW_ROWS
      ? results
      : [...results.slice(0, PREVIEW_ROWS - 4), ...results.slice(-4)];

  const open =
    opening === 'none'
      ? new Set<(typeof specimen)[number]['presentation']['familyId']>()
      : new Set(
          specimen
            .filter((_, index) => opening === 'all' || index === 0)
            .map((choice) => choice.presentation.familyId),
        );

  return groupFamilies(specimen, open);
}

registerPreview({
  componentId: 'candidate-search',
  group: 'Outfitting',
  component: CandidateSearch,
  contract: contract(
    'candidate-search',
    {
      role: 'searchbox',
      visibleNameMatchesAccessibleName: false,
      exposedStates: [],
      relationships: ['label', 'description'],
      textEquivalents: ['the result count, announced politely'],
    },
    ['default', 'empty'],
  ),
  states: [
    state(
      'default',
      { query: 'multi', resultCount: 27, canClear: true },
      [
        'the label is hidden and still bound to the control',
        'the instructions say which four fields a term is matched against',
        'the key hint names this platform’s modifier rather than one glyph everywhere',
      ],
      ['normal', 'expanded-copy', 'rtl', 'long-identity'],
    ),
    state('empty', { query: '', resultCount: 0, canClear: false }, [
      'an empty query offers no clear action, because there is nothing to clear',
    ]),
    notApplicable(
      'loading',
      'The chooser is built synchronously from the package; the surface owns the busy state, not the field.',
    ),
    notApplicable(
      'error',
      'A search cannot fail. A query that matches nothing is the surface’s no-match state, not an error here.',
    ),
    notApplicable('disabled', 'A mount that takes nothing renders no search at all.'),
  ],
});

registerPreview({
  componentId: 'candidate-list',
  group: 'Outfitting',
  component: CandidateList,
  contract: contract(
    'candidate-list',
    {
      role: 'group',
      visibleNameMatchesAccessibleName: false,
      exposedStates: ['selected'],
      relationships: ['label'],
      textEquivalents: [
        'each family\u2019s name, choice count and revealed state, for a reader',
        'the fitted, stock and pre-engineered state, in words',
        'every acquisition restriction, as text beside its chip',
        'an absent package figure, as a word rather than a zero',
      ],
    },
    ['default', 'empty'],
  ),
  states: [
    state(
      'default',
      {
        families: candidateFamilies(FIXTURE_SLOTS.hardpoint),
        label: 'Modules offered for this mount',
        fittedSymbol: null,
        selectedKey: null,
      },
      [
        'one family is revealed and its rows are whole; the rest draw a control only',
        'the wide manifest draws it as a rail beside a pane, the compact one as an accordion',
        'a unique reward keeps its labels on its own row, inside its family',
        'each row is named well enough to tell it from its neighbours',
        'a package figure the Almanac never published is a word, never a zero',
      ],
      ['normal', 'expanded-copy', 'rtl', 'canonical-untranslated', 'unavailable-text'],
    ),
    state(
      'empty',
      {
        families: candidateFamilies(FIXTURE_SLOTS.hardpoint, 'zzzz nothing'),
        label: 'Modules offered for this mount',
        fittedSymbol: null,
        selectedKey: null,
      },
      ['a search that matched nothing renders no rows, and no empty structure either'],
    ),
    notApplicable(
      'loading',
      'The list renders what it is given; the replacement surface owns the state where there is nothing to give it yet.',
    ),
    notApplicable(
      'error',
      'A refusal belongs to the edit that was attempted, and is published by the workspace’s refusal notice.',
    ),
    notApplicable(
      'disabled',
      'A mount the Almanac takes no module in renders its own sentence instead of a disabled list.',
    ),
  ],
});

/**
 * The same list with nothing revealed, and the same list after a search.
 *
 * Two more registrations rather than two more states, because a preview has
 * five state slots and these are two more *compositions* of the default one.
 * Both belong in the catalogue sweep: the first is the only place the family
 * control is measured on its own — its 44 CSS px target, its contrast and its
 * unrevealed state under expanded copy and right-to-left — and the searched
 * list is the state FR-023 describes, with every family holding a match present
 * and counted and the families that matched nothing simply absent.
 *
 * The first is also the **fallback selection state**, and it is a different
 * screen in each manifest: handed a list with nothing revealed, the accordion
 * draws every family closed, and the rail draws the first family in package
 * order with its pane full — because canvas 1c's rail always has a selection
 * and never paints an empty pane (FR-021, as restated 2026-08-25).
 */
registerPreview({
  componentId: 'candidate-list-collapsed',
  group: 'Outfitting',
  component: CandidateList,
  contract: contract(
    'candidate-list-collapsed',
    {
      role: 'group',
      visibleNameMatchesAccessibleName: false,
      exposedStates: ['expanded'],
      relationships: ['label'],
      textEquivalents: ['each family\u2019s name and choice count, with its revealed state'],
    },
    ['default'],
  ),
  states: [
    state(
      'default',
      {
        families: candidateFamilies(FIXTURE_SLOTS.hardpoint, '', 'none'),
        label: 'Modules offered for this mount',
        fittedSymbol: null,
        selectedKey: null,
      },
      [
        'every family draws its control, its name and its count',
        'the accordion draws no rows at all; the rail falls back to the first family',
        'the revealed state is published programmatically, never by a caret or an edge alone',
        'the control clears the 44 CSS px target at every width',
      ],
      ['normal', 'expanded-copy', 'rtl', 'canonical-untranslated'],
    ),
    notApplicable(
      'empty',
      'An empty result renders no families; that is the list\u2019s own empty state.',
    ),
    notApplicable('loading', 'The list renders what it is given; the surface owns the busy state.'),
    notApplicable('error', 'A refusal belongs to the edit that was attempted, not to the list.'),
    notApplicable('disabled', 'A family control is never offered and disabled at the same time.'),
  ],
});

registerPreview({
  componentId: 'candidate-list-searched',
  group: 'Outfitting',
  component: CandidateList,
  contract: contract(
    'candidate-list-searched',
    {
      role: 'group',
      visibleNameMatchesAccessibleName: false,
      exposedStates: ['expanded', 'selected'],
      relationships: ['label'],
      textEquivalents: ['the revealed state of every family a search matched'],
    },
    ['default'],
  ),
  states: [
    state(
      'default',
      {
        families: candidateFamilies(FIXTURE_SLOTS.hardpoint, 'multi', 'all'),
        label: 'Modules offered for this mount',
        fittedSymbol: null,
        selectedKey: null,
      },
      [
        'the accordion opens every family holding a match, up to a screenful of them',
        'the rail reveals the first family holding a match, whatever the match count',
        'a family that matched nothing is absent rather than drawn empty',
      ],
      ['normal', 'expanded-copy', 'rtl'],
    ),
    notApplicable('empty', 'A search that matched nothing is the list\u2019s own empty state.'),
    notApplicable('loading', 'The list renders what it is given; the surface owns the busy state.'),
    notApplicable('error', 'A refusal belongs to the edit that was attempted, not to the list.'),
    notApplicable('disabled', 'A family control is never offered and disabled at the same time.'),
  ],
});

registerPreview({
  componentId: 'acquisition-badge',
  group: 'Outfitting',
  component: AcquisitionBadge,
  contract: contract(
    'acquisition-badge',
    {
      role: 'list',
      visibleNameMatchesAccessibleName: false,
      exposedStates: [],
      relationships: ['label'],
      textEquivalents: ['every restriction, as words rather than as a colour'],
    },
    ['default', 'empty'],
  ),
  states: [
    state(
      'default',
      {
        showExplanations: true,
        labels: [
          {
            kind: 'communityGoal',
            packageValue: 'communityGoal',
            messageKey: 'outfitting.acquisition.communityGoal',
            params: null,
          },
          {
            kind: 'uniqueReward',
            packageValue: 'communityGoal',
            messageKey: 'outfitting.acquisition.uniqueReward',
            params: null,
          },
          {
            kind: 'entitlement',
            packageValue: 'ELITE_HORIZONS_V_PLANETARY_LANDINGS',
            messageKey: 'outfitting.acquisition.entitlement',
            params: { token: 'ELITE_HORIZONS_V_PLANETARY_LANDINGS' },
          },
        ],
      },
      [
        'restrictions stack rather than replace one another',
        'the reward marker is the canvas’s route icon and its reason is a sentence',
        'the raw entitlement token is disclosed, not translated away',
      ],
      ['normal', 'expanded-copy', 'rtl', 'long-identity'],
    ),
    state('empty', { labels: [] }, [
      'a module the Almanac puts no restriction on renders nothing at all',
    ]),
    notApplicable('loading', 'A restriction is a fact already read from the package record.'),
    notApplicable('error', 'A restriction is content, not the outcome of an attempt.'),
    notApplicable('disabled', 'A restriction is content, not a control.'),
  ],
});

// ---------------------------------------------------------------------------
// Engineering
//
// Every row of the engineering editor's states table has a fixture here, and
// each is rendered at every viewport the Playwright projects supply. The
// recurring subject is the pair of absences the design keeps apart: a known
// zero and an unstated figure, which look identical if either is drawn as the
// other (engineering editor design, "States").
// ---------------------------------------------------------------------------

/** A recipe the package offers, as the choice list sees it. */
function blueprintChoice(
  fdname: string,
  name: string,
  route: 'ordinary' | 'mercenary',
  applied = false,
): Record<string, unknown> {
  return { fdname, name: localized(name), route, applied };
}

registerPreview({
  componentId: 'blueprint-choice-list',
  group: 'Engineering',
  component: BlueprintChoiceList,
  contract: contract(
    'blueprint-choice-list',
    {
      role: 'radiogroup',
      visibleNameMatchesAccessibleName: false,
      exposedStates: ['selected'],
      relationships: ['label'],
      textEquivalents: [
        'the applied recipe, in words rather than by its fill',
        'the route a recipe needs, where the package says it is not an ordinary one',
        'what clearing the engineering would also remove',
      ],
    },
    ['default', 'empty', 'disabled'],
  ),
  states: [
    state(
      'default',
      {
        choices: [
          blueprintChoice('Weapon_Overcharged', 'Overcharged', 'ordinary', true),
          blueprintChoice('Weapon_LongRange', 'Long Range', 'ordinary'),
          blueprintChoice('RailGun_LongShot', 'Long Shot', 'mercenary'),
        ],
        selected: 'Weapon_Overcharged',
        clearConsequence: null,
      },
      [
        'the explicit no-blueprint option is first, and is the only clear route',
        'no separate clear control exists at any width',
        'the applied recipe is stated, not only filled',
      ],
      ['normal', 'expanded-copy', 'rtl', 'canonical-untranslated', 'long-identity'],
    ),
    state('empty', { choices: [], selected: null, clearConsequence: null }, [
      'a mount with no package menu still offers the way back to a stock module',
    ]),
    state(
      'disabled',
      {
        choices: [blueprintChoice('RailGun_LongShot', 'Long Shot', 'mercenary', true)],
        selected: 'none',
        clearConsequence: 'This also removes the record of the module as a purchased article.',
      },
      ['the loss of purchase identity is disclosed on the option that would cause it'],
      ['normal', 'expanded-copy', 'rtl'],
    ),
    notApplicable(
      'loading',
      'The menu is read synchronously from the package; the editor owns the state where there is nothing to give it yet.',
    ),
    notApplicable(
      'error',
      'A refusal belongs to the edit that was attempted, and is published by the workspace’s refusal notice.',
    ),
  ],
});

registerPreview({
  componentId: 'grade-selector',
  group: 'Engineering',
  component: GradeSelector,
  contract: contract(
    'grade-selector',
    {
      role: 'radiogroup',
      visibleNameMatchesAccessibleName: false,
      exposedStates: ['selected'],
      relationships: ['label'],
      textEquivalents: ['the chosen grade, beside the label as well as in the fill'],
    },
    ['default', 'empty'],
  ),
  states: [
    state('default', { grades: [1, 2, 3, 4, 5], selected: 5 }, [
      'five cells, the chosen one stated as a number as well as filled',
      'no quality or roll control appears anywhere',
    ]),
    state('empty', { grades: [], selected: null }, [
      'no recipe chosen means no grades: a grade is a grade of something',
    ]),
    notApplicable(
      'loading',
      'The grades come with the selected package descriptor and are never awaited separately.',
    ),
    notApplicable(
      'error',
      'A grade cannot fail; applying one can, and that belongs to the editor.',
    ),
    notApplicable(
      'disabled',
      'A recipe with no grades renders no cells rather than five unusable ones.',
    ),
  ],
});

registerPreview({
  componentId: 'fixed-experimental-effect',
  group: 'Engineering',
  component: FixedExperimentalEffect,
  contract: contract(
    'fixed-experimental-effect',
    {
      role: 'text',
      visibleNameMatchesAccessibleName: true,
      exposedStates: [],
      relationships: ['description', 'untranslated-disclosure'],
      textEquivalents: ['the fixed restriction'],
    },
    ['default', 'empty'],
    [
      'normal',
      'expanded-copy',
      'rtl',
      'canonical-untranslated',
      'unavailable-text',
      'long-identity',
    ],
  ),
  states: [
    state(
      'default',
      { effect: canonical('Auto Loader') },
      [
        'states the package effect as fixed content rather than a control',
        'associates the canonical-text disclosure with the package value',
      ],
      ['normal', 'expanded-copy', 'rtl', 'canonical-untranslated', 'long-identity'],
    ),
    state(
      'empty',
      {
        effect: {
          text: null,
          language: null,
          translationState: 'unavailable',
          disclosureKey: 'game-text.unavailable',
        },
      },
      [
        'states an unavailable package name without exposing a raw symbol',
        'keeps the fixed restriction when the package name is unavailable',
      ],
      ['normal', 'unavailable-text'],
    ),
    notApplicable(
      'loading',
      'The carried effect and its package name resolve synchronously from the fitted module.',
    ),
    notApplicable('error', 'A fixed effect is content, not the outcome of an attempted edit.'),
    notApplicable('disabled', 'A fixed effect is content, not a control.'),
  ],
});

registerPreview({
  componentId: 'experimental-effect-list',
  group: 'Engineering',
  component: ExperimentalEffectList,
  contract: contract(
    'experimental-effect-list',
    {
      role: 'radiogroup',
      visibleNameMatchesAccessibleName: false,
      exposedStates: ['selected'],
      relationships: ['label'],
      textEquivalents: [
        'the applied effect, in words',
        'the package’s own description of each effect, or its absence',
      ],
    },
    ['default', 'empty'],
  ),
  states: [
    state(
      'default',
      {
        effects: [
          {
            fdname: 'special_corrosive_shell',
            name: localized('Corrosive Shell'),
            description: localized('Rounds reduce the target’s hull resistance.'),
            applied: true,
          },
          {
            fdname: 'special_auto_loader',
            name: localized('Auto Loader'),
            description: canonical('Reloads while firing, at a smaller clip size.'),
            applied: false,
          },
        ],
        selected: 'special_corrosive_shell',
      },
      [
        'the explicit no-effect option is first, and is the only removal route',
        'each description is the package’s, disclosed where it is untranslated',
      ],
      ['normal', 'expanded-copy', 'rtl', 'canonical-untranslated', 'unavailable-text'],
    ),
    state('empty', { effects: [], selected: null }, [
      'a module with no experimental menu still offers the explicit no-effect option',
    ]),
    notApplicable('loading', 'The menu is read synchronously from the package.'),
    notApplicable(
      'error',
      'A refusal belongs to the edit that was attempted, not to the list of choices.',
    ),
    notApplicable('disabled', 'A final article renders no effect list at all.'),
  ],
});

// The same component in its other shape. A separate declaration rather than
// more states on the one above, because the two shapes state different roles —
// a radio group of cards there, a button over a listbox here — and a contract
// names one role. The open list is reached by pressing the trigger, in the
// preview exactly as in the editor: the menu holds that state itself, and an
// input that forced it open would be a control the editor never sets
// (`openspec/changes/archive/002-module-outfitting/design/engineering-editor.md`, "The effect menu
// is the application's own control").
registerPreview({
  componentId: 'experimental-effect-menu',
  group: 'Engineering',
  component: ExperimentalEffectList,
  contract: contract(
    'experimental-effect-menu',
    {
      role: 'listbox',
      visibleNameMatchesAccessibleName: true,
      exposedStates: ['expanded', 'selected'],
      relationships: ['label', 'description', 'untranslated-disclosure'],
      textEquivalents: [
        'the effect the trigger holds, and whether its list is open',
        'the package’s own description of each option, or its absence',
      ],
    },
    ['default', 'empty'],
  ),
  states: [
    state(
      'default',
      {
        asDropdown: true,
        effects: [
          {
            fdname: 'special_corrosive_shell',
            name: localized('Corrosive Shell'),
            description: localized('Rounds reduce the target’s hull resistance.'),
            applied: true,
          },
          {
            fdname: 'special_auto_loader',
            name: canonical('Auto Loader'),
            description: canonical(
              'An experimental upgrade that automatically reloads the weapon, even when firing.',
            ),
            applied: false,
          },
          {
            fdname: 'special_unknown_effect',
            name: localized('Effect the catalogue has no description for'),
            description: { text: null, language: null, translationState: 'unavailable' },
            applied: false,
          },
        ],
        selected: 'special_corrosive_shell',
      },
      [
        'the trigger names the chosen effect, and draws an untranslated name as one',
        'pressing the trigger opens the list, and pressing it again shuts it',
        'the selected option carries a wash, an edge and a marker — never a tint alone',
        'an option the catalogue has no description for draws its name and nothing under it',
        'every option clears the target baseline every other list row in the editor clears',
        'the arrows walk the options, Enter takes one, and Escape leaves without taking any',
        'each option is named by its own name line and described by the package’s sentence',
      ],
      ['normal', 'expanded-copy', 'rtl', 'canonical-untranslated', 'unavailable-text'],
    ),
    state('empty', { asDropdown: true, effects: [], selected: null }, [
      'nothing chosen reads as the no-effect option on the trigger, never as a symbol',
      'the explicit no-effect option is still the whole removal route',
    ]),
    notApplicable('loading', 'The menu is read synchronously from the package.'),
    notApplicable(
      'error',
      'A refusal belongs to the edit that was attempted, not to the list of choices.',
    ),
    notApplicable('disabled', 'A final article renders no effect menu at all.'),
  ],
});

registerPreview({
  componentId: 'attribute-comparison',
  group: 'Engineering',
  component: AttributeComparison,
  contract: contract(
    'attribute-comparison',
    {
      role: 'table',
      visibleNameMatchesAccessibleName: false,
      exposedStates: [],
      relationships: ['label'],
      textEquivalents: [
        'each figure related to its attribute by a row header, never by column position',
        'a figure the Almanac never published, as a word rather than a zero',
      ],
    },
    ['default', 'empty'],
  ),
  states: [
    state(
      'default',
      {
        rows: [
          { key: 'damage', label: 'Damage', stock: '5.72', modified: '6.90' },
          { key: 'thermalLoad', label: 'Thermal load', stock: '0.34', modified: '0.41' },
          { key: 'powerDraw', label: 'Power draw MW', stock: '0.73', modified: '0.88' },
          { key: 'clipSize', label: 'Clip size', stock: '90', modified: '81' },
          { key: 'mass', label: 'Mass t', stock: null, modified: '4.00' },
        ],
      },
      [
        'no arrow, percentage or better-worse colour appears anywhere',
        'an unavailable figure is a word, never a zero',
      ],
      ['normal', 'expanded-copy', 'rtl', 'german-format', 'unavailable-text'],
    ),
    state('empty', { rows: [] }, [
      'nothing chosen yet means nothing to compare, and no empty table structure either',
    ]),
    notApplicable(
      'loading',
      'The comparison is computed with the draft; the editor owns the state before there is one.',
    ),
    notApplicable(
      'error',
      'A selection the package refuses has no candidate to describe, which the editor states instead.',
    ),
    notApplicable('disabled', 'A comparison is content, not a control.'),
  ],
});

registerPreview({
  componentId: 'power-controls',
  group: 'Engineering',
  component: PowerControls,
  contract: contract(
    'power-controls',
    {
      role: 'group',
      visibleNameMatchesAccessibleName: false,
      exposedStates: ['checked', 'selected'],
      relationships: ['label'],
      textEquivalents: [
        'both controls named by module and mount, so a ledger row is identifiable',
        'an unstated priority group drawn as the group the package puts it in',
      ],
    },
    ['default', 'empty', 'disabled'],
  ),
  states: [
    state(
      'default',
      {
        slotLabel: 'Core internals · Size 8',
        moduleLabel: 'Power Plant 8A',
        enabled: true,
        priority: 2,
        canSetEnabled: true,
        canSetPriority: true,
      },
      [
        'the package’s zero-based group is presented one-based, as the game does',
        'each control names the module and the mount it acts on',
      ],
      ['normal', 'expanded-copy', 'rtl', 'long-identity'],
    ),
    state(
      'empty',
      {
        slotLabel: 'Cargo hatch',
        moduleLabel: 'Cargo Hatch',
        enabled: undefined,
        priority: undefined,
        canSetEnabled: true,
        canSetPriority: true,
      },
      [
        'an absent power field reads as on, the way the package treats it',
        'an unstated group is drawn as group 1, which is where the package puts it',
      ],
    ),
    state(
      'disabled',
      {
        slotLabel: 'Utility mounts · Node 1',
        moduleLabel: 'Heat Sink Launcher',
        enabled: false,
        priority: 4,
        canSetEnabled: false,
        canSetPriority: true,
      },
      ['only what the package permits on this mount is drawn'],
    ),
    notApplicable('loading', 'Power state is read from the fitted module, never awaited.'),
    notApplicable(
      'error',
      'A refused power change is published by the workspace’s refusal notice, not by the control.',
    ),
  ],
});

registerPreview({
  componentId: 'ingress-refusal-notice',
  group: 'Engineering',
  component: IngressRefusalNotice,
  contract: contract(
    'ingress-refusal-notice',
    {
      role: 'alert',
      visibleNameMatchesAccessibleName: false,
      exposedStates: [],
      relationships: ['label'],
      textEquivalents: [
        'every affected mount, module, recipe and roll, named exactly',
        'the package’s own refusal code, named rather than paraphrased',
      ],
    },
    ['default', 'empty'],
  ),
  states: [
    state(
      'default',
      {
        slotLabels: { MainEngines: 'Thrusters', FrameShiftDrive: 'Frame Shift Drive' },
        failures: [
          {
            source: {
              slotKey: 'MainEngines',
              moduleSymbol: 'Int_Engine_Size7_Class5',
              blueprintFdname: 'Engine_Dirty',
              effectFdname: null,
              grade: 5,
              quality: 0.42,
            },
            reason: 'packageResult',
            code: 'unsupportedEngineering',
            params: null,
          },
          {
            source: {
              slotKey: 'FrameShiftDrive',
              moduleSymbol: 'Int_Hyperdrive_Size6_Class5',
              blueprintFdname: null,
              effectFdname: null,
              grade: null,
              quality: 0.08,
            },
            reason: 'packageContract',
            code: null,
            params: null,
          },
        ],
      },
      [
        'the build is said to be exactly as it was',
        'every affected mount is named the way the ledger names it',
        'a source that stated no recipe is not given one',
      ],
      ['normal', 'expanded-copy', 'rtl', 'german-format', 'long-identity'],
    ),
    state('empty', { failures: [], slotLabels: {} }, ['nothing refused renders nothing at all']),
    notApplicable(
      'loading',
      'The refusal is the ingress gate’s finished answer; there is no partway state to render.',
    ),
    notApplicable('error', 'This notice is the error state, so it has no second one.'),
    notApplicable('disabled', 'A notice is content, not a control.'),
  ],
});

registerPreview({
  componentId: 'ship-identity-fields',
  group: 'Engineering',
  component: ShipIdentityFields,
  contract: contract(
    'ship-identity-fields',
    {
      role: 'group',
      visibleNameMatchesAccessibleName: false,
      exposedStates: [],
      relationships: ['label'],
      textEquivalents: [
        'a pencil whose whole name is words, not the glyph it draws',
        'an ID plate control naming the plate it is showing',
      ],
    },
    ['default', 'empty', 'loading'],
  ),
  states: [
    state(
      'default',
      {
        name: 'Pacifier',
        fallbackName: 'Build',
        detail: 'Anaconda',
        ident: 'FD-11X',
        editing: null,
        // A section heading here: the catalogue renders several of these at
        // once, and only the command bar's copy is the document's own name.
        headingLevel: 2,
      },
      [
        'the name is the command bar’s own title, with the pencil beside it',
        'the hull and the ID plate sit under it, exactly as the canvas draws them',
      ],
      ['normal', 'expanded-copy', 'rtl', 'long-identity'],
    ),
    state(
      'empty',
      {
        name: null,
        fallbackName: 'Build',
        detail: 'Anaconda',
        ident: null,
        editing: null,
        headingLevel: 2,
      },
      [
        'a build with no name of its own reads as the screen it is on',
        'an absent ID plate is absent rather than an empty box of text',
      ],
      ['normal', 'expanded-copy', 'rtl'],
    ),
    state(
      'loading',
      {
        name: 'Pacifier',
        fallbackName: 'Build',
        detail: 'Anaconda',
        ident: 'FD-11X',
        editing: 'name',
        headingLevel: 2,
      },
      [
        'the field opens in place, with an explicit confirm beside it',
        'clearing is offered as its own action, and sets absence',
      ],
      ['normal', 'expanded-copy', 'rtl'],
    ),
    notApplicable(
      'error',
      'A refused rename is published by the workspace’s refusal notice, not by the field.',
    ),
    notApplicable(
      'disabled',
      'Where there is no build there is no identity to edit, so the block is absent rather than disabled.',
    ),
  ],
});

// ---------------------------------------------------------------------------
// Feature 010 — hull anatomy
//
// One component: the schematic plate. The side selector is feature 011's
// `ednb-tab-group` in its segmented presentation and the legend is five static
// rows in the capability's own template, so neither is a new export
// (design/hull-anatomy.md, "Component-system impact").
// ---------------------------------------------------------------------------

/**
 * A schematic the catalogue can hold.
 *
 * The plate renders a *validated document*, and the product only ever gets one
 * by fetching a build-time extract. A fixture cannot await that, so this is the
 * frame that extract describes, written out: a real hull symbol, because the
 * picture the plate draws is the rasterised package document and a made-up
 * symbol would be a broken image, and that hull's own box because the marks are
 * placed inside it.
 *
 * Four numbers of a published extent is not the private geometry catalogue
 * feature 010's FR-009 forbids — nothing is served from here and no mount is identified by
 * it. The mounts over the picture are the synthetic ones below, which is what
 * this preview is for: every treatment the legend explains, on one plate.
 */
function schematicDocument(side: 'top' | 'bottom'): Record<string, unknown> {
  return {
    side,
    symbol: 'Anaconda',
    viewBox: '0 0 1200 800',
    // The Anaconda's own extent inside that box: nose-up, 292 units of ship in
    // 1200 units of frame, which is what the quarter turn and the centring are
    // there to deal with.
    content: { x: 454, y: 40, width: 292, height: 720 },
    // The plate draws its mounts from the occurrences it is handed, which is
    // how one item stays one identity across two sides; the document's own
    // annotations are the projector's input, not the plate's.
    annotations: [],
  };
}

function mountOccurrence(
  key: string,
  kind: 'hardpoint' | 'utility',
  fitted: boolean,
  engineered: boolean,
  node: number,
  centre: { x: number; y: number },
): Record<string, unknown> {
  return {
    item: {
      key,
      name: key.replace(/([a-z])([A-Z])/g, '$1 $2'),
      kind,
      node,
      fitted,
      engineered,
      sides: ['top'],
    },
    side: 'top',
    centre,
  };
}

registerPreview({
  componentId: 'hull-schematic',
  group: 'Outfitting',
  component: HullSchematic,
  contract: contract(
    'hull-schematic',
    {
      role: 'figure',
      visibleNameMatchesAccessibleName: false,
      exposedStates: ['pressed'],
      relationships: ['label', 'description'],
      textEquivalents: [
        'each mount names its slot, kind, side, fitted state and engineering in words',
        'selection is exposed as pressed state, not by the fill alone',
        'a side that did not arrive says so in place of the drawing',
      ],
    },
    ['default', 'empty', 'loading', 'error'],
  ),
  states: [
    state(
      'default',
      {
        view: {
          side: 'top',
          state: { kind: 'ready', document: schematicDocument('top') },
          occurrences: [
            mountOccurrence('SmallHardpoint1', 'hardpoint', true, true, 1, { x: 520, y: 300 }),
            mountOccurrence('SmallHardpoint2', 'hardpoint', true, false, 2, { x: 680, y: 300 }),
            mountOccurrence('MediumHardpoint1', 'hardpoint', false, false, 3, { x: 520, y: 520 }),
            mountOccurrence('TinyHardpoint1', 'utility', true, false, 1, { x: 680, y: 520 }),
            // Twenty units from `MediumHardpoint1`, which is closer than a
            // mark is wide: the Almanac's own case, where a utility sits inside
            // a hardpoint's footprint. This mark steps aside and draws a leader
            // back to the point the package published.
            mountOccurrence('TinyHardpoint2', 'utility', true, false, 2, { x: 500, y: 520 }),
          ],
          selectedKey: 'SmallHardpoint1',
          hullName: 'Anaconda',
        },
      },
      [
        'every state the legend explains is drawn at once: selected, fitted, empty, utility, engineered',
        'no mount state is carried by colour, dash or fill alone',
        'each mount is a named button carrying its node number, as the canvas draws it',
        "the plate holds the whole hull at the hull's own ratio, so nothing pans or scrolls",
        'a mark that would touch its neighbour steps aside and is tied back to its own mount by a hairline',
      ],
      CONTROL_VARIANTS,
    ),
    state(
      'empty',
      {
        view: {
          side: 'bottom',
          state: { kind: 'ready', document: schematicDocument('bottom') },
          occurrences: [],
          selectedKey: null,
          hullName: 'Anaconda',
        },
      },
      [
        'a side the package annotates no mount on draws its artwork and claims nothing',
        'the complete outfitting ledger beside it is still the route to every slot it draws',
      ],
      ['normal', 'rtl', 'reduced-motion'],
    ),
    state(
      'loading',
      {
        view: {
          side: 'top',
          state: { kind: 'loading' },
          occurrences: [],
          selectedKey: null,
          hullName: 'Anaconda',
        },
      },
      [
        'the pending state is stated in text, in place of the drawing',
        'the side is still named, so a peer plate reads as one of two',
      ],
    ),
    state(
      'error',
      {
        view: {
          side: 'bottom',
          state: { kind: 'temporarilyUnavailable' },
          occurrences: [],
          selectedKey: null,
          hullName: 'Anaconda',
        },
      },
      [
        'the absence is explained as temporary and never as a hull without geometry',
        'a retry is offered that does not reload the page',
        'a package defect renders the same way without the retry, because retrying cannot fix it',
      ],
      ['normal', 'expanded-copy', 'rtl'],
    ),
    notApplicable(
      'disabled',
      'A plate is a drawing of mounts, not a control that gates anything; a mount that cannot be acted on is absent from the schematic, and its ledger row states why.',
    ),
  ],
});

registerPreview({
  componentId: 'diagnostic-list',
  group: 'Technical',
  component: DiagnosticList,
  contract: contract(
    'diagnostic-list',
    {
      role: 'list',
      visibleNameMatchesAccessibleName: false,
      exposedStates: [],
      relationships: ['label'],
      textEquivalents: [
        'every diagnostic names its own entry, property, code, constraint and reason',
        'a reason the package had no translation for says so beside it',
      ],
    },
    ['default', 'empty'],
  ),
  states: [
    state(
      'default',
      {
        label: 'What was refused',
        diagnostics: [
          {
            id: '0',
            index: '1',
            path: 'entries[1].header.appName',
            code: 'invalidHeader',
            constraint: 'stringRequired',
            reason: 'entries[1].header.appName must be a string',
            disclosure: null,
            reasonLanguage: 'en',
          },
          {
            id: '1',
            index: '2',
            path: 'entries[2].Modules[14].Engineering.Quality',
            code: 'invalidEngineering',
            constraint: 'unitInterval',
            reason: 'entries[2].Modules[14].Engineering.Quality must be between 0 and 1',
            disclosure:
              'Shown in its original language, because no German text is available for it.',
            reasonLanguage: 'en',
          },
        ],
      },
      [
        'each diagnostic is one list item carrying all five package facts',
        'a package index is shown as the package gave it, never renumbered',
        'a long property path wraps inside the list rather than widening the page',
        'every technical value is direction-isolated',
      ],
      ['normal', 'expanded-copy', 'rtl', 'canonical-untranslated', 'long-identity'],
    ),
    state('empty', { label: 'What was refused', diagnostics: [] }, [
      'nothing rejected renders no rows at all',
    ]),
    notApplicable(
      'loading',
      'Diagnostics are the inspector’s finished answer; the layer owns the state while it is being read.',
    ),
    notApplicable('error', 'This list is the error detail, so it has no second error state.'),
    notApplicable('disabled', 'A list of diagnostics is content, not a control.'),
  ],
});

// ---------------------------------------------------------------------------
// Feature 004 — the exchange layers themselves.
//
// The two surfaces a Commander actually sees, previewed as their own states
// rather than only through their parts. A field and a diagnostic list that each
// look right on their own can still stack into a layer that clips at 200% text.
// ---------------------------------------------------------------------------

const SLEF_PAYLOAD = `[
  {
    "header": { "appName": "Ship Builder", "appVersion": "0.1.0" },
    "data": {
      "event": "Loadout",
      "Ship": "anaconda",
      "Modules": [{ "Slot": "MainEngines", "Item": "int_engine_size7_class5", "On": true }]
    }
  }
]`;

const IMPORT_VIEW = {
  title: 'Import build',
  description: 'Paste a SLEF export or a journal Loadout event.',
  accepted: 'SLEF v1 · Journal Loadout event',
  fieldLabel: 'SLEF payload',
  draft: '',
  status: '',
  busy: false,
  failure: null,
  submitLabel: 'Load build',
  cancelLabel: 'Cancel',
  canSubmit: false,
  dropLabel: 'Select or drop journal files',
  scanned: null,
  scanning: false,
  dividerLabel: 'Or paste',
  picks: [],
  picksLabel: null,
} as const;

registerPreview({
  componentId: 'journal-import-layer',
  group: 'Exchange',
  component: JournalImportLayer,
  contract: contract(
    'journal-import-layer',
    {
      role: 'group',
      visibleNameMatchesAccessibleName: true,
      exposedStates: ['invalid', 'busy'],
      relationships: ['label', 'description', 'error'],
      textEquivalents: [
        'the payload field’s own name, read but not drawn',
        'why an import was refused, in the application’s own framing',
        'what was refused, fact by fact, behind the control that names it',
      ],
    },
    ['default', 'empty', 'loading', 'error'],
  ),
  states: [
    state(
      'default',
      {
        view: {
          ...IMPORT_VIEW,
          draft: SLEF_PAYLOAD,
          canSubmit: true,
          scanned: 'Journal.2026-09-01T100000.01.log · 3 builds',
          submitLabel: 'Load 2 builds',
          picksLabel: '3 builds found · select one or more · 2 selected',
          picks: [
            {
              key: 'night-watch',
              title: 'Night Watch · NW-01',
              detail: 'Anaconda · 42 modules',
              meta: '2026-09-01 10:00',
              selected: true,
            },
            {
              key: 'day-watch',
              title: 'Day Watch',
              detail: 'Python Mk II · 30 modules',
              meta: '2026-08-30 21:14',
              selected: true,
            },
            {
              key: 'stock',
              title: 'Sidewinder',
              detail: 'Sidewinder · 12 modules',
              meta: '2026-08-12 08:02',
              selected: false,
            },
          ],
        },
      },
      [
        'the payload is monospaced, direction-isolated and editable',
        'the status line holds its height while it has nothing to say',
        'the file control carries its own label and what the last scan read',
        'each build a scan found is a checkbox with its own name, hull and time',
        'Cancel and the counted load action are the only controls, as the canvas draws them',
      ],
      ['normal', 'expanded-copy', 'rtl', 'reduced-motion', 'long-identity'],
    ),
    state('empty', { view: IMPORT_VIEW }, [
      'an empty draft is a field and a sentence, with nothing said about it yet',
      'Load build is unavailable until there is something to load',
    ]),
    state(
      'loading',
      {
        view: {
          ...IMPORT_VIEW,
          draft: SLEF_PAYLOAD,
          busy: true,
          scanning: true,
          status: 'Reading 3 files',
        },
      },
      [
        'the draft stays readable while it is being inspected',
        'the busy state is named in text, not only shown as motion',
      ],
    ),
    state(
      'error',
      {
        view: {
          ...IMPORT_VIEW,
          draft: '[{ "header": {}, "data": {} }]',
          failure: {
            message: 'This entry was refused.',
            diagnosticsLabel: 'What was refused',
            advancedLabel: 'Show advanced',
            refusals: [],
            diagnostics: [
              {
                id: '0',
                index: '0',
                path: 'entries[0].header.appName',
                code: 'invalidHeader',
                constraint: 'stringRequired',
                reason: 'entries[0].header.appName must be a string',
                disclosure: null,
                reasonLanguage: 'en',
              },
            ],
          },
        },
      },
      [
        'the refusal is said in words and the field is marked invalid',
        'the exact draft survives the refusal',
        'the package’s diagnostics are listed beneath, unflattened',
      ],
      ['normal', 'expanded-copy', 'rtl', 'long-identity'],
    ),
    notApplicable(
      'disabled',
      'The layer is either open and usable or not mounted; a disabled import layer would be a dialog nobody can leave.',
    ),
  ],
});

const EXPORT_VIEW = {
  title: 'Export build · Anaconda',
  modeLabel: 'Format',
  // The canvas's own order: the payload first, the link beside it.
  modes: [
    {
      mode: 'slef',
      label: 'SLEF JSON',
      description: 'Interchange format read by Coriolis, EDSY and Inara.',
      selected: true,
    },
    {
      mode: 'link',
      label: 'Share link',
      description: 'The link to this build.',
      selected: false,
    },
  ],
  fieldLabel: 'SLEF payload',
  payload: SLEF_PAYLOAD,
  metadata: 'SLEF v1 · 41 modules · 4.1 kB',
  generating: null,
  stale: null,
  validation: null,
  link: null,
  actions: [
    { action: 'download', label: 'Download', status: null, failed: false },
    { action: 'copy', label: 'Copy', status: null, failed: false },
  ],
} as const;

registerPreview({
  componentId: 'slef-export-layer',
  group: 'Exchange',
  component: ExportBuildLayer,
  contract: contract(
    'slef-export-layer',
    {
      role: 'group',
      visibleNameMatchesAccessibleName: true,
      exposedStates: ['disabled'],
      relationships: ['label'],
      textEquivalents: [
        'what the payload is, and how large',
        'whether a link travelled with it, and why not when it did not',
        'what each delivery action reported',
      ],
    },
    ['default', 'empty', 'loading', 'error', 'disabled'],
  ),
  states: [
    state(
      'default',
      { view: EXPORT_VIEW },
      [
        'the payload is present and selectable before anything is pressed',
        'Download and Copy are both offered, and Share only where the platform has it',
        'the metadata and the actions share one row, and stack rather than clip',
      ],
      ['normal', 'expanded-copy', 'rtl', 'reduced-motion', 'long-identity'],
    ),
    state(
      'empty',
      {
        view: {
          ...EXPORT_VIEW,
          payload: '',
          metadata: null,
          link: null,
          stale: 'This build has changed since the export was made. Make it again.',
        },
      },
      [
        'an artifact dropped because the build moved on says so rather than leaving a blank field',
        'no delivery is offered for a payload that is not there',
      ],
    ),
    state(
      'loading',
      {
        view: { ...EXPORT_VIEW, payload: '', metadata: null, generating: 'Preparing this export' },
      },
      ['the pending state is named in text'],
    ),
    state(
      'error',
      {
        view: {
          ...EXPORT_VIEW,
          validation: 'The Almanac reports this build as invalid. It is exported exactly as it is.',
          link: 'The export carries no link, because this build cannot be shared as one.',
          actions: [
            { action: 'download', label: 'Download', status: null, failed: false },
            {
              action: 'copy',
              label: 'Copy',
              status:
                'The payload could not be copied. Select the text above and copy it yourself.',
              failed: true,
            },
          ],
        },
      },
      [
        'an invalid build is still exported, with the verdict said out loud',
        'a refused clipboard leaves the payload on screen and names the way round it',
        'the failure is named in words, never by colour alone',
      ],
      ['normal', 'expanded-copy', 'rtl'],
    ),
    state('disabled', { view: { ...EXPORT_VIEW, payload: '', metadata: null, link: null } }, [
      'every delivery control is unavailable while there is no payload to deliver',
    ]),
  ],
});

/**
 * The licence block, carrying the build's own disclaimer rather than a sample.
 *
 * A preview of a legal notice that shows lorem ipsum proves the layout of a
 * paragraph nobody ships. This is the exact text the application embeds, read
 * from the same generated module the modal reads, so what the catalogue draws
 * at every width and in every variant is the notice a Commander actually meets.
 */
const HELP_LICENCE = {
  index: [
    {
      id: 'application',
      before: BUNDLED_ENGLISH['help.licence.index.application'].replace('{{licence}}', ''),
      link: {
        label: BUNDLED_ENGLISH['help.licence.link.application'],
        href: HELP_MANIFEST.destinations.repositoryLicense.url,
      },
      after: '',
    },
    {
      id: 'library',
      before: BUNDLED_ENGLISH['help.licence.index.library'].replace('{{licence}}', ''),
      link: {
        label: BUNDLED_ENGLISH['help.licence.link.library'],
        href: HELP_MANIFEST.destinations.almanacLicense.url,
      },
      after: '',
    },
    {
      id: 'gameData',
      before: BUNDLED_ENGLISH['help.licence.index.gameData'],
      link: null,
      after: '',
    },
    {
      id: 'typefaces',
      before: BUNDLED_ENGLISH['help.licence.index.typefaces'],
      link: null,
      after: '',
    },
  ],
  excerpt: HELP_MANIFEST.disclaimer.exactText,
  excerptLanguage: HELP_MANIFEST.disclaimer.language,
};

/**
 * The version line, carrying this build's own identities rather than samples.
 *
 * Read from the generated manifest for the same reason the excerpt above is:
 * `APP VERSION 4.2.1 · LIBRARY VERSION 3.8.0.3` is what the reference draws,
 * and a catalogue that reproduced those numbers would be previewing a claim
 * nothing in the repository can make.
 *
 * Two facts, because the reference draws two. The build-state fact an earlier
 * revision drew here is withdrawn with FR-007's display half: the generator
 * still classifies release evidence, and the modal still says nothing about it.
 */
const HELP_ABOUT_FACTS = [
  {
    id: 'application',
    term: BUNDLED_ENGLISH['help.about.version.application'],
    value: HELP_MANIFEST.build.applicationVersion,
  },
  {
    id: 'almanac',
    term: BUNDLED_ENGLISH['help.about.version.almanac'],
    value: HELP_MANIFEST.almanac.version,
  },
];

/**
 * The source sentence, cut at its placeholder the way the presenter cuts it.
 *
 * The link sits inside the sentence rather than at the end of it, so both
 * halves are kept: a catalogue that dropped the tail would draw the full stop
 * before the link instead of after it.
 */
const HELP_SOURCE_SENTENCE = BUNDLED_ENGLISH['help.source'].split('{{source}}');

const HELP_ABOUT = {
  maintainer: BUNDLED_ENGLISH['help.maintainer'],
  source: {
    id: 'source',
    before: HELP_SOURCE_SENTENCE[0] ?? '',
    link: {
      label: BUNDLED_ENGLISH['help.source.link'],
      href: HELP_MANIFEST.destinations.repositorySource.url,
    },
    after: HELP_SOURCE_SENTENCE[1] ?? '',
  },
  facts: HELP_ABOUT_FACTS,
};

/**
 * Every question, read from the generated catalogue and the bundled English
 * messages rather than typed in here.
 *
 * A catalogue page that listed its own copy of the questions would keep
 * rendering the old set on the day the modal started rendering a new one.
 */
const HELP_TOPIC_VIEWS = HELP_TOPICS.map((topic) => ({
  id: topic.id,
  question: BUNDLED_ENGLISH[topic.questionKey as MessageKey],
  answer: BUNDLED_ENGLISH[topic.answerKey as MessageKey],
}));

const HELP_VIEW = {
  title: BUNDLED_ENGLISH['help.title'],
  purpose: BUNDLED_ENGLISH['help.purpose'],
  sections: { about: 'About', faq: 'FAQ', licence: 'Licence' },
  about: HELP_ABOUT,
  topics: HELP_TOPIC_VIEWS,
  licence: HELP_LICENCE,
};

registerPreview({
  componentId: 'version-facts',
  group: 'Panels',
  component: VersionFacts,
  contract: contract(
    'version-facts',
    {
      role: 'list',
      visibleNameMatchesAccessibleName: false,
      exposedStates: [],
      relationships: [],
      textEquivalents: [
        'which application version this is',
        'which bundled Almanac version it reads',
      ],
    },
    ['default'],
  ),
  states: [
    state(
      'default',
      { facts: HELP_ABOUT_FACTS },
      [
        'every value is announced with the term that says what it is',
        'the application and the bundled Almanac are separate facts, never one line',
        'long version identifiers wrap; the row never scrolls sideways',
      ],
      ['normal', 'expanded-copy', 'rtl', 'long-identity'],
    ),
    notApplicable(
      'empty',
      'The identities are build evidence: a build that could not name itself fails generation rather than rendering an empty fact list.',
    ),
    notApplicable(
      'loading',
      'The values are compiled into the bundle; there is nothing to wait for.',
    ),
    notApplicable(
      'error',
      'A missing, empty or unsafe identity fails generation; it is never a state this renders.',
    ),
    notApplicable('disabled', 'Facts are read, never operated.'),
  ],
});

registerPreview({
  componentId: 'inline-link',
  group: 'Panels',
  component: InlineLink,
  contract: contract(
    'inline-link',
    {
      role: 'link',
      visibleNameMatchesAccessibleName: true,
      exposedStates: [],
      relationships: [],
      textEquivalents: [],
    },
    ['default'],
  ),
  states: [
    state(
      'default',
      {
        label: BUNDLED_ENGLISH['help.licence.link.application'],
        href: HELP_MANIFEST.destinations.repositoryLicense.url,
      },
      [
        'the destination is named in the visible words, so a Commander is told before they leave',
        'the address itself is never drawn: it is a thing to mistype and a line that wraps sideways',
        'it is underlined, so it is not a link by colour alone',
        'it sits in the text flow: no target box, no padding, no row of its own',
        'it takes SC 2.5.8’s inline exception because it is in a sentence, and the stage puts one around it',
        'expanded copy wraps with the sentence rather than pushing the page sideways',
      ],
      ['normal', 'expanded-copy', 'rtl'],
      false,
      // The sentence is the point. Rendered bare, this component would be
      // previewed in a shape the product never draws, and the catalogue's own
      // target-size sweep would measure a link that is not in a sentence
      // against a baseline the standard exempts sentences from.
      ['App · ', ' covers this application’s own code.'],
    ),
    notApplicable(
      'empty',
      'A link with no words is a link nobody can read; the caller supplies both or draws neither.',
    ),
    notApplicable(
      'loading',
      'An address is compiled into the bundle; there is nothing to wait for.',
    ),
    notApplicable(
      'error',
      'A destination that could not be audited fails generation rather than rendering an error.',
    ),
    notApplicable(
      'disabled',
      'A licence a Commander may not read is not a state this application has.',
    ),
  ],
});

registerPreview({
  componentId: 'legal-excerpt',
  group: 'Panels',
  component: LegalExcerpt,
  contract: contract(
    'legal-excerpt',
    {
      role: 'none',
      visibleNameMatchesAccessibleName: false,
      exposedStates: [],
      relationships: [],
      textEquivalents: ['the language the quoted notice is written in'],
    },
    ['default'],
  ),
  states: [
    state(
      'default',
      { text: HELP_LICENCE.excerpt, language: HELP_LICENCE.excerptLanguage },
      [
        'the excerpt is the exact text of the build, rendered as text and never as markup',
        'the region is marked in the language the notice was written in, whatever the interface is',
        'an RTL interface reflows the section around an unchanged left-to-right English region',
        'the notice wraps within the measure; it never needs to be dragged sideways',
      ],
      ['normal', 'expanded-copy', 'rtl'],
    ),
    notApplicable(
      'empty',
      'The excerpt is build evidence: a modal that reached this component with nothing to quote is a build that failed generation.',
    ),
    notApplicable('loading', 'The text is compiled into the bundle; there is nothing to wait for.'),
    notApplicable(
      'error',
      'A missing or drifted excerpt fails generation rather than rendering an error.',
    ),
    notApplicable('disabled', 'A quoted document has no disabled state.'),
  ],
});

registerPreview({
  componentId: 'help-dialog',
  group: 'Layers',
  component: HelpDialog,
  contract: contract(
    'help-dialog',
    {
      role: 'dialog',
      visibleNameMatchesAccessibleName: true,
      // No state of its own to expose. The modal is either mounted and open or
      // not mounted at all — there is no collapsed form of it for an
      // `aria-expanded` to describe, and declaring one would be describing a
      // control this component does not draw.
      exposedStates: [],
      relationships: ['label'],
      textEquivalents: ['open and closed state, in text rather than by dimming or motion'],
    },
    ['default', 'empty'],
  ),
  states: [
    state(
      'default',
      { open: true, view: HELP_VIEW, dismissLabel: 'Close' },
      [
        'one dialog, named by its visible title, over an inert capability',
        'ABOUT, then FAQ, then LICENCE — the reference’s own order, at every width',
        'the header and its close stay pinned over a body that scrolls alone',
        'wide viewports centre a bounded dialog; narrow ones raise a full-width sheet',
        'a short viewport and 400% zoom take the full-height treatment rather than clipping',
        'reduced motion makes open and close immediate without removing content',
        'ABOUT reads purpose, maintainer and where the source is before its facts',
        'ABOUT names the application version and the bundled Almanac as separate facts',
        'FAQ answers both questions, once each, in the order they are declared',
        'each question is a heading over its own answer, never one run of prose',
        'LICENCE opens with the five-line summary of what covers what',
        'LICENCE then carries the exact Frontier notice once, marked as English',
        'the only links out are the two licence documents and this application’s source',
      ],
      ['normal', 'expanded-copy', 'rtl', 'reduced-motion'],
      // Isolated: an open modal makes everything behind it inert, which is
      // correct behaviour and incompatible with sharing a catalogue page.
      true,
    ),
    state('empty', { open: false, view: HELP_VIEW, dismissLabel: 'Close' }, [
      'a closed modal renders nothing, holds no focus and covers no capability',
    ]),
    notApplicable(
      'loading',
      'Every fact is compiled into the bundle, so there is no moment at which the modal is open and does not know what to say.',
    ),
    notApplicable(
      'error',
      'A missing or mismatched artifact fails generation; it is never a state the modal renders.',
    ),
    notApplicable('disabled', 'Help is either open or closed; it has no disabled state.'),
  ],
});

// ---------------------------------------------------------------------------
// Feature 013 — the equipment bench
//
// Two components, both shared by every chooser and every reading on the bench.
// The regions themselves — the ledger, the item view and the commander stats —
// are not here: their inputs are presenter view models carrying package
// figures, and a fixture for one would have to state a shield strength or a DPS
// that no package call produced. That is the one thing a fixture may never be
// (constitution II), so those four surfaces are swept as the bench itself in
// `e2e/equipment-builder.spec.ts` instead.
// ---------------------------------------------------------------------------

registerPreview({
  componentId: 'resistance-bar',
  group: 'Equipment',
  component: ResistanceBar,
  contract: contract(
    'resistance-bar',
    {
      role: 'group',
      visibleNameMatchesAccessibleName: true,
      exposedStates: [],
      relationships: ['label'],
      textEquivalents: [
        'the signed percentage as text, so the bar carries none of the meaning',
        'a resistance that is a weakness, by its sign rather than by its colour',
      ],
    },
    ['default', 'empty'],
  ),
  states: [
    state(
      'default',
      { label: 'Kinetic', value: '+35%', magnitude: 0.35, negative: false },
      [
        'the figure is text beside the bar, and the bar is hidden from the reader',
        'the sign is on the number rather than in the direction the bar grows',
      ],
      ['normal', 'expanded-copy', 'rtl', 'reduced-motion', 'german-format'],
    ),
    state('empty', { label: 'Explosive', value: '0%', magnitude: 0, negative: false }, [
      'no resistance draws no bar and still states the figure',
    ]),
    state(
      'disabled',
      { label: 'Thermal', value: '-15%', magnitude: 0.15, negative: true },
      ['a weakness reads as a negative figure, not as a differently coloured bar'],
      ['normal', 'rtl', 'german-format'],
    ),
    notApplicable(
      'loading',
      'The figure arrives with the suit reading it belongs to; the bar is never drawn awaiting one.',
    ),
    notApplicable('error', 'A resistance the package does not publish is not rendered at all.'),
  ],
});

registerPreview({
  componentId: 'choice-list',
  group: 'Equipment',
  component: ChoiceList,
  contract: contract(
    'choice-list',
    {
      role: 'list',
      visibleNameMatchesAccessibleName: false,
      exposedStates: ['selected'],
      relationships: ['label'],
      textEquivalents: ['the fitted or worn row, as state rather than as a wash'],
    },
    ['default', 'empty'],
  ),
  states: [
    state(
      'default',
      {
        label: 'Primary weapon',
        choices: [
          {
            id: 'a',
            name: localized('Karma AR-50'),
            meta: 'RIFLE · KINETIC · AUTOMATIC',
            figure: 'G3',
            current: true,
          },
          {
            id: 'b',
            name: canonical('TK Aphelion'),
            meta: 'RIFLE · THERMAL · AUTOMATIC',
            figure: null,
            current: false,
          },
        ],
      },
      [
        'the fitted row carries its state as well as its wash',
        'a row with no figure draws none rather than a zero',
        'package text with no translation is marked as the language it is in',
      ],
      ['normal', 'expanded-copy', 'rtl', 'canonical-untranslated', 'long-identity'],
    ),
    state('empty', { label: 'Primary weapon', choices: [] }, [
      'nothing offered draws no rows, and no row-shaped placeholder',
    ]),
    notApplicable(
      'loading',
      'Every chooser is built synchronously from the equipment library; there is no moment at which the list is open and empty of an answer.',
    ),
    notApplicable(
      'disabled',
      'Every row this list draws can be chosen. The 2026-09-04 canvas revision took the refused row out of the modification picker rather than drawing it, and the swap block lists the fitted item as a row a Commander can press.',
    ),
    notApplicable(
      'error',
      'A refusal belongs to the choice that was attempted, and the bench publishes it.',
    ),
  ],
});

registerPreview({
  componentId: 'tool-card',
  group: 'Navigation',
  component: ToolCard,
  contract: contract(
    'tool-card',
    {
      role: 'link',
      visibleNameMatchesAccessibleName: true,
      exposedStates: [],
      relationships: [],
      textEquivalents: ['the go mark, which repeats the destination the link already names'],
    },
    ['default'],
  ),
  states: [
    state(
      'default',
      {
        name: 'Ship Builder',
        href: '/ships',
        subjects: 'Shipyard · Outfitting · Anatomy · Power',
        summary:
          'Fit any ship slot by slot, set power priorities, apply engineering blueprints and watch jump range, shields and rebuy move as you go.',
        short: 'Ships, module slots, power priorities, engineering.',
      },
      [
        'the whole card is one link, and its accessible name is the tool name alone',
        'exactly one of the two descriptions is shown at any width',
        'the go mark is hidden from a reader, which the link already names',
      ],
      ['normal', 'expanded-copy', 'rtl', 'long-identity'],
    ),
    notApplicable(
      'empty',
      'A tool card always names a tool and a destination. A card for no tool is a control for something that does not exist.',
    ),
    notApplicable(
      'loading',
      'The tool registry is a source literal, so it is resolved before the first frame and there is no moment at which the card is waiting.',
    ),
    notApplicable(
      'error',
      'The card renders what it is handed and performs nothing that can fail.',
    ),
    notApplicable(
      'disabled',
      'Every tool offered answers an address. A tool that could not be opened would be left out of the registry rather than drawn unavailable.',
    ),
  ],
});

registerPreview({
  componentId: 'file-drop',
  group: 'Fields',
  component: FileDrop,
  contract: contract(
    'file-drop',
    {
      role: 'button',
      visibleNameMatchesAccessibleName: true,
      exposedStates: ['disabled'],
      relationships: ['label', 'description'],
      textEquivalents: ['what the last selection came to'],
    },
    ['default', 'empty', 'loading', 'disabled'],
  ),
  states: [
    state(
      'default',
      {
        label: 'Select or drop journal files',
        hint: 'Journal, log and JSON files, several at a time',
        scanned: 'Journal.2026-09-01T100000.01.log \u00b7 4 builds',
        accept: '.log,.json,.txt,application/json',
      },
      [
        'the label names the control and belongs to the file input',
        'the hint and the scanned line are associated by aria-describedby',
        'the input keeps the keyboard operation the browser gives it',
      ],
      ['normal', 'expanded-copy', 'rtl', 'long-identity'],
    ),
    state('empty', { label: 'Select or drop journal files' }, [
      'renders before anything has been chosen, with the label alone',
    ]),
    state('loading', { label: 'Select or drop journal files', busy: true }, [
      'the control is unavailable while what was chosen is being read',
    ]),
    notApplicable(
      'error',
      'The plate takes files and reports nothing about them. What a file holds is refused by the surface that asked for it, where the refusal is read.',
    ),
    state('disabled', { label: 'Select or drop journal files', disabled: true }, [
      'exposes the disabled state natively on the file control',
    ]),
  ],
});
