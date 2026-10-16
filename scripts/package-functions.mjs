#!/usr/bin/env node
// Baut ein deploybares Functions-Verzeichnis (.deploy/functions) aus dem Monorepo:
//   host.json, dist/, package.json (nur Produktionsabhängigkeiten) und node_modules inkl. shared-types.
// Voraussetzung: `npm run build` (tsc -b) wurde ausgeführt.
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fnDir = join(root, "apps/functions");
const sharedDir = join(root, "packages/shared-types");
const out = process.argv[2] ? resolve(process.argv[2]) : join(root, ".deploy/functions");

for (const required of [
  join(fnDir, "dist/index.js"),
  join(sharedDir, "dist/index.js"),
  join(fnDir, "host.json"),
]) {
  if (!existsSync(required)) {
    console.error(`Fehlt: ${required} – zuerst "npm run build" ausführen.`);
    process.exit(1);
  }
}

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
cpSync(join(fnDir, "host.json"), join(out, "host.json"));
cpSync(join(fnDir, "dist"), join(out, "dist"), {
  recursive: true,
  // Der lokale Demo-Modus (dist/dev) gehört nicht ins Deploy-Paket.
  filter: (src) =>
    !src.endsWith(".map") && !src.endsWith(".tsbuildinfo") && !src.includes(`${sep}dist${sep}dev`),
});

const pkg = JSON.parse(readFileSync(join(fnDir, "package.json"), "utf8"));
const dependencies = Object.fromEntries(
  Object.entries(pkg.dependencies ?? {}).filter(([name]) => !name.startsWith("@mcopilot/")),
);
writeFileSync(
  join(out, "package.json"),
  JSON.stringify(
    {
      name: pkg.name,
      version: pkg.version,
      private: true,
      type: "module",
      main: pkg.main,
      dependencies,
    },
    null,
    2,
  ),
);

execFileSync(
  "npm",
  ["install", "--omit=dev", "--no-audit", "--no-fund", "--package-lock=false", "--ignore-scripts"],
  {
    cwd: out,
    stdio: "inherit",
  },
);

// Workspace-Paket manuell einspielen (nicht auf npm veröffentlicht).
const sharedOut = join(out, "node_modules/@mcopilot/shared-types");
mkdirSync(sharedOut, { recursive: true });
cpSync(join(sharedDir, "dist"), join(sharedOut, "dist"), {
  recursive: true,
  filter: (src) => !src.endsWith(".map"),
});
const sharedPkg = JSON.parse(readFileSync(join(sharedDir, "package.json"), "utf8"));
writeFileSync(join(sharedOut, "package.json"), JSON.stringify(sharedPkg, null, 2));

console.log(`Functions-Paket erstellt: ${out}`);
