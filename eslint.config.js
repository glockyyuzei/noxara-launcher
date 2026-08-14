const tseslint = require("@typescript-eslint/eslint-plugin");
const tsParser = require("@typescript-eslint/parser");
const reactHooks = require("eslint-plugin-react-hooks");
const prettier = require("eslint-config-prettier");

module.exports = [
  {
    ignores: [
      "dist/**",
      "node_modules/**",
      "native/**",
      "postcss.config.js",
      "eslint.config.js",
      "*.d.ts",
    ],
  },
  ...tseslint.configs["flat/recommended"],
  {
    files: ["src/**/*.{ts,tsx}"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: "module",
      },
    },
    plugins: {
      "react-hooks": reactHooks,
    },
    rules: {
      // The codebase prefers `any`/`require` in a handful of deliberate places
      // (loosely-standardized Mojang JSON, lazy cross-service requires). Keep the
      // recommended defaults but relax the ones that would produce noise here.
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-var-requires": "off",
      "@typescript-eslint/no-require-imports": "off",
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-unused-expressions": ["error", { allowShortCircuit: true }],
      "no-dupe-else-if": "error",
      "no-constant-binary-expression": "error",
      "no-unreachable": "error",
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
    },
  },
  prettier,
];
