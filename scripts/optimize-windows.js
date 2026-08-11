#!/usr/bin/env node
/**
 * Apply Windows-only runtime and packaging optimizations.
 *
 * - Force opaque surfaces for normal app windows to avoid Mica composition
 *   stalls on lower-end GPUs, Remote Desktop, and mixed-DPI displays.
 * - Remove binaries and native prebuilds that cannot run on Windows x64.
 *
 * Usage:
 *   node scripts/optimize-windows.js
 *   node scripts/optimize-windows.js --check
 */
const fs = require("fs");
const path = require("path");
const { parse } = require("acorn");
const { locateBundles, relPath, SRC_DIR } = require("./patch-util");

const MARKER = "codex-win-opaque-surfaces";
const GPU_MARKER = "codex-win-gpu-mode";
const OPAQUE_APPEARANCES = ["primary", "secondary", "quickChat", "hud"];

function getPropertyName(node) {
  if (!node) return null;
  if (node.type === "Identifier") return node.name;
  if (node.type === "Literal") return node.value;
  return null;
}

function getStaticString(node) {
  if (node?.type === "Literal" && typeof node.value === "string") return node.value;
  if (node?.type === "TemplateLiteral" && node.expressions.length === 0 && node.quasis.length === 1) {
    return node.quasis[0].value.cooked;
  }
  return null;
}

function walk(node, visitor) {
  if (!node || typeof node !== "object") return;
  if (node.type) visitor(node);
  for (const key of Object.keys(node)) {
    if (key === "start" || key === "end") continue;
    const child = node[key];
    if (Array.isArray(child)) {
      for (const item of child) {
        if (item && typeof item === "object" && item.type) walk(item, visitor);
      }
    } else if (child && typeof child === "object" && child.type) {
      walk(child, visitor);
    }
  }
}

function patchOpaqueWindows(isCheck) {
  const bundles = locateBundles({
    dir: "build",
    pattern: /^main(-[^.]+)?\.js$/,
    platform: "win",
  });

  if (bundles.length !== 1) {
    throw new Error(`Expected one Windows main bundle, found ${bundles.length}`);
  }

  const bundle = bundles[0];
  const source = fs.readFileSync(bundle.path, "utf8");
  if (source.includes(MARKER)) {
    console.log(`   [ok] ${relPath(bundle.path)}: opaque surfaces already enabled`);
    return;
  }

  const ast = parse(source, { ecmaVersion: "latest", sourceType: "module" });
  const matches = [];
  walk(ast, (node) => {
    if (node.type !== "MethodDefinition") return;
    if (getPropertyName(node.key) !== "shouldAlwaysUseOpaqueWindowSurface") return;
    const fn = node.value;
    const parameter = fn?.params?.[0];
    if (parameter?.type !== "Identifier" || fn.body?.type !== "BlockStatement") return;
    matches.push({ position: fn.body.start + 1, parameter: parameter.name });
  });

  if (matches.length !== 1) {
    throw new Error(`Expected one opaque-window method, found ${matches.length}`);
  }

  const { position, parameter } = matches[0];
  const appearances = OPAQUE_APPEARANCES.map((value) => `${parameter}===${JSON.stringify(value)}`).join("||");
  const injection = `/*${MARKER}*/if(process.platform===\"win32\"&&(${appearances}))return!0;`;
  console.log(`   ${isCheck ? "[?]" : "[*]"} ${relPath(bundle.path)}: force opaque normal windows`);
  if (!isCheck) {
    const patched = source.slice(0, position) + injection + source.slice(position);
    fs.writeFileSync(bundle.path, patched, "utf8");
  }
}

function patchGpuMode(isCheck) {
  const bundles = locateBundles({
    dir: "build",
    pattern: /^main(-[^.]+)?\.js$/,
    platform: "win",
  });

  if (bundles.length !== 1) {
    throw new Error(`Expected one Windows main bundle, found ${bundles.length}`);
  }

  const bundle = bundles[0];
  let source = fs.readFileSync(bundle.path, "utf8");
  if (source.includes(GPU_MARKER)) {
    const brokenPattern = /if\(process\.env\.CODEX_GPU_MODE==="software"\|\|process\.argv\.includes\("--software-rendering"\)\)([A-Za-z_$][\w$]*)\.app\.disableHardwareAcceleration\(\)\}\}/;
    if (brokenPattern.test(source)) {
      console.log(`   ${isCheck ? "[?]" : "[*]"} ${relPath(bundle.path)}: repair Windows GPU mode`);
      if (!isCheck) {
        source = source.replace(
          brokenPattern,
          'if(process.env.CODEX_GPU_MODE==="software"||process.argv.includes("--software-rendering")){$1.app.disableHardwareAcceleration()}}',
        );
        fs.writeFileSync(bundle.path, source, "utf8");
      }
      return;
    }
    console.log(`   [ok] ${relPath(bundle.path)}: Windows GPU mode already enabled`);
    return;
  }

  const ast = parse(source, { ecmaVersion: "latest", sourceType: "module" });
  const electronDeclarators = [];
  for (const statement of ast.body) {
    if (statement.type !== "VariableDeclaration") continue;
    for (const declaration of statement.declarations) {
      const init = declaration.init;
      if (
        declaration.id?.type === "Identifier" &&
        init?.type === "CallExpression" &&
        init.callee?.type === "Identifier" &&
        init.callee.name === "require" &&
        init.arguments?.length === 1 &&
        getStaticString(init.arguments[0]) === "electron"
      ) {
        electronDeclarators.push({ electron: declaration.id.name, position: statement.end });
      }
    }
  }

  if (electronDeclarators.length !== 1) {
    throw new Error(`Expected one Electron import, found ${electronDeclarators.length}`);
  }

  const { electron, position } = electronDeclarators[0];
  const injection =
    `/*${GPU_MARKER}*/if(process.platform==="win32"){` +
    `${electron}.app.commandLine.appendSwitch("force-prefers-reduced-motion");` +
    `if(process.env.CODEX_GPU_MODE==="software"||process.argv.includes("--software-rendering")){` +
    `${electron}.app.disableHardwareAcceleration()}` +
    `}`;
  console.log(`   ${isCheck ? "[?]" : "[*]"} ${relPath(bundle.path)}: reduced motion + optional software rendering`);
  if (!isCheck) {
    fs.writeFileSync(bundle.path, source.slice(0, position) + injection + source.slice(position), "utf8");
  }
}

