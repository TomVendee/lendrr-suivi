use chrono::NaiveDate;

use super::working_days::{week_bounds, working_days_between};

pub struct Allocation {
    pub task_start: NaiveDate,
    pub task_end: NaiveDate,
    pub hours: f64,
}

/// Part des heures d'une tâche imputée à `week` au prorata de ses jours ouvrés.
pub fn hours_in_week(a: &Allocation, week: i32) -> f64 {
    let total = working_days_between(a.task_start, a.task_end);
    if total == 0 || a.hours <= 0.0 {
        return 0.0;
    }
    let (wmon, wsun) = week_bounds(week);
    let s = a.task_start.max(wmon);
    let e = a.task_end.min(wsun);
    if e < s {
        return 0.0;
    }
    let in_week = working_days_between(s, e);
    a.hours * (in_week as f64) / (total as f64)
}

/// Charge prévue d'une personne sur une semaine = somme lead+appui.
pub fn planned_load(allocs: &[Allocation], week: i32) -> f64 {
    allocs.iter().map(|a| hours_in_week(a, week)).sum()
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::NaiveDate;

    fn d(y: i32, m: u32, d: u32) -> NaiveDate {
        NaiveDate::from_ymd_opt(y, m, d).unwrap()
    }

    #[test]
    fn prorata_across_two_weeks() {
        // 10h sur 10j ouvrés à cheval sur 2 semaines 5/5 → 5h chacune
        let a = Allocation {
            task_start: d(2026, 9, 28),
            task_end: d(2026, 10, 9),
            hours: 10.0,
        };
        assert!((hours_in_week(&a, 6) - 5.0).abs() < 1e-6);
        assert!((hours_in_week(&a, 7) - 5.0).abs() < 1e-6);
        assert_eq!(hours_in_week(&a, 8), 0.0);
    }

    #[test]
    fn single_week_full() {
        let a = Allocation {
            task_start: d(2026, 9, 28),
            task_end: d(2026, 10, 2),
            hours: 4.0,
        };
        assert!((planned_load(&[a], 6) - 4.0).abs() < 1e-6);
    }
}
