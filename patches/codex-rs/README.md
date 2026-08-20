# Codex Rust patch set

The Windows build prepares a pinned OpenAI Codex checkout outside this repository and applies the
versioned patches in this directory. This keeps upstream source out of the Desktop rebuild history
while preserving the small behavior changes required by the Windows package.

Current source:

- tag: `rust-v0.149.0-alpha.4`
- annotated tag object: `58ba6b9d991d95ec8f5fe19b884c4a060e616aa3`
- commit: `92920d051f9f43b114459b90372056002b74045e`

Run `npm run prepare:codex-rust` to create or verify the generated source cache. Set
`CODEX_RUST_DIR` only when intentionally building a separately prepared compatible workspace.
