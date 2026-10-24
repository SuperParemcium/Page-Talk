import fs from "node:fs/promises";
import path from "node:path";
import { build } from "esbuild";

const ROOT = path.resolve(import.meta.dirname, "..");
const RESOURCES = path.join(ROOT, "src-tauri", "resources");
const NODE_EXE = process.execPath;

async function copyDirectory(from, to) {
  await fs.mkdir(to, { recursive: true });
  await fs.cp(from, to, { recursive: true, force: true });
}

await fs.rm(RESOURCES, { recursive: true, force: true });
await fs.mkdir(path.join(RESOURCES, "server"), { recursive: true });
await fs.mkdir(path.join(RESOURCES, "runtime"), { recursive: true });
await fs.mkdir(path.join(RESOURCES, "pdfjs"), { recursive: true });

await build({
  entryPoints: [path.join(ROOT, "server", "index.mjs")],
  outfile: path.join(RESOURCES, "server", "server.mjs"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  sourcemap: false,
  minify: false,
  banner: {
    js: [
      "import { createRequire as __pageTalkCreateRequire } from 'node:module';",
      "const require = __pageTalkCreateRequire(import.meta.url);",
    ].join("\n"),
  },
  logLevel: "info",
});

await copyDirectory(path.join(ROOT, "dist"), path.join(RESOURCES, "web"));

for (const name of ["cmaps", "standard_fonts", "wasm", "iccs"]) {
  await copyDirectory(
    path.join(ROOT, "node_modules", "pdfjs-dist", name),
    path.join(RESOURCES, "pdfjs", name),
  );
}

await fs.copyFile(NODE_EXE, path.join(RESOURCES, "runtime", "node.exe"));
await fs.copyFile(
  path.join(ROOT, "src-tauri", "licenses", "NODE-LICENSE.txt"),
  path.join(RESOURCES, "runtime", "NODE-LICENSE.txt"),
);
console.log(`Tauri resources ready: ${RESOURCES}`);
console.log(`Node runtime: ${NODE_EXE}`);
