# Codex Rust patch set

The Windows build prepares a pinned OpenAI Codex checkout outside this repository and applies the
versioned patches in this directory. This keeps upstream source out of the Desktop rebuild history
while preserving the small behavior changes required by the Windows package.

Current source:

- tag: `rust-v0.148.0-alpha.15`
- annotated tag object: `bd8e79e102f06dbddf99f9f9e734edf1882606ed`
- commit: `ffe1de5cec9c0cd02629eb246534e4622da0ff41`

Run `npm run prepare:codex-rust` to create or verify the generated source cache. Set
`CODEX_RUST_DIR` only when intentionally building a separately prepared compatible workspace.
