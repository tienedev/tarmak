#!/bin/bash
set -e
echo "Building frontend..."
cd frontend && pnpm build && cd ..
echo "Building backend..."
cargo build --release
echo "Done! Binaries at target/release/{cortx,kanwise,rtk-proxy,context-db}"
