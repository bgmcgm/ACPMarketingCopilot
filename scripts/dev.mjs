#!/usr/bin/env node
// Lokale Entwicklung mit Neuladen: Backend (Demo-Modus) + Frontend (Vite) + TypeScript-Watch.
//   Oberfläche:  http://localhost:5173   (Vite, lädt bei Änderungen im Frontend sofort neu)
//   Backend/API: http://localhost:7071   (startet bei Änderungen im Backend automatisch neu)
// Optional: .env.local mit AI_MODEL=… und ANTHROPIC_API_KEY=… (siehe .env.example).
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const isWin = process.platform === "win32";
const npx = isWin ? "npx.cmd" : "npx";

function loadEnvFile(file) {
  const env = {};
  if (!existsSync(file)) return env;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && !line.trim().startsWith("#")) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return env;
}
const env = { ...process.env, ...loadEnvFile(join(root, ".env.local")) };

console.log("Erstelle Backend einmalig …");
const first = spawnSync(npx, ["tsc", "-b"], { cwd: root, stdio: "inherit", shell: isWin });
if (first.status !== 0) {
  console.error("TypeScript-Fehler – bitte beheben und erneut starten.");
  process.exit(1);
}

const procs = [
  ["tsc", npx, ["tsc", "-b", "-w", "--preserveWatchOutput"], root],
  ["api", process.execPath, ["--watch", "apps/functions/dist/dev/demoServer.js"], root],
  ["web", npx, ["vite", "--port", "5173"], join(root, "apps/web")],
];
const children = procs.map(([name, cmd, args, cwd]) => {
  const child = spawn(cmd, args, { cwd, env, stdio: "inherit", shell: isWin && cmd === npx });
  child.on("exit", (code) => {
    if (code) console.error(`[${name}] beendet mit Code ${code}`);
  });
  return child;
});

console.log(
  `\nBereit:  Oberfläche http://localhost:5173  ·  API http://localhost:7071  ·  Strg+C beendet alles\n`,
);
const stop = () => {
  children.forEach((c) => c.kill());
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
