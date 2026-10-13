use std::collections::{HashMap, HashSet};

/// Vrai si ajouter pred→succ créerait un cycle (succ atteint déjà pred).
pub fn would_cycle(deps: &[(String, String)], pred: &str, succ: &str) -> bool {
    if pred == succ {
        return true;
    }
    let mut next: HashMap<&str, Vec<&str>> = HashMap::new();
    for (p, s) in deps {
        next.entry(p).or_default().push(s);
    }
    let mut seen = HashSet::new();
    let mut stack = vec![succ];
    while let Some(n) = stack.pop() {
        if n == pred {
            return true;
        }
        if seen.insert(n) {
            stack.extend(next.get(n).cloned().unwrap_or_default());
        }
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_direct_and_indirect_cycles() {
        let deps = vec![("a".into(), "b".into()), ("b".into(), "c".into())];
        assert!(would_cycle(&deps, "c", "a")); // fermerait le cycle
        assert!(would_cycle(&deps, "b", "b")); // auto-boucle
        assert!(!would_cycle(&deps, "c", "d")); // ok
        assert!(!would_cycle(&deps, "a", "c")); // doublon logique, pas un cycle
    }
}
