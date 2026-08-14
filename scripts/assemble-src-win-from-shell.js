#!/usr/bin/env node
/**
 * One-off helper: assemble src/win from a validated portable handoff shell.
 *
 * Mirrors sync-upstream.js assembleOutput():
 *   src/win/_asar              <- extracted app.asar
 *   src/win/app.asar.unpacked  <- copied as-is
 *   src/win/...                <- remaining resources (minus app.asar)
 *
 * Usage:
 *   node scripts/assemble-src-win-from-shell.js <handoff-dir>
 */
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const SRC_DIR = path.join(PROJECT_ROOT, "src");
const WIN_DIR = path.join(SRC_DIR, "win");

function clearDir(dir) {
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true });
  fs.mkdirSync(dir, { recursive: true });
}

function countFiles(dir) {
  let n = 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) n += countFiles(path.join(dir, e.name));
    else n++;
  }
  return n;
}

function copyRecursive(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  let count = 0;
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name), d = path.join(dest, e.name);
    if (e.isDirectory()) count += copyRecursive(s, d);
    else if (e.isSymbolicLink()) { /* skip */ }
    else { fs.copyFileSync(s, d); count++; }
  }
  return count;
}

function main() {
  const shellDir = path.resolve(process.argv[2]);
  const resourcesDir = path.join(shellDir, "resources");
  const asarPath = path.join(resourcesDir, "app.asar");
  if (!fs.existsSync(asarPath)) {
    console.error(`[x] app.asar not found in ${resourcesDir}`);
    process.exit(1);
  }

  console.log(`   [shell] ${shellDir}`);
  clearDir(WIN_DIR);

  const asarDest = path.join(WIN_DIR, "_asar");
  console.log("   [asar extract] -> _asar/");
  execFileSync("npx", ["asar", "extract", asarPath, asarDest], { stdio: "inherit", shell: true });

  const unpackedSrc = path.join(resourcesDir, "app.asar.unpacked");
  if (fs.existsSync(unpackedSrc)) {
    const n = copyRecursive(unpackedSrc, path.join(WIN_DIR, "app.asar.unpacked"));
    console.log(`   [copy] app.asar.unpacked/ (${n} files)`);
  }

  let extraCount = 0;
  for (const e of fs.readdirSync(resourcesDir, { withFileTypes: true })) {
    if (e.name === "app.asar" || e.name === "app.asar.unpacked") continue;
    if (e.name.endsWith(".lproj")) continue;
    const s = path.join(resourcesDir, e.name);
    const d = path.join(WIN_DIR, e.name);
    if (e.isDirectory()) extraCount += copyRecursive(s, d);
    else if (!e.isSymbolicLink()) { fs.copyFileSync(s, d); extraCount++; }
  }
  console.log(`   [copy] ${extraCount} extra resource files`);
  console.log(`   [ok] ${countFiles(WIN_DIR)} files total in src/win`);
}

main();
