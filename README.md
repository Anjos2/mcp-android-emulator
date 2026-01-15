# MCP Android Emulator

[![npm version](https://badge.fury.io/js/mcp-android-emulator.svg)](https://www.npmjs.com/package/mcp-android-emulator)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

A Model Context Protocol (MCP) server that enables AI assistants like Claude to interact with Android devices and emulators via ADB (Android Debug Bridge).

## Features

- **Screenshots**: Capture device screen as base64 images
- **UI Inspection**: Get UI hierarchy (like DOM but for Android)
- **Touch Input**: Tap, swipe, scroll, pinch zoom, multi-tap gestures
- **Text Input**: Type, clear, select all, set text in input fields
- **System Keys**: Press BACK, HOME, ENTER, VOLUME, etc.
- **App Management**: Launch, install, force stop, clear data
- **Clipboard**: Get and set clipboard content
- **Device Control**: Rotate screen, get device info
- **Logs**: Access logcat with filters and log levels
- **Wait & Assert**: Wait for elements, UI stability, assertions for testing
- **Safe Interactions**: Tap avoiding system bars, element bounds detection

## Requirements

- Node.js 18+
- ADB (Android Debug Bridge) installed
- One of the following:
  - Android Studio Emulator (AVD)
  - Redroid (Docker-based Android)
  - Genymotion
  - Physical Android device via USB/WiFi

## Installation

### From npm (Recommended)

```bash
npm install -g mcp-android-emulator
```

### From source

```bash
git clone https://github.com/Anjos2/mcp-android-emulator.git
cd mcp-android-emulator
npm install
npm run build
```

## Quick Start

### 1. Ensure ADB is working

```bash
adb devices
# Should show your device/emulator
```

### 2. Add to Claude Code

```bash
claude mcp add android-emulator -- npx mcp-android-emulator
```

### 3. Start using

Ask Claude: "Take a screenshot of the Android device"

---

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `ADB_PATH` | `adb` | Path to ADB executable |
| `SCREENSHOT_DIR` | `/tmp/android-screenshots` | Directory for temporary screenshots |

### Claude Code Integration

**Option 1: CLI command**

```bash
claude mcp add android-emulator -- npx mcp-android-emulator
```

**Option 2: Manual configuration**

Edit `~/.claude.json`:

```json
{
  "mcpServers": {
    "android-emulator": {
      "command": "npx",
      "args": ["mcp-android-emulator"],
      "env": {
        "ADB_PATH": "/path/to/adb"
      }
    }
  }
}
```

### Claude Desktop Integration

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "android-emulator": {
      "command": "npx",
      "args": ["mcp-android-emulator"],
      "env": {
        "ADB_PATH": "/path/to/adb"
      }
    }
  }
}
```

---

## Available Tools (39 tools)

### Screen Capture & UI

| Tool | Description |
|------|-------------|
| `screenshot` | Capture screen as base64 PNG image |
| `get_ui_tree` | Get UI element hierarchy with coordinates |
| `get_all_text` | **NEW** Get all visible text elements on screen (for debugging) |
| `get_screen_size` | Get screen dimensions and density |
| `get_focused_element` | Get info about currently focused element |
| `is_element_visible` | Check if element is visible on screen |
| `get_element_bounds` | Get exact coordinates of an element |
| `assert_screen_contains` | Assert text is visible (for testing) |

### Touch Interactions

| Tool | Description |
|------|-------------|
| `tap` | Tap at specific coordinates |
| `tap_text` | Find element by text and tap it |
| `tap_element` | Tap element by text or resource-id (more reliable) |
| `tap_safe` | Tap avoiding system navigation bars |
| `double_tap` | Double tap at coordinates |
| `long_press` | Long press for context menus |
| `multi_tap` | Multiple rapid taps at same position |
| `swipe` | Swipe between two points |
| `scroll` | Scroll in a direction (up/down/left/right) |
| `scroll_to_text` | Scroll until text is visible |
| `drag` | Drag gesture for drag & drop |
| `pinch_zoom` | Pinch zoom gesture (zoom in/out) |

### Text Input

| Tool | Description |
|------|-------------|
| `type_text` | Type text into focused input |
| `clear_input` | Clear focused text field |
| `select_all` | Select all text in focused field |
| `set_text` | Clear and type new text (combines both) |
| `get_focused_input_value` | **NEW** Get current text value of focused input |
| `is_keyboard_visible` | **NEW** Check if soft keyboard is currently visible |

### System & Keys

| Tool | Description |
|------|-------------|
| `press_key` | Press system key (BACK, HOME, ENTER, etc.) |
| `rotate_device` | Rotate to portrait or landscape |
| `set_clipboard` | Set text to device clipboard |
| `get_clipboard` | Get clipboard content |

### App Management

| Tool | Description |
|------|-------------|
| `launch_app` | Launch app by package name |
| `install_apk` | Install APK file |
| `list_packages` | List installed packages |
| `clear_app_data` | Clear app data |
| `force_stop` | Force stop an app |
| `get_current_activity` | Get currently focused activity |

### Device Info & Logs

| Tool | Description |
|------|-------------|
| `device_info` | Get device model, Android version, screen size |
| `get_logs` | Get logcat logs with filters and log levels |

### Wait & Sync

| Tool | Description |
|------|-------------|
| `wait_for_element` | Wait for element with text to appear |
| `wait_for_element_gone` | Wait for element to disappear |
| `wait_for_ui_stable` | Wait for UI to stop changing (after animations) |

---

## Emulator Setup Guides

### Option 1: Android Studio Emulator (AVD)

Best for: Local development on machines with display

```bash
# List available AVDs
emulator -list-avds

