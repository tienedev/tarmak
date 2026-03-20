//! KBF (Kanban Binary-text Format) - Token-efficient serialization for kanban data.

pub mod decode;
pub mod encode;
pub mod schema;

pub use decode::{DecodeError, Decoded, decode_deltas, decode_full};
pub use encode::{Delta, Row, encode_delta, encode_full, row_from_map};
pub use schema::Schema;
