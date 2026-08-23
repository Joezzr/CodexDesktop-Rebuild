#!/usr/bin/env node
/**
 * build-from-upstream.js — Patch upstream Codex and repackage
 *
 * For macOS and Windows: no forge needed.
 * Takes the upstream app, patches ASAR in-place, replaces codex CLI, outputs distributable.
 *
 * Usage:
 *   node scripts/build-from-upstream.js --platform mac-arm64
 *   node scripts/build-from-upstream.js --platform mac-x64
 *   node scripts/build-from-upstream.js --platform win
 */
const fs = require("fs");
const path = require("path");
const { execFileSync, execSync } = require("child_process");
const { CODEX_VERSION } = require("./prepare-codex-rust");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const SRC_DIR = path.join(PROJECT_ROOT, "src");
const OUT_DIR = path.join(PROJECT_ROOT, "out");

const TARGET_TRIPLE_MAP = {
  "mac-arm64": "aarch64-apple-darwin",
  "mac-x64": "x86_64-apple-darwin",
  "win": "x86_64-pc-windows-msvc",
};

const LOCAL_BIN_DIR_MAP = {
  "mac-arm64": "mac-arm64",
  "mac-x64": "mac-x64",
  "win": "win-x64",
};

// ─── Helpers ────────────────────────────────────────────────────

function clearDir(dir) {
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true });
  fs.mkdirSync(dir, { recursive: true });
}

function copyRecursive(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  let count = 0;
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name), d = path.join(dest, e.name);
    if (e.isDirectory()) { count += copyRecursive(s, d); }
    else if (e.isSymbolicLink()) {
      const target = fs.readlinkSync(s);
      try { fs.symlinkSync(target, d); } catch {}
      count++;
    } else {
      fs.copyFileSync(s, d);
      count++;
    }
  }
  return count;
}

function findWindowsShellExe(dir) {
  for (const name of ["Codex.exe", "ChatGPT.exe"]) {
    const candidate = path.join(dir, name);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function isCompleteWindowsShell(dir) {
  return findWindowsShellExe(dir) != null && fs.existsSync(path.join(dir, "chrome.dll"));
}

function measurePath(target) {
  if (!fs.existsSync(target)) return { bytes: 0, files: 0 };
  const stat = fs.statSync(target);
  if (!stat.isDirectory()) return { bytes: stat.size, files: 1 };

  const totals = { bytes: 0, files: 0 };
  const stack = [target];
  while (stack.length > 0) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const entryPath = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(entryPath);
      else if (entry.isFile()) {
        totals.bytes += fs.statSync(entryPath).size;
        totals.files += 1;
      }
    }
  }
  return totals;
}

