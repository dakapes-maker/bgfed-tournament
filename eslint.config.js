// Minimal lint: catches names that are used but never defined (a typo or a
// missing import breaks the app only at run time otherwise). Run: npm run lint
import react from "eslint-plugin-react";
import globals from "globals";

export default [
  {
    files: ["src/**/*.{js,jsx}", "api/**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: { ...globals.browser, ...globals.node },
    },
    plugins: { react },
    rules: {
      "no-undef": "error",
      "react/jsx-no-undef": "error",
      "react/jsx-uses-vars": "error",
    },
  },
];
