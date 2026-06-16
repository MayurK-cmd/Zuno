// `instructions::handler` is the only public name the lib.rs entry
// point references. Each instruction file re-exports its own
// `handler` via `pub fn handler(...)`; glob re-exports collide on the
// shared name, so the per-module public paths are used directly:
//
//   instructions::initialize_room::handler
//   instructions::play_card::handler
//   ...
//
// No `pub use` globs here on purpose.

pub mod call_zuno;
pub mod claim_victory;
pub mod draw_card;
pub mod force_skip;
pub mod initialize_room;
pub mod join_room;
pub mod play_card;
pub mod punish_zuno;
pub mod reveal_randomness;
pub mod start_game;
