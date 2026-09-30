// The grammar of apps/tauri/edition.json, identical to apps/tauri/read-edition.mjs. Included by build.rs (which
// panics on a violation) and by lib.rs under cfg(test) (which runs the shared vectors,
// apps/tauri/test/edition-vectors.txt, against it).
//
// The WHOLE text must be: `{` `"edition"` `:` `"public"` or `"fork"` `}`, with optional ASCII whitespace (space, tab,
// CR, LF) between tokens and around them. No BOM, no other keys, no escapes, no comments, no trailing comma, no
// nesting, no duplicate keys, no trailing text.

/// Returns "public" or "fork", or why the text is not the edition grammar.
pub fn parse_edition(text: &str) -> Result<&'static str, String> {
    fn ws(s: &str) -> &str {
        s.trim_start_matches([' ', '\t', '\r', '\n'])
    }
    fn tok<'a>(s: &'a str, t: &str) -> Result<&'a str, String> {
        ws(s).strip_prefix(t).ok_or_else(|| format!("expected {t} (edition.json must be exactly {{ \"edition\": \"public\" | \"fork\" }})"))
    }
    let s = tok(text, "{")?;
    let s = tok(s, "\"edition\"")?;
    let s = tok(s, ":")?;
    let s = ws(s);
    let (value, s) = if let Some(rest) = s.strip_prefix("\"public\"") {
        ("public", rest)
    } else if let Some(rest) = s.strip_prefix("\"fork\"") {
        ("fork", rest)
    } else {
        return Err("the \"edition\" value must be exactly \"public\" or \"fork\"".into());
    };
    let s = tok(s, "}")?;
    if !ws(s).is_empty() {
        return Err("unexpected text after the closing }".into());
    }
    Ok(value)
}

#[cfg(test)]
mod tests {
    use super::parse_edition;

    /// Decode the vector file's escapes: \n \r \t \\ \" and \uXXXX (the same subset a JSON string uses).
    fn unescape(s: &str) -> String {
        let mut out = String::new();
        let mut it = s.chars();
        while let Some(c) = it.next() {
            if c != '\\' {
                out.push(c);
                continue;
            }
            match it.next().expect("dangling backslash in a vector") {
                'n' => out.push('\n'),
                'r' => out.push('\r'),
                't' => out.push('\t'),
                '\\' => out.push('\\'),
                '"' => out.push('"'),
                'u' => {
                    let hex: String = it.by_ref().take(4).collect();
                    out.push(char::from_u32(u32::from_str_radix(&hex, 16).unwrap()).unwrap());
                }
                other => panic!("unknown escape \\{other} in a vector"),
            }
        }
        out
    }

    #[test]
    fn shared_vectors() {
        let vectors = include_str!("../test/edition-vectors.txt");
        let mut n = 0;
        for line in vectors.lines().filter(|l| !l.trim().is_empty() && !l.starts_with('#')) {
            let mut parts = line.splitn(3, '\t');
            let (verdict, name, text) = (parts.next().unwrap(), parts.next().unwrap(), unescape(parts.next().unwrap_or("")));
            let got = parse_edition(&text);
            match verdict {
                "public" | "fork" => assert_eq!(got, Ok(verdict), "vector {name}"),
                "reject" => assert!(got.is_err(), "vector {name} must be rejected, got {got:?}"),
                other => panic!("unknown verdict {other} in vector {name}"),
            }
            n += 1;
        }
        assert!(n >= 20, "only {n} vectors read");
    }
}
