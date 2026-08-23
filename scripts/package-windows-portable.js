#!/usr/bin/env node
/**
 * Package the rebuilt Windows app as one self-extracting portable EXE.
 *
 * The upstream Codex.exe is an MSIX identity wrapper and exits when unpackaged.
 * ChatGPT.exe is the actual Owl/Chromium host and can run without registration,
 * so the SFX launches that executable after extracting to a temporary folder.
 */
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { CODEX_VERSION } = require("./prepare-codex-rust");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.join(PROJECT_ROOT, "out");
const APP_DIR = path.join(OUT_DIR, `Codex-win-x64-${CODEX_VERSION}`);
const WORK_DIR = path.join(OUT_DIR, ".portable-build");
const TOOLS_DIR = path.join(OUT_DIR, ".portable-tools");
const LZMA_SDK_URL =
  "https://github.com/ip7z/7zip/releases/download/26.02/lzma2602.7z";
const LZMA_SDK_SHA256 = "2878C85F5F43A4A4E0952B1FD4E5FE097C1C143997A8047C7E1E788892AA9357";
const SMALL_SFX_SHA256 = "5844E4A1F78F309170B8A956DF9A24CAF932A6BA4CF1FCDE3E0066D850FBF5E3";

function fail(message) {
  console.error(`[x] ${message}`);
  process.exit(1);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    ...options,
    stdio: "inherit",
    shell: false,
  });
  if (result.error) fail(`${command}: ${result.error.message}`);
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function findSevenZip() {
  const programFiles = process.env.ProgramFiles || "C:\\Program Files";
  const programFilesX86 = process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)";
  const candidates = [
    process.env.SEVEN_ZIP,
    path.join(programFiles, "7-Zip", "7z.exe"),
    path.join(programFilesX86, "7-Zip", "7z.exe"),
  ].filter(Boolean);

  for (const executable of candidates) {
    if (fs.existsSync(executable)) return executable;
  }
  fail("7-Zip was not found. Install 7-Zip or set SEVEN_ZIP.");
}

function readRustVersion() {
  return CODEX_VERSION;
}

function validateApp() {
  const required = [
    "ChatGPT.exe",
    "chrome.dll",
    path.join("resources", "app.asar"),
    path.join("resources", "codex.exe"),
    path.join("resources", "codex-code-mode-host.exe"),
  ];
  for (const relative of required) {
    if (!fs.existsSync(path.join(APP_DIR, relative))) {
      fail(`Incomplete Windows app; missing ${relative}. Run the Windows build first.`);
    }
  }

  const forbidden = [
    path.join("resources", "codex"),
    path.join("resources", "codex-code-mode-host"),
    path.join("resources", "cua_node", "bin", "node_modules", "%40oai", "sky", "bin", "linux"),
  ];
  for (const relative of forbidden) {
    if (fs.existsSync(path.join(APP_DIR, relative))) {
      fail(`Non-Windows runtime was not pruned: ${relative}`);
    }
  }
}

function appendFile(output, input) {
  const source = fs.openSync(input, "r");
  const buffer = Buffer.allocUnsafe(8 * 1024 * 1024);
  try {
    for (;;) {
      const bytes = fs.readSync(source, buffer, 0, buffer.length, null);
      if (bytes === 0) break;
      fs.writeSync(output, buffer, 0, bytes);
    }
  } finally {
    fs.closeSync(source);
  }
}

function sha256(file) {
  const hash = crypto.createHash("sha256");
  const descriptor = fs.openSync(file, "r");
  const buffer = Buffer.allocUnsafe(8 * 1024 * 1024);
  try {
    for (;;) {
      const bytes = fs.readSync(descriptor, buffer, 0, buffer.length, null);
      if (bytes === 0) break;
      hash.update(buffer.subarray(0, bytes));
    }
  } finally {
    fs.closeSync(descriptor);
  }
  return hash.digest("hex").toUpperCase();
}

