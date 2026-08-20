# Codex Rust patch set

The Windows build prepares a pinned OpenAI Codex checkout outside this repository and applies the
versioned patches in this directory. This keeps upstream source out of the Desktop rebuild history
while preserving the small behavior changes required by the Windows package.

Current source:

- tag: `rust-v0.149.0-alpha.3`
- annotated tag object: `3446ac047fd84f1b245cbc8ce4bc94dc5a40736a`
- commit: `7df9d8d8c625c5d9cbb3c2399cff120e3f806e3a`

Run `npm run prepare:codex-rust` to create or verify the generated source cache. Set
`CODEX_RUST_DIR` only when intentionally building a separately prepared compatible workspace.
