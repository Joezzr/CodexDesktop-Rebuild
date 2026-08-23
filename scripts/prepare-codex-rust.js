#!/usr/bin/env node
/**
 * Prepare the pinned OpenAI Codex Rust source used by the Windows build.
 *
 * The upstream checkout lives outside the repository so the Desktop rebuild
 * only tracks the small Windows-specific patch set it owns.
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const CODEX_REPOSITORY = "https://github.com/openai/codex.git";
const CODEX_VERSION = "0.150.0-alpha.7";
const CODEX_TAG = `rust-v${CODEX_VERSION}`;
const CODEX_TAG_OBJECT = "69b81b46830757c3a7adbfc500ca39503e586ba6";
const CODEX_COMMIT = "03eec0241d14dd11a8e4d1e2c4ced5eb6c607ffc";
const PATCH_DIR = path.join(PROJECT_ROOT, "patches", "codex-rs", CODEX_VERSION);

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    ...options,
    encoding: "utf8",
    shell: false,
  });

  if (result.error) {
    throw new Error(`Failed to run ${command}: ${result.error.message}`);
  }
  return result;
}

function requireSuccess(result, description) {
  if (result.status === 0) return;
  const detail = (result.stderr || result.stdout || "").trim();
  throw new Error(`${description}${detail ? `: ${detail}` : ""}`);
}

function defaultCacheRoot() {
  const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
  return path.join(localAppData, "CodexDesktop-Rebuild", "codex-source");
}

function resolveWorkspace(candidate) {
  const directManifest = path.join(candidate, "Cargo.toml");
  if (fs.existsSync(directManifest)) return candidate;

  const nested = path.join(candidate, "codex-rs");
  if (fs.existsSync(path.join(nested, "Cargo.toml"))) return nested;

  throw new Error(`Codex Rust workspace not found under ${candidate}`);
}

function workspaceVersion(workspace) {
  const manifestPath = path.join(workspace, "Cargo.toml");
  const manifest = fs.readFileSync(manifestPath, "utf8");
  const match = manifest.match(/^\[workspace\.package\][\s\S]*?^version\s*=\s*"([^"]+)"/m);
  if (!match) throw new Error(`Unable to read workspace version from ${manifestPath}`);
  return match[1];
}

function verifyWorkspace(workspace) {
  const version = workspaceVersion(workspace);
  if (version !== CODEX_VERSION) {
    throw new Error(`Expected Codex Rust ${CODEX_VERSION}, found ${version} at ${workspace}`);
  }
}

function ensureCheckout(checkoutDir) {
  const gitDir = path.join(checkoutDir, ".git");
  if (!fs.existsSync(gitDir)) {
    fs.mkdirSync(path.dirname(checkoutDir), { recursive: true });
    console.log(`   [source] cloning ${CODEX_TAG}`);
    const clone = run("git", [
      "clone",
      "--filter=blob:none",
      "--no-checkout",
      "--single-branch",
      "--branch",
      CODEX_TAG,
      CODEX_REPOSITORY,
      checkoutDir,
    ]);
    requireSuccess(clone, "Unable to clone OpenAI Codex");

    const longPaths = run("git", ["-C", checkoutDir, "config", "core.longpaths", "true"]);
    requireSuccess(longPaths, "Unable to enable long path support for the generated checkout");

    const checkout = run("git", ["-C", checkoutDir, "checkout", "--detach", CODEX_COMMIT]);
    requireSuccess(checkout, `Unable to check out ${CODEX_COMMIT}`);
  }

  const tagObject = run("git", ["-C", checkoutDir, "rev-parse", CODEX_TAG]);
  requireSuccess(tagObject, `Unable to verify ${CODEX_TAG}`);
  if (tagObject.stdout.trim() !== CODEX_TAG_OBJECT) {
    throw new Error(`Tag object for ${CODEX_TAG} does not match the pinned source identity.`);
  }

  const peeledTag = run("git", ["-C", checkoutDir, "rev-parse", `${CODEX_TAG}^{commit}`]);
  requireSuccess(peeledTag, `Unable to resolve ${CODEX_TAG}`);
  if (peeledTag.stdout.trim() !== CODEX_COMMIT) {
    throw new Error(`Commit for ${CODEX_TAG} does not match the pinned source identity.`);
  }

  const head = run("git", ["-C", checkoutDir, "rev-parse", "HEAD"]);
  requireSuccess(head, "Unable to inspect cached Codex checkout");
  if (head.stdout.trim() !== CODEX_COMMIT) {
    throw new Error(
      `Cached Codex checkout is at ${head.stdout.trim()}, expected ${CODEX_COMMIT}. ` +
        "Remove that generated cache directory or set CODEX_RUST_DIR explicitly.",
    );
  }

  const deleted = run("git", ["-C", checkoutDir, "diff", "--name-only", "--diff-filter=D"]);
  requireSuccess(deleted, "Unable to verify the generated Codex checkout");
  if (deleted.stdout.trim()) {
    throw new Error(
      "Generated Codex checkout is incomplete. Ensure Git long-path support is available and recreate the cache.",
    );
  }
}

function applyPatchSet(checkoutDir) {
  const patches = fs
    .readdirSync(PATCH_DIR, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".patch"))
    .map((entry) => path.join(PATCH_DIR, entry.name))
    .sort();

  if (patches.length === 0) throw new Error(`No Codex Rust patches found in ${PATCH_DIR}`);

  for (const patchFile of patches) {
    const relative = path.relative(PROJECT_ROOT, patchFile);
    const check = run("git", ["-C", checkoutDir, "apply", "--check", patchFile]);
    if (check.status === 0) {
      const apply = run("git", ["-C", checkoutDir, "apply", "--whitespace=nowarn", patchFile]);
      requireSuccess(apply, `Unable to apply ${relative}`);
      console.log(`   [patch] applied ${relative}`);
      continue;
    }

    const reverseCheck = run("git", ["-C", checkoutDir, "apply", "--reverse", "--check", patchFile]);
    if (reverseCheck.status === 0) {
      console.log(`   [patch] already applied ${relative}`);
      continue;
    }

    throw new Error(
      `Patch ${relative} does not apply cleanly. The generated source cache contains unexpected changes.`,
    );
  }
}

function prepareCodexRustSource() {
  if (process.env.CODEX_RUST_DIR) {
    const workspace = resolveWorkspace(path.resolve(process.env.CODEX_RUST_DIR));
    verifyWorkspace(workspace);
    console.log(`   [source] using CODEX_RUST_DIR=${workspace}`);
    return workspace;
  }

  const cacheRoot = path.resolve(process.env.CODEX_RUST_CACHE_DIR || defaultCacheRoot());
  const checkoutDir = path.join(cacheRoot, `${CODEX_TAG}-${CODEX_COMMIT.slice(0, 12)}`);
  ensureCheckout(checkoutDir);
  applyPatchSet(checkoutDir);

  const workspace = resolveWorkspace(checkoutDir);
  verifyWorkspace(workspace);
  console.log(`   [source] verified ${CODEX_TAG} (${CODEX_COMMIT.slice(0, 12)})`);
  return workspace;
}

if (require.main === module) {
  try {
    console.log(prepareCodexRustSource());
  } catch (error) {
    console.error(`[x] ${error.message}`);
    process.exit(1);
  }
}

module.exports = {
  CODEX_COMMIT,
  CODEX_TAG,
  CODEX_TAG_OBJECT,
  CODEX_VERSION,
  prepareCodexRustSource,
};