# Start emulator
emulator -avd YOUR_AVD_NAME

# Verify connection
adb devices
```

### Option 2: Redroid (Docker) - Recommended for Servers

Best for: Headless servers, CI/CD, cloud VPS

Redroid runs Android in a Docker container without requiring KVM on x86.

```bash
# Run Redroid container
docker run -d --name redroid \
  --privileged \
  -p 5555:5555 \
  redroid/redroid:13.0.0-latest \
  androidboot.redroid_width=720 \
  androidboot.redroid_height=1280 \
  androidboot.redroid_dpi=320

# Connect ADB
adb connect localhost:5555

# Verify
adb devices
```

**For apps using network (React Native, Expo, etc.):**

```bash
# Forward ports from device to host
adb reverse tcp:8081 tcp:8081  # Metro bundler
adb reverse tcp:3000 tcp:3000  # API server
```

### Option 3: Genymotion

Best for: Local development, faster than AVD

1. Download from [genymotion.com](https://www.genymotion.com/)
2. Create and start a virtual device
3. Enable ADB bridge in settings
4. Connect: `adb connect localhost:5555`

### Option 4: Physical Device

Best for: Real-world testing

**USB Connection:**
1. Enable Developer Options on device
2. Enable USB Debugging
3. Connect via USB
4. Run `adb devices`

**WiFi Connection:**
```bash
# First connect via USB, then:
adb tcpip 5555
adb connect DEVICE_IP:5555
# Disconnect USB
```

---

## Running on Cloud/VPS Servers

### Prerequisites

- Linux server (Ubuntu 20.04+ recommended)
- Docker installed
- At least 4GB RAM, 2 CPU cores

### Step-by-Step Setup

#### 1. Install ADB

```bash
# Ubuntu/Debian
sudo apt update
sudo apt install android-tools-adb

# Verify
adb version
```

#### 2. Run Redroid

```bash
docker run -d --name redroid \
  --privileged \
  -p 5555:5555 \
  redroid/redroid:13.0.0-latest \
  androidboot.redroid_width=720 \
  androidboot.redroid_height=1280 \
  androidboot.redroid_dpi=320
```

#### 3. Connect ADB

```bash
adb connect localhost:5555
adb devices  # Should show "localhost:5555 device"
```

#### 4. Install Node.js and MCP

```bash
# Install Node.js 18+
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt install -y nodejs

# Install MCP
npm install -g mcp-android-emulator
```

#### 5. Configure Claude Code

```bash
claude mcp add android-emulator -- npx mcp-android-emulator
```

### Running AVD Headless (Alternative)

If you have KVM support:

```bash
# Install Android SDK
sudo apt install openjdk-11-jdk
wget https://dl.google.com/android/repository/commandlinetools-linux-latest.zip
# ... setup SDK ...

# Run emulator headless
emulator -avd YOUR_AVD \
  -no-window \
  -no-audio \
  -no-boot-anim \
  -gpu swiftshader_indirect \
  -memory 2048 \
  -cores 2
