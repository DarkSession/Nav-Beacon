#!/usr/bin/env node
/**
 * Repository policy checks for the interface foundation.
 *
 * These are the rules that cannot be expressed as a type or a unit test,
 * because they are about what must *not* appear anywhere: a hard-coded English
 * label, a hex colour outside the token sources, a component nobody previews, a
 * skipped interface suite.
 *
 * The checks parse rather than grep. Angular's own template parser reads
 * templates, the TypeScript compiler reads component metadata, and the
 * `postcss-scss` parser reads stylesheets — so structural punctuation, token
 * calculations and dynamic bindings are understood as what they are, instead of
 * tripping a regular expression.
 *
 * Every rule here reads the product and the four documents that state the
 * conformance target. None of them reads `openspec/`: the rules that reconcile
 * the specification record against this repository are
 * `scripts/check-specification-record.mjs`, so a change to a specification
 * cannot fail this checker and does not need the pipeline this checker gates.
 *
 * Exit code 0 means every rule passed. Any violation prints its file, line and
 * the reason, and fails the build (FR-024).
 */
import { readFile, readdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TmplAstText, TmplAstTextAttribute, parseTemplate } from '@angular/compiler';
import ts from 'typescript';
import scssSyntax from 'postcss-scss';
import {
  contentBearingAddresses,
  declaredOrigin,
  readSitemap,
} from './search/published-addresses.mjs';
import { prerenderRoutes } from './generate-prerender-routes.mjs';
import { conformanceClaimViolations } from './conformance-claims.mjs';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));

/** Source of truth for what the checker inspects. */
export const SCOPE = {
  /** Product source. Application-owned display text lives here and nowhere else. */
  product: 'src',
  /** The only files permitted to contain governed visual literals. */
  tokenSources: [
    'src/styles/tokens/_primitives.scss',
    'src/styles/tokens/_semantic.scss',
    'src/styles/_fonts.scss',
  ],
  ledger: 'e2e/coverage-ledger.ts',
  /** The application-owned message catalogues. English defines the schema. */
  catalogues: 'src/app/i18n/locales',
  /** The application's one service-worker configuration. */
  serviceWorkerConfig: 'ngsw-config.json',
  /**
   * Files that may state the conformance target on the project's behalf.
   *
   * The constitution is among them because it is where the excluded set is
   * defined: a rule that reads every document quoting the target and not the
   * one that sets it has a hole in the middle of it.
   */
  conformanceDocuments: ['README.md', 'AGENTS.md', 'CONTRIBUTING.md', 'CONSTITUTION.md'],
  /** The emitted production output, inspected as shipped. */
  productionOutput: 'dist/navbeacon/browser',
  /** Where the build is configured to place the copied hull schematics. */
  extractedSchematics: 'public/assets/ships',
  previewManifest: 'src/app/ui/previews/preview-manifest.ts',
  /**
   * The shared waiting mark, whose own stylesheet is the only place a
   * reduced-motion rule can reach it.
   */
  waitingMark: 'public/assets/loader.svg',
  uiComponents: 'src/app/ui/components',
  /** Interface suites that may never be skipped, focused or quarantined. */
  testGlobs: ['e2e', 'src/app/ui', 'src/app/i18n', 'src/app/platform'],
  /**
   * Composition steps stated twice, and the two statements to reconcile.
   *
   * Where a behaviour turns on a composition rather than an arrangement, the
   * step has to be stated in TypeScript as well, because behaviour is not
   * decided in a stylesheet. That is a second copy of a figure the stylesheets
   * own, and a second copy that drifts is a manifest reading a hull into a rail
   * that is not drawn (`src/app/ui/wide-composition.ts`).
   *
   * So the two are reconciled by the `composition-step` rule rather than by a
   * comment promising they agree.
   */
  duplicatedSteps: [
    {
      scss: { file: 'src/styles/_responsive.scss', name: '$mode-wide-min' },
      ts: { file: 'src/app/ui/wide-composition.ts', name: 'WIDE_MODE_MIN_REM' },
    },
    {
      scss: { file: 'src/styles/_responsive.scss', name: '$viewport-short-max' },
      ts: { file: 'src/app/ui/short-viewport.ts', name: 'STACKABLE_MINIMUM_REM' },
    },
    {
      scss: { file: 'src/styles/_responsive.scss', name: '$equipment-bench-wide-min' },
      ts: { file: 'src/app/ui/equipment/bench-composition.ts', name: 'BENCH_WIDE_MINIMUM_REM' },
    },
  ],
};

/**
 * CSS properties whose values carry the design system's decisions.
 *
 * A literal in one of these is a visual decision made outside the token layer,
 * which is exactly what FR-002 prohibits.
 */
const GOVERNED_PROPERTIES = new Set([
  'color',
  'background',
  'background-color',
  'border',
  'border-color',
  'border-top-color',
  'border-right-color',
  'border-bottom-color',
  'border-left-color',
  'border-inline-color',
  'border-block-color',
  'border-width',
  'border-radius',
  'outline',
  'outline-color',
  'outline-width',
  'box-shadow',
  'text-shadow',
  'font-family',
  'font-size',
  'font-weight',
  'line-height',
  'letter-spacing',
  'padding',
  'padding-block',
  'padding-inline',
  'padding-top',
  'padding-right',
  'padding-bottom',
  'padding-left',
  'margin',
  'margin-block',
  'margin-inline',
  'gap',
  'row-gap',
  'column-gap',
  'transition',
  'transition-duration',
  'transition-timing-function',
  'animation',
  'animation-duration',
  'fill',
  'stroke',
]);

/**
 * Identifiers that name structure inside a `transition` or `animation`
 * shorthand: the property being animated, and the standard timing and fill
 * keywords. The duration and easing in the same declaration are still governed,
 * so a literal `200ms` or a hand-tuned cubic-bezier is still caught.
 */
const MOTION_KEYWORDS = new Set([
  'all',
  'opacity',
  'transform',
  'filter',
  'visibility',
  'ease',
  'ease-in',
  'ease-out',
  'ease-in-out',
  'linear',
  'step-start',
  'step-end',
  'infinite',
  'alternate',
  'alternate-reverse',
  'forwards',
  'backwards',
  'both',
  'running',
  'paused',
  'reverse',
]);

/** Values that are structure or neutral, not a visual decision. */
const ALLOWED_LITERAL_VALUES = new Set([
  '0',
  'none',
  'auto',
  'inherit',
  'initial',
  'unset',
  'currentcolor',
  'transparent',
  'normal',
  '100%',
  '1fr',
  'solid',
  'dashed',
  'dotted',
  'hidden',
  'center',
  'baseline',
]);

/**
 * Template attributes whose literal value a Commander can read or hear.
 *
 * `alt` is included: an empty `alt=""` marks a decorative image and is allowed,
 * but any words in one are display text.
 */
const DISPLAY_ATTRIBUTES = new Set([
  'aria-label',
  'aria-placeholder',
  'aria-roledescription',
  'aria-valuetext',
  'title',
  'placeholder',
  'alt',
  'label',
]);

/** Attributes whose literal values are structural, never read to anyone. */
const STRUCTURAL_ATTRIBUTES = new Set([
  'class',
  'id',
  'type',
  'role',
  'for',
  'name',
  'href',
  'src',
  'target',
  'rel',
  'width',
  'height',
  'viewBox',
  'd',
  'fill',
  'stroke',
  'xmlns',
  'aria-labelledby',
  'aria-describedby',
  'aria-hidden',
  'aria-live',
  'aria-atomic',
  'aria-controls',
  'aria-owns',
  'aria-current',
  'aria-expanded',
  'aria-selected',
  'aria-checked',
  'aria-pressed',
  'aria-invalid',
  'aria-busy',
  'aria-disabled',
  'aria-modal',
  'aria-haspopup',
  'aria-level',
  'aria-orientation',
  'aria-required',
  'lang',
  'dir',
  'tabindex',
  'inert',
  'hidden',
  'disabled',
  'autocomplete',
  'inputmode',
  'enterkeyhint',
  'slot',
  'part',
  'scope',
  'colspan',
  'rowspan',
]);

/**
 * Text that is punctuation, symbol or structure rather than language.
 *
 * A separator, a unit bracket or an ellipsis is not a translatable sentence and
 * flagging it would push authors towards catalogue entries that carry no
 * meaning.
 */
function isStructuralText(text) {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return true;
  }
  // No letter in any script: punctuation, digits, symbols, separators.
  return !/\p{L}/u.test(trimmed);
}

const violations = [];

function report(file, line, rule, message) {
  violations.push({ file: relative(ROOT, file), line, rule, message });
}

/** Every file under `dir` with one of the given extensions. */
async function walk(dir, extensions) {
  const absolute = resolve(ROOT, dir);
  if (!existsSync(absolute)) {
    return [];
  }
  const found = [];
  const entries = await readdir(absolute, { withFileTypes: true });
  for (const entry of entries) {
    const path = join(absolute, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) {
        continue;
      }
      found.push(...(await walk(path, extensions)));
    } else if (extensions.includes(extname(entry.name))) {
      found.push(path);
    }
  }
  return found;
}

function lineOf(source, offset) {
  return source.slice(0, offset).split('\n').length;
}

// ---------------------------------------------------------------------------
// Rule: no application-owned literal display text in templates
// ---------------------------------------------------------------------------

/**
 * Walks a parsed Angular template, reporting literal text nodes and literal
 * values on attributes a Commander can read or hear.
 */
function templateViolations(file, template, offsetLine = 0) {
  const found = [];
  const add = (line, rule, message) =>
    found.push({ file: relative(ROOT, file), line, rule, message });
  let parsed;
  try {
    parsed = parseTemplate(template, file, { preserveWhitespaces: true });
  } catch {
    // A template the parser rejects is a compilation failure the build already
    // reports; there is nothing useful for this checker to add.
    return found;
  }
  if (parsed.errors && parsed.errors.length > 0) {
    return found;
  }

  const lineFor = (node) =>
    offsetLine + (node?.sourceSpan?.start?.line ?? node?.startSourceSpan?.start?.line ?? 0) + 1;

  /**
   * Walks every node the template can hold.
   *
   * Identity is established with `instanceof` against the compiler's own
   * exported classes rather than a constructor name, because the emitted class
   * names are not part of the package's contract and a minified build would
   * silently turn every rule into a no-op.
   */
  const visit = (nodes) => {
    for (const node of nodes ?? []) {
      if (node instanceof TmplAstText) {
        if (!isStructuralText(node.value)) {
          add(
            lineFor(node),
            'literal-display-text',
            `Literal display text "${node.value.trim().slice(0, 60)}" must resolve through the message facade.`,
          );
        }
        continue;
      }

      // Static attributes live beside the element, not among its children.
      for (const attribute of node?.attributes ?? []) {
        if (!(attribute instanceof TmplAstTextAttribute)) {
          continue;
        }
        const name = attribute.name;
        if (name === 'style') {
          add(
            lineFor(attribute),
            'inline-style',
            'An inline style attribute cannot be inspected by the token policy. Move it into the component stylesheet.',
          );
          continue;
        }
        if (
          DISPLAY_ATTRIBUTES.has(name) &&
          !STRUCTURAL_ATTRIBUTES.has(name) &&
          !isStructuralText(attribute.value ?? '')
        ) {
          add(
            lineFor(attribute),
            'literal-display-attribute',
            `Literal "${name}" value "${String(attribute.value).slice(0, 60)}" must resolve through the message facade.`,
          );
        }
      }

      visit(node?.children);
      visit(node?.cases?.flatMap((branch) => branch.children ?? []));
      visit(node?.branches?.flatMap((branch) => branch.children ?? []));
      if (node?.empty) visit(node.empty.children);
      if (node?.placeholder) visit(node.placeholder.children);
      if (node?.loading) visit(node.loading.children);
      if (node?.error) visit(node.error.children);
      visit(node?.templateAttrs);
    }
  };

  visit(parsed.nodes);
  return found;
}

/** IO wrapper: parses one template file and records what it finds. */
function checkTemplate(file, template, offsetLine = 0) {
  violations.push(...templateViolations(file, template, offsetLine));
}

// ---------------------------------------------------------------------------
// Rule: component metadata — inline templates, inline styles
// ---------------------------------------------------------------------------

