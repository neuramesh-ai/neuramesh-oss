// The size gate (docs/design/modularization-2026-08/plan.md §2).
//
// Phase 0 scope, deliberately: the file-size law, unused-vars, and the React hooks
// rules — NOT a preset avalanche. A 103k-line codebase meeting `recommended` for the
// first time would drown the signal; rules are added as tracks land, never wholesale.
//
// The ratchet: lint-ratchet.json holds every file currently over the 250 bar at its
// OWN current size — an offender can shrink but can never grow, and new files always
// face 250. `scripts/lint-ratchet.mjs --update` only ever lowers caps; raising one is
// a hand edit with a reason, reviewed like code. `--self-test` proves the gate can
// still fail (the selector-audits-that-cannot-fail lesson).
import { readFileSync } from 'node:fs';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

const ratchet = JSON.parse(readFileSync(new URL('./lint-ratchet.json', import.meta.url), 'utf8'));
const MAX_LINES = { skipBlankLines: true, skipComments: true };
const sizeCap = (max) => ({ 'max-lines': ['error', { max, ...MAX_LINES }] });
const globEscape = (p) => p.replace(/[*?{}()!\[\]]/g, (c) => `\\${c}`);

export default [
  {
    ignores: [
      '**/node_modules/**', '**/dist/**', '**/out/**', '**/release/**', '**/coverage/**',
      // generated-but-committed (each auto-regenerated; see plan §2 for the audit)
      'packages/control-api/index.js',
      'packages/control-api/api/**',
      'packages/control-api/src/seed/skill-seed.ts', // gen-skill-seed.ts output — marketing-skill-seed.ts is hand-authored and stays linted
      'apps/web/src/benchmarks.v1.json',
      'apps/mobile/src/terminal-html.ts', // build-mobile-terminal.mjs output — the WebView's xterm page as one string (S8)
      // non-product trees
      'mockups/**', 'docs/**', 'supabase/**', 'patches/**', '.claude/**',
      'apps/desktop/build/**', 'apps/mobile/appstore/**',
      // Phase 0 lints TypeScript only; scripts/*.mjs and config js join in a later phase
      '**/*.js', '**/*.mjs', '**/*.cjs',
    ],
  },
  {
    files: ['**/*.ts', '**/*.tsx', '**/*.mts', '**/*.cts'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: { '@typescript-eslint': tseslint.plugin },
    rules: {
      ...sizeCap(250),
      'max-lines-per-function': ['warn', { max: 80, ...MAX_LINES, IIFEs: true }],
      complexity: ['warn', 20],
      'max-depth': ['warn', 4],
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none', ignoreRestSiblings: true },
      ],
    },
  },
  {
    files: ['apps/desktop/src/renderer/**/*.{ts,tsx}', 'apps/web/src/**/*.{ts,tsx}', 'apps/mobile/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      // warn, not error: extraction work will touch the 60-effect App() constantly,
      // and every finding here needs judgment, not a reflex fix
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
  {
    // A test file's length tracks the SURFACE IT COVERS, not a failure to modularize — splitting a
    // table-driven suite by line count hides which behaviours are asserted together. So tests get a
    // blanket cap, loose enough never to force a split and tight enough to catch a runaway file, and
    // the ratchet never gives them a per-file entry (scripts/lint-ratchet.mjs, IS_TEST).
    files: ['**/*.test.ts', '**/*.test.tsx', '**/test/**/*.ts'],
    rules: { ...sizeCap(800), 'max-lines-per-function': 'off' },
  },
  // Standing exceptions — permanent, each with a reason, reviewed like code.
  // Paths are literal, so glob metacharacters get escaped — apps/mobile/app/task/[id]/
  // is a character class to minimatch and silently matches nothing otherwise.
  ...Object.entries(ratchet.standing).map(([file, { max }]) => ({ files: [globEscape(file)], rules: sizeCap(max) })),
  // The burn-down ratchet — shrink-only caps at each offender's current size.
  ...Object.entries(ratchet.files).map(([file, max]) => ({ files: [globEscape(file)], rules: sizeCap(max) })),
];
