/// Seuils des alertes du cahier (réglables) + prédicat de dépassement.
/// Les 7 alertes sont assemblées dans `routes::stats::compute_alerts`.
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

pub fn overrun(planned: f64, actual: f64, t: &Thresholds) -> bool {
    if planned <= 0.0 {
        return actual > t.overrun_hours;
    }
    actual - planned > t.overrun_hours || (actual - planned) / planned > t.overrun_pct
}

#[cfg(test)]
mod tests {
    use super::*;

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
}
