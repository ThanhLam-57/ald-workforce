import eslint from "@eslint/js";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/.next/**",
      "**/coverage/**",
      "**/dist/**",
      "**/node_modules/**",
      "**/src/generated/**",
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  ...nextVitals,
  ...nextTypescript,
  {
    rules: {
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/no-explicit-any": "error",
      "@next/next/no-html-link-for-pages": "off",
    },
  },
);
