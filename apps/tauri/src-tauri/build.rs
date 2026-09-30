use std::{fs, path::Path};

#[path = "edition_grammar.rs"]
mod edition_grammar;

fn main() {
    // Owner 09-21: the Rust shell learns the build EDITION from apps/tauri/edition.json (the same file
    // vite.config.ts reads for __FORK_EDITION__), as a `public_edition` cfg. Public builds enforce a single
    // running instance; the fork edition keeps the FUMBBL_SINGLE_INSTANCE opt-in for two-coach testing.
    println!("cargo::rustc-check-cfg=cfg(public_edition)");
    let edition_file = Path::new(env!("CARGO_MANIFEST_DIR")).join("../edition.json");
    println!("cargo:rerun-if-changed={}", edition_file.display());
    println!("cargo:rerun-if-changed=edition_grammar.rs");
    let text = fs::read_to_string(&edition_file)
        .unwrap_or_else(|e| panic!("{}: cannot read the edition file: {e}", edition_file.display()));
    // Fail closed (owner 09-29): the whole file must match the edition grammar (edition_grammar.rs, the same grammar
    // as apps/tauri/read-edition.mjs); anything else stops the build.
    if edition_grammar::parse_edition(&text).unwrap_or_else(|why| panic!("{}: {why}", edition_file.display())) == "public" {
        println!("cargo:rustc-cfg=public_edition");
    }
    tauri_build::build()
}
