#!/usr/bin/env node
// Ersetzt den Platzhalter __TENANT_ID__ in staticwebapp.config.json (nur im Build-Ausgabeverzeichnis).
// Aufruf: node scripts/prepare-swa-config.mjs <pfad/staticwebapp.config.json> <tenant-id>
import { readFileSync, writeFileSync } from "node:fs";

const [file, tenantId] = process.argv.slice(2);
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

if (!file || !tenantId || !GUID.test(tenantId)) {
  console.error("Aufruf: prepare-swa-config.mjs <datei> <tenant-id (GUID)>");
  process.exit(1);
}
const content = readFileSync(file, "utf8");
if (!content.includes("__TENANT_ID__")) {
  console.error("Platzhalter __TENANT_ID__ nicht gefunden – Konfiguration unerwartet.");
  process.exit(1);
}
const result = content.replaceAll("__TENANT_ID__", tenantId);
JSON.parse(result); // muss gültiges JSON bleiben
writeFileSync(file, result);
console.log("staticwebapp.config.json vorbereitet.");
