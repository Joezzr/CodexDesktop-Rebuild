#!/usr/bin/env node
/**
 * Keep Windows project grouping compatible with legacy workspace roots and
 * enable account-scoped custom sidebar sections without the remote rollout gate.
 */
const fs = require("fs");
const path = require("path");
const { parse } = require("acorn");
const { relPath, SRC_DIR } = require("./patch-util");
const { repairProjectSidebarState } = require("./project-sidebar-state");

const MARKER = "codex-windows-project-sidebar-fix-v1";
const GATE_ID = "2413345355";

function walk(node, visitor, parent = null) {
  if (!node || typeof node !== "object") return;
  if (node.type) visitor(node, parent);
  for (const key of Object.keys(node)) {
    if (key === "start" || key === "end") continue;
    const child = node[key];
    if (Array.isArray(child)) {
      for (const item of child) if (item?.type) walk(item, visitor, node);
    } else if (child?.type) {
      walk(child, visitor, node);
    }
  }
}

function getStaticString(node) {
  if (node?.type === "Literal" && typeof node.value === "string") return node.value;
  if (
    node?.type === "TemplateLiteral" &&
    node.expressions.length === 0 &&
    node.quasis.length === 1
  ) {
    return node.quasis[0].value.cooked;
  }
  return null;
}

function applyPatches(source, patches) {
  let output = source;
  for (const patch of [...patches].sort((left, right) => right.start - left.start)) {
    output = output.slice(0, patch.start) + patch.replacement + output.slice(patch.end);
  }
  return output;
}

function findRendererAsset(platform) {
  const assetsDir = path.join(SRC_DIR, platform, "_asar", "webview", "assets");
  if (!fs.existsSync(assetsDir)) return null;
  const matches = fs
    .readdirSync(assetsDir)
    .filter((name) => name.endsWith(".js"))
    .map((name) => path.join(assetsDir, name))
    .filter((file) => {
      const source = fs.readFileSync(file, "utf8");
      return (
        source.includes("sidebar-custom-sections-v3") &&
        (source.includes(GATE_ID) || source.includes(MARKER))
      );
    });
  if (matches.length !== 1) {
    throw new Error(`Expected one ${platform} custom-section asset; found ${matches.length}`);
  }
  return matches[0];
}

function patchRenderer(platform, check) {
  const file = findRendererAsset(platform);
  if (file == null) return 0;
  const source = fs.readFileSync(file, "utf8");
  if (source.includes(MARKER)) {
    console.log(`  [=] ${relPath(file)}: custom-section gate already patched`);
    return 0;
  }

  const ast = parse(source, { ecmaVersion: "latest", sourceType: "module" });
  const matches = [];
  walk(ast, (node) => {
    if (node.type !== "CallExpression") return;
    if (node.arguments.some((argument) => getStaticString(argument) === GATE_ID)) {
      matches.push(node);
    }
  });
  if (matches.length !== 1) throw new Error(`Expected one ${GATE_ID} gate call; found ${matches.length}`);

  const patches = [{ start: matches[0].start, end: matches[0].end, replacement: "!0" }];
  console.log(`  [${check ? "?" : "*"}] ${relPath(file)}: bypass gate ${GATE_ID}`);
  if (!check) {
    const output = `${applyPatches(source, patches)}\n/*${MARKER}*/\n`;
    parse(output, { ecmaVersion: "latest", sourceType: "module" });
    fs.writeFileSync(file, output, "utf8");
  }
  return 1;
}

function migrationBootstrap() {
  const repairSource = repairProjectSidebarState.toString();
  return `/*${MARKER}*/\n;(()=>{try{const fs=require("node:fs"),os=require("node:os"),path=require("node:path"),crypto=require("node:crypto");const statePath=path.join(os.homedir(),".codex",".codex-global-state.json");if(!fs.existsSync(statePath))return;const original=fs.readFileSync(statePath,"utf8"),state=JSON.parse(original),repair=${repairSource},result=repair(state,path,crypto,Date.now());if(!result.changed)return;const backup=statePath+".bak.project-sidebar-fix-v1";if(!fs.existsSync(backup))fs.copyFileSync(statePath,backup);const temp=statePath+".tmp-project-sidebar-fix-"+process.pid;fs.writeFileSync(temp,JSON.stringify(result.state),"utf8");fs.renameSync(temp,statePath);console.info("[project-sidebar-fix] migrated legacy projects",{migratedRootCount:result.createdProjectIds.length,remappedAssignmentCount:result.remappedAssignments})}catch(error){console.error("[project-sidebar-fix] migration failed",error)}})();\n`;
}

function patchBootstrap(platform, check) {
  const file = path.join(SRC_DIR, platform, "_asar", ".vite", "build", "early-bootstrap.js");
  if (!fs.existsSync(file)) return 0;
  const source = fs.readFileSync(file, "utf8");
  if (source.includes(MARKER)) {
    console.log(`  [=] ${relPath(file)}: legacy project migration already injected`);
    return 0;
  }
  const output = migrationBootstrap() + source;
  parse(output, { ecmaVersion: "latest", sourceType: "script", allowHashBang: true });
  console.log(`  [${check ? "?" : "*"}] ${relPath(file)}: inject legacy project migration`);
  if (!check) fs.writeFileSync(file, output, "utf8");
  return 1;
}

function main() {
  const args = process.argv.slice(2);
  const check = args.includes("--check");
  const requested = args.find((argument) => ["mac-arm64", "mac-x64", "win"].includes(argument));
  const platforms = requested
    ? [requested]
    : ["mac-arm64", "mac-x64", "win"].filter((platform) =>
        fs.existsSync(path.join(SRC_DIR, platform, "_asar")),
      );
  let count = 0;
  for (const platform of platforms) {
    count += patchRenderer(platform, check);
    count += patchBootstrap(platform, check);
  }
  console.log(`  [ok] ${check ? "would apply" : "applied"} ${count} project-sidebar edits`);
}

main();