/** Reads `@Component` metadata and inspects inline templates and styles. */
function componentMetadataViolations(file, source) {
  const found = [];
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);

  const visit = (node) => {
    if (ts.isDecorator(node) && ts.isCallExpression(node.expression)) {
      const callee = node.expression.expression;
      if (ts.isIdentifier(callee) && callee.text === 'Component') {
        const [argument] = node.expression.arguments;
        if (argument && ts.isObjectLiteralExpression(argument)) {
          for (const property of argument.properties) {
            if (!ts.isPropertyAssignment(property) || !ts.isIdentifier(property.name)) {
              continue;
            }
            const key = property.name.text;
            const line = sourceFile.getLineAndCharacterOfPosition(property.getStart()).line + 1;

            if (key === 'template' && ts.isStringLiteralLike(property.initializer)) {
              found.push(...templateViolations(file, property.initializer.text, line - 1));
            }
            if (key === 'styles') {
              found.push({
                file: relative(ROOT, file),
                line,
                rule: 'inline-style',
                message:
                  'Inline component styles cannot be inspected by the SCSS token policy. Use styleUrl.',
              });
            }
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return found;
}

/** IO wrapper for component metadata. */
async function checkComponentMetadata(file) {
  violations.push(...componentMetadataViolations(file, await readFile(file, 'utf8')));
}

// ---------------------------------------------------------------------------
// Rule: governed visual literals only in token sources
// ---------------------------------------------------------------------------

/**
 * Units that are layout syntax rather than a design decision.
 *
 * Percentages, fractions and viewport units describe how a box relates to the
 * space it is in. The governed scales — type, spacing, radius, border, motion —
 * are absolute, and an absolute unit outside the token sources is someone
 * choosing a size by hand.
 */
const LAYOUT_UNITS = /^\d*\.?\d+(%|fr|vh|vw|vmin|vmax|dvh|dvw|svh|lvh)$/;

/** An absolute measurement: a governed decision when it appears outside a token. */
const GOVERNED_UNITS = /\d*\.?\d+(px|rem|em|ex|ch|pt|pc|cm|mm|in|q|s|ms|deg|turn|rad)\b/;

/** Colour syntax. None of it may appear outside the token sources. */
const COLOUR_FUNCTION = /\b(rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch|color|color-mix)\s*\(/;
const HEX_COLOUR = /#[0-9a-f]{3,8}\b/;
const NAMED_COLOURS = new Set([
  'red',
  'white',
  'black',
  'blue',
  'green',
  'grey',
  'gray',
  'yellow',
  'orange',
  'purple',
  'pink',
  'brown',
  'cyan',
  'magenta',
  'silver',
  'gold',
  'navy',
  'teal',
  'olive',
  'maroon',
  'lime',
  'aqua',
  'fuchsia',
  'beige',
  'ivory',
]);

/**
 * True when a value is made only of token references, keywords and structure.
 *
 * The distinction being drawn is between *layout syntax* — which describes how
 * a box relates to its container and is not a design decision — and a *visual
 * literal*, which is a decision that belongs in the token layer. `1fr`,
 * `100%`, `auto` and a calculation over tokens are the former; `#ff8c1a`,
 * `13px` and `rgba(0, 0, 0, 0.4)` are the latter.
 */
function isTokenisedValue(value) {
  const normalized = value.trim().toLowerCase();
  if (normalized.length === 0 || ALLOWED_LITERAL_VALUES.has(normalized)) {
    return true;
  }
  // Sass variables and interpolation resolve inside the token layer, which the
  // token sources themselves are responsible for keeping honest.
  if (normalized.startsWith('$') || normalized.includes('#{')) {
    return true;
  }

  // Colour syntax is never layout, so it is decided before anything is
  // stripped — a colour function's arguments must not look like arithmetic.
  if (COLOUR_FUNCTION.test(normalized) || HEX_COLOUR.test(normalized)) {
    return false;
  }
  // A quoted string in a governed property is a font name or a content string.
  if (/['"]/.test(normalized)) {
    return false;
  }

  // Collapse token references, including nested fallbacks, to a marker. A
  // fallback that contains a literal survives this and is caught below.
  let collapsed = normalized;
  for (let pass = 0; pass < 10; pass += 1) {
    const next = collapsed.replace(/var\(\s*--[a-z0-9-]+\s*\)/g, ' \u0000 ');
    if (next === collapsed) {
      break;
    }
    collapsed = next;
  }

  if (GOVERNED_UNITS.test(collapsed)) {
    return false;
  }

  const remainder = collapsed
    .replace(/var\(\s*--[a-z0-9-]+\s*,/g, ' ')
    .replace(/\b(calc|min|max|clamp|round|env|fit-content|minmax|repeat)\(/g, ' ')
    .replace(/[(),/]/g, ' ')
    .replace(/[+\-*]/g, ' ')
    .trim();

  if (remainder.length === 0) {
    return true;
  }

  return remainder.split(/\s+/).every((token) => {
    if (token.length === 0 || token === '\u0000') {
      return true;
    }
    if (NAMED_COLOURS.has(token)) {
      return false;
    }
    return (
      ALLOWED_LITERAL_VALUES.has(token) ||
      MOTION_KEYWORDS.has(token) ||
      GOVERNED_PROPERTIES.has(token) ||
      LAYOUT_UNITS.test(token) ||
      // A bare unitless number inside a calculation is arithmetic, not a size.
      /^\d+(\.\d+)?$/.test(token) ||
      token.startsWith('--')
    );
  });
}

function stylesheetViolations(file, source) {
  const found = [];
  let root;
  try {
    // The SCSS parser is called directly. `postcss.parse` *is* a parser and
    // ignores a `parser` or `syntax` option, so routing SCSS through it left
    // the standard CSS parser in place — which throws on any `//` comment and,
    // because the throw was caught below, silently exempted most of the
    // stylesheets this rule exists to check.
    root = scssSyntax.parse(source, { from: file });
  } catch (error) {
    // A stylesheet the SCSS parser itself cannot read is a syntax error the
    // build will report; it is not a licence to skip the rule.
    found.push({
      file: relative(ROOT, file),
      line: 0,
      rule: 'unparseable-stylesheet',
      message: `The stylesheet could not be parsed: ${error instanceof Error ? error.message : String(error)}`,
    });
    return found;
  }

  root.walkDecls((declaration) => {
    const property = declaration.prop.toLowerCase();
    const line = declaration.source?.start?.line ?? 0;

    // Every token this application draws from is `--ednb-`. A reference to any
    // other namespace resolves to nothing and paints nothing, in silence: CSS
    // drops the declaration and no build, test or browser says why the rule
    // stopped applying. That is what a mistyped or stale prefix looks like, and
    // the product has carried two prefixes in its life.
    //
    // Before the custom-property check below, and not after it: a token is
    // most often defined in terms of other tokens, so the values this has to
    // read are mostly the ones that check would return on.
    for (const [, referenced] of declaration.value.matchAll(/var\(\s*(--[\w-]+)/g)) {
      if (!referenced.startsWith('--ednb-')) {
        found.push({
          file: relative(ROOT, file),
          line,
          rule: 'foreign-token-namespace',
          message: `"${declaration.prop}" reads "${referenced}", which is not a token this application declares.`,
        });
      }
    }

    // Declaring a custom property outside the token sources is itself the
    // violation the property check would otherwise miss: it creates a second
    // place where a visual decision lives.
    if (property.startsWith('--')) {
      found.push({
        file: relative(ROOT, file),
        line,
        rule: 'token-outside-source',
        message: `Custom property "${declaration.prop}" is declared outside the token sources.`,
      });
      return;
    }

    if (!GOVERNED_PROPERTIES.has(property)) {
      return;
    }
    if (!isTokenisedValue(declaration.value)) {
      found.push({
        file: relative(ROOT, file),
        line,
        rule: 'visual-literal',
        message: `Governed property "${declaration.prop}" uses the literal "${declaration.value}" instead of a token.`,
      });
    }
  });

  return found;
}

/**
 * IO wrapper. Token sources are the one place governed literals belong.
 *
 * They are not exempt from the namespace rule, and they are where it matters
 * most: a token is usually defined in terms of another one, so these files hold
 * the densest `var()` references in the repository and are what a rename edits
 * most heavily. A stale prefix here silently empties every token defined from
 * it.
 */
export function governedStylesheetViolations(relativePath, found, scope = SCOPE) {
  return scope.tokenSources.includes(relativePath)
    ? found.filter((violation) => violation.rule === 'foreign-token-namespace')
    : found;
}

async function checkStylesheet(file) {
  const relativePath = relative(ROOT, file).split('\\').join('/');
  violations.push(
    ...governedStylesheetViolations(
      relativePath,
      stylesheetViolations(file, await readFile(file, 'utf8')),
    ),
  );
}

// ---------------------------------------------------------------------------
// Rule: every exported UI component has a preview declaration
// ---------------------------------------------------------------------------

/** Component class names exported from `src/app/ui/components`. */
async function exportedUiComponents() {
  const files = await walk(SCOPE.uiComponents, ['.ts']);
  const components = [];

  for (const file of files) {
    if (file.endsWith('.spec.ts') || file.endsWith('.spec-helpers.ts')) {
      continue;
    }
    const source = await readFile(file, 'utf8');
    const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);

    const visit = (node) => {
      if (ts.isClassDeclaration(node) && node.name) {
        const isExported = node.modifiers?.some(
          (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
        );
        const isComponent = ts
          .getDecorators?.(node)
          ?.some(
            (decorator) =>
              ts.isCallExpression(decorator.expression) &&
              ts.isIdentifier(decorator.expression.expression) &&
              decorator.expression.expression.text === 'Component',
          );
        if (isExported && isComponent) {
          components.push({ name: node.name.text, file });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }

  return components;
}

function previewCoverageViolations(components, manifestSource) {
  return (
    components
      // A declaration registers the production class itself, so the class name
      // appearing in the manifest is the reliable signal that it is previewed.
      .filter((component) => !new RegExp(`\\b${component.name}\\b`).test(manifestSource))
      .map((component) => ({
        file: component.file,
        line: 1,
        rule: 'missing-preview',
        message: `Exported UI component "${component.name}" has no preview declaration in ${SCOPE.previewManifest}.`,
      }))
  );
}

/** IO wrapper. */
async function checkPreviewCoverage() {
  const components = await exportedUiComponents();
  if (components.length === 0) {
    return;
  }
  const manifestPath = resolve(ROOT, SCOPE.previewManifest);
  const manifest = existsSync(manifestPath) ? await readFile(manifestPath, 'utf8') : '';
  violations.push(
    ...previewCoverageViolations(
      components.map((component) => ({ ...component, file: relative(ROOT, component.file) })),
      manifest,
    ),
  );
}

// ---------------------------------------------------------------------------
// Rule: the composition steps are declared once
// ---------------------------------------------------------------------------

/** How deep a step may be built on other steps before the rule gives up. */
const STEP_DEPTH_BUDGET = 16;

/** A term read into a pattern is a name, not a pattern of its own. */
function asLiteralPattern(term) {
  return term.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&');
}

/**
 * Adds up one step from the terms it is composed of.
 *
 * A step is either a figure or a sum of figures and other steps, which is how
 * both sides state a composition made of tracks and the rules between them. The
 * terms are resolved from the same source they are written in, so a step built
 * on another one moves with it. Anything else — a subtraction, a product, a
 * figure in another unit — reads as unreadable, and an unreadable step is a
 * violation rather than an agreement.
 *
 * `path` is the way back to the step this call is adding up, so a step that
 * names itself somewhere along it stops rather than adding up forever. A term
 * that appears twice side by side is a sum, not a cycle, and is added twice.
 *
 * `declaration` finds a name's expression in the source, and `figure` reads a
 * single term as a number. The two differ between a stylesheet and a TypeScript
 * source; everything else about adding a step up does not.
 */
function stepTotal(source, name, declaration, figure, path = []) {
  if (path.includes(name) || path.length > STEP_DEPTH_BUDGET) return null;

  const found = declaration(source, name);
  if (found === null) return null;

  let total = 0;
  for (const term of found.expression.split('+')) {
    const written = term.trim();
    if (written === '') return null;
    const read = figure(written);
    if (read !== null) {
      total += read;
      continue;
    }
    const composed = stepTotal(source, written, declaration, figure, [...path, name]);
    if (composed === null) return null;
    total += composed.total;
  }
  return { total, index: found.index };
}

/** A stylesheet's own step: `$name: 24.5rem + $other;`, in rem and nothing else. */
function scssStep(source, name) {
  return stepTotal(
    source,
    name,
    (text, wanted) => {
      const found = new RegExp(`${asLiteralPattern(wanted)}\\s*:\\s*([^;]+);`).exec(text);
      return found === null ? null : { expression: found[1], index: found.index };
    },
    (term) => {
      const found = /^(\d*\.?\d+)rem$/.exec(term);
      return found === null ? null : Number(found[1]);
    },
  );
}

/** The TypeScript restatement: `const NAME = 24.5 + OTHER;`, in the same rem. */
function tsStep(source, name) {
  return stepTotal(
    source,
    name,
    (text, wanted) => {
      const found = new RegExp(`\\b${asLiteralPattern(wanted)}\\s*=\\s*([^;\\n]+)`).exec(text);
      return found === null ? null : { expression: found[1], index: found.index };
    },
    (term) => {
      const found = /^(\d*\.?\d+)$/.exec(term);
      return found === null ? null : Number(found[1]);
    },
  );
}

/**
 * Reconciles one duplicated step: the stylesheets' declaration against the
 * TypeScript restatement of it.
 *
 * Both sources are passed in, so the comparison is a function of two strings and
 * a pair rather than of the file system. `null` for either source is the file
 * being absent, which is itself a violation: a rule that quietly passes when
 * half of what it reconciles has been moved or renamed reconciles nothing.
 *
 * Either side may be composed from other steps in its own source, and the sum is
 * what the two are compared on. So a step built on a container size moves when
 * that size does, on both sides, and a change to one of them alone is what this
 * catches.
 */
function duplicatedStepViolations(pair, scssSource, tsSource) {
  const { scss, ts } = pair;
  const found = [];
  if (scssSource === null) {
    found.push({
      file: scss.file,
      line: 1,
      rule: 'composition-step',
      message: `${scss.file} is missing, so ${ts.name} has nothing to be reconciled against.`,
    });
  }
  if (tsSource === null) {
    found.push({
      file: ts.file,
      line: 1,
      rule: 'composition-step',
      message: `${ts.file} is missing, so ${scss.name} has nothing to be reconciled against.`,
    });
  }
  if (found.length > 0) {
    return found;
  }

  const declared = scssStep(scssSource, scss.name);
  const restated = tsStep(tsSource, ts.name);

  if (declared === null) {
    return [
      {
        file: scss.file,
        line: 1,
        rule: 'composition-step',
        message: `${scss.name} is not declared in rem here.`,
      },
    ];
  }
  if (restated === null) {
    return [
      {
        file: ts.file,
        line: 1,
        rule: 'composition-step',
        message: `${ts.name} is not declared as a number here.`,
      },
    ];
  }
  if (declared.total !== restated.total) {
    return [
      {
        file: ts.file,
        line: lineOf(tsSource, restated.index),
        rule: 'composition-step',
        message:
          `${ts.name} is ${restated.total}rem where ${scss.name} is ${declared.total}rem. ` +
          'A behaviour keyed to a composition has to turn at the width the stylesheets draw it at.',
      },
    ];
  }
  return [];
}

/** IO wrapper. */
async function checkDuplicatedSteps() {
  for (const pair of SCOPE.duplicatedSteps) {
    const read = async (file) => {
      const path = resolve(ROOT, file);
      return existsSync(path) ? await readFile(path, 'utf8') : null;
    };
    violations.push(
      ...duplicatedStepViolations(pair, await read(pair.scss.file), await read(pair.ts.file)),
    );
  }
}

// ---------------------------------------------------------------------------
// Rule: no skipped, focused or quarantined interface tests
// ---------------------------------------------------------------------------

const FORBIDDEN_TEST_FORMS = [
  [/\b(?:describe|it|test)\.only\b/g, 'a focused test'],
  [/\b(?:describe|it|test)\.skip\b/g, 'a skipped test'],
  [/\b(?:fdescribe|fit|xdescribe|xit)\s*\(/g, 'a focused or skipped test'],
  [/\btest\.fixme\b/g, 'a quarantined test'],
];

function testDisciplineViolations(file, source) {
  const found = [];
  for (const [pattern, label] of FORBIDDEN_TEST_FORMS) {
    for (const match of source.matchAll(pattern)) {
      found.push({
        file,
        line: lineOf(source, match.index ?? 0),
        rule: 'test-discipline',
        message: `${label} ("${match[0]}") cannot reach a green build.`,
      });
    }
  }
  return found;
}

/** IO wrapper. */
async function checkTestDiscipline() {
  const files = [];
  for (const scope of SCOPE.testGlobs) {
    files.push(...(await walk(scope, ['.ts'])));
  }
  for (const file of files) {
    violations.push(
      ...testDisciplineViolations(relative(ROOT, file), await readFile(file, 'utf8')),
    );
  }
}

// ---------------------------------------------------------------------------
// Rule: what an announcement declares, and where it is built
// ---------------------------------------------------------------------------

/**
 * The keywords a value may follow, so a `/` after one opens a pattern.
 *
 * Every one of them is followed by an expression rather than by an operand, so
 * nothing here can be the left side of a division.
 */
const VALUE_KEYWORDS = new Set([
  'await',
  'case',
  'delete',
  'do',
  'else',
  'in',
  'instanceof',
  'new',
  'of',
  'return',
  'throw',
  'typeof',
  'void',
  'yield',
]);

/**
 * The source with every comment, string, template and regular expression
 * blanked out, character for character.
 *
 * Both rules below match shapes in text, and text that is not code says
 * nothing about what the code does. A doc comment explaining the rule would
 * otherwise fail it; a quotation mark inside a regular expression would
 * otherwise run a string to the end of the file and take a whole effect out of
 * the reading with it. Blanking rather than removing keeps every offset and
 * every line break where it was, so a violation is still reported on its own
 * line.
 */
function maskedSource(source) {
  const out = [...source];
  const blank = (from, to) => {
    for (let index = from; index < to && index < out.length; index += 1) {
      if (out[index] !== '\n') {
        out[index] = ' ';
      }
    }
  };

  /**
   * Whether a `/` here opens a regular expression rather than divides.
   *
   * An operator or an opening bracket before it means a value is expected, and
   * a value starting with `/` is a pattern. So does a keyword: `return /…/` and
   * `typeof /…/` are patterns, and reading them as division scans the pattern
   * body as code — where a quote in it opens a string that runs to the next
   * one and blanks whole calls on its way.
   */
  const opensRegex = (index) => {
    let back = index - 1;
    while (back >= 0 && ' \t\n\r'.includes(source[back])) {
      back -= 1;
    }
    if (back < 0) {
      return true;
    }
    if (!/[\w$]/.test(source[back])) {
      return '(,=:[!&|?{};+-*%~^<>'.includes(source[back]);
    }
    let start = back;
    while (start > 0 && /[\w$]/.test(source[start - 1])) {
      start -= 1;
    }
    // `a.in / 2` is a property divided, not a keyword followed by a pattern.
    if (start > 0 && source[start - 1] === '.') {
      return false;
    }
    return VALUE_KEYWORDS.has(source.slice(start, back + 1));
  };

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];

    if (character === '/' && source[index + 1] === '/') {
      const end = source.indexOf('\n', index);
      const stop = end === -1 ? source.length : end;
      blank(index, stop);
      index = stop;
      continue;
    }
    if (character === '/' && source[index + 1] === '*') {
      const end = source.indexOf('*/', index + 2);
      const stop = end === -1 ? source.length : end + 2;
      blank(index, stop);
      index = stop - 1;
      continue;
    }
    if (character === "'" || character === '"' || character === '`') {
      // A template literal's interpolations are code, and the rules read them:
      // a message resolved inside `${…}` is the same catalogue read as one
      // resolved on its own line. Its text is blanked around them.
      //
      // An interpolation holds whole expressions, strings included, so the
      // braces that close it are counted outside any string it carries — a
      // `'}'` that ended the interpolation early would blank from inside that
      // string onwards, and a call left unbalanced makes `callSpan` answer
      // nothing, which stops every rule silently.
      const template = character === '`';
      let end = index + 1;
      let text = index + 1;
      let nesting = 0;
      while (end < source.length) {
        if (source[end] === '\\') {
          end += 2;
          continue;
        }
        if (template && nesting === 0 && source[end] === '$' && source[end + 1] === '{') {
          blank(text, end);
          nesting = 1;
          end += 2;
          continue;
        }
        if (template && nesting > 0) {
          const inner = source[end];
          if (inner === "'" || inner === '"' || inner === '`') {
            // A string inside the interpolation. Its own body is text: the
            // rules must not read it, and its braces are not the template's.
            let close = end + 1;
            while (close < source.length) {
              if (source[close] === '\\') {
                close += 2;
                continue;
              }
              if (source[close] === inner) {
                break;
              }
              close += 1;
            }
            const stop = Math.min(close, source.length);
            blank(end + 1, stop);
            end = stop + 1;
            continue;
          }
          if (inner === '{') {
            nesting += 1;
          } else if (inner === '}') {
            nesting -= 1;
            if (nesting === 0) {
              text = end + 1;
            }
          }
          end += 1;
          continue;
        }
        if (source[end] === character) {
          break;
        }
        end += 1;
      }
      const stop = Math.min(end, source.length);
      blank(nesting === 0 ? text : stop, stop);
      index = stop;
      continue;
    }
    if (character === '/' && opensRegex(index)) {
      let end = index + 1;
      let inClass = false;
      while (end < source.length && source[end] !== '\n') {
        if (source[end] === '\\') {
          end += 2;
          continue;
        }
        if (source[end] === '[') {
          inClass = true;
        } else if (source[end] === ']') {
          inClass = false;
        } else if (source[end] === '/' && !inClass) {
          break;
        }
        end += 1;
      }
      blank(index + 1, Math.min(end, source.length));
      index = Math.min(end, source.length);
      continue;
    }
  }

  return out.join('');
}

/**
 * The span of the call whose opening parenthesis is at `open`.
 *
 * Offsets of the text between the parentheses, or `null` where they never
 * balance. Reads masked source, so a bracket in a comment or a string is
 * already gone.
 */
function callSpan(masked, open) {
  let depth = 0;
  for (let index = open; index < masked.length; index += 1) {
    if (masked[index] === '(') {
      depth += 1;
    } else if (masked[index] === ')') {
      depth -= 1;
      if (depth === 0) {
        return { start: open + 1, end: index };
      }
    }
  }
  return null;
}

/**
 * The keys an object literal states directly, ignoring anything nested.
 *
 * Depth is what makes this worth writing rather than matching: `params` is a
 * caller's own message data, and a key inside it is a word in a sentence rather
 * than something the policy is being handed.
 *
 * A shorthand key counts. `{ kind, urgency, messageKey, revision }` states the
 * same four keys as the spelled-out form, and it is the spelling someone
 * re-adding the field would reach for. So does a quoted one: a string is
 * blanked before the rules read anything, so `'revision':` is read from the
 * unmasked source at the same offset.
 */
function topLevelKeys(literal, raw = literal) {
  const keys = [];
  let depth = 0;
  for (let index = 0; index < literal.length; index += 1) {
    const character = literal[index];
    if (character === '{' || character === '[' || character === '(') {
      depth += 1;
      continue;
    }
    if (character === '}' || character === ']' || character === ')') {
      depth -= 1;
      continue;
    }
    if (depth !== 1) {
      continue;
    }
    const quoted = /^(['"])([A-Za-z_$][\w$]*)\1\s*:/.exec(raw.slice(index));
    if (quoted !== null) {
      keys.push(quoted[2]);
      index += quoted[0].length - 1;
      continue;
    }
    const key = /^([A-Za-z_$][\w$]*)\s*(?::|,|\}|$)/.exec(literal.slice(index));
    if (key !== null && !/[\w$.]/.test(literal[index - 1] ?? '')) {
      keys.push(key[1]);
      index += key[0].length - 1;
    }
  }
  return keys;
}

/**
 * Whether an object literal spreads something into itself at the top level.
 *
 * The same route the literal rule closes, one character wider. TypeScript
 * checks a surplus property on a literal and not on what a spread brings in, so
 * a `revision` arriving through `...request` reaches neither the compiler nor
 * the key rule below.
 */
function spreadsIntoItself(literal) {
  let depth = 0;
  for (let index = 0; index < literal.length; index += 1) {
    const character = literal[index];
    if (character === '{' || character === '[' || character === '(') {
      depth += 1;
    } else if (character === '}' || character === ']' || character === ')') {
      depth -= 1;
    } else if (depth === 1 && literal.startsWith('...', index)) {
      return true;
    }
  }
  return false;
}

/** Every offset at which `pattern` matches, with the match. */
function occurrences(masked, pattern) {
  return [...masked.matchAll(pattern)].map((match) => ({
    index: match.index ?? 0,
    text: match[0],
  }));
}

const ANNOUNCE_CALL = /\.announce\s*\(/g;
const EFFECT_CALL = /\b(?:effect|afterRenderEffect|afterNextRender|afterEveryRender)\s*\(/g;
const UNTRACKED_CALL = /\buntracked\s*\(/g;
const CATALOGUE_READ = /\.message(?:Signal)?\s*\(/g;
const LOCALE_SERVICES = '(?:MessageService|Formatters|GameTextPresenter)';
const LOCALE_SERVICE = new RegExp(
  `(?:readonly\\s+)?(#?[A-Za-z_$][\\w$]*)\\s*(?::[^=;\\n]+)?=\\s*inject\\(\\s*${LOCALE_SERVICES}\\s*\\)`,
  'g',
);
const LOCALE_PARAMETER = new RegExp(
  `(?:public|protected|private)\\s+(?:readonly\\s+)?([A-Za-z_$][\\w$]*)\\s*:\\s*${LOCALE_SERVICES}\\b`,
  'g',
);
const MEMBER_DECLARATION =
  /^[ \t]*(?:(?:public|protected|private|static|override|readonly)\s+)*(#?[A-Za-z_$][\w$]*)\s*(?::[^=;\n]+)?=/gm;
const MEMBER_READ = /\bthis\.(#?[A-Za-z_$][\w$]*)\s*\(/g;

/** Where the statement beginning at `from` ends, ignoring nested brackets. */
function statementEnd(masked, from) {
  let depth = 0;
  for (let index = from; index < masked.length; index += 1) {
    const character = masked[index];
    if (character === '(' || character === '[' || character === '{') {
      depth += 1;
    } else if (character === ')' || character === ']' || character === '}') {
      depth -= 1;
      if (depth < 0) {
        return index;
      }
    } else if (character === ';' && depth === 0) {
      return index;
    }
  }
  return masked.length;
}

/**
 * The fields holding a service whose answers move with the reading language.
 *
 * The catalogue is not reached only through `message()`. `Formatters.integer()`
 * reads the effective locale to know how to spell a number, and
 * `GameTextPresenter` reads it to know which of the package's languages it is
 * answering in. A tracked call to either takes the same dependency a `message()`
 * call does, and every announcement here formats a number, so this is the
 * nearest way to get the dependency back by accident.
 *
 * `LocaleStore` is not one of these. Everything above derives from the reading
 * language, so reading one is never the event — but the language settling is
 * itself an event, and `app-frame.ts` announces it with the locale snapshot as
 * its trigger, tracked on purpose.
 *
 * A field is seen however it is declared — `inject()` with or without a type
 * annotation, or a constructor parameter property — and read through `this.`.
 * A local alias (`const formatters = this.#formatters`) is not followed;
 * design.md records it with the other shapes syntax cannot see.
 */
function localeServices(masked) {
  const fields = new Set();
  for (const declaration of masked.matchAll(LOCALE_SERVICE)) {
    fields.add(declaration[1]);
  }
  for (const parameter of masked.matchAll(LOCALE_PARAMETER)) {
    fields.add(parameter[1]);
  }
  return fields;
}

/**
 * Reads of a locale service's own methods, as a fresh pattern each call.
 *
 * A pattern carrying state is a pattern two callers cannot share, so each asks
 * for its own and says which flags it wants: the scan over an effect body needs
 * `g`, a single `test` over one initialiser does not.
 *
 * A field name goes in as a name rather than as a pattern of its own. `$` is
 * legal in an identifier and means end of input in a pattern, so a field with
 * two of them would match nothing at all.
 */
function localeReadPattern(locales, flags) {
  if (locales.size === 0) {
    return null;
  }
  const fields = [...locales].map(asLiteralPattern).join('|');
  return new RegExp(`\\bthis\\.(?:${fields})\\s*\\.[A-Za-z_$][\\w$]*\\s*\\(`, flags);
}

/**
 * The class's own members whose value is resolved from the message catalogue.
 *
 * A component keeps the sentence it draws as a member — `title` is a `computed`
 * over one message — and reading that member reads the catalogue exactly as
 * calling `message()` does. Without this the rule below sees only the shape it
 * was written against, and one line hoisted out of the `untracked` call walks
 * past it.
 *
 * A member is resolved whichever way it reaches the catalogue: by calling
 * `message()`, or by asking a locale service for a word — `integer`, a hull's
 * name — because a member spelling a number in the Commander's language is as
 * much a catalogue read as a sentence is, and hoisting it out of the `untracked`
 * call takes the same dependency.
 *
 * One level deep, and deliberately so. A member reaching the catalogue through
 * a private method it calls is not found here; design.md records that with the
 * other shape no scan can see.
 */
function messageMembers(masked, locales) {
  const members = new Set();
  const reads = localeReadPattern(locales, '');
  for (const declaration of masked.matchAll(MEMBER_DECLARATION)) {
    const at = declaration.index ?? 0;
    const initialiser = masked.slice(at, statementEnd(masked, at + declaration[0].length));
    if (/\.message(?:Signal)?\s*\(/.test(initialiser) || reads?.test(initialiser)) {
      members.add(declaration[1]);
    }
  }
  return members;
}

/**
 * What an announcement may declare, and where an effect may build one.
 *
 * Three rules over one subject.
 *
 * An announcement states its event and nothing else. It carries no number for
 * the policy to compare, and it is written where it is made: a request built
 * somewhere else and handed over is the same field arriving by another route,
 * and the compiler does not see it, because it checks a surplus key on a
 * literal at the call site and not on a variable.
 *
 * The third rule carries the obligation that sits with the caller. An effect
 * re-runs when anything it read changes, and resolving a message reads the
 * message catalogue, so an announcement built in the open is republished
 * whenever a Commander's reading language is committed. Building the request
 * and calling `announce` inside one `untracked` call is what makes the effect
 * depend on its own event and nothing else. It is a requirement rather than a
 * preference: without it there is nothing left that keeps a replay silent.
 *
 * An announcing effect therefore reads the catalogue inside `untracked` or not
 * at all — whatever the value was wanted for, and whether it is reached by
 * calling `message()` or by reading one of the class's own members that holds
 * a message. A tracked read for something else takes the same dependency and
 * republishes the same event; a message wanted for something else belongs to
 * an effect that announces nothing.
 */
function announcementViolations(file, source) {
  const found = [];
  const masked = maskedSource(source);
  const locales = localeServices(masked);
  const resolvers = messageMembers(masked, locales);
  const localeReads = localeReadPattern(locales, 'g');
  const add = (offset, rule, message) =>
    found.push({ file, line: lineOf(source, offset), rule, message });

  for (const call of occurrences(masked, ANNOUNCE_CALL)) {
    const span = callSpan(masked, call.index + call.text.indexOf('('));
    if (span === null) {
      continue;
    }
    const literal = masked.slice(span.start, span.end).trim();
    const raw = source.slice(span.start, span.end).trim();
    if (!literal.startsWith('{')) {
      add(
        call.index,
        'announcement-request',
        'An announcement is written where it is made. A request built elsewhere and handed ' +
          'over carries whatever it was given, and a surplus key on it reaches no compiler.',
      );
      continue;
    }
    if (spreadsIntoItself(literal)) {
      add(
        call.index,
        'announcement-request',
        'An announcement is written where it is made. A spread carries whatever it was given, ' +
          'and neither the compiler nor the rule below sees a surplus key that arrives that way.',
      );
    }
    if (topLevelKeys(literal, raw).includes('revision')) {
      add(
        call.index,
        'announcement-request',
        'An announcement states its event, never a number for the policy to compare. ' +
          'A caller that must not be heard twice decides that before it calls.',
      );
    }
  }

  for (const effectCall of occurrences(masked, EFFECT_CALL)) {
    const body = callSpan(masked, effectCall.index + effectCall.text.indexOf('('));
    if (body === null) {
      continue;
    }
    const region = masked.slice(body.start, body.end);
    const announcing = occurrences(region, ANNOUNCE_CALL);
    if (announcing.length === 0) {
      continue;
    }

    const sheltered = [];
    for (const untracked of occurrences(region, UNTRACKED_CALL)) {
      const span = callSpan(region, untracked.index + untracked.text.indexOf('('));
      if (span !== null) {
        sheltered.push(span);
      }
    }
    const inside = (offset) => sheltered.some((span) => offset >= span.start && offset < span.end);

    for (const call of announcing) {
      if (!inside(call.index)) {
        add(
          body.start + call.index,
          'announcement-effect',
          'An announcement published from an effect is built and made inside one `untracked` ' +
            'call. Outside it, resolving the message reads the catalogue, and a committed ' +
            'locale republishes an event that already happened.',
        );
      }
    }

    // A message resolved in the open and carried into the request is the same
    // read, one statement earlier — and so is a catalogue read this effect makes
    // for anything else at all. An effect re-runs when anything it read
    // changes, so one tracked read of the catalogue republishes the
    // announcement whenever a Commander's reading language is committed,
    // whatever the value was wanted for. An announcing effect reads the
    // catalogue inside `untracked` or not at all; a message wanted for
    // something else belongs to a second effect.
    //
    // Read through a member as well as through `message()` itself. `this.title()`
    // reaches the catalogue whenever `title` is one of the class's own resolved
    // members, and it is the shape these components are written in.
    //
    // Gathered by the text each match covers rather than by where it starts, so
    // one read is one violation. `this.#messages.message(` is matched by two of
    // the three patterns — one from `this.`, one from `.message(` inside it —
    // and that is how every real caller is written.
    const reads = [];
    const take = (read) => {
      const start = read.index;
      const stop = start + read.text.length;
      if (reads.some((held) => start < held.stop && stop > held.start)) {
        return;
      }
      reads.push({ start, stop });
    };
    for (const read of occurrences(region, CATALOGUE_READ)) {
      take(read);
    }
    for (const read of occurrences(region, MEMBER_READ)) {
      const member = /this\.(#?[A-Za-z_$][\w$]*)/.exec(read.text)?.[1];
      if (member !== undefined && resolvers.has(member)) {
        take(read);
      }
    }
    if (localeReads !== null) {
      for (const read of occurrences(region, localeReads)) {
        take(read);
      }
    }

    for (const read of reads.map((held) => held.start).sort((one, other) => one - other)) {
      if (inside(read)) {
        continue;
      }
      add(
        body.start + read,
        'announcement-effect',
        'This effect announces, and reads the message catalogue out here. Read it inside the ' +
          '`untracked` call with the rest of the request, or move it to an effect that ' +
          'announces nothing: a committed locale re-runs this one and republishes the event.',
      );
    }
  }

  return found;
}

/** IO wrapper. */
async function checkAnnouncements(sources) {
  for (const file of sources) {
    // Product code only. The policy's own suite hands it one request twice on
    // purpose, to prove the service adds nothing of its own to what it is given.
    if (file.endsWith('.spec.ts') || file.endsWith('.spec-helpers.ts')) {
      continue;
    }
    violations.push(...announcementViolations(relative(ROOT, file), await readFile(file, 'utf8')));
  }
}

// ---------------------------------------------------------------------------

/** Runs every rule and returns the violations found. */
export async function runChecks({ scope = SCOPE } = {}) {
  violations.length = 0;

  // Component templates only. `index.html` is the host document, not a
  // component template: it is served before Angular runs, its `<title>` is the
  // product's own title, which a browser tab shows during bootstrap, and the
  // locale store replaces that title on the first committed snapshot.
  const templates = (await walk(scope.product, ['.html'])).filter(
    (file) => !file.endsWith('index.html'),
  );
  for (const file of templates) {
    checkTemplate(file, await readFile(file, 'utf8'));
  }

  const sources = await walk(scope.product, ['.ts']);
  for (const file of sources) {
    if (file.endsWith('.spec.ts') || file.endsWith('.spec-helpers.ts')) {
      continue;
    }
    await checkComponentMetadata(file);
  }

  for (const file of await walk(scope.product, ['.scss'])) {
    await checkStylesheet(file);
  }

  await checkPreviewCoverage();
  await checkDuplicatedSteps();
  await checkTestDiscipline();
  await checkAnnouncements(sources);
  await checkCatalogues();
  await checkServiceWorkerOwnership(sources);
  await checkConformanceClaims(sources);
  await checkLedgerReconciliation();
  await checkSearchMetadata();
  await checkProductionOutput();
  await checkCopiedSchematics();
  await checkWaitingMark();

  return [...violations];
}

/**
 * The two inputs the search-metadata rule derives rather than reads.
 *
 * Both can fail, and a failure here has to be a violation rather than a missing
 * one: five of the rules below are guarded by "if this input arrived", which is
 * there for the unit fixtures. Letting a real failure through that guard would
 * retire the sitemap reconciliation, the route-table check, the two message-key
 * checks and the hull-card check all at once, in silence. A rule that passes
 * because there was nothing to inspect is not a gate.
 *
 * Separated from the reading so it can be run without a filesystem, which is
 * the only way the silence above can be tested for.
 */
export function searchMetadataSources(originSource, englishText) {
  const violations = [];
  const fail = (file, message) =>
    violations.push({ file, line: 0, rule: 'search-metadata', message });

  // The origin and the addresses fail separately, because they fail in
  // different files: an undeclared origin is `site-address.ts`, and naming the
  // address module for it would send the reader to an innocent one.
  let published;
  try {
    const origin = declaredOrigin(originSource);
    try {
      // With feature 015's verdict attached, so the reconciliation below reads
      // one list rather than joining two by path (015/FR-021).
      published = contentBearingAddresses({ origin });
    } catch (failure) {
      fail(
        SEARCH_METADATA_FILES.addresses,
        `The published addresses could not be built, so nothing was reconciled against them: ${failure.message}`,
      );
    }
  } catch (failure) {
    fail(
      SEARCH_METADATA_FILES.origin,
      `The production origin could not be read, so no address was built from it: ${failure.message}`,
    );
  }

  let messages;
  try {
    messages = Object.keys(JSON.parse(englishText));
  } catch (failure) {
    fail(
      'src/app/i18n/locales/en.json',
      `Bundled English does not parse, so no published message key was checked: ${failure.message}`,
    );
  }

  return { published, messages, violations };
}

/**
 * The route table as the rule compares it: one triple per addressable route.
 *
 * Paired rather than flattened. Two routes whose keys were exchanged declare
 * every key somewhere, so a check that the two key *sets* match passes while
 * the published document names one screen and the application names another.
 *
 * Read with a pattern rather than with the TypeScript parser because the shape
 * is the route table's own and does not vary: a `path`, then the `title` and
 * `data.description` that belong to it. A route missing either is a triple with
 * `undefined` in it, which is what the rule reports.
 */
export function routeTableTriples(source) {
  const starts = [...source.matchAll(/path:\s*'([^']*)'/g)];
  return starts.map((start, index) => {
    // Everything between this `path` and the next one belongs to this route.
    const segment = source.slice(
      start.index,
      index + 1 < starts.length ? starts[index + 1].index : source.length,
    );
    return {
      path: start[1],
      titleKey: /title:\s*'([^']*)'/.exec(segment)?.[1],
      descriptionKey: /description:\s*'([^']*)'/.exec(segment)?.[1],
    };
  });
}

/**
 * IO wrapper: reads every file the search-metadata rule compares.
 *
 * The nine in `SEARCH_METADATA_FILES`, plus the route table, the locale
 * registry, bundled English and everything `public/` serves. The rule does not
 * require its inputs, so what is derived rather than read goes through
 * `searchMetadataSources`, which reports a failure instead of returning
 * nothing.
 */
async function checkSearchMetadata() {
  const read = async (path) => {
    const file = resolve(ROOT, path);
    return existsSync(file) ? await readFile(file, 'utf8') : '';
  };

  const routesSource = await read('src/app/app.routes.ts');
  const originSource = await read(SEARCH_METADATA_FILES.origin);
  const english = await read('src/app/i18n/locales/en.json');

  const sources = searchMetadataSources(originSource, english);
  violations.push(...sources.violations);
  const { published, messages } = sources;

  violations.push(
    ...searchMetadataViolations({
      origin: originSource,
      index: await read(SEARCH_METADATA_FILES.index),
      robots: await read(SEARCH_METADATA_FILES.robots),
      sitemap: await read(SEARCH_METADATA_FILES.sitemap),
      manifest: await read(SEARCH_METADATA_FILES.manifest),
      domain: await read(SEARCH_METADATA_FILES.domain),
      tokens: await read(SEARCH_METADATA_FILES.tokens),
      preview: await read(SEARCH_METADATA_FILES.preview),
      routes: [...routesSource.matchAll(/path:\s*'([^']*)'/g)].map((match) => match[1]),
      routeTable: routeTableTriples(routesSource),
      locales: [
        ...(await read('src/app/i18n/locale-registry.ts')).matchAll(/^\s{4}tag: '([^']+)',$/gm),
      ].map((match) => match[1]),
      published,
      messages,
      assets: (await walk('public', ['.png', '.ico', '.svg', '.webmanifest', '.txt', '.xml'])).map(
        (file) => relative(resolve(ROOT, 'public'), file).split('\\').join('/'),
      ),
    }),
  );
}

/** IO wrapper: reads the emitted production output. */
async function checkProductionOutput() {
  const directory = resolve(ROOT, SCOPE.productionOutput);
  if (!existsSync(directory)) {
    violations.push(...productionOutputViolations({}));
    return;
  }

  const contents = {};
  for (const file of await walk(SCOPE.productionOutput, ['.js', '.css', '.html'])) {
    contents[relative(ROOT, file).split('\\').join('/')] = await readFile(file, 'utf8');
  }

  violations.push(...productionOutputViolations(contents));
  violations.push(...firstFrameTypefaceViolations(contents));
}

/**
 * IO wrapper: audits the committed mount extracts against the installed package.
 *
 * Reads the installed package's schematics, hashes each one, reads the extract
 * committed beside the rasterised drawing, and walks the repository for a
 * tracked copy of a package SVG.
 *
 * The rendering itself carries no digest and is not compared. The two
 * reproduction scripts are run together after a pin move and read the same SVG,
 * so a stale extract and a stale rendering arrive together and the extract's
 * digest is the signal for both.
 */
async function checkCopiedSchematics() {
  const packageRoot = resolve(ROOT, SCHEMATIC_SOURCE);
  if (!existsSync(packageRoot)) {
    violations.push(...copiedSchematicViolations({ installed: {}, extracted: {}, tracked: [] }));
    return;
  }

  const installed = {};
  for (const file of await walk(SCHEMATIC_SOURCE, ['.svg'])) {
    const key = relative(packageRoot, file).split('\\').join('/');
    if (SCHEMATIC_FILE.test(key)) {
      installed[key] = createHash('sha256')
        .update(await readFile(file))
        .digest('hex');
    }
  }

  const extracted = {};
  for (const key of Object.keys(installed)) {
    const file = resolve(ROOT, SCOPE.extractedSchematics, key.replace(/\.svg$/, '.json'));
    if (!existsSync(file)) {
      continue;
    }
    try {
      extracted[key] = JSON.parse(await readFile(file, 'utf8')).source;
    } catch {
      extracted[key] = null;
    }
  }

  // Everything committed, so a hull the package has *dropped* is caught too.
  // Comparing only installed-to-extract leaves an orphan behind after a rename
  // or a withdrawal: a file still served that no script can reproduce from the
  // pinned package, which is the private geometry catalogue by another route.
  const committed = (await walk(SCOPE.extractedSchematics, ['.json']))
    .map((file) => relative(resolve(ROOT, SCOPE.extractedSchematics), file).split('\\').join('/'))
    .filter((key) => SCHEMATIC_FILE.test(key.replace(/\.json$/, '.svg')));

  // A private copy is a *tracked* package file: the extract and the rasterised
  // drawing are this repository's own output, reproducible from the package,
  // and the SVG itself is what may not be kept.
  const tracked = execFileSync('git', ['ls-files', '-z', '--', 'public', 'src'], {
    cwd: ROOT,
    encoding: 'utf8',
  })
    .split('\u0000')
    .filter((file) => file.endsWith('.svg'));

  violations.push(...copiedSchematicViolations({ installed, extracted, committed, tracked }));
}

/** IO wrapper: reconciles the ledger with the routes, components, previews and projects. */
async function checkLedgerReconciliation() {
  const routesPath = resolve(ROOT, 'src/app/app.routes.ts');
  const routesSource = existsSync(routesPath) ? await readFile(routesPath, 'utf8') : '';
  const routes = [...routesSource.matchAll(/path:\s*'([^']*)'/g)].map((match) => match[1]);

  const componentIds = [
    ...(await readFile(resolve(ROOT, SCOPE.previewManifest), 'utf8')).matchAll(
      /componentId:\s*'([^']+)'/g,
    ),
  ].map((match) => match[1]);

  const previewAddresses = [...new Set(componentIds)].flatMap((id) =>
    ['default', 'empty', 'loading', 'error', 'disabled'].map((state) => `${id}--${state}`),
  );

  const ledgerSource = await readFile(resolve(ROOT, SCOPE.ledger), 'utf8');
  const ledger = [
    ...ledgerSource.matchAll(/surfaceId:\s*'([^']+)',\s*[\s\S]*?journey:\s*'([^']+)'/g),
  ].map((match) => ({ surfaceId: match[1], journey: match[2] }));

  const configSource = await readFile(resolve(ROOT, 'playwright.config.ts'), 'utf8');
  const engines = [...configSource.matchAll(/browserName:\s*engine/g)].length > 0;
  const configured = engines
    ? ['chromium', 'firefox'].flatMap((engine) =>
        [
          'desktop',
          'tablet-portrait',
          'tablet-landscape',
          'mobile-portrait',
          'mobile-landscape',
        ].map((profile) => `${engine}-${profile}`),
      )
    : [];

  const declared =
    [...ledgerSource.matchAll(/`\$\{engine\}-\$\{profile\}`/g)].length > 0 ? configured : [];

  violations.push(
    ...ledgerReconciliationViolations({
      routes,
      componentIds: [...new Set(componentIds)],
      previewAddresses,
      projectNames: declared,
      configuredProjectNames: configured,
      ledger,
    }),
  );
}

/** IO wrapper: reads the product source and the documents that state the target. */
async function checkConformanceClaims(sources) {
  const contents = {};

  for (const file of sources) {
    contents[relative(ROOT, file).split('\\').join('/')] = await readFile(file, 'utf8');
  }
  for (const file of await walk(SCOPE.product, ['.html', '.json'])) {
    contents[relative(ROOT, file).split('\\').join('/')] = await readFile(file, 'utf8');
  }
  for (const document of SCOPE.conformanceDocuments) {
    const path = resolve(ROOT, document);
    if (existsSync(path)) {
      contents[document] = await readFile(path, 'utf8');
    }
  }
  violations.push(...conformanceClaimViolations(contents));
}

/** IO wrapper: reads every shipped catalogue and compares it with English. */
async function checkCatalogues() {
  const directory = resolve(ROOT, SCOPE.catalogues);
  if (!existsSync(directory)) {
    return;
  }

  const catalogues = {};
  for (const entry of await readdir(directory)) {
    if (!entry.endsWith('.json')) {
      continue;
    }
    catalogues[entry.replace(/\.json$/, '')] = JSON.parse(
      await readFile(join(directory, entry), 'utf8'),
    );
  }

  violations.push(...catalogueViolations(catalogues));
}

/** IO wrapper: reads the product source and the worker configuration. */
async function checkServiceWorkerOwnership(sources) {
  const contents = {};
  for (const file of sources) {
    contents[relative(ROOT, file).split('\\').join('/')] = await readFile(file, 'utf8');
  }

  const configPath = resolve(ROOT, SCOPE.serviceWorkerConfig);
  const config = existsSync(configPath) ? JSON.parse(await readFile(configPath, 'utf8')) : null;

  violations.push(...serviceWorkerOwnershipViolations(contents, config));
}

// ---------------------------------------------------------------------------
// Rule: the production output ships no preview and reaches no other origin
// ---------------------------------------------------------------------------

/**
 * Marker strings that only exist because the preview application was bundled.
 *
 * String literals rather than identifiers, because identifiers are minified
 * and would stop matching the moment the build changed its mangling.
 */
const PREVIEW_MARKERS = ['data-preview-address', 'data-preview-isolated', 'data-preview-stage'];

/**
 * Strings that only exist in a shipped bundle by mistake.
 *
 * The first two are formats the canvas once listed in the export layer and this
 * application cannot produce: a bundle that carries their labels is a bundle
 * offering a Commander something that does not work. They are no longer drawn
 * either — feature 004 took them out of `.design` — so this is the guard that
 * keeps them from coming back rather than a fence around something still there.
 *
 * The last two are the repository's own manifest — the export metadata imports
 * two named values out of `package.json`, and a bundler that stopped
 * tree-shaking it would ship the dependency list, the scripts and whatever else
 * it holds.
 */
const BUNDLE_REMNANTS = [
  'JOURNAL LOADOUT',
  'MARKDOWN TABLE',
  '"devDependencies"',
  'onlyBuiltDependencies',
];

/**
 * Origins that appear as namespace or documentation strings, never as requests.
 *
 * Deliberately short, and deliberately not shared with the search-metadata
 * rule: this list exempts a host from the constitution-I gate on the shipped
 * bundle, so anything added here is a host the output may reach without anyone
 * being told. The vocabularies the head and the sitemap declare themselves
 * against are named in {@link DECLARED_VOCABULARIES} instead, which exempts
 * them from that rule alone.
 */
const NON_REQUEST_ORIGINS = [/^https?:\/\/www\.w3\.org\//];

/**
 * Vocabularies the crawler-facing files name without ever fetching them.
 *
 * `schema.org` is what the JSON-LD block declares itself against and
 * `sitemaps.org` is the sitemap's XML namespace. A `@context` names a
 * vocabulary and an `xmlns` names a schema; both would be identical strings if
 * the site were served from the moon, so neither is the site's origin moving
 * out from under the other files.
 *
 * Each entry is written with its trailing slash, because the addresses these
 * are tested against are full URLs. A caller holding a bare origin appends one
 * before testing.
 */
const DECLARED_VOCABULARIES = [/^https?:\/\/schema\.org\//, /^https?:\/\/www\.sitemaps\.org\//];

/** Ways a bundle can actually reach another origin. */
const CROSS_ORIGIN_REQUEST = [
  /\bfetch\s*\(\s*["'`](https?:\/\/[^"'`]+)/g,
  /\.open\s*\(\s*["'][A-Z]+["']\s*,\s*["'`](https?:\/\/[^"'`]+)/g,
  /<(?:script|link|img|iframe|source)\b[^>]*?\b(?:src|href)\s*=\s*["'](https?:\/\/[^"']+)/gi,
  /@import\s+(?:url\()?["']?(https?:\/\/[^"')]+)/gi,
  /url\(\s*["']?(https?:\/\/[^"')]+)/gi,
];

/**
 * `<link>` relationships that state something rather than fetch something.
 *
 * A canonical or an alternate is an address the document *declares*; the
 * browser opens no connection for either, and a search engine is the only
 * consumer. Every other relationship is left caught, including the ones that
 * look declarative and are not: `preconnect` and `dns-prefetch` open the
 * connection as their whole purpose, and `manifest`, `stylesheet`, `icon` and
 * `preload` fetch a file.
 *
 * Without this, the canonical link the application needs in order to be found
 * at all would be reported as the cross-origin request it is not (011/FR-027).
 */
const DECLARED_LINK_RELS = /<link\b[^>]*?\brel\s*=\s*["'](?:canonical|alternate)["'][^>]*>/gi;

// ---------------------------------------------------------------------------
// Rule: the hull schematics are extracted from the package, never kept
// ---------------------------------------------------------------------------

/** Where the installed Almanac package keeps its per-hull assets. */
export const SCHEMATIC_SOURCE = 'node_modules/@elite-dangerous-almanac/core/assets/ships';

/** The two files per hull the anatomy capability renders. */
export const SCHEMATIC_FILE = /^[^/]+\/schematic-(?:top|bottom)\.svg$/;

/**
 * Checks that every committed mount extract was made from the installed package.
 *
 * Feature 010's FR-009 says a hull's mounts come from the installed package and that no
 * private copy or geometry catalogue is maintained. The extract under
 * `public/assets/ships` is neither: it is written by
 * `scripts/extract-schematic-mounts.mts` from the installed SVG and carries that
 * file's digest, so "reproducible from the package" is a fact this rule can
 * check rather than a claim in a comment.
 *
 * Three ways it can go wrong, all of them silent without this: a package
 * upgrade that nobody re-extracted leaves every mount on the previous
 * release's coordinates; a hull added by the package has no extract at all and
 * draws no mounts; and a well-meant "fixed" SVG committed under `public/` is
 * exactly the private copy the requirement forbids — it would keep working, and
 * would stop tracking the package at the next release.
 *
 * `installed` is `{ [relative path]: sha256 }` of the package's own files,
 * `extracted` is `{ [the same path]: the digest the committed extract records }`
 * and `tracked` is every `.svg` git has under `public/` and `src/`. An empty
 * input is itself a violation: a rule that passes when there is nothing to
 * inspect is not a gate.
 */
export function copiedSchematicViolations({ installed, extracted, committed, tracked }) {
  const found = [];
  const file = SCOPE.extractedSchematics;
  const fail = (where, message) =>
    found.push({ file: where, line: 0, rule: 'copied-schematics', message });

  const names = Object.keys(installed ?? {});
  if (names.length === 0) {
    fail(
      SCHEMATIC_SOURCE,
      'No installed hull schematics were found to audit. Install dependencies before running this check.',
    );
    return found;
  }

  for (const name of names) {
    const recorded = (extracted ?? {})[name];
    const target = `${file}/${name.replace(/\.svg$/, '.json')}`;
    if (recorded === undefined) {
      fail(
        target,
        `No mount extract for "${name}". Run \`node scripts/extract-schematic-mounts.mts\`.`,
      );
    } else if (recorded !== installed[name]) {
      fail(
        target,
        'The mount extract was made from a different file than the installed package ships. Re-run `node scripts/extract-schematic-mounts.mts`.',
      );
    }
  }

  for (const key of committed ?? []) {
    if (installed[key.replace(/\.json$/, '.svg')] === undefined) {
      fail(
        `${file}/${key}`,
        'This extract is for a hull the pinned package does not ship. Nothing can reproduce it; delete it.',
      );
    }
  }

  for (const path of tracked ?? []) {
    if (SCHEMATIC_FILE.test(path.split('/').slice(-2).join('/'))) {
      fail(
        path,
        'A package hull schematic is tracked in the repository. Only the extract and the rendering are kept.',
      );
    }
  }

  return found;
}

/**
 * Checks the built output rather than the source.
 *
 * What matters is what ships. The preview catalogue is a tooling application
 * and must not be reachable in production — not as a route, not as a chunk, not
 * as dead code someone can still evaluate. And the bundle must reach no other
 * origin at runtime, because the application is client-side only and sends
 * nothing anywhere (constitution I).
 *
 * `contents` is `{ [emitted file]: text }`. An empty input is itself a
 * violation: a rule that silently passes when there is nothing to inspect is
 * not a gate.
 */
export function productionOutputViolations(contents) {
  const found = [];
  const files = Object.keys(contents);

  if (files.length === 0) {
    return [
      {
        file: SCOPE.productionOutput,
        line: 0,
        rule: 'production-output',
        message: 'No production output was found to inspect. Build before running this check.',
      },
    ];
  }

  for (const file of files) {
    if (file.includes('ui-preview')) {
      found.push({
        file,
        line: 0,
        rule: 'production-output',
        message: 'The preview application is emitted into the production output.',
      });
    }
  }

  for (const [file, text] of Object.entries(contents)) {
    for (const marker of PREVIEW_MARKERS) {
      if (text.includes(marker)) {
        found.push({
          file,
          line: 0,
          rule: 'production-output',
          message: `The preview catalogue is bundled: "${marker}" is present in the shipped output.`,
        });
        break;
      }
    }

    for (const marker of BUNDLE_REMNANTS) {
      if (text.includes(marker)) {
        found.push({
          file,
          line: 0,
          rule: 'production-output',
          message: `The shipped output carries "${marker}", which no delivered capability puts there.`,
        });
      }
    }

    // One URL, one violation: `@import url(...)` matches two of the patterns
    // above, and reporting the same address twice makes a short list look like
    // a long one.
    //
    // Declarative `<link>` elements are removed first rather than filtered
    // afterwards, so the address inside one is never compared at all: it is not
    // a request, and exempting it by origin would exempt real requests to the
    // same host.
    const requestable = text.replace(DECLARED_LINK_RELS, '');
    const reported = new Set();
    for (const pattern of CROSS_ORIGIN_REQUEST) {
      pattern.lastIndex = 0;
      let match = pattern.exec(requestable);
      while (match !== null) {
        const url = match[1];
        if (!NON_REQUEST_ORIGINS.some((allowed) => allowed.test(url)) && !reported.has(url)) {
          reported.add(url);
          found.push({
            file,
            line: 0,
            rule: 'production-output',
            message: `The production output requests another origin: ${url}`,
          });
        }
        match = pattern.exec(requestable);
      }
    }
  }

  return found;
}

// ---------------------------------------------------------------------------
// Rule: a served document is drawn in its own typefaces from its first frame
// ---------------------------------------------------------------------------

/**
 * Every `<link>` a document carries, whole.
 *
 * Read as tags and sorted by their own attributes rather than matched by a
 * pattern per relationship: `onload="this.rel='stylesheet'"` carries the word a
 * `rel="stylesheet"` pattern looks for, and the deferral that spells it that way
 * is exactly the one this rule exists to catch.
 */
const LINK_TAG = /<link\b[^>]*>/gi;

/**
 * One `@font-face`, as the emitted stylesheet spells it: its family and its file.
 *
 * Whitespace-tolerant, because the same rule is read from a minified stylesheet
 * and from an unminified one, and a pattern that only matches the minified
 * spelling stops checking without failing anything.
 */
const FACE_RULE = /@font-face\s*\{[^}]*\}/g;

/** A CSS value with its quotes and surrounding space taken off. */
function unquoted(value) {
  return value.trim().replace(/^["']|["']$/g, '');
}

/** Whether a tag carries an attribute at all, with or without a value. */
function hasAttribute(tag, name) {
  return new RegExp(`(?:^|\\s)${name}(?=[\\s=>/])`, 'i').test(tag);
}

/**
 * One attribute of a tag, however it is quoted.
 *
 * The name is anchored on whitespace rather than a word boundary, because a
 * word boundary also falls after the dot in `onload="this.media='all'"`. That
 * value carries the name and a value of its own, and reading it as the tag's
 * own attribute is what would let the deferral this rule exists to catch state
 * `media="print"` and be read as applying to every screen.
 */
function attributeValue(tag, name) {
  const match = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(["'])([\\s\\S]*?)\\1`, 'i').exec(tag);
  return match === null ? null : match[2];
}

/**
 * Checks that every published document paints in the faces it was designed in.
 *
 * A document painted in a system fallback and re-painted in Barlow a moment
 * later changes shape in front of the Commander, and the change is the whole
 * page: the fallback stacks are metrically different, so the text moves as well
 * as changing. Two things keep it from happening, and both are invisible in a
 * source file:
 *
 *   * the stylesheet that declares the faces is applied before the first paint,
 *     which is what `optimization.styles.inlineCritical: false` in
 *     `angular.json` holds. The critical-CSS pass moves the stylesheet behind
 *     the first paint, and it keeps a face only where a rule it judges critical
 *     names the family in a `font-family` value — every rule here names one
 *     through a design token, which that pass cannot resolve, so it drops all
 *     twenty faces and the document paints in whatever the system offers;
 *   * `src/index.html` preloads the faces a served document draws with, so they
 *     arrive with that stylesheet rather than a round trip behind it.
 *
 * What it holds a document to is every family, not every weight: which weights
 * one address draws is a property of the screen it renders, and no rule reading
 * the emitted files can know it. A family with no face asked for is a whole
 * typeface arriving behind the paint, and that this rule does catch.
 *
 * `contents` is `{ [emitted file]: text }`, the same map the production-output
 * rule reads. Only the documents and the emitted stylesheets are inspected.
 */
export function firstFrameTypefaceViolations(contents) {
  const found = [];
  const fail = (file, message) =>
    found.push({ file, line: 0, rule: 'first-frame-typeface', message });

  // What the emitted stylesheets declare: every face's file, and which family
  // each file belongs to. The families are what a document is held to asking
  // for, because a family with no preloaded face is a whole typeface arriving
  // behind the paint rather than one weight of one.
  const declared = new Map();
  for (const [file, text] of Object.entries(contents)) {
    if (!file.endsWith('.css')) {
      continue;
    }
    for (const rule of text.match(FACE_RULE) ?? []) {
      const source = /url\(([^)]+)\)/.exec(rule);
      const family = /font-family\s*:\s*([^;}]+)/.exec(rule);
      if (source === null || family === null) {
        continue;
      }
      declared.set(unquoted(source[1]), unquoted(family[1]));
    }
  }

  for (const [file, text] of Object.entries(contents)) {
    if (!file.endsWith('.html')) {
      continue;
    }

    // `all` and `screen` are the two values that leave a stylesheet applied to
    // the screen a Commander reads. Anything else — `print`, and a width query
    // as much as a type — holds it back on some viewport or all of them, and a
    // held-back stylesheet is one the document paints without.
    const applies = (link) => {
      const media = attributeValue(link, 'media');
      return media === null || /^(all|screen)$/i.test(media.trim());
    };

    const links = text.match(LINK_TAG) ?? [];
    const relationship = (tag) => (attributeValue(tag, 'rel') ?? '').trim().toLowerCase();
    const stylesheets = links.filter((tag) => relationship(tag) === 'stylesheet');
    for (const link of stylesheets.filter((sheet) => !applies(sheet))) {
      fail(
        file,
        `A stylesheet is deferred behind media="${attributeValue(link, 'media')}", so the document paints before the faces it declares are known.`,
      );
    }

    if (stylesheets.length === 0) {
      fail(
        file,
        'The document applies no stylesheet, so nothing it is drawn in reaches it before it paints.',
      );
      continue;
    }

    // Every stylesheet it has is held back, which the failures above have
    // already said once each.
    if (!stylesheets.some(applies)) {
      continue;
    }

    if (declared.size === 0) {
      fail(
        file,
        'The document applies a stylesheet that declares no face at all, so every word of it is drawn in a system fallback.',
      );
      continue;
    }

    // The relationship is required rather than assumed from `as="font"`: a
    // `prefetch`, a misspelt `rel` and a missing one all leave a tag that reads
    // like a preload and fetches nothing early.
    const preloads = links.filter(
      (tag) =>
        relationship(tag) === 'preload' &&
        (attributeValue(tag, 'as') ?? '').trim().toLowerCase() === 'font',
    );
    const asked = new Set();
    for (const preload of preloads) {
      const href = attributeValue(preload, 'href');
      if (href === null || href.startsWith('/') || /^[a-z]+:/i.test(href)) {
        fail(
          file,
          `A font preload states ${href ?? 'no address'}. It has to be relative, so a deployment under a sub-path reaches its own fonts.`,
        );
        continue;
      }
      // Stated, and stated as the anonymous mode: a face is fetched anonymously
      // whatever its origin, so a preload that carries no `crossorigin`, or
      // carries `use-credentials`, does not match the fetch it exists for. The
      // attribute is asked for by presence, because the spelling this document
      // uses states no value at all.
      const mode = attributeValue(preload, 'crossorigin');
      if (!hasAttribute(preload, 'crossorigin') || !/^(|anonymous)$/i.test(mode ?? '')) {
        fail(
          file,
          `The preload of ${href} does not ask for it in anonymous mode. A face is fetched anonymously whatever its origin, so the preload goes unused and the file is fetched twice.`,
        );
      }
      const family = declared.get(href);
      if (family === undefined) {
        fail(
          file,
          `The document preloads ${href}, which no emitted stylesheet declares a face for.`,
        );
        continue;
      }
      asked.add(family);
    }

    for (const family of new Set(declared.values())) {
      if (!asked.has(family)) {
        fail(
          file,
          `The document draws with ${family} and asks for none of its faces, so the whole family arrives behind the stylesheet.`,
        );
      }
    }
  }

  return found;
}

// ---------------------------------------------------------------------------
// Rule: the files that state where this application lives, and what it looks
// like, agree with each other and with the route table
// ---------------------------------------------------------------------------

/** Where each half of the search metadata is written. */
export const SEARCH_METADATA_FILES = {
  origin: 'src/app/platform/browser/site-address.ts',
  index: 'src/index.html',
  robots: 'public/robots.txt',
  sitemap: 'public/sitemap.xml',
  manifest: 'public/manifest.webmanifest',
  /**
   * The file that actually decides the production domain.
   *
   * Pages reads it and serves the site from whatever it names, so a domain move
   * that edits this and nothing else would leave every canonical link, the
   * sitemap and the robots file pointing at an address the site no longer
   * answers on — and nothing would notice.
   */
  domain: 'public/CNAME',
  /** The one file permitted to declare the colour the application is drawn on. */
  tokens: 'src/styles/tokens/_primitives.scss',
  /**
   * The one place that turns the route table and the package's hulls into
   * addresses.
   *
   * The sitemap, the deployment's published documents and this checker all read
   * it, so a disagreement between the three is impossible by construction and
   * what is left to reconcile is this module against the route table.
   */
  addresses: 'scripts/search/published-addresses.mjs',
  /**
   * The file that rewrites the robots tag for a preview deployment.
   *
   * Read here because it is the only thing that carries out "a deployment that
   * is not the production site asks not to be indexed" (011/FR-027), and its
   * `sed` matches one exact spelling of the tag. Reformatting the tag in
   * `index.html` would leave the expression matching nothing, and the failure
   * would surface on a preview publish rather than in `pnpm run check`.
   */
  preview: '.github/workflows/ci.yml',
};

/** Head tags `index.html` must carry for a crawler that runs no script. */
const REQUIRED_HEAD_TAGS = [
  { attribute: 'name', key: 'description' },
  { attribute: 'name', key: 'theme-color' },
  { attribute: 'name', key: 'robots' },
  { attribute: 'name', key: 'twitter:image' },
  { attribute: 'property', key: 'og:image' },
  { attribute: 'property', key: 'og:image:alt' },
  { attribute: 'name', key: 'twitter:card' },
  { attribute: 'name', key: 'twitter:title' },
  { attribute: 'name', key: 'twitter:description' },
  { attribute: 'property', key: 'og:type' },
  { attribute: 'property', key: 'og:site_name' },
  { attribute: 'property', key: 'og:title' },
  { attribute: 'property', key: 'og:description' },
  { attribute: 'property', key: 'og:url' },
  { attribute: 'property', key: 'og:locale' },
];

/** The description tags that must all say the same thing. */
const DESCRIPTION_TAGS = [
  { attribute: 'name', key: 'description' },
  { attribute: 'property', key: 'og:description' },
  { attribute: 'name', key: 'twitter:description' },
];

/** Members a web app manifest needs before a browser offers installation. */
const REQUIRED_MANIFEST_MEMBERS = [
  'name',
  'short_name',
  'description',
  'start_url',
  'scope',
  'display',
  'background_color',
  'theme_color',
  'icons',
];

/**
 * Icon sizes a browser wants before it offers installation.
 *
 * 192 and 512 are what a browser looks for, and one of them has to be
 * `maskable` or a platform that crops to a circle crops the mark. Stated as
 * sizes rather than as "some icons", because `icons: []` satisfies "the member
 * is declared" and offers installation nowhere.
 */
const REQUIRED_ICON_SIZES = ['192x192', '512x512'];

/** Routes that are redirects or wildcards, and so are not addresses to list. */
// The wildcard alone. `''` was here while it redirected into the ship tool;
// it answers with the start page now, so it is an address like any other.
const UNLISTABLE_ROUTES = new Set(['**']);

/**
 * One `<meta>` element's content, whichever quote character delimits it.
 *
 * Delimiter-aware rather than "anything that is not a quote": a sentence with
 * an apostrophe in it truncates under the simpler pattern, and two tags that
 * differ only after the apostrophe compare equal.
 */
function headContent(document, attribute, key) {
  const tag = new RegExp(
    `<meta\\b[^>]*?\\b${attribute}\\s*=\\s*(["'])${key}\\1[^>]*?\\bcontent\\s*=\\s*(["'])([\\s\\S]*?)\\2`,
    'i',
  ).exec(document);
  return tag?.[3] ?? null;
}

/** One `<link>` element's href, by its relationship. */
function linkHref(document, rel) {
  const tag = new RegExp(
    `<link\\b[^>]*?\\brel\\s*=\\s*(["'])${rel}\\1[^>]*?\\bhref\\s*=\\s*(["'])([\\s\\S]*?)\\2`,
    'i',
  ).exec(document);
  return tag?.[3] ?? null;
}

/**
 * Checks that nothing drifts between the files that state where this
 * application lives, what each of its pages is, and what colour it is.
 *
 * The production origin is repeated in `src/index.html`, `public/robots.txt`
 * and `public/sitemap.xml`, and again as the host in `public/CNAME`; the route
 * list is repeated in `app.routes.ts` and the sitemap; the background colour is
 * repeated in the head's `theme-color` and in two members of the manifest.
 * Every one of those repetitions is a silent regression waiting to happen — a
 * route added with no sitemap entry, a domain moved in one file and not the
 * others, a palette token changed under a manifest nobody reopened — and none
 * of them fails anything at runtime. They fail months later, in a search result
 * nobody is looking at (011/FR-027).
 *
 * The manifest states the origin nowhere, and that absence is checked too: a
 * `start_url`, `scope` or icon that is absolute or root-absolute would be a
 * fifth copy of it, and an `id` a sixth.
 *
 * `input` is `{ origin, index, robots, sitemap, manifest, domain, tokens,
 * preview, routes, routeTable, locales, published, messages, assets }`. Each of
 * the first eight is the text of its file — `origin` is `site-address.ts`,
 * `domain` is `public/CNAME`, `tokens` is the primitives stylesheet the theme
 * colour is read from, and `preview` is the workflow that rewrites a preview's
 * robots tag. `routes` is the paths parsed out of the route table and
 * `routeTable` the same table as `(path, titleKey, descriptionKey)` triples;
 * `locales` is the tags this build ships; `published` is the address set from
 * `scripts/search/published-addresses.mjs`; `messages` is the keys bundled
 * English carries; `assets` is what `public/` serves. Every one of them is
 * read, and a caller that omits one loses the checks that need it — which is
 * why `checkSearchMetadata` reports a failure to read one rather than passing
 * `undefined` and going quiet. An empty input is itself a violation: a rule
 * that passes when there is nothing to inspect is not a gate.
 */
export function searchMetadataViolations(input) {
  const found = [];
  const fail = (file, message) => found.push({ file, line: 0, rule: 'search-metadata', message });

  const declared = /SITE_ORIGIN\s*=\s*'(https:\/\/[^']+)'/.exec(input.origin ?? '');
  if (declared === null) {
    fail(
      SEARCH_METADATA_FILES.origin,
      'No SITE_ORIGIN is declared, so nothing states where this application is published.',
    );
    return found;
  }
  const origin = declared[1];
  const host = origin.replace(/^https?:\/\//, '');

  // The domain the site is actually served from. `SITE_ORIGIN` is a claim about
  // it, and a claim nobody compares is how a moved domain leaves every
  // canonical link pointing at an address that no longer answers.
  const domain = (input.domain ?? '').trim();
  if (domain.length === 0) {
    fail(SEARCH_METADATA_FILES.domain, 'No production domain is declared for the deployment.');
  } else if (domain !== host) {
    fail(
      SEARCH_METADATA_FILES.domain,
      `The site is served from "${domain}" but SITE_ORIGIN names "${host}". One of the two has moved.`,
    );
  }

  // `index.html`: the head a crawler that runs no script is served.
  const index = input.index ?? '';
  for (const { attribute, key } of REQUIRED_HEAD_TAGS) {
    const content = headContent(index, attribute, key);
    if (content === null || content.length === 0) {
      fail(
        SEARCH_METADATA_FILES.index,
        `The head carries no non-empty <meta ${attribute}="${key}">, so a crawler that runs no script reads none.`,
      );
    }
  }

  // The href, not just the element. A relative `href="/"` satisfies "a canonical
  // exists" and is exactly the mistake `SITE_ORIGIN` exists to prevent: served
  // from a preview sub-path it canonicalises the preview to itself.
  const canonical = linkHref(index, 'canonical');
  if (canonical === null) {
    fail(
      SEARCH_METADATA_FILES.index,
      'The head declares no canonical link, so every preview deployment is a duplicate of the site.',
    );
  } else if (canonical !== `${origin}/`) {
    fail(
      SEARCH_METADATA_FILES.index,
      `The canonical link is "${canonical}"; it must be the absolute "${origin}/".`,
    );
  }

  // `og:url` is the canonical by another name, and a crawler reading only the
  // card block reads this one. Presence alone would let it say "/".
  const declaredUrl = headContent(index, 'property', 'og:url');
  if (declaredUrl !== null && declaredUrl !== `${origin}/`) {
    fail(SEARCH_METADATA_FILES.index, `og:url is "${declaredUrl}"; it must be "${origin}/".`);
  }

  // The manifest link is held to the rule its own paths are held to: a leading
  // slash resolves at the host root, which is not where a preview lives.
  const manifestHref = linkHref(index, 'manifest');
  if (manifestHref === null) {
    fail(SEARCH_METADATA_FILES.index, 'The head links no web app manifest.');
  } else if (manifestHref.startsWith('/')) {
    fail(
      SEARCH_METADATA_FILES.index,
      `The manifest is linked as "${manifestHref}". A root-absolute path breaks every preview deployment; make it relative.`,
    );
  }

  // The structured data is parsed rather than spotted. A block that does not
  // parse states exactly as much as no block at all, and says so to nobody.
  const structured =
    /<script\b[^>]*?\btype\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/i.exec(
      index,
    );
  if (structured === null) {
    fail(
      SEARCH_METADATA_FILES.index,
      'The head carries no JSON-LD, so nothing states in machine-readable form what this is.',
    );
  } else {
    let node = null;
    try {
      node = JSON.parse(structured[1]);
    } catch {
      fail(
        SEARCH_METADATA_FILES.index,
        'The JSON-LD block does not parse, so no crawler reads it.',
      );
    }
    if (node !== null) {
      if (node.url !== `${origin}/`) {
        fail(
          SEARCH_METADATA_FILES.index,
          `The JSON-LD names "${node.url}" rather than "${origin}/".`,
        );
      }
      const declaredLanguages = [node.inLanguage ?? []].flat().join(',');
      if (input.locales !== undefined && declaredLanguages !== input.locales.join(',')) {
        fail(
          SEARCH_METADATA_FILES.index,
          `The JSON-LD declares languages "${declaredLanguages}" but this build ships "${input.locales.join(',')}".`,
        );
      }
    }
  }

  // The three description tags say one thing. They drift the moment one is
  // edited and the others are not, and nothing at runtime notices. A tag that
  // is absent is left out of the comparison: it is already reported above as
  // missing, and reporting it twice makes one fault look like two.
  const descriptions = new Set(
    DESCRIPTION_TAGS.map(({ attribute, key }) => headContent(index, attribute, key)).filter(
      (value) => value !== null,
    ),
  );
  if (descriptions.size > 1) {
    fail(
      SEARCH_METADATA_FILES.index,
      'The description, og:description and twitter:description do not say the same thing.',
    );
  }

  // Every absolute address in the four crawler-facing files is this origin.
  // `http` as well as `https`: a plain-text address is still an address, and an
  // unnoticed one is still the wrong site.
  for (const key of ['index', 'robots', 'sitemap', 'manifest']) {
    const file = SEARCH_METADATA_FILES[key];
    for (const match of (input[key] ?? '').matchAll(/https?:\/\/[a-z0-9.-]+/gi)) {
      const address = match[0];
      // A bare origin gains the trailing slash `DECLARED_VOCABULARIES` is
      // written against, so a vocabulary named without a path still matches.
      if (
        address !== origin &&
        !DECLARED_VOCABULARIES.some((allowed) => allowed.test(`${address}/`))
      ) {
        fail(
          file,
          `"${address}" is not the declared site origin ${origin}. One of the two has moved and the other has not.`,
        );
      }
    }
  }

  // `robots.txt`: crawlable, and naming the map.
  const robots = input.robots ?? '';
  if (!/^\s*User-agent:/im.test(robots)) {
    fail(SEARCH_METADATA_FILES.robots, 'No User-agent group, so the file states nothing.');
  }
  if (/^\s*Disallow:\s*\/\s*$/im.test(robots)) {
    fail(
      SEARCH_METADATA_FILES.robots,
      'The whole site is disallowed. Nothing here is behind an account to keep out of an index.',
    );
  }
  if (!robots.includes(`Sitemap: ${origin}/sitemap.xml`)) {
    fail(SEARCH_METADATA_FILES.robots, `No "Sitemap: ${origin}/sitemap.xml" line.`);
  }

  // `sitemap.xml`: exactly the addressable routes, no more and no fewer.
  //
  // Read through `readSitemap`, which is the same function
  // `scripts/publish-static-routes.mjs` publishes from. That is the point of it
  // being a function rather than a rule spelled here and a `sed` spelled there:
  // a `<loc>` the two read differently is an address that passes this gate and
  // never gets a file, or a file published from inside a comment.
  const { addresses, defect } = readSitemap(input.sitemap ?? '');
  if (defect !== null) {
    fail(
      SEARCH_METADATA_FILES.sitemap,
      `${defect} Neither this check nor the publisher can read it; write plain comments.`,
    );
  }

  const listed = new Set(addresses);

  // The map is generated from `published`, so the two agree unless the file was
  // edited by hand or the generator was not re-run after a package pin move.
  // Both are worth a named failure: an address the deployment does not publish
  // is a 404 in a sitemap, and a hull the map does not list is a page nothing
  // will ever find.
  const published = input.published;
  if (published !== undefined) {
    for (const entry of published) {
      if (!listed.has(entry.address)) {
        fail(
          SEARCH_METADATA_FILES.sitemap,
          `"/${entry.path}" is an address this application publishes but is not listed. Run \`pnpm run search:sitemap\`.`,
        );
      }
    }
    for (const address of listed) {
      if (!published.some((entry) => entry.address === address)) {
        fail(
          SEARCH_METADATA_FILES.sitemap,
          `"${address}" is listed but is not an address this application publishes.`,
        );
      }
    }
  }

  // The map against the route table. This is the pair that can drift silently:
  // the module states the message keys a second time, deliberately, because the
  // alternative is a script that parses TypeScript and stops working the first
  // time the file is formatted differently.
  if (published !== undefined && input.routes !== undefined) {
    const declared = new Set(input.routes);
    for (const route of input.routes.filter(
      (route) => !UNLISTABLE_ROUTES.has(route) && !route.includes(':'),
    )) {
      if (!published.some((entry) => entry.route === route)) {
        fail(
          SEARCH_METADATA_FILES.addresses,
          `Route "/${route}" is addressable but no published address names it.`,
        );
      }
    }
    for (const entry of published) {
      const leaf = entry.route.split('/').at(-1) ?? '';
      if (!declared.has(leaf)) {
        fail(
          SEARCH_METADATA_FILES.addresses,
          `"${entry.route}" is published but the route table declares no "${leaf}".`,
        );
      }
    }
  }

  // Which advertised addresses the build renders a document for.
  //
  // Feature 015 turns 51 of the 53 into documents that state their subject
  // before any script runs, and leaves 2 as the head-only shells they have
  // always been. What makes that safe is that the verdict is recorded once and
  // read by both the build and the gate — so this reconciles the record against
  // itself and against what the routes-file generator would actually write, and
  // an address that is neither generated nor deliberately content-free fails
  // the build rather than being published silently (015/FR-021).
  if (published !== undefined) {
    for (const entry of published) {
      if (typeof entry.contentBearing !== 'boolean') {
        fail(
          SEARCH_METADATA_FILES.addresses,
          `"/${entry.path}" is advertised but nothing records whether it has content to state. ` +
            'It would be neither generated nor deliberately content-free.',
        );
        continue;
      }
      if (!entry.contentBearing && (entry.reason ?? '').trim().length === 0) {
        fail(
          SEARCH_METADATA_FILES.addresses,
          `"/${entry.path}" is advertised with no document and no reason. ` +
            'An address left out because nobody got to it is not a decision.',
        );
      }
      if (entry.contentBearing && entry.reason !== null) {
        fail(
          SEARCH_METADATA_FILES.addresses,
          `"/${entry.path}" is generated but carries a reason for not being. ` +
            'One of the two is stale.',
        );
      }
    }

    // And the list the builder is actually handed. `prerender.routesFile` with
    // `discoverRoutes: false` means that file is the whole set: an address
    // missing from it ships the empty shell this feature exists to replace, and
    // nothing about the build would say so.
    try {
      const rendered = new Set(prerenderRoutes(published).trimEnd().split('\n'));
      for (const entry of published) {
        const route = `/${entry.path}`;
        if (entry.contentBearing && !rendered.has(route)) {
          fail(
            SEARCH_METADATA_FILES.addresses,
            `"${route}" has content to state but the build is not told to render it.`,
          );
        }
        if (!entry.contentBearing && rendered.has(route)) {
          fail(
            SEARCH_METADATA_FILES.addresses,
            `"${route}" is recorded as having nothing to state but the build renders it.`,
          );
        }
      }
    } catch (failure) {
      fail(
        SEARCH_METADATA_FILES.addresses,
        `The set of addresses to render could not be built: ${failure.message}`,
      );
    }
  }

  // Every key the map names has to exist, and has to be the key the route
  // declares. A key that resolves to nothing publishes a blank description; a
  // key the route table does not carry publishes one sentence to a crawler and
  // a different one to a Commander a moment later.
  if (published !== undefined && input.messages !== undefined) {
    const carried = new Set(input.messages);
    for (const key of new Set(
      published.flatMap((entry) => [entry.titleKey, entry.descriptionKey]),
    )) {
      if (!carried.has(key)) {
        fail(
          SEARCH_METADATA_FILES.addresses,
          `"${key}" is published but this build carries no such message.`,
        );
      }
    }
  }
  // Route by route, not key by key. Two addresses whose keys were exchanged
  // between them declare every key somewhere, so a check that both sets match
  // passes while the published document names one screen and the application
  // names another a moment later.
  if (published !== undefined && input.routeTable !== undefined) {
    const declared = new Map(input.routeTable.map((route) => [route.path, route]));
    for (const entry of published) {
      const leaf = entry.route.split('/').at(-1) ?? '';
      const route = declared.get(leaf);
      if (route === undefined) {
        continue; // Already failed above, by name, as a route the table lacks.
      }
      for (const [what, published_, table] of [
        ['title', entry.titleKey, route.titleKey],
        ['description', entry.descriptionKey, route.descriptionKey],
      ]) {
        if (published_ !== table) {
          fail(
            SEARCH_METADATA_FILES.addresses,
            `"/${entry.path}" publishes "${published_}" as its ${what}, but the route table declares "${table ?? 'none'}". A crawler and a Commander would be told different things.`,
          );
        }
      }
    }
  }

  // The dark ground, stated three times: in the token layer that draws it, in
  // the head that tells a browser what to paint before the styles land, and in
  // the manifest that colours an installed window. `src/index.html` is outside
  // the template scan, so nothing else would notice them diverging.
  const ground = /--ednb-palette-bg:\s*(#[0-9a-f]{3,8})\b/i.exec(input.tokens ?? '');
  if (ground === null) {
    fail(
      SEARCH_METADATA_FILES.tokens,
      'No --ednb-palette-bg is declared to take a theme colour from.',
    );
  } else {
    const declared = headContent(index, 'name', 'theme-color');
    if (declared !== null && declared.toLowerCase() !== ground[1].toLowerCase()) {
      fail(
        SEARCH_METADATA_FILES.index,
        `theme-color is "${declared}" but the token layer draws ${ground[1]}.`,
      );
    }
  }

  // `manifest.webmanifest`: parses, complete, and reachable from a sub-path.
  let manifest = null;
  try {
    manifest = JSON.parse(input.manifest ?? '');
  } catch {
    fail(SEARCH_METADATA_FILES.manifest, 'The manifest is not valid JSON, so no browser reads it.');
  }
  if (manifest !== null) {
    for (const member of REQUIRED_MANIFEST_MEMBERS) {
      if (manifest[member] === undefined) {
        fail(SEARCH_METADATA_FILES.manifest, `The manifest declares no "${member}".`);
      }
    }

    if (ground !== null) {
      for (const member of ['theme_color', 'background_color']) {
        const value = manifest[member];
        if (typeof value === 'string' && value.toLowerCase() !== ground[1].toLowerCase()) {
          fail(
            SEARCH_METADATA_FILES.manifest,
            `"${member}" is "${value}" but the token layer draws ${ground[1]}.`,
          );
        }
      }
    }
    // Same reason the locale catalogues' paths are relative: a preview is
    // served from a sub-path of a Pages site, and a leading slash would look
    // for the scope, the start URL and every icon at the host root.
    // `id` is deliberately absent rather than relative: the specification
    // resolves it against the manifest's *origin*, so `./` and `/` name the
    // same identity and neither can be per-deployment. Omitted, the identity
    // defaults to the resolved `start_url`, which is.
    if (manifest.id !== undefined) {
      fail(
        SEARCH_METADATA_FILES.manifest,
        'The manifest declares an "id". It resolves against the origin, so it collides every deployment into one installed application; omit it and let the resolved start_url be the identity.',
      );
    }

    for (const [member, value] of [
      ['start_url', manifest.start_url],
      ['scope', manifest.scope],
      ...(Array.isArray(manifest.icons) ? manifest.icons : []).map((icon, index) => [
        `icons[${index}].src`,
        icon?.src,
      ]),
    ]) {
      if (typeof value !== 'string') {
        continue;
      }
      // Absolute as well as root-absolute. An address naming the production
      // origin passes every other rule here — it is the declared origin, after
      // all — and still pins the installed application to production from a
      // preview, which is the one thing these three members must not do.
      if (/^[a-z][a-z0-9+.-]*:/i.test(value) || value.startsWith('//')) {
        fail(
          SEARCH_METADATA_FILES.manifest,
          `"${member}" is "${value}". An absolute address installs a preview as the production site; make it relative.`,
        );
      } else if (value.startsWith('/')) {
        fail(
          SEARCH_METADATA_FILES.manifest,
          `"${member}" is "${value}". A root-absolute path breaks every preview deployment; make it relative.`,
        );
      }
    }

    // Installability, stated as the sizes rather than as "some icons". An
    // `icons` member that is present and useless satisfies every rule above and
    // offers installation on no platform.
    const icons = Array.isArray(manifest.icons) ? manifest.icons : [];
    for (const size of REQUIRED_ICON_SIZES) {
      if (!icons.some((icon) => typeof icon?.sizes === 'string' && icon.sizes.includes(size))) {
        fail(
          SEARCH_METADATA_FILES.manifest,
          `No icon is declared at ${size}, so a browser will not offer to install this.`,
        );
      }
    }
    if (!icons.some((icon) => `${icon?.purpose ?? ''}`.split(/\s+/).includes('maskable'))) {
      fail(
        SEARCH_METADATA_FILES.manifest,
        'No icon is declared "maskable", so a platform that crops to a circle crops the mark.',
      );
    }
  }

  // Every picture these files name has to be a file that exists. A manifest
  // naming an icon nobody rendered installs without one, and a card address
  // that 404s unfurls as a broken image — both of which look, in the
  // repository, exactly like the working version.
  if (input.assets !== undefined) {
    const present = new Set(input.assets);
    const named = [
      ...(Array.isArray(manifest?.icons) ? manifest.icons : [])
        .map((icon) => ({ file: SEARCH_METADATA_FILES.manifest, path: icon?.src }))
        .filter((entry) => typeof entry.path === 'string'),
      ...['og:image', 'twitter:image']
        .map((key) => ({
          file: SEARCH_METADATA_FILES.index,
          path: headContent(index, key.startsWith('og:') ? 'property' : 'name', key)?.replace(
            `${origin}/`,
            '',
          ),
        }))
        .filter((entry) => typeof entry.path === 'string' && entry.path.length > 0),
      ...(linkHref(index, 'apple-touch-icon') === null
        ? []
        : [{ file: SEARCH_METADATA_FILES.index, path: linkHref(index, 'apple-touch-icon') }]),
    ];
    for (const entry of named) {
      if (!present.has(entry.path)) {
        fail(
          entry.file,
          `"${entry.path}" is named but no such file is served. Run \`pnpm run brand:assets\`.`,
        );
      }
    }

    // The forty-nine hull cards, which no file in this repository names: they
    // are derived per hull from the installed package, so a pin move that adds
    // a hull adds an address, a document and an `og:image` pointing at artwork
    // nobody has rendered. Every other rule here would stay green while that
    // hull's link unfurled as a broken image.
    for (const entry of published ?? []) {
      if (!present.has(entry.image)) {
        fail(
          SEARCH_METADATA_FILES.addresses,
          `"/${entry.path}" shows "${entry.image}" but no such file is served. Run \`node scripts/convert-ship-artwork.mjs\`.`,
        );
      }
    }
  }

  // The card is fetched by a chat client from its own machine, so a relative
  // address is no address at all.
  for (const key of ['og:image', 'twitter:image']) {
    const declared = headContent(index, key.startsWith('og:') ? 'property' : 'name', key);
    if (declared !== null && !declared.startsWith(`${origin}/`)) {
      fail(
        SEARCH_METADATA_FILES.index,
        `${key} is "${declared}"; a card address is fetched from elsewhere, so it must be absolute under ${origin}.`,
      );
    }
  }

  // The production document asks to be indexed. Only the preview deployment
  // rewrites this tag, and it rewrites the built copy rather than this file.
  const robotsTag = headContent(index, 'name', 'robots');
  if (robotsTag !== null && /\bnoindex\b/i.test(robotsTag)) {
    fail(
      SEARCH_METADATA_FILES.index,
      'The document asks not to be indexed. That belongs to a preview deployment, not to the site.',
    );
  }

  // ...and the preview's rewrite can still find it. A tag spelled across two
  // lines, or in single quotes, satisfies every rule above while leaving the
  // `sed` matching nothing — and a preview that quietly asks to be indexed
  // competes with the site it is a preview of, which is the one failure nobody
  // is looking at a build log for.
  //
  // The two are compared as strings, in the one direction that compiles
  // nothing: the expression the workflow would need is *derived from the tag
  // this file actually carries*, and the workflow is searched for it. Reading
  // it the other way — compiling the workflow's expression and running it over
  // this file — would build a regular expression out of file contents, which is
  // a catastrophic-backtracking pattern away from a check that never returns.
  if (input.preview !== undefined && index.length > 0) {
    const tag = /<meta name="robots" content="([^"]*)"/.exec(index);
    if (tag === null || tag[1].length === 0) {
      fail(
        SEARCH_METADATA_FILES.index,
        'The robots tag is not one line of `<meta name="robots" content="…">` with a value in it, ' +
          'so the preview step cannot rewrite it and a preview would keep asking to be indexed.',
      );
    } else {
      // The tag with its value widened to the class the `sed` matches: exactly
      // the left-hand side of the expression the workflow has to carry.
      const search = tag[0].replace(tag[1], '[^"]*');
      const rewrite = `sed -E -i 's|${search}|`;
      const at = input.preview.indexOf(rewrite);
      if (at === -1) {
        fail(
          SEARCH_METADATA_FILES.preview,
          `No step rewrites the robots tag as this file spells it. It needs \`${rewrite}…|' index.html\`; ` +
            '`-E` is named so the expression means one thing rather than two.',
        );
      } else {
        const replacement = input.preview.slice(at + rewrite.length).split('|')[0];
        if (!/\bnoindex\b/.test(replacement)) {
          fail(
            SEARCH_METADATA_FILES.preview,
            `The preview step rewrites the robots tag to "${replacement}", which does not say noindex.`,
          );
        }
      }
    }
  }

  return found;
}

// ---------------------------------------------------------------------------
// Rule: the ledger reconciles with what actually exists
// ---------------------------------------------------------------------------

/**
 * Compares the coverage ledger with the four things it claims to cover.
 *
 * The ledger is a claim about completeness, and a claim nobody checks decays
 * the moment a capability lands. This is what makes "every" mean something: a
 * new route, a new component, a new preview state or a renamed Playwright
 * project has to appear here, or the build fails.
 *
 * `input` carries `routes`, `componentIds`, `previewAddresses`, `projectNames`,
 * `configuredProjectNames` and `ledger`.
 */
export function ledgerReconciliationViolations(input) {
  const found = [];
  const file = SCOPE.ledger;
  const ledger = input.ledger ?? [];
  const surfaces = ledger.map((entry) => entry.surfaceId);
  const journeys = new Set(ledger.map((entry) => entry.journey));

  const fail = (message) => found.push({ file, line: 0, rule: 'ledger-reconciliation', message });

  for (const route of input.routes ?? []) {
    const address = route === '' ? 'shell' : route;
    if (!surfaces.some((surface) => surface.includes(address))) {
      fail(`Route "${route}" has no coverage entry naming it.`);
    }
  }

  const addresses = input.previewAddresses ?? [];
  for (const componentId of input.componentIds ?? []) {
    if (!addresses.some((address) => address.startsWith(`${componentId}--`))) {
      fail(`Component "${componentId}" is exported but has no preview state to cover.`);
    }
  }

  if (addresses.length > 0 && !journeys.has('preview/sweep')) {
    fail('Preview states exist but no entry claims the preview sweep covers them.');
  }

  const configured = input.configuredProjectNames ?? [];
  const declared = input.projectNames ?? [];

  for (const name of declared) {
    if (!configured.includes(name)) {
      fail(`Project "${name}" is declared in the ledger but not configured in Playwright.`);
    }
  }
  for (const name of configured) {
    if (!declared.includes(name)) {
      fail(`Project "${name}" is configured in Playwright but not declared in the ledger.`);
    }
  }

  return found;
}

// ---------------------------------------------------------------------------
// Rule: every shipped catalogue matches bundled English exactly
// ---------------------------------------------------------------------------

/**
 * Values a shipped locale is reviewed as sharing with English.
 *
 * A German value identical to the English one is usually an untranslated
 * string that slipped through, so identity is a failure by default. These are
 * the ones a reviewer has looked at and kept, each with the reason it is the
 * same word in both languages. Adding a message that happens to match English
 * fails the build until someone records why — which is the point: the gate is
 * about wording having been reviewed, not about strings differing.
 */
export const REVIEWED_IDENTICAL_VALUES = {
  de: {
    'app.name': 'A product name, not a phrase to translate.',
    'app.document-title':
      'A composition pattern; both variables and the separator are language-neutral.',
    'hullDetail.bar.detail':
      'A composition pattern; both variables and the separator are language-neutral.',
    'hullDetail.title':
      'The variable alone. A hull address is titled with the hull, and the hull name is the package’s in every language because the game does not translate one (constitution VI, and game-text.presenter.ts, shipCatalogueText).',
    'hullDetail.slots.run.multiplier':
      'A composition pattern; both the variable and the multiplication sign are language-neutral. The words the chip stands for are hullDetail.slots.run.one and .many, which are translated.',
    'drives.fsd.optimal-mass.detail':
      'A composition pattern; both variables and the separator are language-neutral.',
    'catalogue.title':
      'The ship tool’s own name. Ship Builder is the name of the tool in every language, ruled 2026-08-27, and a tool renamed in one language is a different tool.',
    'navigation.start':
      'The product’s own name, carried by the mark that reaches the entry point. A product name, not a phrase to translate, for the reason app.name gives.',
    'tools.ship':
      'The same tool name again, carried by the tool’s own tab, for the reason catalogue.title gives.',
    'equipment.export.meta':
      'A composition pattern. Every part of it is translated on its own — the format name, the two counted phrases and `KB` — and what is left here is the separator between them.',
    'equipment.badge.empty':
      'A `+` in the row’s leading square where a badge goes: a sign, not a word, and the same sign in every language.',
    'equipment.count.none':
      'An em dash where a count would be, on a rule that has nothing to count yet. A punctuation mark, not a word.',
    'equipment.badge.PrimaryWeapon1':
      'A two-character mount code on the row’s leading square. The letter is the mount kind’s initial, which German spells the same way (primär, sekundär).',
    'equipment.badge.PrimaryWeapon2': 'The same mount code, for the second primary mount.',
    'equipment.badge.SecondaryWeapon': 'The same mount code, for the secondary mount.',
    'equipment.weapon.meta':
      'A composition pattern; all three variables and the separator are language-neutral.',
    'equipment.mount.selected':
      'A composition pattern; both variables and the separator are language-neutral.',
    'equipment.grade.short':
      'The canvas’s own grade chip. G is the in-game abbreviation and German abbreviates Grad the same way.',
    'equipment.grade.none': 'An em dash standing for a mount with no grade to state.',
    'equipment.modifications.count':
      'A composition pattern; both variables and the solidus are language-neutral.',
    'equipment.attribute.dps': 'The in-game abbreviation for damage per second, not translated.',
    'offence.rail.label': 'The same in-game abbreviation, on the status rail’s offence cell.',
    'equipment.value.perSecond': 'The SI form for “per second”, identical in German.',
    'equipment.damage.plasma': 'Plasma is the ordinary German word.',
    'equipment.stats.regen':
      'The canvas’s own abbreviation over the regeneration figure, with the SI form for “per second”; German abbreviates Regeneration the same way.',
    'equipment.stats.dps': 'The same in-game abbreviation, in a composition pattern.',
    'equipment.weapon.figure.unit':
      'The same in-game abbreviation again, drawn small beside a chooser row’s figure.',
    'equipment.weapon.mounted':
      'A composition pattern; both variables and the separator are language-neutral. The words it composes — the weapon class and the mount name — are translated where they are stated.',
    'equipment.weapon.candidate':
      'The same pattern with a third variable. Every word in it comes from the package or from a translated message; nothing here is wording.',
    'equipment.chooser.shieldPoints':
      'SP is the in-game abbreviation for shield points and is not translated.',
    'shell.status.label': '"Status" is the ordinary German word.',
    'outfitting.status-rail.mode': '"Status" is the ordinary German word.',
    'status.info': '"Information" is the ordinary German word.',
    'field.optional': '"Optional" is the ordinary German word.',
    'format.credits': 'CR is the in-game abbreviation and is not translated.',
    'power.badge.reading':
      'PWR is the canvas’s own abbreviation on the badge plate, and German abbreviates the word the same way. The sentence behind the badge, power.badge.label, is translated.',
    'hullDetail.unit.speed': 'The SI symbol for metres per second, identical in German.',
    'hullDetail.unit.mass': 'The SI symbol for the tonne, identical in German.',
    'drives.rail.metres-per-second': 'The SI symbol for metres per second, identical in German.',
    'drives.thrusters.optimal-mass':
      'The canvas’s own one-word mark under the mass bar; German writes the same word.',
    'drives.thrusters.maximum-mass':
      'The canvas’s own abbreviation at the end of the mass bar; German abbreviates it the same way.',
    'drives.thrusters.fuel.tank':
      'The canvas’s own one-word qualifier beside the fuel segment; Tank is the ordinary German word.',
    'drives.rail.tonnes': 'The SI symbol for the tonne, identical in German.',
    'capacity.rail.tonnes': 'The SI symbol for the tonne, identical in German.',
    'hullDetail.unit.shield': 'The SI symbol for the megajoule, identical in German.',
    'catalogue.hardpoint.code.medium':
      'The mount codes are single initials of the German class names; Mittel and medium share one.',
    'catalogue.price.unit':
      'Mcr is the in-game abbreviation for a million credits and is not translated.',
    'catalogue.sort.indicator.ascending': 'A geometric arrow, not language.',
    'catalogue.sort.indicator.descending': 'A geometric arrow, not language.',
    'hullDetail.fact.boost': 'The in-game term, used untranslated in the German community.',
    'hullDetail.slots.group.hardpoint':
      'The in-game term, used untranslated in the German community.',
    'catalogue.column.hardpoints': 'The same in-game term, over the catalogue’s hardpoint column.',
    'catalogue.sort.field.hardpoints':
      'The same in-game term again, on the control that orders the catalogue by it.',
    'outfitting.category.hardpoint':
      'The same in-game term, on the filter that shows the ledger’s hardpoints.',
    'outfitting.group.hardpoint': 'The same in-game term, over that group of the ledger.',
    'anatomy.mount.name':
      'A composition pattern: every part is a variable, and the separator is language-neutral.',
    'shell.beta':
      'The release stage as a mark rather than a word: the canvas sets it in Latin capitals on every artboard, and it is read the same way in German. Translating it would rename the product on one of the two.',
    'power.heat.does-not-settle':
      'The mathematical symbol for infinity, which is not a word in either language. The reading it stands for is carried in words beside it, under its own key.',
    'offence.capacitor.endurance.sustained':
      'The mathematical symbol for infinity, which is not a word in either language. The reading it stands for is carried in words beside it, under its own key.',
    'outfitting.search.shortcut.apple':
      'The Apple command key and a letter; the glyph is the key itself, not a word.',
    'help.licence.index.application':
      'A composition pattern: the label is the product word “App”, which German uses too, and the rest is the link variable.',
    'help.source.link':
      'The name of the site the link reaches. A destination is named as it names itself, in every language.',
    'help.action.symbol':
      'A question mark, drawn as the reference draws it. The glyph is the mark itself and not a word; the action’s translated name is what a reader is told.',
    'slef.import.refusal.module':
      'A composition pattern: every part is a variable, and the separator is language-neutral.',
    'slef.announce.delivery':
      'A composition pattern: both parts are variables, and the colon is language-neutral.',
    'slef.import.scanned':
      'A composition pattern: the file name and the counted phrase are variables, and the separator is language-neutral. The counted phrase itself is translated.',
    'slef.import.pick.title':
      'A composition pattern: a Commander\u2019s own ship name and ident, which no language translates, either side of a language-neutral separator.',
    'slef.import.failure.refused':
      'A composition pattern: the record\u2019s own title and the package\u2019s reason, either side of a language-neutral separator.',
    'slef.import.announce.scanFailed':
      'The variable alone: the sentence the import panel states the refusal in, which is translated where it is written.',
    'equipment.import.announce.scanFailed':
      'The same refusal sentence, on the bench\u2019s own import layer.',
    'slef.import.announce.batch':
      'A composition pattern: two whole sentences, each translated on its own, with a space between them. A language wanting another separator changes it here.',
    'equipment.import.announce.batch':
      'The same pair of sentences, on the bench\u2019s own import layer.',
    'equipment.import.scanned': 'The same scan report, on the bench\u2019s own import layer.',
    'equipment.import.failure.refused':
      'The same refusal line, on the bench\u2019s own import layer.',
    'equipment.import.outcome.line':
      'A composition pattern: where the entry sat, the package\u2019s own symbol and its reason, between language-neutral separators.',
    'slef.diagnostic.code': '"Code" is the ordinary German word.',
    'slef.export.mode.label': '"Format" is the ordinary German word.',
    'equipment.export.mode.label': 'The same word, on the bench\u2019s own export layer.',
    'equipment.region.loadout':
      'Loadout is the in-game term for a kit of fitted equipment, and the word the journal event carries. The German catalogue keeps it untranslated, because Ausrüstung already stands for outfitting and for equipment.',
    'equipment.tab.loadout': 'The same term, on the tab that reaches that region.',
    'slef.export.mode.slef': 'SLEF JSON is the interchange format\u2019s own name, not a phrase.',
    'outfitting.engineering.materials.merc-coin':
      'Merc Coins is the in-game currency name and is not translated.',
    'outfitting.slot.engineering':
      'A composition of a package-supplied recipe name and the grade; G is the in-game grade marker and is not a word.',
    'power.hardpoints.label': 'The in-game term, used untranslated in the German community.',
    'power.distributor.column.bank': '"Bank" is the ordinary German word.',
    'power.distributor.column.pips':
      'Pips is the in-game term for a capacitor allocation step and is not translated.',
    'power.modules.count':
      'A multiplication sign and a variable, counting the mounts one line stands for; not a word in either language.',
    'power.heat.sinks.breakdown':
      'Two variables and a multiplication sign; not a word in either language.',
    'power.distributor.bank.systems':
      'SYS is the in-game abbreviation on the pip display and is not translated.',
    'power.distributor.bank.engines':
      'ENG is the in-game abbreviation on the pip display and is not translated.',
    'power.distributor.bank.weapons':
      'WEP is the in-game abbreviation on the pip display and is not translated.',
    'power.unit.megawatts': 'The SI symbol for the megawatt, identical in German.',
    'power.format.megawatts': 'A value and the SI symbol for the megawatt, identical in German.',
    'power.format.megajoules-per-second':
      'A value and the SI symbol for megajoules per second, identical in German.',
    'format.seconds': 'A value and the SI symbol for the second, identical in German.',
    'format.minutes':
      'Two variables and a colon, which is how both languages write minutes and seconds.',
    'defence.damage.column.megajoules': 'The SI symbol for the megajoule, identical in German.',
    'defence.damage.column.hull-points':
      'HP is the in-game abbreviation for hull points and is used untranslated in the German community.',
    'defence.damage.unbounded':
      'The mathematical symbol for infinity; not a word in either language.',
    'defence.recovery.never':
      'The mathematical symbol for infinity; not a word in either language.',
    'defence.source.count':
      'A multiplication sign and a variable, counting the mounts one row stands for; not a word in either language.',
    'defence.source.added':
      'A plus sign and a variable, marking a figure that adds to the one above it; not a word in either language.',
    'defence.banks.detail':
      'A cell count, a multiplication sign and a reinforcement figure; all variables and a symbol, not a word in either language.',
    'defence.module.code':
      'A size and a grade letter, both of them variables; neither is a word in either language.',
    'defence.module.separator':
      'A middot between the parts of a module\u2019s name; not a word in either language.',
    'defence.format.megajoules':
      'A value and the SI symbol for the megajoule, identical in German.',
    'defence.format.megajoules-per-second':
      'A value and the SI symbol for megajoules per second, identical in German.',
    'defence.format.hull-points':
      'A value and the in-game abbreviation for hull points, used untranslated in the German community.',
    'defence.rail.megajoules': 'The SI symbol for the megajoule, identical in German.',
    'offence.format.seconds': 'A value and the SI symbol for the second, identical in German.',
    'offence.format.megawatts': 'A value and the SI symbol for the megawatt, identical in German.',
    'offence.format.megajoules-per-second':
      'A value and the SI symbol for megajoules per second, identical in German.',
    'offence.format.milliradians':
      'A value and the SI symbol for the milliradian, identical in German.',
    'offence.damage.legend':
      'A composition pattern: every part is a variable, and the separator is language-neutral.',
    'drives.format.tonnes': 'A value and the SI symbol for the tonne, identical in German.',
    'drives.format.metres-per-second':
      'A value and the SI symbol for metres per second, identical in German.',
    'drives.format.degrees-per-second':
      'A value and the SI symbol for degrees per second, identical in German.',
    'drives.source.engineered':
      'A composition of a package-supplied rating and recipe name and the grade; G is the in-game grade marker and is not a word.',
    'drives.thrusters.hull.detail':
      'Two package-supplied identities joined by a separator; the pattern holds no word in either language.',
    'drives.thrusters.boost':
      'The in-game term, used untranslated in the German community — the same decision already recorded for hullDetail.fact.boost, which names this very reading. "Schub" is thrust, and this figure is a speed.',
    'help.section.faq':
      'FAQ is the same borrowed abbreviation in German, and is what a German reader scans a help modal for.',
  },
};

/**
 * The interpolation variables a message pattern declares, sorted.
 *
 * A hand-kept copy of `PLACEHOLDER` in `src/app/i18n/locale-registry.ts`, which
 * this file cannot import because it is `.mjs` and that is TypeScript. The two
 * must be spelled the same: this gate decides whether a catalogue ships, and
 * the runtime decides what it renders, so a pattern one of them sees and the
 * other does not is a build that passes and a locale that then refuses to load.
 */
function interpolationVariablesOf(pattern) {
  const found = new Set();
  for (const match of pattern.matchAll(/\{\{\s*([^{}]*?)\s*\}\}/g)) {
    found.add(match[1]);
  }
  return [...found].sort();
}

/**
 * Compares every shipped catalogue with bundled English.
 *
 * `catalogues` is `{ [locale]: parsed catalogue }` and must contain `en`. The
 * rule is deliberately symmetric and total: same keys, no blank values, same
 * interpolation variables, and reviewed wording. A capability that adds a
 * message to English and forgets German fails here, in the same change, rather
 * than shipping a half-translated interface (FR-019).
 */
export function catalogueViolations(catalogues, reviewed = REVIEWED_IDENTICAL_VALUES) {
  const found = [];
  const english = catalogues['en'];
  const file = 'src/app/i18n/locales/en.json';

  if (!english) {
    return [
      {
        file,
        line: 0,
        rule: 'catalogue-missing',
        message:
          'The bundled English catalogue is missing; it defines the schema for every locale.',
      },
    ];
  }

  for (const [key, value] of Object.entries(english)) {
    if (typeof value !== 'string' || value.trim().length === 0) {
      found.push({
        file,
        line: 0,
        rule: 'catalogue-blank',
        message: `English message "${key}" is blank or is not a string.`,
      });
    }
  }

  for (const [locale, catalogue] of Object.entries(catalogues)) {
    if (locale === 'en') {
      continue;
    }
    const localeFile = `src/app/i18n/locales/${locale}.json`;
    const allowed = reviewed[locale] ?? {};

    for (const key of Object.keys(english)) {
      if (!(key in catalogue)) {
        found.push({
          file: localeFile,
          line: 0,
          rule: 'catalogue-missing-key',
          message: `"${key}" is in English but not in ${locale}.`,
        });
      }
    }

    for (const [key, value] of Object.entries(catalogue)) {
      if (!(key in english)) {
        found.push({
          file: localeFile,
          line: 0,
          rule: 'catalogue-unknown-key',
          message: `"${key}" is in ${locale} but not in English.`,
        });
        continue;
      }

      if (typeof value !== 'string' || value.trim().length === 0) {
        found.push({
          file: localeFile,
          line: 0,
          rule: 'catalogue-blank',
          message: `"${key}" is blank in ${locale}.`,
        });
        continue;
      }

      const expected = interpolationVariablesOf(english[key]).join(', ');
      const actual = interpolationVariablesOf(value).join(', ');
      if (expected !== actual) {
        found.push({
          file: localeFile,
          line: 0,
          rule: 'catalogue-interpolation',
          message: `"${key}" declares [${actual}] in ${locale} but [${expected}] in English.`,
        });
        continue;
      }

      if (value === english[key] && !(key in allowed)) {
        found.push({
          file: localeFile,
          line: 0,
          rule: 'catalogue-unreviewed-wording',
          message:
            `"${key}" is word-for-word English in ${locale}. If that is correct, record why in ` +
            'REVIEWED_IDENTICAL_VALUES; otherwise translate it.',
        });
      }
    }

    for (const key of Object.keys(allowed)) {
      if (!(key in english)) {
        found.push({
          file: 'scripts/check-interface-foundations.mjs',
          line: 0,
          rule: 'catalogue-stale-review',
          message: `"${key}" is recorded as reviewed for ${locale} but no longer exists.`,
        });
      }
    }
  }

  return found;
}

// ---------------------------------------------------------------------------
// Rule: one service worker, one cache owner
// ---------------------------------------------------------------------------

/** Any second way of registering a worker or owning a cache. */
const FOREIGN_WORKER = [
  {
    pattern: /navigator\s*\.\s*serviceWorker\s*\.\s*register\s*\(/,
    what: 'a direct service-worker registration',
  },
  { pattern: /new\s+(?:Shared)?Worker\s*\(/, what: 'a worker of its own' },
  { pattern: /\bcaches\s*\.\s*open\s*\(/, what: 'a cache of its own' },
];

/**
 * Checks that the application has exactly one service worker and one owner.
 *
 * `sources` is `{ [file]: contents }` over the product source. A downstream
 * capability may extend the static asset groups in `ngsw-config.json` — that is
 * how a feature ships its own assets offline — but it may not register a second
 * worker, add a second worker dependency, or open its own cache. Two owners of
 * the same origin's cache is how a build ends up serving one feature's assets
 * from another feature's version.
 */
export function serviceWorkerOwnershipViolations(sources, config = null) {
  const found = [];
  const registrations = [];

  for (const [file, contents] of Object.entries(sources)) {
    if (contents.includes('provideServiceWorker(')) {
      registrations.push(file);
    }
    for (const { pattern, what } of FOREIGN_WORKER) {
      if (pattern.test(contents)) {
        found.push({
          file,
          line: 0,
          rule: 'service-worker-ownership',
          message: `${file} declares ${what}. The application has exactly one service worker, registered in src/app/app.config.ts.`,
        });
      }
    }
  }

  if (registrations.length === 0) {
    found.push({
      file: 'src/app/app.config.ts',
      line: 0,
      rule: 'service-worker-ownership',
      message: 'No service worker is registered, so complete English is not readable offline.',
    });
  } else if (registrations.length > 1) {
    found.push({
      file: registrations[1],
      line: 0,
      rule: 'service-worker-ownership',
      message: `More than one service-worker registration exists: ${registrations.join(', ')}.`,
    });
  }

  if (config !== null) {
    const groups = Array.isArray(config.assetGroups) ? config.assetGroups : [];
    const names = groups.map((group) => group.name);

    if (new Set(names).size !== names.length) {
      found.push({
        file: 'ngsw-config.json',
        line: 0,
        rule: 'service-worker-ownership',
        message: 'Two asset groups share a name, so one silently replaces the other.',
      });
    }

    const files = groups.flatMap((group) => group.resources?.files ?? []);
    for (const resource of files) {
      if (!resource.startsWith('/')) {
        found.push({
          file: 'ngsw-config.json',
          line: 0,
          rule: 'service-worker-ownership',
          message: `Asset "${resource}" is not a same-origin absolute path.`,
        });
      }
    }

    if (!files.some((resource) => resource === '/i18n/en.json')) {
      found.push({
        file: 'ngsw-config.json',
        line: 0,
        rule: 'service-worker-ownership',
        message:
          'Bundled English is not prefetched, so the fallback language is not available offline.',
      });
    }

    if (Array.isArray(config.dataGroups) && config.dataGroups.length > 0) {
      found.push({
        file: 'ngsw-config.json',
        line: 0,
        rule: 'service-worker-ownership',
        message:
          'A data group caches responses rather than static assets; this application caches neither builds nor Commander data.',
      });
    }
  }

  return found;
}

// ---------------------------------------------------------------------------
// Rule: the shared waiting mark stops moving under reduced motion
// ---------------------------------------------------------------------------

/** The classes the mark animates, which the rule holds the block to naming. */
const ANIMATED_MARK_CLASSES = ['l1', 'l2'];

/**
 * Rejects a waiting mark that would go on animating under reduced motion.
 *
 * The mark is drawn through `<img>`, so it is a separate document and
 * `src/styles/_base.scss` cannot reach inside it. Its own stylesheet is the
 * only place the preference can be honoured, and no stylesheet checker looks
 * there — the governed-literal rule reads `src/`, and a linter reading SCSS
 * does not read an SVG. So the block is held here instead, by name.
 *
 * Both animated classes are named, because a block that stops one of them
 * leaves the mark half moving, which is the preference honoured for half the
 * drawing (011/FR-013).
 */
export function waitingMarkViolations(source, file = SCOPE.waitingMark) {
  const found = [];
  const report = (message) => found.push({ file, line: 0, rule: 'waiting-mark-motion', message });

  const opening = source.match(/@media[^{]*\(\s*prefers-reduced-motion\s*:\s*reduce\s*\)[^{]*\{/);
  if (opening === null || opening.index === undefined) {
    report(
      'The waiting mark carries no reduced-motion block. It is drawn through <img>, so the page\u2019s own rule cannot reach it and the mark goes on animating for a Commander who asked it not to.',
    );
    return found;
  }

  // Counted to the brace that closes the block rather than read to the first
  // one. The block holds a rule of its own, so a lazy match stops inside it and
  // what the rule then reads depends on how the file is laid out.
  const start = opening.index + opening[0].length;
  let depth = 1;
  let end = start;
  while (end < source.length && depth > 0) {
    if (source[end] === '{') {
      depth += 1;
    } else if (source[end] === '}') {
      depth -= 1;
    }
    end += 1;
  }
  if (depth !== 0) {
    report('The waiting mark\u2019s reduced-motion block is never closed.');
    return found;
  }

  const body = source.slice(start, end - 1);
  for (const name of ANIMATED_MARK_CLASSES) {
    if (!new RegExp(`\\.${name}\\b`).test(body)) {
      report(
        `The reduced-motion block does not name ".${name}", so that part of the mark goes on animating.`,
      );
    }
  }

  if (!/animation\s*:\s*none/.test(body)) {
    report('The reduced-motion block stops no animation.');
  }

  return found;
}

/** IO wrapper: reads the shared waiting mark and inspects its own stylesheet. */
async function checkWaitingMark() {
  const path = resolve(ROOT, SCOPE.waitingMark);
  if (!existsSync(path)) {
    violations.push({
      file: SCOPE.waitingMark,
      line: 0,
      rule: 'waiting-mark-motion',
      message: 'The shared waiting mark is missing.',
    });
    return;
  }
  violations.push(...waitingMarkViolations(await readFile(path, 'utf8')));
}

/**
 * The rules as pure functions, so every one of them can be driven by positive
 * and negative fixtures without touching the repository (T029).
 */
export const rules = {
  templateViolations,
  catalogueViolations,
  serviceWorkerOwnershipViolations,
  conformanceClaimViolations,
  ledgerReconciliationViolations,
  productionOutputViolations,
  firstFrameTypefaceViolations,
  searchMetadataViolations,
  searchMetadataSources,
  routeTableTriples,
  copiedSchematicViolations,
  waitingMarkViolations,
  componentMetadataViolations,
  stylesheetViolations,
  governedStylesheetViolations,
  previewCoverageViolations,
  testDisciplineViolations,
  announcementViolations,
  duplicatedStepViolations,
  isTokenisedValue,
  isStructuralText,
};

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  const found = await runChecks();
  if (found.length === 0) {
    process.stdout.write('interface foundations policy: no violations\n');
    process.exit(0);
  }

  process.stderr.write(`interface foundations policy: ${found.length} violation(s)\n\n`);
  for (const violation of found) {
    process.stderr.write(
      `  ${violation.file}:${violation.line}  [${violation.rule}]\n    ${violation.message}\n`,
    );
  }
  process.stderr.write('\n');
  process.exit(1);
}