function ensureSmallInstallerSfx(sevenZip) {
  const cachedSfx = path.join(TOOLS_DIR, "7zS2.sfx");
  const candidates = [
    process.env.SEVEN_ZIP_INSTALLER_SFX,
    cachedSfx,
    path.join(OUT_DIR, ".lzma-sdk", "files", "bin", "7zS2.sfx"),
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (!fs.existsSync(candidate) || sha256(candidate) !== SMALL_SFX_SHA256) continue;
    fs.mkdirSync(TOOLS_DIR, { recursive: true });
    if (path.resolve(candidate) !== path.resolve(cachedSfx)) fs.copyFileSync(candidate, cachedSfx);
    return cachedSfx;
  }

  fs.mkdirSync(TOOLS_DIR, { recursive: true });
  const sdkArchive = path.join(TOOLS_DIR, "lzma2602.7z");
  console.log("   [tools] downloading official LZMA SDK installer SFX");
  run("curl.exe", [
    "-L",
    "--fail",
    "--silent",
    "--show-error",
    LZMA_SDK_URL,
    "--output",
    sdkArchive,
  ]);
  if (sha256(sdkArchive) !== LZMA_SDK_SHA256) fail("LZMA SDK download hash mismatch.");

  const extractDir = path.join(TOOLS_DIR, "sdk-extract");
  fs.rmSync(extractDir, { recursive: true, force: true });
  run(sevenZip, ["e", sdkArchive, "bin\\7zS2.sfx", `-o${extractDir}`, "-y"]);
  const extractedSfx = path.join(extractDir, "7zS2.sfx");
  if (!fs.existsSync(extractedSfx) || sha256(extractedSfx) !== SMALL_SFX_SHA256) {
    fail("Official LZMA SDK installer SFX verification failed.");
  }
  fs.copyFileSync(extractedSfx, cachedSfx);
  fs.rmSync(extractDir, { recursive: true, force: true });
  fs.rmSync(sdkArchive, { force: true });
  return cachedSfx;
}

function verifyArchive(sevenZip, archive) {
  const result = spawnSync(sevenZip, ["l", "-slt", archive], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    shell: false,
  });
  if (result.error) fail(`Unable to inspect portable archive: ${result.error.message}`);
  if (result.status !== 0) fail(`Unable to inspect portable archive: ${result.stderr.trim()}`);

  const paths = result.stdout
    .split(/\r?\n/)
    .filter((line) => line.startsWith("Path = "))
    .map((line) => line.slice(7).replaceAll("/", "\\"));
  for (const required of [
    "run.cmd",
    "ChatGPT.exe",
    "resources\\app.asar",
    "resources\\codex.exe",
    "resources\\codex-code-mode-host.exe",
  ]) {
    if (!paths.includes(required)) fail(`Portable archive is missing ${required}.`);
  }
  if (paths.includes("Codex.exe")) fail("Portable archive still contains the MSIX-only Codex.exe.");
  const nonWindowsPrebuild = paths.find((entry) =>
    /\\prebuilds\\(?!win32-x64(?:\\|$))/.test(entry),
  );
  if (nonWindowsPrebuild) {
    fail(`Portable archive contains a non-Windows native prebuild: ${nonWindowsPrebuild}`);
  }
}

function main() {
  validateApp();
  const version = readRustVersion();
  const sevenZip = findSevenZip();
  const sfx = ensureSmallInstallerSfx(sevenZip);
  const archive = path.join(WORK_DIR, "Codex.7z");
  const output = path.join(OUT_DIR, `Codex-Windows-x64-${version}.exe`);
  const runScript = path.join(APP_DIR, "run.cmd");

  fs.rmSync(WORK_DIR, { recursive: true, force: true });
  fs.mkdirSync(WORK_DIR, { recursive: true });
  fs.rmSync(output, { force: true });

  console.log(`\n== Package portable Windows EXE ${version} ==\n`);
  console.log("   [archive] Windows runtime only");
  fs.writeFileSync(
    runScript,
    '@echo off\r\nstart "" /wait "%~dp0ChatGPT.exe" %*\r\nexit /b %errorlevel%\r\n',
    "ascii",
  );
  process.on("exit", () => fs.rmSync(runScript, { force: true }));
  const appEntries = fs.readdirSync(APP_DIR).filter((entry) => entry !== "Codex.exe");
  run(
    sevenZip,
    [
      "a",
      "-t7z",
      archive,
      "-mx=7",
      "-m0=LZMA2",
      "-ms=64m",
      "-mmt=on",
      ...appEntries,
    ],
    { cwd: APP_DIR },
  );
  verifyArchive(sevenZip, archive);
  fs.rmSync(runScript, { force: true });

  console.log("   [sfx] building single executable");
  const descriptor = fs.openSync(output, "w");
  try {
    appendFile(descriptor, sfx);
    appendFile(descriptor, archive);
  } finally {
    fs.closeSync(descriptor);
  }

  const outputDescriptor = fs.openSync(output, "r");
  const headerBytes = Buffer.alloc(2);
  try {
    fs.readSync(outputDescriptor, headerBytes, 0, headerBytes.length, 0);
  } finally {
    fs.closeSync(outputDescriptor);
  }
  const header = headerBytes.toString("ascii");
  if (header !== "MZ") fail("Portable output is not a Windows executable.");
  verifyArchive(sevenZip, output);

  const sizeMB = (fs.statSync(output).size / 1048576).toFixed(1);
  console.log(`   [ok] ${output}`);
  console.log(`   [ok] ${sizeMB} MB`);
  console.log(`   [sha256] ${sha256(output)}`);
  fs.rmSync(WORK_DIR, { recursive: true, force: true });
}

main();
