import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.json', './tsconfig.test.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  {
    // Repositories are the sole boundary where @supabase/supabase-js's
    // untyped query results enter the codebase (createClient() is not
    // parameterized with a generated Database type: this sandbox has no
    // Docker daemon, so `supabase gen types typescript` cannot be run
    // against a live stack here). Every exported repository function
    // still declares an explicit return type, so the untyped boundary is
    // contained to this layer and does not leak into routes/domain code.
    files: ['src/repositories/**/*.ts', 'src/db/**/*.ts'],
    rules: {
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
    },
  },
  {
    // Integration tests assert on `JSON.parse(response.body)` — the actual
    // shape under test, not a value with a declared TypeScript type. Real
    // supabase-js calls made directly by these tests (to exercise RLS from
    // the client side) hit the same untyped-client boundary as
    // src/repositories/**.
    files: ['tests/integration/**/*.ts'],
    rules: {
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
    },
  },
);
