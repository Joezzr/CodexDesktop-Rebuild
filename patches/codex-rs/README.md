# Codex Rust patch set

The Windows build prepares a pinned OpenAI Codex checkout outside this repository and applies the
versioned patches in this directory. This keeps upstream source out of the Desktop rebuild history
while preserving the small behavior changes required by the Windows package.

Current source:

- tag: `rust-v0.148.0-alpha.9`
- annotated tag object: `44271b1a725e3265d80adde7886d10e48f08d8cc`
- commit: `9392c3fa5bcda342b5b96a1a04d67b2f781617c2`

Run `npm run prepare:codex-rust` to create or verify the generated source cache. Set
`CODEX_RUST_DIR` only when intentionally building a separately prepared compatible workspace.
