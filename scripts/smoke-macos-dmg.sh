#!/usr/bin/env bash
set -Eeuo pipefail

if [[ $# -ne 3 ]]; then
  echo "Usage: $0 <dmg> <pdf> <artifact-directory>" >&2
  exit 2
fi

dmg="$(cd "$(dirname "$1")" && pwd)/$(basename "$1")"
pdf="$(cd "$(dirname "$2")" && pwd)/$(basename "$2")"
artifact_dir="$3"
mkdir -p "$artifact_dir"
artifact_dir="$(cd "$artifact_dir" && pwd)"

mount_dir="$(mktemp -d)"
copied_app="$RUNNER_TEMP/VerityPDF-smoke.app"
ready_file="$artifact_dir/macos-ready.txt"
launch_log="$artifact_dir/macos-launch.log"
rm -rf "$copied_app"
rm -f "$ready_file"

mounted=false
app_pid=""
cleanup() {
  if [[ -n "$app_pid" ]] && kill -0 "$app_pid" 2>/dev/null; then
    kill "$app_pid" 2>/dev/null || true
    wait "$app_pid" 2>/dev/null || true
  fi
  if [[ "$mounted" == true ]]; then
    hdiutil detach "$mount_dir" -quiet || true
  fi
  rm -rf "$mount_dir" "$copied_app"
}
trap cleanup EXIT

hdiutil attach "$dmg" -nobrowse -readonly -mountpoint "$mount_dir" -quiet
mounted=true
source_app="$(find "$mount_dir" -maxdepth 1 -type d -name '*.app' -print -quit)"
if [[ -z "$source_app" ]]; then
  echo "The DMG does not contain an application bundle." >&2
  exit 1
fi
ditto "$source_app" "$copied_app"

plist="$copied_app/Contents/Info.plist"
plutil -lint "$plist"
plutil -p "$plist" >"$artifact_dir/macos-info-plist.txt"
bundle_identifier="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$plist")"
if [[ "$bundle_identifier" != "org.sovereignpdf.desktop" ]]; then
  echo "Unexpected bundle identifier: $bundle_identifier" >&2
  exit 1
fi

executable_name="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleExecutable' "$plist")"
executable="$copied_app/Contents/MacOS/$executable_name"
if [[ ! -x "$executable" ]]; then
  echo "The application executable is missing: $executable" >&2
  exit 1
fi

architectures="$(lipo -archs "$executable")"
printf '%s\n' "$architectures" | tee "$artifact_dir/macos-architectures.txt"
for architecture in x86_64 arm64; do
  if [[ " $architectures " != *" $architecture "* ]]; then
    echo "The macOS executable is missing $architecture: $architectures" >&2
    exit 1
  fi
done

export VERITYPDF_SMOKE_READY_FILE="$ready_file"
"$executable" "$pdf" >"$launch_log" 2>&1 &
app_pid=$!

for _ in $(seq 1 45); do
  if ! kill -0 "$app_pid" 2>/dev/null; then
    wait "$app_pid" || true
    cat "$launch_log" >&2 || true
    echo "The copied macOS application exited before opening the PDF." >&2
    exit 1
  fi
  if [[ -f "$ready_file" ]] && grep -Fqx "$pdf" "$ready_file"; then
    echo "The universal macOS application opened $(basename "$pdf")."
    exit 0
  fi
  sleep 1
done

cat "$launch_log" >&2 || true
echo "The macOS application did not report the loaded PDF in time." >&2
exit 1
