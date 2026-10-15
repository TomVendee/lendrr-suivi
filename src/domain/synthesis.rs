//! Synthèse hebdomadaire en texte à trous (D15) : phrases courtes, rubriques vides omises.
use chrono::{Datelike, NaiveDate};

pub struct WeekFacts {
    pub week: i32,
    pub monday: NaiveDate,
    pub done: Vec<String>,
    pub late: Vec<String>,
    pub overloads: usize,
    pub overruns: usize,
    pub missing_hours: usize,
    pub threatened: usize,
    pub pending: usize,
    pub pending_overdue: usize,
    pub real_hours: f64,
}

const MONTHS: [&str; 12] = [
    "janvier", "février", "mars", "avril", "mai", "juin",
    "juillet", "août", "septembre", "octobre", "novembre", "décembre",
];

/// « 1 surcharge prévue », « 2 surcharges prévues ».
fn n(count: usize, one: &str, many: &str) -> String {
    format!("{count} {}", if count > 1 { many } else { one })
}

fn hours(h: f64) -> String {
    let s = format!("{:.1}", h).replace('.', ",");
    format!("{} h", s.strip_suffix(",0").unwrap_or(&s))
}

pub fn synthesis_text(f: &WeekFacts) -> String {
    let friday = f.monday + chrono::Duration::days(4);
    let month = |d: NaiveDate| MONTHS[d.month0() as usize];
    let span = if f.monday.month() == friday.month() {
        format!("du {} au {} {}", f.monday.day(), friday.day(), month(friday))
    } else {
        format!("du {} {} au {} {}", f.monday.day(), month(f.monday), friday.day(), month(friday))
    };
    let mut lines = vec![format!("Semaine {}, {span}. {} déclarées par l'équipe.", f.week, hours(f.real_hours))];

    lines.push(if f.done.is_empty() {
        "Aucune tâche terminée cette semaine.".to_string()
    } else {
        format!("Terminé : {}.", f.done.join(", "))
    });
    if !f.late.is_empty() {
        lines.push(format!("En retard : {}.", f.late.join(", ")));
    }

    let mut watch = vec![];
    if f.threatened > 0 { watch.push(n(f.threatened, "jalon menacé", "jalons menacés")); }
    if f.overloads > 0 { watch.push(n(f.overloads, "surcharge prévue", "surcharges prévues")); }
    if f.overruns > 0 { watch.push(n(f.overruns, "dépassement d'heures", "dépassements d'heures")); }
    if f.missing_hours > 0 { watch.push(n(f.missing_hours, "personne sans heures déclarées", "personnes sans heures déclarées")); }
    lines.push(if watch.is_empty() {
        "Aucun point d'attention.".to_string()
    } else {
        format!("Points d'attention : {}.", watch.join(", "))
    });

    if f.pending > 0 {
        let mut v = format!("À valider : {}", n(f.pending, "proposition", "propositions"));
        if f.pending_overdue > 0 {
            v += &format!(", dont {} en attente depuis trop longtemps", f.pending_overdue);
        }
        lines.push(v + ".");
    }
    lines.push("Décisions du point d'équipe : à compléter.".to_string());
    lines.join("\n")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn facts() -> WeekFacts {
        WeekFacts {
            week: 8,
            monday: NaiveDate::from_ymd_opt(2026, 10, 12).unwrap(),
            done: vec![],
            late: vec![],
            overloads: 0,
            overruns: 0,
            missing_hours: 0,
            threatened: 0,
            pending: 0,
            pending_overdue: 0,
            real_hours: 9.5,
        }
    }

    #[test]
    fn quiet_week() {
        let t = synthesis_text(&facts());
        assert!(t.starts_with("Semaine 8, du 12 au 16 octobre. 9,5 h déclarées par l'équipe."));
        assert!(t.contains("Aucune tâche terminée cette semaine."));
        assert!(t.contains("Aucun point d'attention."));
        assert!(!t.contains("En retard"));
        assert!(!t.contains("À valider"));
        assert!(!t.contains("(s)"));
    }

    #[test]
    fn busy_week_plurals() {
        let mut f = facts();
        f.done = vec!["Choix du microcontrôleur".into()];
        f.late = vec!["API de réservation des casiers".into()];
        f.threatened = 1;
        f.overloads = 2;
        f.missing_hours = 1;
        f.pending = 3;
        f.pending_overdue = 1;
        let t = synthesis_text(&f);
        assert!(t.contains("Terminé : Choix du microcontrôleur."));
        assert!(t.contains("En retard : API de réservation des casiers."));
        assert!(t.contains("Points d'attention : 1 jalon menacé, 2 surcharges prévues, 1 personne sans heures déclarées."));
        assert!(t.contains("À valider : 3 propositions, dont 1 en attente depuis trop longtemps."));
    }

    #[test]
    fn week_across_months_and_round_hours() {
        let mut f = facts();
        f.week = 10; // lundi 26/10 → vendredi 30/10
        f.monday = NaiveDate::from_ymd_opt(2026, 10, 26).unwrap();
        f.real_hours = 12.0;
        assert!(synthesis_text(&f).starts_with("Semaine 10, du 26 au 30 octobre. 12 h déclarées"));
        f.monday = NaiveDate::from_ymd_opt(2026, 11, 30).unwrap(); // vendredi 04/12
        assert!(synthesis_text(&f).contains("du 30 novembre au 4 décembre"));
    }
}
