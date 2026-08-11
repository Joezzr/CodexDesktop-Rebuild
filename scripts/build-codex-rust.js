#!/usr/bin/env node
/**
 * Build/stage the codex-rs runtime binaries for Desktop packaging.
 *
 * Usage:
 *   node scripts/build-codex-rust.js --platform win-x64
 */
const fs = require("fs");
const crypto = require("crypto");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const { prepareCodexRustSource } = require("./prepare-codex-rust");

const PROJECT_ROOT = path.resolve(__dirname, "..");

const TARGETS = {
  "win-x64": {
    cargoTarget: "x86_64-pc-windows-msvc",
    binName: "codex.exe",
  },
};

function parsePlatform() {
  const args = process.argv.slice(2);
  const platformIndex = args.indexOf("--platform");
  return platformIndex === -1 ? "win-x64" : args[platformIndex + 1];
}

function run(command, args, options) {
  const result = spawnSync(command, args, {
    ...options,
    stdio: "inherit",
    shell: false,
  });

  if (result.error) {
    console.error(`[x] Failed to run ${command}: ${result.error.message}`);
    process.exit(1);
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function capture(command, args, options) {
  const result = spawnSync(command, args, {
    ...options,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    shell: false,
  });

  if (result.error) {
    console.error(`[x] Failed to run ${command}: ${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) {
    if (result.stderr) process.stderr.write(result.stderr);
    process.exit(result.status ?? 1);
  }
  return result.stdout;
}

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function workspaceVersion(manifestPath) {
  const manifest = fs.readFileSync(manifestPath, "utf8");
  const match = manifest.match(/^\[workspace\.package\][\s\S]*?^version\s*=\s*"([^"]+)"/m);
  if (!match) {
    console.error(`[x] Unable to read workspace version from ${manifestPath}`);
    process.exit(1);
  }
  return match[1];
}

function stageOfficialCodeModeHost(manifestPath, stagedBin) {
  const version = workspaceVersion(manifestPath);
  const tag = `rust-v${version}`;
  const assetName = "codex-code-mode-host-x86_64-pc-windows-msvc.exe";
  const apiUrl = `https://api.github.com/repos/openai/codex/releases/tags/${tag}`;
  console.log(`   [code-mode] resolving official ${tag} Windows host`);
  const release = JSON.parse(
    capture("curl.exe", [
      "-L",
      "--fail",
      "--silent",
      "--show-error",
      "-H",
      "User-Agent: CodexDesktop-Rebuild",
      apiUrl,
    ]),
  );
  const asset = release.assets?.find((candidate) => candidate.name === assetName);
  if (!asset?.browser_download_url || !asset.digest?.startsWith("sha256:")) {
    console.error(`[x] Verified ${assetName} is unavailable for ${tag}`);
    process.exit(1);
  }

  const expectedHash = asset.digest.slice("sha256:".length).toLowerCase();
  if (
    fs.existsSync(stagedBin) &&
    fs.statSync(stagedBin).size === asset.size &&
    sha256(stagedBin) === expectedHash
  ) {
    console.log("   [code-mode] verified cached official Windows host");
    return;
  }

  fs.mkdirSync(path.dirname(stagedBin), { recursive: true });
  const download = `${stagedBin}.download`;
  fs.rmSync(download, { force: true });
  run("curl.exe", [
    "-L",
    "--fail",
    "--silent",
    "--show-error",
    "-H",
    "User-Agent: CodexDesktop-Rebuild",
    asset.browser_download_url,
    "--output",
    download,
  ]);
  if (fs.statSync(download).size !== asset.size || sha256(download) !== expectedHash) {
    fs.rmSync(download, { force: true });
    console.error(`[x] Official ${assetName} failed size/SHA-256 verification`);
    process.exit(1);
  }
  fs.renameSync(download, stagedBin);
  console.log(`   [ok] ${path.relative(PROJECT_ROOT, stagedBin)} (official ${tag})`);
}

function defaultCargoTargetDir() {
  const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
  return path.join(localAppData, "CodexDesktop-Rebuild", "cargo-target");
}

function main() {
  const platform = parsePlatform();
  const target = TARGETS[platform];

  if (!target) {
    console.error(`[x] Usage: build-codex-rust.js --platform <${Object.keys(TARGETS).join("|")}>`);
    process.exit(1);
  }

  let rustDir;
  try {
    rustDir = prepareCodexRustSource();
  } catch (error) {
    console.error(`[x] ${error.message}`);
    process.exit(1);
  }
  const manifestPath = path.join(rustDir, "Cargo.toml");

  if (!fs.existsSync(manifestPath)) {
    console.error(`[x] Local Rust workspace not found: ${path.relative(PROJECT_ROOT, rustDir)}`);
    console.error("    Set CODEX_RUST_DIR to a compatible workspace or rerun source preparation.");
    process.exit(1);
  }

  console.log(`\n== Build codex-rs: ${platform} ==\n`);
  console.log(`   source: ${path.relative(PROJECT_ROOT, rustDir)}`);
  console.log(`   target: ${target.cargoTarget}`);

  const env = {
    ...process.env,
    CARGO_TARGET_DIR: process.env.CARGO_TARGET_DIR || defaultCargoTargetDir(),
    // Desktop does not archive symbol sidecars. Keeping line-table symbols in
    // codex.exe only increases disk/AV scan cost when app-server starts.
    CARGO_PROFILE_RELEASE_STRIP: process.env.CARGO_PROFILE_RELEASE_STRIP || "symbols",
  };
  console.log(`   target-dir: ${env.CARGO_TARGET_DIR}`);
  console.log(`   strip: ${env.CARGO_PROFILE_RELEASE_STRIP}`);

  const cargoArgs = [
    "build",
    "--release",
    "--target",
    target.cargoTarget,
    "-p",
    "codex-cli",
  ];

  if (process.env.CODEX_RUST_LOCKED === "1") {
    cargoArgs.splice(1, 0, "--locked");
  }

  run("cargo", cargoArgs, { cwd: rustDir, env });

  function stageBinary(packageName, binName) {
    const builtBin = path.join(env.CARGO_TARGET_DIR, target.cargoTarget, "release", binName);
    if (!fs.existsSync(builtBin)) {
      console.error(`[x] Built ${packageName} binary not found: ${builtBin}`);
      process.exit(1);
    }
    const stagedBin = path.join(PROJECT_ROOT, "resources", "bin", platform, binName);
    fs.mkdirSync(path.dirname(stagedBin), { recursive: true });
    fs.copyFileSync(builtBin, stagedBin);
    try { fs.chmodSync(stagedBin, 0o755); } catch {}
    const sizeMB = (fs.statSync(stagedBin).size / 1048576).toFixed(1);
    console.log(`   [ok] ${path.relative(PROJECT_ROOT, stagedBin)} (${sizeMB} MB)`);
  }

  stageBinary("codex-cli", target.binName);

  const hostManifest = path.join(rustDir, "code-mode-host", "Cargo.toml");
  if (platform === "win-x64" && fs.existsSync(hostManifest)) {
    const stagedHost = path.join(
      PROJECT_ROOT,
      "resources",
      "bin",
      platform,
      "codex-code-mode-host.exe",
    );
    const suppliedHost = process.env.CODEX_CODE_MODE_HOST;
    const runtimeManifest = path.join(rustDir, "code-mode-runtime", "Cargo.toml");
    const requiresSandboxV8 =
      fs.existsSync(runtimeManifest) &&
      fs.readFileSync(runtimeManifest, "utf8").includes("v8_enable_sandbox");

    if (suppliedHost) {
      if (!fs.existsSync(suppliedHost)) {
        console.error(`[x] CODEX_CODE_MODE_HOST not found: ${suppliedHost}`);
        process.exit(1);
      }
      fs.mkdirSync(path.dirname(stagedHost), { recursive: true });
      fs.copyFileSync(suppliedHost, stagedHost);
      console.log(`   [code-mode] staged supplied Windows host: ${suppliedHost}`);
    } else if (requiresSandboxV8 && process.env.CODEX_FORCE_LOCAL_CODE_MODE_HOST !== "1") {
      // rusty_v8 150.4.0 does not publish the ptr-compression+sandbox Windows
      // archive expected by Cargo. Use the matching OpenAI release binary,
      // whose size and SHA-256 come from the GitHub Release API.
      stageOfficialCodeModeHost(manifestPath, stagedHost);
    } else {
      const hostArgs = ["build", "--release", "--target", target.cargoTarget, "-p", "codex-code-mode-host"];
      if (process.env.CODEX_RUST_LOCKED === "1") hostArgs.splice(1, 0, "--locked");
      console.log("   [code-mode] building standalone Windows host");
      run("cargo", hostArgs, { cwd: rustDir, env });
      stageBinary("codex-code-mode-host", "codex-code-mode-host.exe");
    }
  }
}

main();
