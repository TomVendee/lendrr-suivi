/// Validation (fonction 11, prévue dès F1) : une tâche publiée + éventuelle
/// révision en attente. Règles pures ici, persistance côté routes.
pub fn can_validate(lead_count: usize) -> bool {
    lead_count == 1
}

/// Une révision touche dates/heures/collaborateurs ? → repasse en attente.
pub fn needs_revalidation(dates_changed: bool, hours_changed: bool, assignees_changed: bool) -> bool {
    dates_changed || hours_changed || assignees_changed
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lead_rule() {
        assert!(can_validate(1));
        assert!(!can_validate(0));
        assert!(!can_validate(2));
        assert!(needs_revalidation(true, false, false));
        assert!(!needs_revalidation(false, false, false));
    }
}
