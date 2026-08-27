# Codex Rust patch set

The Windows build prepares a pinned OpenAI Codex checkout outside this repository and applies the
versioned patches in this directory. This keeps upstream source out of the Desktop rebuild history
while preserving the small behavior changes required by the Windows package.

Current source:

- tag: `rust-v0.150.0-alpha.13`
- annotated tag object: `8986f792fc8d7e1ff4a020a916ee76e9884f520a`
- commit: `c080ad22b3744f3cefcdeeb134ee17c0093d16a1`

Run `npm run prepare:codex-rust` to create or verify the generated source cache. Set
`CODEX_RUST_DIR` only when intentionally building a separately prepared compatible workspace.
