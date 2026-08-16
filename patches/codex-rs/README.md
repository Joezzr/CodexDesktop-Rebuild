# Codex Rust patch set

The Windows build prepares a pinned OpenAI Codex checkout outside this repository and applies the
versioned patches in this directory. This keeps upstream source out of the Desktop rebuild history
while preserving the small behavior changes required by the Windows package.

Current source:

- tag: `rust-v0.148.0-alpha.20`
- annotated tag object: `a6157dbea69566bfb8f27ec41ec95a958f25784d`
- commit: `1ed8da4365faafa2c1b6f87afc1bcf7dcf761921`

Run `npm run prepare:codex-rust` to create or verify the generated source cache. Set
`CODEX_RUST_DIR` only when intentionally building a separately prepared compatible workspace.
