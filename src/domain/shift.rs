use std::collections::{HashMap, HashSet};

use chrono::NaiveDate;

use super::working_days::{add_working_days, end_from_duration, working_days_between};

#[derive(Debug, Clone)]
pub struct Node {
    pub id: String,
    pub start: NaiveDate,
    pub end: NaiveDate,
    pub milestone: bool,
}

/// Décale en cascade : quand `moved_id` finit plus tard, chaque successeur recule
/// **seulement s'il chevauche** son prédécesseur, en jours ouvrés, durée conservée.
/// Les jalons ne bougent jamais : ils sont listés dans `threatened`.
/// `deps` : (pred, succ) fin-début. Retourne les nouvelles dates par id.
pub fn cascade_shift(
    nodes: &[Node],
    deps: &[(String, String)],
    moved_id: &str,
    new_end: NaiveDate,
) -> (HashMap<String, (NaiveDate, NaiveDate)>, Vec<String>) {
    let mut dates: HashMap<String, (NaiveDate, NaiveDate)> =
        nodes.iter().map(|n| (n.id.clone(), (n.start, n.end))).collect();
    let milestones: HashSet<String> =
        nodes.iter().filter(|n| n.milestone).map(|n| n.id.clone()).collect();

    if let Some(slot) = dates.get_mut(moved_id) {
        let dur = working_days_between(slot.0, slot.1).max(1);
        slot.1 = new_end;
        // Le début suit la fin pour garder la durée (recule si besoin).
        slot.0 = add_working_days(new_end, -((dur - 1) as i64));
    }

    let mut succ_of: HashMap<String, Vec<String>> = HashMap::new();
    for (p, s) in deps {
        succ_of.entry(p.clone()).or_default().push(s.clone());
    }

    let mut threatened = vec![];
    let mut queue = vec![moved_id.to_string()];
    let mut seen = HashSet::new();
    while let Some(cur) = queue.pop() {
        if !seen.insert(cur.clone()) {
            continue;
        }
        let (_, cur_end) = dates[&cur];
        for succ in succ_of.get(&cur).cloned().unwrap_or_default() {
            let (s_start, s_end) = dates[&succ];
            // Chevauchement : le successeur commence avant la fin+1j ouvré du pred.
            let earliest = add_working_days(cur_end, 1);
            if s_start < earliest {
                if milestones.contains(&succ) {
                    if !threatened.contains(&succ) {
                        threatened.push(succ.clone());
                    }
                    // Le jalon ne bouge pas, mais la cascade continue au-delà
                    // (ses successeurs se comparent à sa date fixe).
                    queue.push(succ);
                    continue;
                }
                let dur = working_days_between(s_start, s_end).max(1);
                let ns = earliest;
                let ne = end_from_duration(ns, dur);
                dates.insert(succ.clone(), (ns, ne));
                queue.push(succ);
            }
        }
    }
    (dates, threatened)
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::NaiveDate;

    fn d(y: i32, m: u32, d: u32) -> NaiveDate {
        NaiveDate::from_ymd_opt(y, m, d).unwrap()
    }

    #[test]
    fn shifts_only_on_overlap() {
        let nodes = vec![
            Node { id: "a".into(), start: d(2026, 9, 28), end: d(2026, 10, 2), milestone: false },
            Node { id: "b".into(), start: d(2026, 10, 5), end: d(2026, 10, 9), milestone: false },
            // c commence après b + marge : pas de décalage
            Node { id: "c".into(), start: d(2026, 10, 19), end: d(2026, 10, 23), milestone: false },
        ];
        let deps = vec![("a".into(), "b".into()), ("b".into(), "c".into())];
        // a recule d'1 sem : finit le 09/10
        let (dates, threatened) = cascade_shift(&nodes, &deps, "a", d(2026, 10, 9));
        assert!(threatened.is_empty());
        assert_eq!(dates["b"].0, d(2026, 10, 12)); // lundi suivant
        assert_eq!(dates["c"].0, d(2026, 10, 19)); // inchangé
    }

    #[test]
    fn milestone_never_moves() {
        let nodes = vec![
            Node { id: "a".into(), start: d(2026, 9, 28), end: d(2026, 10, 2), milestone: false },
            Node { id: "m".into(), start: d(2026, 10, 5), end: d(2026, 10, 5), milestone: true },
        ];
        let deps = vec![("a".into(), "m".into())];
        let (dates, threatened) = cascade_shift(&nodes, &deps, "a", d(2026, 10, 9));
        assert_eq!(dates["m"].0, d(2026, 10, 5));
        assert_eq!(threatened, vec!["m".to_string()]);
    }
}