function measure(target) {
  if (!fs.existsSync(target)) return { bytes: 0, files: 0 };
  const stat = fs.statSync(target);
  if (!stat.isDirectory()) return { bytes: stat.size, files: 1 };

  let bytes = 0;
  let files = 0;
  const stack = [target];
  while (stack.length > 0) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const entryPath = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(entryPath);
      else if (entry.isFile()) {
        bytes += fs.statSync(entryPath).size;
        files += 1;
      }
    }
  }
  return { bytes, files };
}

function removeTarget(target, isCheck, totals) {
  if (!fs.existsSync(target)) return;
  const size = measure(target);
  totals.bytes += size.bytes;
  totals.files += size.files;
  console.log(`   ${isCheck ? "[?]" : "[-]"} ${relPath(target)} (${size.files} files, ${(size.bytes / 1048576).toFixed(1)} MB)`);
  if (!isCheck) fs.rmSync(target, { force: true, recursive: true });
}

function findDirectories(root, name) {
  if (!fs.existsSync(root)) return [];
  const results = [];
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const entryPath = path.join(current, entry.name);
      if (entry.name === name) results.push(entryPath);
      else stack.push(entryPath);
    }
  }
  return results;
}

function pruneNonWindowsResources(isCheck) {
  const winRoot = path.join(SRC_DIR, "win");
  const totals = { bytes: 0, files: 0 };

  // Darwin binaries that can be present beside their Windows equivalents.
  for (const name of ["codex", "codex-code-mode-host", "rg"]) {
    removeTarget(path.join(winRoot, name), isCheck, totals);
  }

  // The CUA runtime ships both Linux and Windows helper executables.
  removeTarget(
    path.join(winRoot, "cua_node", "bin", "node_modules", "%40oai", "sky", "bin", "linux"),
    isCheck,
    totals,
  );
  const skyTargets = path.join(
    winRoot,
    "cua_node",
    "bin",
    "node_modules",
    "%40oai",
    "sky",
    "dist",
    "project",
    "cua",
    "sky_js",
    "src",
    "targets",
  );
  for (const name of ["linux", "mac"]) {
    removeTarget(path.join(skyTargets, name), isCheck, totals);
  }

  // HIDAPI source trees for operating systems that cannot be selected on win32.
  const hidapiRoot = path.join(
    winRoot,
    "_asar",
    "node_modules",
    "@worklouder",
    "device-kit-oai",
    "node_modules",
    "@worklouder",
    "wl-device-kit",
    "node_modules",
    "node-hid",
    "hidapi",
  );
  for (const name of ["android", "libusb", "linux", "mac"]) {
    removeTarget(path.join(hidapiRoot, name), isCheck, totals);
  }

  // Bundled browser plugins include native LevelDB builds for every platform.
  const pluginsRoot = path.join(winRoot, "plugins");
  for (const prebuilds of findDirectories(pluginsRoot, "prebuilds")) {
    for (const entry of fs.readdirSync(prebuilds, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name === "win32-x64") continue;
      removeTarget(path.join(prebuilds, entry.name), isCheck, totals);
    }
  }
  for (const snappy of findDirectories(pluginsRoot, "snappy")) {
    for (const name of ["linux", "mac"]) {
      removeTarget(path.join(snappy, name), isCheck, totals);
    }
  }

  console.log(
    `   [ok] ${isCheck ? "would remove" : "removed"} ${totals.files} non-Windows files, ${(totals.bytes / 1048576).toFixed(1)} MB`,
  );
}

function main() {
  const isCheck = process.argv.includes("--check");
  console.log("\n== Windows performance optimization ==\n");
  patchOpaqueWindows(isCheck);
  patchGpuMode(isCheck);
  pruneNonWindowsResources(isCheck);
}

main();
