import { platform } from "node:process";

import { defineConfig } from "oxfmt";

export default defineConfig({
  sortImports: true,
  endOfLine: platform === "win32" ? "crlf" : "lf", // https://github.com/oxc-project/oxc/issues/17856
});
