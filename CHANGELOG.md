# Changelog

## 2.0.0 — 2026-04-19

### Security (breaking)

- **Eliminated command injection across the MCP tool surface.** Issue #1
  reported an injection vector in `launch_app`; the underlying anti-pattern
  affected every tool that interpolated LLM-controlled input into a template
  string passed to `child_process.exec`. This release rebuilds the ADB
  execution layer from scratch and validates every LLM input before it
  reaches the device shell.

### Changed

- New module `src/adb/runner.ts` — wraps `child_process.execFile` (not `exec`),
  so arguments are never re-parsed by `/bin/sh` on the host regardless of
  their contents.
- New module `src/adb/validators.ts` — strict zod allowlists for every
  LLM-controlled input: Android package names, APK paths, resource-ids,
  typeable text, search filters, coordinates, and durations.
- `list_packages` and `get_logs` no longer use shell pipes. Filtering is
  applied in JavaScript after collecting the full output from `adb shell`.
- `type_text` and `set_text` now enforce an allowlist of alphanumerics,
  spaces, and common punctuation (`.,:/_-@+=?!#%*[]{}`). Shell
  metacharacters are rejected at the schema layer.
- `set_clipboard` writes the payload via fully argv-separated shell
  invocations; no user-controlled pipes.
- Dependencies are now pinned to exact versions (`npm audit` → 0
  vulnerabilities).
- Version bumped to **2.0.0** — some inputs previously accepted are now
  rejected by the stricter allowlists. Consumers relying on symbols
  outside the allowlist must update their calls.

### Added

- `test/validators.test.ts` — covers positive and negative cases for
  every allowlist, including shell-metachar payloads.
- `test/runner.test.ts` — empirically verifies that `execFile` does not
  reinterpret metacharacters on the host (Linux/macOS; skipped on Windows
  because `execFile` requires `shell:true` to run `.cmd` scripts, which
  defeats the purpose of the test there).
- `SECURITY.md` — responsible disclosure policy.

### Migration notes

- If your automation passed package names or paths with characters outside
  the Android spec (`^[a-zA-Z_][a-zA-Z0-9_]*(\.[a-zA-Z_][a-zA-Z0-9_]*)+$`
  for packages, `.apk` extension and no shell metacharacters for paths),
  those calls will now fail validation. Update them to the canonical form.
- `type_text` / `set_text`: if you need to type characters outside the
  current allowlist, file an issue describing the use case — we are open
  to extending the allowlist once we understand the need.

## 1.4.0

- **New tools:**
  - `get_clickable_elements` - Get all clickable elements with text, resource-id, class, and coordinates. Useful when `tap_text` fails to find an element.

## 1.3.0

- **New tools:**
  - `get_all_text` - Get all visible text elements on screen (useful for debugging)
  - `is_keyboard_visible` - Check if soft keyboard is currently visible
  - `get_focused_input_value` - Get current text value of focused input field
- **Improvements:**
  - `wait_for_ui_stable` - Now uses UI fingerprint instead of raw XML comparison (more reliable)
  - `get_current_activity` - Multi-method approach for compatibility with different emulators (AVD, Redroid, Genymotion, etc.)
  - `is_keyboard_visible` - Multiple detection methods with fallbacks

## 1.2.3

- Updated documentation with comprehensive setup guides
- Added emulator comparison (AVD, Redroid, Genymotion, Physical)
- Added cloud/VPS deployment instructions
- Added troubleshooting section

## 1.2.2

- Fixed `set_clipboard` and `get_clipboard` for Redroid/Docker compatibility
- Uses `/data/local/tmp` as fallback path

## 1.2.0

- Added 14 new tools: `get_screen_size`, `is_element_visible`, `get_element_bounds`, `scroll_to_text`, `wait_for_ui_stable`, `wait_for_element_gone`, `multi_tap`, `pinch_zoom`, `tap_safe`, `tap_element`, `set_clipboard`, `get_clipboard`, `rotate_device`, `get_focused_element`, `assert_screen_contains`.

## 1.1.0

- Added `double_tap`, `drag`, `set_text`, `select_all`, `clear_input`.

## 1.0.0

- Initial release with core functionality.
