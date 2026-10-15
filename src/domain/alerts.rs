//! Les sept alertes du cahier, en prédicats purs (seuils réglables, D22).
//! L'assemblage (lecture base, visibilité par rôle) est dans `routes::stats::compute_alerts`.
use chrono::{Datelike, NaiveDate, NaiveDateTime, Timelike};

pub struct Thresholds {
    pub overrun_pct: f64, // 0.25
    pub overrun_hours: f64, // 1.0
    /// Retard bloquant : un successeur commence dans moins de N jours.
    pub blocking_days: i64, // 7
}

impl Default for Thresholds {
    fn default() -> Self {
        Self { overrun_pct: 0.25, overrun_hours: 1.0, blocking_days: 7 }
    }
}

/// 1. Surcharge prévue : la charge prévue dépasse la capacité de la semaine.
pub fn overloaded(planned: f64, capacity: f64) -> bool {
    planned - capacity > 1e-9
}

/// 2. Dépassement réel : le réel dépasse le prévu de plus de `overrun_pct` ou de plus de `overrun_hours`.
pub fn overrun(planned: f64, actual: f64, t: &Thresholds) -> bool {
    if planned <= 0.0 {
        return actual > t.overrun_hours;
    }
    actual - planned > t.overrun_hours || (actual - planned) / planned > t.overrun_pct
}

/// 3. Heures non déclarées : l'alerte s'ouvre le lundi à 12 h (heure de Paris) pour la semaine écoulée.
pub fn missing_hours_due(now_paris: NaiveDateTime) -> bool {
    now_paris.weekday().number_from_monday() != 1 || now_paris.hour() >= 12
}

/// 4. Tâche en retard : échéance passée, pas terminée (les jalons relèvent de « jalon menacé »).
pub fn late(end: NaiveDate, done: bool, milestone: bool, today: NaiveDate) -> bool {
    !milestone && !done && end < today
}

/// 5. Retard bloquant : un successeur non terminé commence dans moins de `blocking_days` jours.
pub fn blocking(succ_start: NaiveDate, succ_done: bool, today: NaiveDate, t: &Thresholds) -> bool {
    !succ_done && (succ_start - today).num_days() < t.blocking_days
}

/// 6. Jalon menacé : un prédécesseur non terminé finit le jour du jalon ou après (marge négative).
///
/// L'autre cas (tâche critique en retard) combine `late` et le chemin critique.
pub fn milestone_at_risk(pred_end: NaiveDate, pred_done: bool, milestone_date: NaiveDate) -> bool {
    !pred_done && pred_end >= milestone_date
}

/// 7. Tâche incomplète : pas exactement un pilote, ou aucune heure prévue.
pub fn incomplete(lead_count: usize, planned_hours: f64) -> bool {
    lead_count != 1 || planned_hours <= 0.0
}

#[cfg(test)]
mod tests {
    use super::*;

    fn d(m: u32, j: u32) -> NaiveDate {
        NaiveDate::from_ymd_opt(2026, m, j).unwrap()
    }
    fn at(m: u32, j: u32, h: u32, min: u32) -> NaiveDateTime {
        d(m, j).and_hms_opt(h, min, 0).unwrap()
    }

    #[test]
    fn overrun_thresholds() {
        let t = Thresholds::default();
        assert!(overrun(4.0, 5.5, &t)); // +1,5h
        assert!(overrun(4.0, 5.05, &t)); // +26%
        assert!(!overrun(4.0, 4.5, &t));
        assert!(overrun(0.0, 2.0, &t));
    }

    #[test]
    fn overrun_custom_thresholds() {
        let t = Thresholds { overrun_pct: 0.10, overrun_hours: 3.0, ..Default::default() };
        assert!(overrun(4.0, 4.5, &t)); // +12,5 %
        assert!(!overrun(4.0, 4.3, &t)); // +7,5 %, +0,3 h
        assert!(overrun(40.0, 43.5, &t)); // +3,5 h
    }

    #[test]
    fn overload_against_capacity() {
        // Tom A. : capacité 3 h (1 h de pilotage), 3 h prévues = pile, pas d'alerte.
        assert!(!overloaded(3.0, 3.0));
        assert!(overloaded(3.5, 3.0));
        // Absence : capacité 0 h, la moindre heure prévue lève l'alerte.
        assert!(overloaded(0.5, 0.0));
        assert!(!overloaded(0.0, 0.0));
    }

    #[test]
    fn missing_hours_opens_monday_noon() {
        // Lundi 19/10 : rien avant 12 h, alerte à partir de 12 h, et toute la semaine ensuite.
        assert!(!missing_hours_due(at(10, 19, 11, 59)));
        assert!(missing_hours_due(at(10, 19, 12, 0)));
        assert!(missing_hours_due(at(10, 20, 8, 0)));
        assert!(missing_hours_due(at(10, 25, 23, 0)));
    }

    #[test]
    fn late_tasks() {
        // « Schéma électrique de la serrure » finit le 16/10.
        assert!(!late(d(10, 16), false, false, d(10, 16)));
        assert!(late(d(10, 16), false, false, d(10, 19)));
        assert!(!late(d(10, 16), true, false, d(10, 19)));
        // Un jalon ne lève pas « en retard » (il lève « jalon menacé »).
        assert!(!late(d(10, 23), false, true, d(10, 26)));
    }

    #[test]
    fn blocking_successor_within_threshold() {
        let t = Thresholds::default();
        // Schéma en retard le 19/10 ; « Prototype boîtier » commence le 19/10 : bloquant.
        assert!(blocking(d(10, 19), false, d(10, 19), &t));
        // Successeur qui démarre dans 7 jours pile : pas encore bloquant.
        assert!(!blocking(d(10, 26), false, d(10, 19), &t));
        assert!(blocking(d(10, 25), false, d(10, 19), &t));
        // Déjà terminé : rien à bloquer.
        assert!(!blocking(d(10, 19), true, d(10, 19), &t));
        let strict = Thresholds { blocking_days: 3, ..Default::default() };
        assert!(!blocking(d(10, 23), false, d(10, 19), &strict));
    }

    #[test]
    fn milestone_negative_margin() {
        // Revue de mi-parcours le 23/10 : le schéma qui finit le 24/10 la menace.
        assert!(milestone_at_risk(d(10, 24), false, d(10, 23)));
        assert!(milestone_at_risk(d(10, 23), false, d(10, 23)));
        assert!(!milestone_at_risk(d(10, 22), false, d(10, 23)));
        assert!(!milestone_at_risk(d(10, 24), true, d(10, 23)));
    }

    #[test]
    fn incomplete_tasks() {
        assert!(!incomplete(1, 4.0));
        assert!(incomplete(0, 4.0)); // sans pilote
        assert!(incomplete(2, 4.0)); // deux pilotes
        assert!(incomplete(1, 0.0)); // sans heures
    }
}
