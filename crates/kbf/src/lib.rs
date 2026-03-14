//! KBF (Kanban Binary-text Format) - Token-efficient serialization for kanban data.

pub mod decode;
pub mod encode;
pub mod schema;

pub use decode::{decode_deltas, decode_full, DecodeError, Decoded};
pub use encode::{encode_delta, encode_full, row_from_map, Delta, Row};
pub use schema::Schema;
