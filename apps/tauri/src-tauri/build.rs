use std::{fs, path::Path};

fn main() {
    // Owner 09-21: the Rust shell learns the build EDITION from apps/tauri/edition.json (the same file
    // vite.config.ts reads for __FORK_EDITION__), as a `public_edition` cfg. Public builds enforce a single
    // running instance; the fork edition keeps the FUMBBL_SINGLE_INSTANCE opt-in for two-coach testing.
    println!("cargo::rustc-check-cfg=cfg(public_edition)");
    let edition_file = Path::new(env!("CARGO_MANIFEST_DIR")).join("../edition.json");
    println!("cargo:rerun-if-changed={}", edition_file.display());
    let text = fs::read_to_string(&edition_file).unwrap_or_default();
    // The file is `{ "edition": "public" | "fork" }` — a substring test is all the parsing it needs.
    let public = text.contains("\"edition\"") && text.contains("\"public\"");
    if public {
        println!("cargo:rustc-cfg=public_edition");
    }
    tauri_build::build()
}
