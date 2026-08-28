# Codex Rust patch set

The Windows build prepares a pinned OpenAI Codex checkout outside this repository and applies the
versioned patches in this directory. This keeps upstream source out of the Desktop rebuild history
while preserving the small behavior changes required by the Windows package.

Current source:

- tag: `rust-v0.151.0-alpha.5`
- annotated tag object: `a6af5be554f667dbf361949e5a910a1680f42aaf`
- commit: `e6e0c4fb8c0340800f4066c50e849149e4ecd912`

Run `npm run prepare:codex-rust` to create or verify the generated source cache. Set
`CODEX_RUST_DIR` only when intentionally building a separately prepared compatible workspace.
