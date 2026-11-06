import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
    {
        ignores: ['dist/**', 'coverage/**', 'node_modules/**', '*.js'],
    },
    eslint.configs.recommended,
    ...tseslint.configs.recommended,
    {
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'module',
        },
        rules: {
            '@typescript-eslint/no-explicit-any': 'off',
            '@typescript-eslint/explicit-module-boundary-types': 'off',
            '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
            'no-console': ['error', { allow: ['warn'] }],
        },
    },
    // The Relate client is not published to npm: it is loaded dynamically
    // from a sibling checkout (or RELATE_CLIENT_PATH), which needs require()
    {
        files: ['src/driver/relate.ts', 'test/integration/support/backend.ts'],
        rules: {
            '@typescript-eslint/no-require-imports': 'off',
        },
    }
);
