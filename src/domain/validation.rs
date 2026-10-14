/// Validation (fonction 11, prévue dès F1) : une tâche publiée + éventuelle
/// révision en attente. Règles pures ici, persistance côté routes.
pub fn can_validate(lead_count: usize) -> bool {
    lead_count == 1
}

pub fn valid_axis(code: &str) -> bool {
    matches!(code, "HARD" | "SOFT" | "IA" | "PILOTAGE" | "VIDEO")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lead_rule() {
        assert!(can_validate(1));
        assert!(!can_validate(0));
        assert!(!can_validate(2));
        assert!(valid_axis("HARD"));
        assert!(!valid_axis("NOPE"));
    }
}
