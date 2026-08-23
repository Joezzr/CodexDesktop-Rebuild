# Codex Rust patch set

The Windows build prepares a pinned OpenAI Codex checkout outside this repository and applies the
versioned patches in this directory. This keeps upstream source out of the Desktop rebuild history
while preserving the small behavior changes required by the Windows package.

Current source:

- tag: `rust-v0.150.0-alpha.7`
- annotated tag object: `69b81b46830757c3a7adbfc500ca39503e586ba6`
- commit: `03eec0241d14dd11a8e4d1e2c4ced5eb6c607ffc`

Run `npm run prepare:codex-rust` to create or verify the generated source cache. Set
`CODEX_RUST_DIR` only when intentionally building a separately prepared compatible workspace.
