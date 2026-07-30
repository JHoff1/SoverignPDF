#!/usr/bin/env bash

set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "Usage: $0 <path-to-AppImage>" >&2
  exit 2
fi

appimage_path="$(readlink -f "$1")"
if [[ ! -f "$appimage_path" ]]; then
  echo "AppImage not found: $appimage_path" >&2
  exit 1
fi

runtime_url="https://github.com/AppImage/type2-runtime/releases/download/continuous/runtime-x86_64"
runtime_sha256="1cc49bcf1e2ccd593c379adb17c9f85a36d619088296504de95b1d06215aebbf"
work_dir="$(mktemp -d)"

cleanup() {
  rm -rf "$work_dir"
}
trap cleanup EXIT

input_appimage="$work_dir/input.AppImage"
app_dir="$work_dir/squashfs-root"
runtime_path="$work_dir/runtime-x86_64"
squashfs_path="$work_dir/payload.squashfs"
repaired_path="$work_dir/repaired.AppImage"

cp "$appimage_path" "$input_appimage"
chmod 0755 "$input_appimage"

(
  cd "$work_dir"
  "$input_appimage" --appimage-extract >/dev/null
)

if [[ ! -x "$app_dir/AppRun" ]]; then
  chmod 0755 "$app_dir/AppRun"
fi

wrapped_path="$app_dir/AppRun.wrapped"
if [[ ! -e "$wrapped_path" ]]; then
  echo "The extracted AppImage does not contain AppRun.wrapped." >&2
  exit 1
fi

wrapped_target="$(readlink -f "$wrapped_path")"
if [[ -z "$wrapped_target" || ! -f "$wrapped_target" ]]; then
  echo "Could not resolve the AppRun.wrapped executable." >&2
  exit 1
fi
chmod 0755 "$wrapped_target"

curl --fail --location --retry 3 --silent --show-error \
  "$runtime_url" \
  --output "$runtime_path"
echo "$runtime_sha256  $runtime_path" | sha256sum --check --status
chmod 0755 "$runtime_path"

mksquashfs "$app_dir" "$squashfs_path" \
  -all-root \
  -noappend \
  -comp zstd \
  -Xcompression-level 19 \
  -quiet

cat "$runtime_path" "$squashfs_path" >"$repaired_path"
chmod 0755 "$repaired_path"

verify_dir="$work_dir/verify"
mkdir "$verify_dir"
(
  cd "$verify_dir"
  "$repaired_path" --appimage-extract >/dev/null
)

verified_app_dir="$verify_dir/squashfs-root"
verified_wrapped_target="$(readlink -f "$verified_app_dir/AppRun.wrapped")"
if [[ ! -x "$verified_app_dir/AppRun" || ! -x "$verified_wrapped_target" ]]; then
  echo "The repaired AppImage entry points are not executable." >&2
  exit 1
fi

mv "$repaired_path" "$appimage_path"
echo "Repacked AppImage with executable entry points: $appimage_path"
