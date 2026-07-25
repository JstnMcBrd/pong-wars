import { defineConfig } from "oxfmt";

// FIXME Avoid installing @types/node
// import { platform } from "node:process";
declare const process: { platform: string };

export default defineConfig({
  sortImports: true,
  endOfLine: process.platform === "win32" ? "crlf" : "lf", // https://github.com/oxc-project/oxc/issues/17856
});
