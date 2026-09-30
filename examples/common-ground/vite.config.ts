import { defineConfig } from "vite";
import memoizedDom from "@memoized-dom/vite";
export default defineConfig({
  root: import.meta.dirname,
  base: "./",
  plugins: [memoizedDom({ clientEntry: "main.ts" })],
});
