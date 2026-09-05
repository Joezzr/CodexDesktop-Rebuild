# Codex Rust patch set

The Windows build prepares a pinned OpenAI Codex checkout outside this repository and applies the
versioned patches in this directory. This keeps upstream source out of the Desktop rebuild history
while preserving the small behavior changes required by the Windows package.

Current source:

- tag: `rust-v0.153.4`
- annotated tag object: `042fb41b7c813ac7999105e886b2b7aa715b5081`
- commit: `3d2ee51ca2d5db578f328aa75e20aa22c0197c9a`

Run `npm run prepare:codex-rust` to create or verify the generated source cache. Set
`CODEX_RUST_DIR` only when intentionally building a separately prepared compatible workspace.
