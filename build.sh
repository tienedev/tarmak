#!/bin/bash
set -e
echo "Building frontend..."
cd frontend && pnpm build && cd ..
echo "Building backend..."
cargo build --release
echo "Done! Binary at target/release/kanwise"
