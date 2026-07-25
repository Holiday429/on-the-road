// @ts-check
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['dist/**', 'node_modules/**', 'assets/**'],
  },
  ...tseslint.configs.recommended,
  {
    rules: {
      // Bare `x.innerHTML = ...` assignments bypass escHtml — this project has
      // ~120 pre-existing ones (tracked debt), so new code is what we gate:
      // route new innerHTML writes through a reviewed helper or escHtml().
      'no-restricted-syntax': [
        'warn',
        {
          selector: "AssignmentExpression[left.property.name='innerHTML']",
          message: 'Assigning innerHTML directly risks XSS — make sure all interpolated values go through escHtml() first.',
        },
      ],
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      // Downgraded to warn: pre-existing style debt across several large view
      // files (let-that-could-be-const, `expr?.()` used as a statement). Not
      // correctness bugs — don't fail CI on code this PR didn't touch.
      'prefer-const': 'warn',
      '@typescript-eslint/no-unused-expressions': 'warn',
    },
  },
  {
    // Files whose innerHTML sites have been audited and every external-data
    // interpolation escaped (N5). Here the rule is an ERROR: a new bare
    // innerHTML assignment must go through escHtml/safeUrl or be explicitly
    // // eslint-disable'd with a reason, so these files can't silently
    // regress. src/core is included pre-emptively — the app shell renders
    // trip names, member info, etc., and is the highest-value target.
    files: [
      'src/core/**/*.ts',
      'src/views/guide/guide.ts',
      'src/views/expenses/expenses.ts',
      'src/views/nomad/nomad.ts',
      'src/views/nomad/nomad-modal.ts',
      'src/views/itinerary/itinerary.ts',
      'src/views/safety/city-modal.ts',
      'src/views/journal/capture/render.ts',
    ],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "AssignmentExpression[left.property.name='innerHTML']",
          message: 'Assigning innerHTML directly risks XSS — route interpolated values through escHtml()/safeUrl(), or // eslint-disable-next-line with a reason if the template is provably static.',
        },
      ],
    },
  },
);
