use chrono::{Datelike, NaiveDate};

/// Aujourd'hui calendaire au fuseau du projet (D16 : Europe/Paris).
pub fn today_paris() -> NaiveDate {
    chrono::Utc::now()
        .with_timezone(&chrono_tz::Europe::Paris)
        .date_naive()
}

/// Lundi de S01 : 24/08/2026. Fixe (D21) : les numéros de semaine sont stockés en base.
pub fn project_start() -> NaiveDate {
    NaiveDate::from_ymd_opt(2026, 8, 24).unwrap()
}

pub fn is_working_day(d: NaiveDate) -> bool {
    d.weekday().number_from_monday() <= 5
}

/// Jours ouvrés dans [start, end] inclus. `None` si end < start.
pub fn working_days_between(start: NaiveDate, end: NaiveDate) -> u32 {
    if end < start {
        return 0;
    }
    let mut n = 0;
    let mut d = start;
    while d <= end {
        if is_working_day(d) {
            n += 1;
        }
        d = d.succ_opt().unwrap();
    }
    n
}

/// Ajoute `n` jours ouvrés à `d` (n=0 → d). Samedi/dimanche sautés.
pub fn add_working_days(d: NaiveDate, n: i64) -> NaiveDate {
    if n == 0 {
        return d;
    }
    let mut cur = d;
    let step: i64 = if n > 0 { 1 } else { -1 };
    let mut left = n.abs();
    while left > 0 {
        cur = if step > 0 {
            cur.succ_opt().unwrap()
        } else {
            cur.pred_opt().unwrap()
        };
        if is_working_day(cur) {
            left -= 1;
        }
    }
    cur
}

/// Fin = début + (durée_ouvrée - 1) jours ouvrés.
pub fn end_from_duration(start: NaiveDate, duration_workdays: u32) -> NaiveDate {
    if duration_workdays == 0 {
        return start;
    }
    add_working_days(start, (duration_workdays - 1) as i64)
}

/// Numéro de semaine projet (S01 = semaine du 24/08/2026). Lundi→dimanche.
pub fn project_week(d: NaiveDate) -> i32 {
    let monday = d - chrono::Duration::days((d.weekday().number_from_monday() - 1) as i64);
    let start = project_start();
    ((monday - start).num_days() / 7 + 1) as i32
}

pub fn week_bounds(week: i32) -> (NaiveDate, NaiveDate) {
    let mon = project_start() + chrono::Duration::weeks((week - 1) as i64);
    (mon, mon + chrono::Duration::days(6))
}

/// Semaines projet couvertes par une tâche, du début à la fin inclus. Jamais avant S01, et au plus 52 semaines
/// (une tâche mal datée ne doit pas produire une liste interminable).
pub fn task_weeks(start: NaiveDate, end: NaiveDate) -> Vec<i32> {
    let first = project_week(start).max(1);
    let last = project_week(end).max(first);
    (first..=last.min(first + 51)).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn d(y: i32, m: u32, d: u32) -> NaiveDate {
        NaiveDate::from_ymd_opt(y, m, d).unwrap()
    }

    #[test]
    fn weekends_skipped() {
        // Ven 28/08/2026 + 1j ouvré = Lun 31/08
        assert_eq!(add_working_days(d(2026, 8, 28), 1), d(2026, 8, 31));
        assert_eq!(working_days_between(d(2026, 8, 24), d(2026, 8, 30)), 5);
        assert_eq!(working_days_between(d(2026, 8, 29), d(2026, 8, 30)), 0);
    }

    #[test]
    fn project_weeks() {
        assert_eq!(project_week(d(2026, 8, 24)), 1);
        assert_eq!(project_week(d(2026, 8, 30)), 1);
        assert_eq!(project_week(d(2026, 9, 28)), 6); // S06 per cahier
    }

    #[test]
    fn duration_roundtrip() {
        let s = d(2026, 9, 28); // lundi
        assert_eq!(end_from_duration(s, 5), d(2026, 10, 2)); // vendredi
        assert_eq!(working_days_between(s, d(2026, 10, 2)), 5);
    }

    #[test]
    fn task_weeks_cover_start_to_end() {
        // Jour unique : une semaine. S09 = semaine du 19/10/2026.
        assert_eq!(task_weeks(d(2026, 10, 21), d(2026, 10, 21)), vec![9]);
        // Du ven 23/10 (S09) au mar 03/11 (S11) : trois semaines.
        assert_eq!(task_weeks(d(2026, 10, 23), d(2026, 11, 3)), vec![9, 10, 11]);
        // Avant le début du projet : on commence à S01.
        assert_eq!(task_weeks(d(2026, 8, 1), d(2026, 8, 26)), vec![1]);
        // Dates inversées : au moins la première semaine.
        assert_eq!(task_weeks(d(2026, 10, 21), d(2026, 10, 5)), vec![9]);
        // Plafond de 52 semaines.
        assert_eq!(task_weeks(d(2026, 8, 24), d(2030, 1, 1)).len(), 52);
    }
}
