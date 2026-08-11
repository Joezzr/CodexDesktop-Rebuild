#!/usr/bin/env node
const fs = require("fs");
const os = require("os");
const path = require("path");
const { repairProjectSidebarState } = require("./project-sidebar-state");

function parseArgs(argv) {
  const stateIndex = argv.indexOf("--state");
  return {
    check: argv.includes("--check"),
    statePath:
      stateIndex >= 0 && argv[stateIndex + 1]
        ? path.resolve(argv[stateIndex + 1])
        : path.join(os.homedir(), ".codex", ".codex-global-state.json"),
  };
}

function main() {
  const { check, statePath } = parseArgs(process.argv.slice(2));
  if (!fs.existsSync(statePath)) throw new Error(`Global state file not found: ${statePath}`);

  const original = fs.readFileSync(statePath, "utf8");
  const state = JSON.parse(original);
  const result = repairProjectSidebarState(state);
  console.log(
    `  [${check ? "?" : "*"}] ${statePath}: ${result.createdProjectIds.length} legacy roots, ` +
      `${result.remappedAssignments} assignments`,
  );
  if (check || !result.changed) return;

  const backupPath = `${statePath}.bak.project-sidebar-fix-v1`;
  if (!fs.existsSync(backupPath)) fs.copyFileSync(statePath, backupPath);
  const tempPath = `${statePath}.tmp-project-sidebar-fix-${process.pid}`;
  fs.writeFileSync(tempPath, JSON.stringify(result.state), "utf8");
  fs.renameSync(tempPath, statePath);
  console.log(`  [ok] backup: ${backupPath}`);
}

main();
