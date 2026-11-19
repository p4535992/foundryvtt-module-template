import path from "node:path";
import { defineConfig } from "vite";
import { PROJECT_ROOT, getModuleDirectory, readFoundryConfig, readManifest } from "./build/config.js";
import { createResourcesPlugin } from "./build/build.js";

export function createModuleConfig({
  projectRoot = PROJECT_ROOT,
  command = "build",
  mode = "production",
  outRoot = "dist",
  watchMode = false,
} = {}) {
  const { id } = readManifest(projectRoot);
  const local = command === "serve" ? readFoundryConfig({ optional: true, projectRoot }) : {};
  const moduleBase = `/modules/${id}/`;
  const foundryUrl = local.foundryUrl ?? "http://127.0.0.1:30000";
  if (!/^https?:\/\//.test(foundryUrl)) throw new Error("foundryUrl must be an http or https URL.");
  const outDir = getModuleDirectory(outRoot, projectRoot);
  const compact = mode !== "development";

  return {
    root: projectRoot,
    publicDir: false,
    base: command === "serve" ? moduleBase : "./",
    define: { BUILD_MODE: JSON.stringify(mode) },
    plugins: [createResourcesPlugin({ projectRoot, outRoot, mode, watchMode })],
    build: {
      outDir,
      emptyOutDir: false,
      sourcemap: mode === "development",
      target: "es2024",
      minify: false,
      watch: watchMode ? {} : null,
      lib: {
        entry: path.join(projectRoot, "src", "module.js"),
        formats: ["es"],
        fileName: () => "module.js",
        cssFileName: "module",
      },
      rolldownOptions: {
        output: {
          entryFileNames: "module.js",
          chunkFileNames: "scripts/chunks/[name]-[hash].js",
          assetFileNames(asset) {
            const names = asset.names ?? [asset.name ?? ""];
            return names.some((name) => name.endsWith(".css"))
              ? "styles/module.css"
              : "scripts/generated-assets/[name]-[hash][extname]";
          },
          minify: compact
            ? {
                compress: { keepNames: { class: true, function: true } },
                mangle: false,
                codegen: { removeWhitespace: true },
              }
            : false,
        },
      },
    },
    css: {
      devSourcemap: mode === "development",
      preprocessorOptions: { scss: { additionalData: `$module-id: ${JSON.stringify(id)};\n` } },
    },
    server: {
      host: "127.0.0.1",
      port: local.vitePort ?? 30001,
      strictPort: true,
      open: false,
      hmr: { path: "__vite_hmr" },
      watch: { ignored: [`${path.resolve(projectRoot, outRoot).replaceAll("\\", "/")}/**`, "**/packs-src/**"] },
      proxy: {
        "/socket.io": { target: foundryUrl, ws: true },
        [`^(?!${moduleBase})`]: { target: foundryUrl },
      },
    },
  };
}

export default defineConfig((environment) => createModuleConfig(environment));
