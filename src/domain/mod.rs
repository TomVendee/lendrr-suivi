//! Règles métier pures (sans I/O) : ce sont elles qui font la soutenance.
//! Chaque module a ses tests avec des cas du vrai planning + cas limites (D7).
pub mod alerts;
pub mod cpm;
pub mod deps;
pub mod load;
pub mod shift;
pub mod validation;
pub mod working_days;
