# Codex Rust patch set

The Windows build prepares a pinned OpenAI Codex checkout outside this repository and applies the
versioned patches in this directory. This keeps upstream source out of the Desktop rebuild history
while preserving the small behavior changes required by the Windows package.

Current source:

- tag: `rust-v0.149.0-alpha.1`
- annotated tag object: `9072ebb22a566df4509fa336a5af9f8a9e491c39`
- commit: `c767040aebb84b0ecdb1f8dbae092f12bf2d55af`

Run `npm run prepare:codex-rust` to create or verify the generated source cache. Set
`CODEX_RUST_DIR` only when intentionally building a separately prepared compatible workspace.
