# Codex Rust patch set

The Windows build prepares a pinned OpenAI Codex checkout outside this repository and applies the
versioned patches in this directory. This keeps upstream source out of the Desktop rebuild history
while preserving the small behavior changes required by the Windows package.

Current source:

- tag: `rust-v0.150.0-alpha.1`
- annotated tag object: `2d49bd1373d41fa4bc773a5dc80ed783277c4d61`
- commit: `6acc7fdf968a99e7e28ad244544306ab398d1af7`

Run `npm run prepare:codex-rust` to create or verify the generated source cache. Set
`CODEX_RUST_DIR` only when intentionally building a separately prepared compatible workspace.
