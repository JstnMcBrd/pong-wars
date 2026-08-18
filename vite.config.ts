import { platform } from "node:process";

import { defineConfig } from "vite-plus";

export default defineConfig({
  base: "/pong-wars/",
  fmt: {
    sortImports: true,
    endOfLine: platform === "win32" ? "crlf" : "lf", // https://github.com/oxc-project/oxc/issues/17856
  },
  lint: {
    plugins: ["eslint", "typescript", "unicorn", "oxc"],
    categories: {
      correctness: "error",
    },
    options: {
      typeAware: true,
      typeCheck: true,
    },
    jsPlugins: [
      {
        name: "vite-plus",
        specifier: "vite-plus/oxlint-plugin",
      },
    ],
    rules: {
      "vite-plus/prefer-vite-plus-imports": "error",
    },
  },
});
