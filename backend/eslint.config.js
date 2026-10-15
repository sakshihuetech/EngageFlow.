import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts'],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['src/controllers/api-campaign.controller.ts', 'src/controllers/api-credential.controller.ts', 'src/middleware/api-campaign-rate-limit.ts', 'src/services/api-campaign/*.ts'],
    rules: { '@typescript-eslint/no-explicit-any': 'off', 'preserve-caught-error': 'off' },
  },
  {
    files: ['src/services/whatsapp/inbox.service.ts', 'tests/inbox.test.ts'],
    rules: { '@typescript-eslint/no-explicit-any': 'off', '@typescript-eslint/no-unused-vars': 'off', 'no-control-regex': 'off' },
  },
);