```

---

## Usage Examples

Once configured, ask Claude to:

```
"Take a screenshot of the Android device"

"Tap on the Login button"

"Type 'hello@example.com' in the email field and press Enter"

"Scroll down until you see 'Submit' and tap it"

"Launch the Chrome app and navigate to google.com"

"Get error logs from the last 100 lines"

"Wait for the loading spinner to disappear, then take a screenshot"

"Check if 'Welcome' text is visible on screen"

"Rotate the device to landscape mode"
```

### Automated Testing Example

```
"Test the login flow:
1. Take a screenshot of the initial state
2. Type 'testuser' in the username field
3. Type 'password123' in the password field
4. Tap the Login button
5. Wait for the UI to stabilize
6. Assert that 'Dashboard' is visible
7. Take a final screenshot"
```

---

## Troubleshooting

### ADB not found

```bash
# Check if ADB is installed
which adb

# If not found, install it
sudo apt install android-tools-adb  # Ubuntu/Debian
brew install android-platform-tools  # macOS

# Or set custom path
export ADB_PATH=/path/to/android-sdk/platform-tools/adb
```

### No devices connected

```bash
# List devices
adb devices

# If using Redroid, connect explicitly
adb connect localhost:5555

# Check if emulator is fully booted
adb shell getprop sys.boot_completed  # Should return "1"
```

### Permission denied on screenshots

```bash
mkdir -p /tmp/android-screenshots
chmod 755 /tmp/android-screenshots
```

### Redroid container won't start

```bash
# Check logs
docker logs redroid

# Ensure privileged mode
docker run --privileged ...

# Try different Android version
docker run ... redroid/redroid:11.0.0-latest
```

### Apps can't reach localhost services

```bash
# Forward ports from device to host
adb reverse tcp:8081 tcp:8081
adb reverse tcp:3000 tcp:3000

# Verify
adb reverse --list
```

---

## Changelog

### v1.3.0 (Latest)
- **New tools:**
  - `get_all_text` - Get all visible text elements on screen (useful for debugging)
  - `is_keyboard_visible` - Check if soft keyboard is currently visible
  - `get_focused_input_value` - Get current text value of focused input field
- **Improvements:**
  - `wait_for_ui_stable` - Now uses UI fingerprint instead of raw XML comparison (more reliable)
  - `get_current_activity` - Multi-method approach for compatibility with different emulators (AVD, Redroid, Genymotion, etc.)
  - `is_keyboard_visible` - Multiple detection methods with fallbacks

### v1.2.3
- Updated documentation with comprehensive setup guides
- Added emulator comparison (AVD, Redroid, Genymotion, Physical)
- Added cloud/VPS deployment instructions
- Added troubleshooting section

### v1.2.2
- Fixed `set_clipboard` and `get_clipboard` for Redroid/Docker compatibility
- Uses `/data/local/tmp` as fallback path

### v1.2.0
- Added 14 new tools:
  - `get_screen_size`, `is_element_visible`, `get_element_bounds`
  - `scroll_to_text`, `wait_for_ui_stable`, `wait_for_element_gone`
  - `multi_tap`, `pinch_zoom`, `tap_safe`, `tap_element`
  - `set_clipboard`, `get_clipboard`, `rotate_device`
  - `get_focused_element`, `assert_screen_contains`

### v1.1.0
- Added `double_tap`, `drag`, `set_text`, `select_all`, `clear_input`

### v1.0.0
- Initial release with core functionality

---

## Development

```bash
# Clone repo
git clone https://github.com/Anjos2/mcp-android-emulator.git
cd mcp-android-emulator

# Install dependencies
npm install

# Build
npm run build

# Watch mode for development
npm run dev
```

## License

MIT License - see [LICENSE](LICENSE) for details.

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

### Ideas for contributions:
- Support for multiple connected devices
- Screen recording
- File transfer (push/pull)
- Network simulation
- Battery/GPS simulation

## Related Projects

- [Model Context Protocol](https://modelcontextprotocol.io/)
- [Android Debug Bridge (ADB)](https://developer.android.com/tools/adb)
- [Claude Code](https://claude.ai/code)
- [Redroid](https://github.com/remote-android/redroid-doc)
