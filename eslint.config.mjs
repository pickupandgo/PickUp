// @ts-check
import eslint from '@eslint/js';
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/** Modules that hold or move money. They take amounts from the Fare module, never rules. */
const PAYMENT_MODULES = [
  'bookings',
  'collections',
  'earnings',
  'engine',
  'fees',
  'payments',
  'payouts',
  'razorpay',
  'reconciliation',
  'settlements',
  'simulation',
  'wallet',
];

const RAW_SQL_RESTRICTIONS = [
  {
    property: '$queryRawUnsafe',
    message: 'Use the tagged $queryRaw template so values are always parameterized.',
  },
  {
    property: '$executeRawUnsafe',
    message: 'Use the tagged $executeRaw template so values are always parameterized.',
  },
];

const FARE_TABLE_MESSAGE =
  'Payment code reads quotes only through FareQuoteRedeemer (fare/fare-contract), never the Fare tables.';

export default tseslint.config(
  {
    ignores: ['eslint.config.mjs', 'dist/**', 'coverage/**', 'node_modules/**', 'src/generated/**'],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  eslintPluginPrettierRecommended,
  {
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.jest,
      },
      sourceType: 'commonjs',
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      'no-restricted-properties': ['error', ...RAW_SQL_RESTRICTIONS],
      'prettier/prettier': ['error', { endOfLine: 'auto' }],
    },
  },
  {
    // Fare boundary: payment code never sees a pricing rule. It uses the Fare module only through
    // its contract (FareQuoteRedeemer, FrozenFare) and FareModule, and copies frozen amounts.
    files: [`src/{${PAYMENT_MODULES.join(',')}}/**/*.ts`],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/fare/**', '!**/fare/fare-contract', '!**/fare/fare.module'],
              message:
                "Payment code may import only fare/fare-contract and fare/fare.module: it copies a quote's frozen amounts and never prices a fare.",
            },
          ],
        },
      ],
      'no-restricted-properties': [
        'error',
        ...RAW_SQL_RESTRICTIONS,
        { property: 'pricingVersion', message: FARE_TABLE_MESSAGE },
        { property: 'fareQuote', message: FARE_TABLE_MESSAGE },
        { property: 'fareQuoteStop', message: FARE_TABLE_MESSAGE },
      ],
    },
  },
  {
    // ...and the Fare module never reads payment state.
    files: ['src/fare/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: PAYMENT_MODULES.map((name) => `**/${name}/**`),
              message: 'The Fare module prices routes; it must not depend on payment modules.',
            },
          ],
        },
      ],
    },
  },
  {
    // supertest response bodies are `any`; tests assert on them directly. Production code under
    // src/ (except *.spec.ts) keeps every unsafe-any rule.
    files: ['test/**/*.ts', 'src/**/*.spec.ts'],
    rules: {
      '@typescript-eslint/unbound-method': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
    },
  },
);
