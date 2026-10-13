/// Les 7 alertes du cahier, évaluées en pur (seuils réglables).
#[derive(Debug, Clone, PartialEq)]
pub enum Alert {
    Overload { user: String, week: i32 },
    Overrun { task: String, user: String },
    MissingHours { user: String, week: i32 },
    Late { task: String },
    BlockingLate { task: String, succ: String },
    MilestoneThreatened { milestone: String },
    Incomplete { task: String },
}

pub struct Thresholds {
    pub overrun_pct: f64, // 0.25
    pub overrun_hours: f64, // 1.0
}

impl Default for Thresholds {
    fn default() -> Self {
        Self { overrun_pct: 0.25, overrun_hours: 1.0 }
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
}
