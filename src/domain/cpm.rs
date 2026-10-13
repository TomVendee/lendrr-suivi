use std::collections::{HashMap, VecDeque};

use chrono::NaiveDate;

use super::working_days::working_days_between;

/// CPM fin-début en jours ouvrés. Retourne (marges par id, ids critiques).
/// Durée = jours ouvrés [start,end]. Sans marge = critique.
pub fn critical_path(
    ids: &[String],
    start: &HashMap<String, NaiveDate>,
    end: &HashMap<String, NaiveDate>,
    deps: &[(String, String)],
) -> (HashMap<String, i64>, Vec<String>) {
    let dur: HashMap<String, i64> = ids
        .iter()
        .map(|id| (id.clone(), working_days_between(start[id], end[id]).max(1) as i64))
        .collect();

    // Ordre topo (Kahn). En cas de cycle, on coupe : les restants gardent marge 0.
    let mut indeg: HashMap<String, usize> = ids.iter().map(|id| (id.clone(), 0)).collect();
    let mut succ: HashMap<String, Vec<String>> = HashMap::new();
    let mut pred: HashMap<String, Vec<String>> = HashMap::new();
    for (p, s) in deps {
        succ.entry(p.clone()).or_default().push(s.clone());
        pred.entry(s.clone()).or_default().push(p.clone());
        *indeg.entry(s.clone()).or_insert(0) += 1;
    }
    let mut q: VecDeque<String> = ids.iter().filter(|id| indeg[*id] == 0).cloned().collect();
    let mut topo = vec![];
    while let Some(n) = q.pop_front() {
        topo.push(n.clone());
        for s in succ.get(&n).cloned().unwrap_or_default() {
            let e = indeg.get_mut(&s).unwrap();
            *e -= 1;
            if *e == 0 {
                q.push_back(s);
            }
        }
    }

    // Plus tôt (en jours ouvrés relatifs)
    let mut es: HashMap<String, i64> = HashMap::new();
    for n in &topo {
        let v = pred
            .get(n)
            .map(|ps| ps.iter().map(|p| es[p] + dur[p]).max().unwrap_or(0))
            .unwrap_or(0);
        es.insert(n.clone(), v);
    }
    let project = es.iter().map(|(id, e)| e + dur[id]).max().unwrap_or(0);
    // Plus tard
    let mut lf: HashMap<String, i64> = ids.iter().map(|id| (id.clone(), project)).collect();
    for n in topo.iter().rev() {
        if let Some(ss) = succ.get(n) {
            let v = ss.iter().map(|s| lf[s] - dur[s]).min().unwrap_or(project);
            lf.insert(n.clone(), v);
        }
    }
    let mut margins = HashMap::new();
    let mut critical = vec![];
    for id in ids {
        let m = lf[id] - es[id] - dur[id];
        margins.insert(id.clone(), m);
        if m <= 0 {
            critical.push(id.clone());
        }
    }
    (margins, critical)
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::NaiveDate;

    fn d(y: i32, m: u32, d: u32) -> NaiveDate {
        NaiveDate::from_ymd_opt(y, m, d).unwrap()
    }

    #[test]
    fn chain_is_critical_parallel_has_margin() {
        // a→b→c en chaîne (5j chacune), x en parallèle courte
        let ids = ["a", "b", "c", "x"].iter().map(|s| s.to_string()).collect::<Vec<_>>();
        let start: HashMap<String, NaiveDate> = [
            ("a", d(2026, 9, 28)), ("b", d(2026, 10, 5)),
            ("c", d(2026, 10, 12)), ("x", d(2026, 9, 28)),
        ].into_iter().map(|(k, v)| (k.to_string(), v)).collect();
        let end: HashMap<String, NaiveDate> = [
            ("a", d(2026, 10, 2)), ("b", d(2026, 10, 9)),
            ("c", d(2026, 10, 16)), ("x", d(2026, 9, 29)),
        ].into_iter().map(|(k, v)| (k.to_string(), v)).collect();
        let deps = vec![("a".into(), "b".into()), ("b".into(), "c".into())];
        let (m, crit) = critical_path(&ids, &start, &end, &deps);
        assert!(crit.contains(&"a".to_string()));
        assert!(crit.contains(&"c".to_string()));
        assert!(m["x"] > 0);
    }
}
