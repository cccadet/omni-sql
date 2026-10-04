#!/usr/bin/env bash
set -euo pipefail

bundle_dir="${1:-apps/desktop/src-tauri/target/release/bundle}"
test "$(uname -s)" = Darwin
work_dir="$(mktemp -d "${TMPDIR:-/tmp}/omni-macos.XXXXXX")"
mount_dir="$work_dir/mount"
app_pid=""
cleanup() {
  if [[ -n "$app_pid" ]]; then
    pkill -TERM -P "$app_pid" 2>/dev/null || true
    kill "$app_pid" 2>/dev/null || true
    wait "$app_pid" 2>/dev/null || true
  fi
  hdiutil detach "$mount_dir" -quiet 2>/dev/null || true
  rm -rf "$work_dir"
}
trap cleanup EXIT

installers=("$bundle_dir"/dmg/*.dmg)
test "${#installers[@]}" -eq 1
hdiutil attach "${installers[0]}" -readonly -nobrowse -mountpoint "$mount_dir" -quiet
app="$work_dir/Installed App/omni-sql.app"
mkdir -p "$(dirname "$app")"
ditto "$mount_dir/omni-sql.app" "$app"
hdiutil detach "$mount_dir" -quiet
codesign --verify --deep --strict "$app"

resources="$app/Contents/Resources/resources"
while IFS= read -r -d '' binary; do
  if file -b "$binary" | grep -q 'Mach-O'; then
    codesign --verify --strict "$binary"
    # No absolute Homebrew dependency may escape the installed application.
    if otool -L "$binary" | grep -E '^[[:space:]]+/(opt/homebrew|usr/local)/' | grep -v "$(basename "$binary") (compatibility version"; then
      echo "Unbundled native dependency: $binary" >&2
      exit 1
    fi
  fi
done < <(find "$app/Contents" -type f -print0)

export PATH=/usr/bin:/bin:/usr/sbin:/sbin
unset NODE_PATH NODE_OPTIONS JAVA_HOME JDK_JAVA_OPTIONS JAVA_TOOL_OPTIONS _JAVA_OPTIONS DYLD_LIBRARY_PATH DYLD_INSERT_LIBRARIES
"$resources/runtime/node/node" --version
"$resources/runtime/jre/bin/java" -version
(
  cd "$resources/backend"
  "$resources/runtime/node/node" --input-type=module -e '
    import assert from "node:assert/strict";
    import keyring from "@napi-rs/keyring";
    import odbc from "odbc";
    import oracle from "oracledb";
    assert.equal(typeof odbc.connect, "function");
    assert.equal(typeof oracle.getConnection, "function");
    const entry = new keyring.AsyncEntry("omni-sql-macos-preflight", `probe-${process.pid}`);
    try {
      await entry.setPassword("preflight-value");
      assert.equal(await entry.getPassword(), "preflight-value");
    } finally { await entry.deleteCredential(); }
  '
)

executable="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleExecutable' "$app/Contents/Info.plist")"
XDG_DATA_HOME="$work_dir/data" "$app/Contents/MacOS/$executable" > "$work_dir/startup.log" 2>&1 &
app_pid=$!
for ((attempt=0; attempt<90; attempt++)); do
  if grep -q 'backend sidecar health check passed' "$work_dir/startup.log" &&
     grep -q 'JVM sidecar health check passed' "$work_dir/startup.log"; then
    kill -0 "$app_pid"
    echo 'Installed macOS app started its bundled backend and JVM successfully.'
    exit 0
  fi
  if ! kill -0 "$app_pid" 2>/dev/null; then break; fi
  sleep 1
done
cat "$work_dir/startup.log" >&2
echo 'Installed macOS app did not start both sidecars.' >&2
exit 1
