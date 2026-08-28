# Codex Desktop Rebuild

Cross-platform Electron build for OpenAI Codex Desktop App.

[简体中文：Windows 优化版说明](README.zh-CN.md)

## Supported Platforms

| Platform | Architecture | Status |
|----------|--------------|--------|
| macOS    | x64, arm64   | ✅     |
| Windows  | x64          | ✅     |
| Linux    | x64, arm64   | ✅     |

## Build

```bash
# Install dependencies
npm install

# Build for current platform
npm run build

# Build for specific platform
npm run build:mac-x64
npm run build:mac-arm64
npm run build:win-x64
npm run build:linux-x64
npm run build:linux-arm64

# Build all platforms
npm run build:all
```

## Windows x64 with pinned codex-rs

The Windows build pins OpenAI Codex `rust-v0.151.0-alpha.5` by commit and prepares
the source in an external local cache. Only the versioned Windows patch set under
`patches/codex-rs/` is tracked by this repository; the full upstream Rust workspace
is not vendored into Git history. Windows packaging builds `codex-cli` locally and
stages the matching alpha.5 standalone code-mode host, then injects `codex.exe`
and `codex-code-mode-host.exe` into the Desktop package's `resources` directory.

Alpha.5 enables the V8 sandbox, but rusty_v8 150.4.0 does not publish the
corresponding Windows static-library archive. The Windows build therefore uses
the matching OpenAI release `codex-code-mode-host.exe` and verifies its size and
SHA-256 through the GitHub Release API; set `CODEX_FORCE_LOCAL_CODE_MODE_HOST=1`
only when a complete local V8-from-source toolchain is available.

The Windows build also applies Windows-only performance optimizations: normal
app windows use opaque surfaces instead of Mica, Rust symbols are stripped from
the packaged CLI, and non-Windows native prebuilds are removed.
Before Cargo runs, the state migration SQL files are normalized to Windows CRLF
line endings so SQLx migration checksums remain compatible with the official
Microsoft Store build and its existing `%USERPROFILE%\.codex` databases.

The Windows patch set also repairs the newer sidebar project model. On first
launch it backs up `.codex-global-state.json`, migrates legacy saved workspace
roots into `local-projects`, remaps project ordering and assignments, and keeps
account-scoped custom sections available when the remote rollout gate is
unavailable. The standalone repair can be checked with
`npm run repair:win-projects -- --check` and applied with
`npm run repair:win-projects` while Codex is closed.

```bash
npm install
npm run build:win-x64
```

The Windows build command prepares the pinned Rust source, synchronizes the current
official Windows shell, applies the Windows patch set and performance changes, then
creates the rebuilt app and portable executable. The individual preparation commands
remain available when debugging a specific stage.

`npm run prepare:codex-rust` verifies the pinned annotated tag, commit, complete
checkout, and idempotent patch state. To use a separately prepared Rust workspace,
set `CODEX_RUST_DIR` before running `npm run build:codex-win-x64`; explicitly
supplied workspaces are version-checked, and the state migration SQL files are
normalized to Windows CRLF line endings in place so SQLx migration checksums stay
compatible with existing `%USERPROFILE%\.codex` databases (use
`node scripts/build-codex-rust.js --check` to verify without writing).

The validated Windows handoff is the unpacked portable directory
`out/Codex-win-x64-0.151.0-alpha.5/`.
Launch `ChatGPT.exe` directly from that directory. The MSIX-only `Codex.exe`
wrapper is excluded, and no package registration or certificate installation
is required. The self-extracting packager remains available for automation,
but the directory build avoids temporary extraction and is the recommended
Windows artifact.

## Development

```bash
npm run dev
```

## Project Structure

```
├── src/
│   ├── .vite/build/     # Main process (Electron)
│   └── webview/         # Renderer (Frontend)
├── resources/
│   ├── electron.icns    # App icon
│   └── notification.wav # Sound
├── scripts/
│   └── patch-copyright.js
├── forge.config.js      # Electron Forge config
└── package.json
```

## CI/CD

GitHub Actions automatically builds on:
- Push to `master`
- Tag `v*` → Creates draft release

## Credits

**© OpenAI · Cometix Space**

- [OpenAI Codex](https://github.com/openai/codex) - Original Codex CLI (Apache-2.0)
- [Cometix Space](https://github.com/Haleclipse) - Cross-platform rebuild & [@cometix/codex](https://www.npmjs.com/package/@cometix/codex) binaries
- [Electron Forge](https://www.electronforge.io/) - Build toolchain

## License

This project rebuilds the Codex Desktop app for cross-platform distribution.
Original Codex CLI by OpenAI is licensed under Apache-2.0.
