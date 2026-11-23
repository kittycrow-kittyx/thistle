# Exact-source compiler validation

The compiler workflow checks out the pull-request head SHA and the released
Baguette, Croissant and Crust v1.0.1 commits. Each compiler's nested Bake pin
must equal v1.0.1 commit 30f7c767584737bf001d2f99b7d303b809bb4f0f.

`scripts/validate-compiler.ts` records source, backend and Bake commits plus
source SHA-256 hashes. The C and Rust Bake CLI calls use fail-on-warnings.
Baguette's released Bake stage uses fail-on-warnings. Generated source and
diagnostic receipts are uploaded as commit-labelled workflow artefacts.

`scripts/compiler-validation.config.json` derives from Teto v2.2.0's native
configuration, with candidate consolidation exports added. The script inserts
the checkout's exact SHA and resolves paths before invoking released Baguette.

`scripts/verify-compiled-credentials.ts` instantiates baseline and threaded
WASM. It checks the memory ABI, extended group snapshots, identity operations
and extension-frame reclamation.

The target matrix compiles six C and six Rust targets with source warnings
treated as errors. These checks produce objects and libraries, not boot
images or a mikuOS userland proof. They do not promote dependency pins or
publish releases.
