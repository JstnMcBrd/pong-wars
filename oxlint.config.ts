import { defineConfig } from "oxlint";

export default defineConfig({
  plugins: ["eslint", "typescript", "unicorn", "oxc"],
  categories: {
    correctness: "error",
  },
  options: {
    typeAware: true,
  },
});