function removeWindowsOutputTarget(resourcesDir, target, totals) {
  if (!fs.existsSync(target)) return;
  const resolvedRoot = path.resolve(resourcesDir) + path.sep;
  const resolvedTarget = path.resolve(target);
  if (!resolvedTarget.startsWith(resolvedRoot)) {
    throw new Error(`Refusing to prune path outside Windows resources: ${resolvedTarget}`);
  }
  const size = measurePath(resolvedTarget);
  fs.rmSync(resolvedTarget, { force: true, recursive: true });
  totals.bytes += size.bytes;
  totals.files += size.files;
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

function pruneWindowsOutput(resourcesDir) {
  const totals = { bytes: 0, files: 0 };

  // These extensionless binaries are Mach-O builds. Windows equivalents are
  // retained beside them with an .exe suffix.
  for (const name of ["codex", "codex-code-mode-host", "rg"]) {
    removeWindowsOutputTarget(resourcesDir, path.join(resourcesDir, name), totals);
  }

  removeWindowsOutputTarget(
    resourcesDir,
    path.join(resourcesDir, "cua_node", "bin", "node_modules", "%40oai", "sky", "bin", "linux"),
    totals,
  );
  const skyTargets = path.join(
    resourcesDir,
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
    removeWindowsOutputTarget(resourcesDir, path.join(skyTargets, name), totals);
  }

  // Reusable shells may carry native dependencies outside plugins (for
  // example under cua_node). Scan the complete output resource tree.
  for (const prebuilds of findDirectories(resourcesDir, "prebuilds")) {
    for (const entry of fs.readdirSync(prebuilds, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name === "win32-x64") continue;
      removeWindowsOutputTarget(resourcesDir, path.join(prebuilds, entry.name), totals);
    }
  }
  for (const snappy of findDirectories(resourcesDir, "snappy")) {
    for (const name of ["linux", "mac"]) {
      removeWindowsOutputTarget(resourcesDir, path.join(snappy, name), totals);
    }
  }

  console.log(
    `   [prune] removed ${totals.files} non-Windows files, ${(totals.bytes / 1048576).toFixed(1)} MB`,
  );
}

function findCommand(command) {
  const whereCommand = process.platform === "win32" ? "where" : "which";
  try {
    const output = execFileSync(whereCommand, [command], { encoding: "utf-8", stdio: ["pipe", "pipe", "ignore"] });
    return output.split(/\r?\n/).map((line) => line.trim()).find(Boolean) || null;
  } catch {
    return null;
  }
}

function createZip(zipPath, cwd) {
  const sevenZip = findCommand("7zz") || findCommand("7z");
  if (sevenZip) {
    execFileSync(sevenZip, ["a", "-tzip", "-mx=5", zipPath, "."], { cwd, stdio: "inherit" });
    return;
  }

  const tar = findCommand("tar");
  if (tar) {
    execFileSync(tar, ["-a", "-cf", zipPath, "."], { cwd, stdio: "inherit" });
    return;
  }

  const powershell = findCommand("powershell.exe") || findCommand("powershell");
  if (powershell) {
    execFileSync(powershell, [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      "Compress-Archive -LiteralPath * -DestinationPath $env:ZIP_PATH -Force",
    ], { cwd, env: { ...process.env, ZIP_PATH: zipPath }, stdio: "inherit" });
    return;
  }

  throw new Error("No ZIP tool found. Install 7-Zip or ensure Windows tar/powershell is available.");
}

function resolveLocalCodexVendor(platform) {
  const triple = TARGET_TRIPLE_MAP[platform];
  if (!triple) return null;

  const binName = platform === "win" ? "codex.exe" : "codex";
  const localBinDir = LOCAL_BIN_DIR_MAP[platform];
  const candidates = [
    localBinDir && path.join(PROJECT_ROOT, "resources", "bin", localBinDir, binName),
    path.join(PROJECT_ROOT, "codex-rs", "target", triple, "release", binName),
  ].filter(Boolean);

  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

function resolveLocalCodeModeHost(platform) {
  if (platform !== "win") return null;
  const triple = TARGET_TRIPLE_MAP[platform];
  const localBinDir = LOCAL_BIN_DIR_MAP[platform];
  const binName = "codex-code-mode-host.exe";
  const candidates = [
    localBinDir && path.join(PROJECT_ROOT, "resources", "bin", localBinDir, binName),
    path.join(PROJECT_ROOT, "codex-rs", "target", triple, "release", binName),
  ].filter(Boolean);

  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

function describeCodexVendor(vendorPath) {
  const relativePath = path.relative(PROJECT_ROOT, vendorPath).split(path.sep).join("/");
  return relativePath.startsWith("resources/bin") || relativePath.startsWith("codex-rs/target")
    ? "local codex-rs build"
    : "@cometix/codex";
}

function resolveCodexVendor(platform) {
  const local = resolveLocalCodexVendor(platform);
  if (local) return local;

  const triple = TARGET_TRIPLE_MAP[platform];
  if (!triple) return null;
  const binName = platform === "win" ? "codex.exe" : "codex";

  // Try platform-specific package (0.128+)
  const PKG_MAP = { "mac-arm64": "codex-darwin-arm64", "mac-x64": "codex-darwin-x64", "win": "codex-win32-x64" };
  const platPkg = PKG_MAP[platform];
  if (platPkg) {
    const p = path.join(PROJECT_ROOT, "node_modules", "@cometix", platPkg, "vendor", triple, "codex", binName);
    if (fs.existsSync(p)) return p;
  }
  // Try old-style vendor (pre-0.128)
  const localPath = path.join(PROJECT_ROOT, "node_modules", "@cometix", "codex", "vendor", triple, "codex", binName);
  if (fs.existsSync(localPath)) return localPath;

  // npm pack fallback — fetch platform-specific package
  // First get latest cometix base version, then append platform suffix
  const PLAT_SUFFIX = {
    "mac-arm64": "darwin-arm64", "mac-x64": "darwin-x64",
    "win": "win32-x64",
    "linux-x64": "linux-x64", "linux-arm64": "linux-arm64",
  };
  const suffix = PLAT_SUFFIX[platform];
  if (!suffix) return null;

  let baseVer;
  try {
    baseVer = execSync("npm view @cometix/codex version", { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }).trim();
  } catch { return null; }

  // e.g. "0.128.0-cometix" → "@cometix/codex@0.128.0-cometix-darwin-x64"
  const platPkgSpec = `@cometix/codex@${baseVer}-${suffix}`;
  console.log(`   [codex] fetching ${platPkgSpec} via npm pack...`);
  const tmpDir = path.join(require("os").tmpdir(), "cometix-codex-pack");
  fs.mkdirSync(tmpDir, { recursive: true });
  try {
    const tgzName = execSync(`npm pack ${platPkgSpec} --pack-destination "${tmpDir}"`, {
      cwd: tmpDir, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"],
    }).trim().split("\n").pop();
    const extractDir = path.join(tmpDir, "extracted");
    clearDir(extractDir);
    execSync(`tar xzf "${path.join(tmpDir, tgzName)}" -C "${extractDir}"`, { stdio: "pipe" });
    const p = path.join(extractDir, "package", "vendor", triple, "codex", binName);
    if (fs.existsSync(p)) return p;
  } catch (e) {
    console.log(`   [!] npm pack failed: ${e.message}`);
  }
  return null;
}

// ─── macOS build ────────────────────────────────────────────────

function buildMac(platform) {
  const platformDir = path.join(SRC_DIR, platform);
  const asarDir = path.join(platformDir, "_asar");

  if (!fs.existsSync(asarDir)) {
    console.error(`[x] ${platform}/_asar/ not found. Run sync-upstream first.`);
    process.exit(1);
  }

  // 1. Find the .app in the ZIP extract cache
  const tempDir = path.join(require("os").tmpdir(), "codex-sync");
  const variant = platform === "mac-arm64" ? "arm64" : "x64";
  const extractDir = path.join(tempDir, `${variant}-extract`);

  // Find Codex.app
  let appPath = null;
  if (fs.existsSync(extractDir)) {
    const findApp = (dir) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (e.name === "Codex.app" && e.isDirectory()) return path.join(dir, e.name);
        if (e.isDirectory()) { const r = findApp(path.join(dir, e.name)); if (r) return r; }
      }
      return null;
    };
    appPath = findApp(extractDir);
  }

  if (!appPath) {
    console.error(`[x] Codex.app not found in cache. Run sync-upstream first.`);
    process.exit(1);
  }

  console.log(`   [source] ${appPath}`);

  // 2. Copy .app to output (ditto preserves symlinks + resource forks)
  const outAppDir = path.join(OUT_DIR, platform);
  clearDir(outAppDir);
  const outApp = path.join(outAppDir, "Codex.app");
  console.log("   [copy] Codex.app -> out/");
  execSync(`ditto "${appPath}" "${outApp}"`);

  const resourcesDir = path.join(outApp, "Contents", "Resources");

  // 3. Repack patched ASAR
  const asarPath = path.join(resourcesDir, "app.asar");
  console.log("   [asar pack] _asar/ -> app.asar");
  execSync(`npx asar pack "${asarDir}" "${asarPath}"`);

  // 4. Update ASAR integrity hash in Info.plist
  const infoPlist = path.join(outApp, "Contents", "Info.plist");
  if (fs.existsSync(infoPlist)) {
    updateAsarIntegrity(asarPath, infoPlist);
  }

  // 5. Strip original signature + quarantine
  console.log("   [codesign] removing original signature");
  try { execSync(`codesign --remove-signature "${outApp}"`, { stdio: "pipe" }); } catch {}
  try { execSync(`xattr -rd com.apple.quarantine "${outApp}"`, { stdio: "pipe" }); } catch {}

  // 6. Replace codex CLI
  replaceCodex(platform, resourcesDir, "codex");

  // 7. Ad-hoc re-sign (prevents "damaged app" Gatekeeper error)
  console.log("   [codesign] ad-hoc signing");
  try {
    execSync(`codesign --sign - --force --deep "${outApp}"`, { stdio: "pipe" });
    console.log("   [ok] ad-hoc signed");
  } catch (e) {
    console.log(`   [!] ad-hoc sign failed: ${e.message}`);
  }

  // 8. Create DMG
  const version = getVersion(asarDir);
  const dmgName = `Codex-${platform}-${version}.dmg`;
  const dmgPath = path.join(OUT_DIR, dmgName);
  console.log(`   [dmg] ${dmgName}`);
  execSync(`hdiutil create -volname Codex -srcfolder "${outAppDir}" -ov -format UDZO "${dmgPath}"`, { stdio: "pipe" });
  const sizeMB = (fs.statSync(dmgPath).size / 1048576).toFixed(1);
  console.log(`   [ok] ${dmgPath} (${sizeMB} MB)`);
}

// ─── Windows build ──────────────────────────────────────────────

function buildWin(platform, createZipOutput = true) {
  const platformDir = path.join(SRC_DIR, platform);
  const asarDir = path.join(platformDir, "_asar");

  if (!fs.existsSync(asarDir)) {
    console.error(`[x] win/_asar/ not found. Run sync-upstream first.`);
    process.exit(1);
  }

  // Windows: use the MSIX extract cache
  const tempDir = path.join(require("os").tmpdir(), "codex-sync");
  const extractDir = path.join(tempDir, "win-extract");
  const appDir = path.join(extractDir, "app");
  const hasExtractedApp = fs.existsSync(appDir);

  const version = getVersion(asarDir);
  const reusableShells = fs.existsSync(OUT_DIR)
    ? fs
        .readdirSync(OUT_DIR, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && entry.name.startsWith("Codex-win-x64-"))
        .map((entry) => path.join(OUT_DIR, entry.name))
        .filter(isCompleteWindowsShell)
        .sort((left, right) => right.localeCompare(left, undefined, { numeric: true }))
    : [];
  const shellCandidates = [
    process.env.CODEX_WINDOWS_SHELL_DIR,
    path.join(OUT_DIR, `Codex-win-x64-${version}`),
    // Prefer the freshly extracted MSIX shell over stale reusable shells so
    // repeated builds never mix Chromium binaries from different revisions.
    // isCompleteWindowsShell still guards completeness before selection.
    hasExtractedApp ? appDir : null,
    ...reusableShells,
  ].filter(Boolean);
  const shellSource = shellCandidates.find(isCompleteWindowsShell);
  if (!shellSource) {
    console.error("[x] Complete Windows shell not found (Codex.exe/ChatGPT.exe + chrome.dll).");
    console.error("    Set CODEX_WINDOWS_SHELL_DIR to an extracted Codex Windows app directory.");
    process.exit(1);
  }
  const shellAsarPath = path.join(shellSource, "resources", "app.asar");
  const shellAsarHash = fs.existsSync(shellAsarPath) ? computeAsarHeaderHash(shellAsarPath) : null;

  // Copy a complete executable shell first. Some MSIX revisions store only
  // mutable app resources under app/, so overlay those after the shell copy.
  // Keep portable builds versioned. Besides matching the documented handoff
  // path, this avoids rebuilding into a generic directory that an IDE or a
  // running smoke-test process may still have open.
  const outApp = path.join(OUT_DIR, `Codex-win-x64-${CODEX_VERSION}`);
  clearDir(outApp);
  console.log(`   [copy] Windows shell: ${path.relative(PROJECT_ROOT, shellSource)}`);
  copyRecursive(shellSource, outApp);
  if (hasExtractedApp && path.resolve(shellSource) !== path.resolve(appDir)) {
    console.log("   [overlay] MSIX app resources -> out/");
    copyRecursive(appDir, outApp);
  } else if (!hasExtractedApp) {
    console.log("   [overlay] skipped: using the existing complete Windows shell");
  }

  const resourcesDir = path.join(outApp, "resources");

  // Compute old ASAR header hash (before repack)
  const asarPath = path.join(resourcesDir, "app.asar");
  const oldHash = computeAsarHeaderHash(asarPath);
  console.log(`   [integrity] old hash: ${oldHash.slice(0, 16)}...`);

  // Repack patched ASAR
  console.log("   [asar pack] _asar/ -> app.asar");
  execSync(`npx asar pack "${asarDir}" "${asarPath}"`);

  // Compute new hash and patch exe
  const newHash = computeAsarHeaderHash(asarPath);
  console.log(`   [integrity] new hash: ${newHash.slice(0, 16)}...`);

  if (oldHash !== newHash || (shellAsarHash != null && shellAsarHash !== newHash)) {
    // Newer shells are branded ChatGPT.exe; older extracts use Codex.exe.
    const exePath = findWindowsShellExe(outApp);
    if (exePath) {
      patchExeHash(exePath, [shellAsarHash, oldHash].filter(Boolean), newHash);
    } else {
      console.log("   [!] Windows shell executable not found for hash patching");
    }
  }

  // Replace codex CLI
  replaceCodex(platform, resourcesDir, "codex.exe");
  replaceCodeModeHost(platform, resourcesDir);

  // A complete upstream Windows shell can contain Darwin/Linux helpers. Do
  // this after all overlays so they cannot be reintroduced into the ZIP.
  pruneWindowsOutput(resourcesDir);
  const msixWrapper = path.join(outApp, "Codex.exe");
  if (fs.existsSync(msixWrapper)) {
    fs.rmSync(msixWrapper, { force: true });
    console.log("   [prune] removed MSIX-only Codex.exe wrapper");
  }

  if (createZipOutput) {
    const zipName = `Codex-win-x64-${version}.zip`;
    const zipPath = path.join(OUT_DIR, zipName);
    console.log(`   [zip] ${zipName}`);
    createZip(zipPath, outApp);

    const sizeMB = (fs.statSync(zipPath).size / 1048576).toFixed(1);
    console.log(`   [ok] ${zipPath} (${sizeMB} MB)`);
  } else {
    console.log(`   [ok] unpacked app: ${outApp}`);
  }
}

// ─── ASAR integrity ─────────────────────────────────────────────

function computeAsarHeaderHash(asarPath) {
  const crypto = require("crypto");
  const buf = fs.readFileSync(asarPath);
  const headerSize = buf.readUInt32LE(12);
  const header = buf.slice(16, 16 + headerSize);
  return crypto.createHash("sha256").update(header).digest("hex");
}

function patchExeHash(exePath, oldHashes, newHash) {
  const buf = fs.readFileSync(exePath);
  if (buf.indexOf(Buffer.from(newHash, "ascii")) >= 0) {
    console.log("   [integrity] exe hash already current");
    return true;
  }
  for (const oldHash of [...new Set(oldHashes)]) {
    const idx = buf.indexOf(Buffer.from(oldHash, "ascii"));
    if (idx < 0) continue;
    Buffer.from(newHash, "ascii").copy(buf, idx);
    fs.writeFileSync(exePath, buf);
    console.log(`   [integrity] exe hash patched at offset ${idx}`);
    return true;
  }
  console.log("   [integrity] no embedded Electron ASAR hash (Owl shell)");
  return false;
}

function updateAsarIntegrity(asarPath, infoPlistPath) {
  const newHash = computeAsarHeaderHash(asarPath);
  execSync(`plutil -replace ElectronAsarIntegrity.Resources/app\\\\.asar.hash -string "${newHash}" "${infoPlistPath}"`, { stdio: "pipe" });
  execSync(`plutil -replace ElectronAsarIntegrity.Resources/app\\\\.asar.algorithm -string "SHA256" "${infoPlistPath}"`, { stdio: "pipe" });

  // Verify
  const verify = execSync(`plutil -extract ElectronAsarIntegrity.Resources/app\\\\.asar.hash raw "${infoPlistPath}"`, { encoding: "utf-8" }).trim();
  if (verify === newHash) {
    console.log(`   [integrity] hash updated: ${newHash.slice(0, 16)}...`);
  } else {
    console.log(`   [!] integrity verify failed`);
  }
}

// ─── Shared ─────────────────────────────────────────────────────

function replaceCodex(platform, resourcesDir, binName) {
  const vendor = resolveCodexVendor(platform);
  if (vendor) {
    const dest = path.join(resourcesDir, binName);
    fs.copyFileSync(vendor, dest);
    try { fs.chmodSync(dest, 0o755); } catch {}
    console.log(`   [codex] replaced with ${describeCodexVendor(vendor)}`);
  } else {
    console.log(`   [!] local codex-rs build or @cometix/codex not found, keeping upstream codex`);
  }
}

function replaceCodeModeHost(platform, resourcesDir) {
  const host = resolveLocalCodeModeHost(platform);
  if (host) {
    const dest = path.join(resourcesDir, "codex-code-mode-host.exe");
    fs.copyFileSync(host, dest);
    try { fs.chmodSync(dest, 0o755); } catch {}
    console.log(`   [code-mode] installed Windows host from ${describeCodexVendor(host)}`);
  } else if (platform === "win") {
    console.log("   [!] local codex-code-mode-host.exe not found; code mode will be unavailable");
  }
}

function getVersion(asarDir) {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(asarDir, "package.json"), "utf-8"));
    return pkg.version || "unknown";
  } catch {
    return "unknown";
  }
}

// ─── Main ───────────────────────────────────────────────────────

function main() {
  const args = process.argv.slice(2);
  const platIdx = args.indexOf("--platform");
  const platform = platIdx !== -1 ? args[platIdx + 1] : null;

  if (!platform || !["mac-arm64", "mac-x64", "win"].includes(platform)) {
    console.error("[x] Usage: build-from-upstream.js --platform <mac-arm64|mac-x64|win>");
    process.exit(1);
  }

  console.log(`\n== Build from upstream: ${platform} ==\n`);
  fs.mkdirSync(OUT_DIR, { recursive: true });

  if (platform.startsWith("mac")) {
    buildMac(platform);
  } else {
    buildWin(platform, !args.includes("--no-zip"));
  }
}

main();
