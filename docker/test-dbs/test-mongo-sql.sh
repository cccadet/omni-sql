#!/usr/bin/env sh
set -eu
export OMNI_SQL_TEST_MONGO_URI="${OMNI_SQL_TEST_MONGO_URI:-mongodb://127.0.0.1:27017/omni_test?authSource=admin}"
export OMNI_SQL_TEST_MONGO_USER=omni_mongo_test
export OMNI_SQL_TEST_MONGO_PASSWORD="p:'/?@"
CARGO_BUILD_JOBS=2 cargo test --manifest-path ../../apps/desktop/src-tauri/Cargo.toml --lib mongo_sql_real_database_readonly_catalog --no-default-features -- --ignored --nocapture
