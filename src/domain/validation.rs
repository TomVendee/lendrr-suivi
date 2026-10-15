/// Validation (fonction 11, prévue dès F1) : une tâche publiée + éventuelle
/// révision en attente. Règles pures ici, persistance côté routes.
use chrono::NaiveDate;
use uuid::Uuid;

use super::working_days::working_days_between;

pub fn can_validate(lead_count: usize) -> bool {
    lead_count == 1
}

pub fn valid_axis(code: &str) -> bool {
    matches!(code, "HARD" | "SOFT" | "IA" | "PILOTAGE" | "VIDEO")
}

/// Sort d'une création ou d'une modification de tâche selon l'auteur et les réglages.
#[derive(Debug, PartialEq, Eq)]
pub enum WriteMode {
    Publish,
    Propose,
    Forbidden,
}

pub fn write_mode(
    is_pilot: bool,
    is_create: bool,
    validation_enabled: bool,
    revalidate_on_edit: bool,
    members_can_propose: bool,
) -> WriteMode {
    if is_pilot {
        WriteMode::Publish
    } else if !members_can_propose {
        WriteMode::Forbidden
    } else if validation_enabled && (is_create || revalidate_on_edit) {
        WriteMode::Propose
    } else {
        WriteMode::Publish
    }
}

/// Peut valider : le pilote, le validateur désigné ou le suppléant (toujours habilité, D22).
pub fn can_decide(uid: Uuid, is_pilot: bool, validator_id: Option<Uuid>, deputy_id: Option<Uuid>) -> bool {
    is_pilot || validator_id == Some(uid) || deputy_id == Some(uid)
}

/// Rappel de validation : au moins `reminder_days` jours ouvrés écoulés depuis la proposition.
/// `None` = jamais.
pub fn pending_overdue(created: NaiveDate, today: NaiveDate, reminder_days: Option<i32>) -> bool {
    let Some(n) = reminder_days else { return false };
    let Some(next) = created.succ_opt() else { return false };
    working_days_between(next, today) as i32 >= n
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

    #[test]
    fn write_mode_table() {
        use WriteMode::*;
        // (pilote, création, validation, revalider, membres proposent) → sort
        let cases = [
            (true, true, true, true, false, Publish),
            (true, false, true, true, true, Publish),
            (false, true, true, true, false, Forbidden),
            (false, false, false, false, false, Forbidden),
            (false, true, true, true, true, Propose),
            (false, true, true, false, true, Propose),
            (false, false, true, true, true, Propose),
            (false, false, true, false, true, Publish),
            (false, true, false, true, true, Publish),
            (false, false, false, true, true, Publish),
        ];
        for (p, c, v, r, m, want) in cases {
            assert_eq!(write_mode(p, c, v, r, m), want, "{p} {c} {v} {r} {m}");
        }
    }

    #[test]
    fn deciders() {
        let (me, other, deputy) = (Uuid::from_u128(1), Uuid::from_u128(2), Uuid::from_u128(3));
        assert!(can_decide(me, true, None, None));
        assert!(!can_decide(me, false, None, None));
        assert!(can_decide(me, false, Some(me), None));
        assert!(can_decide(deputy, false, Some(other), Some(deputy)));
        assert!(!can_decide(me, false, Some(other), Some(deputy)));
    }

    #[test]
    fn reminder_skips_weekend() {
        let d = |m, j| NaiveDate::from_ymd_opt(2026, m, j).unwrap();
        // Proposée vendredi 09/10 : lundi = 1 jour ouvré, mardi = 2.
        assert!(!pending_overdue(d(10, 9), d(10, 11), Some(2)));
        assert!(!pending_overdue(d(10, 9), d(10, 12), Some(2)));
        assert!(pending_overdue(d(10, 9), d(10, 13), Some(2)));
        assert!(pending_overdue(d(10, 9), d(10, 12), Some(1)));
        assert!(!pending_overdue(d(10, 9), d(10, 30), None));
        assert!(!pending_overdue(d(10, 13), d(10, 13), Some(1)));
    }
}
