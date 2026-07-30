#!/usr/bin/env bash
set -Eeuo pipefail

if [[ $# -lt 4 || $# -gt 5 ]]; then
  echo "Usage: $0 <label> <executable> <pdf> <artifact-directory> [desktop-entry]" >&2
  exit 2
fi

label="$1"
executable="$(realpath "$2")"
pdf="$(realpath "$3")"
artifact_dir="$(realpath -m "$4")"
desktop_entry="${5:-}"

if [[ ! -x "$executable" ]]; then
  echo "Executable is missing or not runnable: $executable" >&2
  exit 1
fi
if [[ ! -f "$pdf" ]]; then
  echo "Smoke-test PDF is missing: $pdf" >&2
  exit 1
fi
if [[ -n "$desktop_entry" ]]; then
  desktop_entry="$(realpath "$desktop_entry")"
  if [[ ! -f "$desktop_entry" ]]; then
    echo "Desktop entry is missing: $desktop_entry" >&2
    exit 1
  fi
fi

mkdir -p "$artifact_dir"
export VERITYPDF_SMOKE_LABEL="$label"
export VERITYPDF_SMOKE_EXECUTABLE="$executable"
export VERITYPDF_SMOKE_PDF="$pdf"
export VERITYPDF_SMOKE_READY_FILE="$artifact_dir/${label}-ready.txt"
export VERITYPDF_SMOKE_LOG="$artifact_dir/${label}-launch.log"
export VERITYPDF_SMOKE_SCREENSHOT="$artifact_dir/${label}-failure.png"
export VERITYPDF_SMOKE_DESKTOP_ENTRY="$desktop_entry"
rm -f "$VERITYPDF_SMOKE_READY_FILE" "$VERITYPDF_SMOKE_SCREENSHOT"

xvfb-run -a -s "-screen 0 1440x900x24" bash -Eeuo pipefail -c '
  app_pid=""
  launcher_pid=""
  direct_launch=true
  if [[ -n "$VERITYPDF_SMOKE_DESKTOP_ENTRY" ]]; then
    direct_launch=false
    gio launch "$VERITYPDF_SMOKE_DESKTOP_ENTRY" "$VERITYPDF_SMOKE_PDF" \
      >"$VERITYPDF_SMOKE_LOG" 2>&1 &
    launcher_pid=$!
  else
    "$VERITYPDF_SMOKE_EXECUTABLE" "$VERITYPDF_SMOKE_PDF" \
      >"$VERITYPDF_SMOKE_LOG" 2>&1 &
    app_pid=$!
  fi

  cleanup() {
    if [[ -n "$app_pid" ]] && kill -0 "$app_pid" 2>/dev/null; then
      kill "$app_pid" 2>/dev/null || true
      wait "$app_pid" 2>/dev/null || true
    fi
    if [[ -n "$launcher_pid" ]] && kill -0 "$launcher_pid" 2>/dev/null; then
      kill "$launcher_pid" 2>/dev/null || true
      wait "$launcher_pid" 2>/dev/null || true
    fi
  }
  capture_failure() {
    import -window root "$VERITYPDF_SMOKE_SCREENSHOT" 2>/dev/null || true
    echo "Visible X11 windows:" >&2
    xwininfo -root -tree >&2 || true
    echo "Application log:" >&2
    cat "$VERITYPDF_SMOKE_LOG" >&2 || true
  }
  trap cleanup EXIT

  expected_title="$(basename "$VERITYPDF_SMOKE_PDF")"
  for _ in $(seq 1 45); do
    if [[ "$direct_launch" == true ]] && ! kill -0 "$app_pid" 2>/dev/null; then
      wait "$app_pid" || true
      capture_failure
      echo "$VERITYPDF_SMOKE_LABEL exited before opening the PDF." >&2
      exit 1
    fi

    loaded=false
    if [[ -f "$VERITYPDF_SMOKE_READY_FILE" ]] &&
       grep -Fqx "$VERITYPDF_SMOKE_PDF" "$VERITYPDF_SMOKE_READY_FILE"; then
      loaded=true
    fi

    visible=false
    while IFS= read -r window_id; do
      [[ -n "$window_id" ]] || continue
      window_title="$(xdotool getwindowname "$window_id" 2>/dev/null || true)"
      if [[ "$window_title" == *"$expected_title"* ]] &&
         [[ "$window_title" == *"VerityPDF"* ]]; then
        app_pid="$(xdotool getwindowpid "$window_id" 2>/dev/null || true)"
        visible=true
        break
      fi
    done < <(xdotool search --onlyvisible --name "VerityPDF" 2>/dev/null || true)

    if [[ "$loaded" == true && "$visible" == true ]] &&
       [[ -n "$app_pid" ]] && kill -0 "$app_pid" 2>/dev/null; then
      echo "$VERITYPDF_SMOKE_LABEL opened $expected_title in a visible window."
      exit 0
    fi
    sleep 1
  done

  capture_failure
  echo "$VERITYPDF_SMOKE_LABEL did not expose a loaded VerityPDF window in time." >&2
  exit 1
'
