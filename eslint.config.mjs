import { fixupConfigRules } from "@eslint/compat";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const typescriptModulePath = require.resolve("typescript");

// TypeScript 7 has no compiler API yet. Keep its CLI for application checks while
// giving typescript-eslint the compatibility API published for this transition.
require(typescriptModulePath);
require.cache[
  typescriptModulePath
].exports = require("@typescript/typescript6");

const [{ default: nextVitals }, { default: nextTs }] = await Promise.all([
  import("eslint-config-next/core-web-vitals"),
  import("eslint-config-next/typescript"),
]);

const eslintConfig = [
  ...fixupConfigRules([...nextVitals, ...nextTs]),
  {
    ignores: [".next/**", "node_modules/**", "coverage/**"],
  },
];

export default eslintConfig;
