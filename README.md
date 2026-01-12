# MCP Android Emulator

A Model Context Protocol (MCP) server that enables AI assistants like Claude to interact with Android devices and emulators via ADB (Android Debug Bridge).

## Features

- **Screenshots**: Capture device screen as base64 images
- **UI Inspection**: Get UI hierarchy (like DOM but for Android)
- **Touch Input**: Tap, swipe, scroll gestures
- **Text Input**: Type text into input fields
- **System Keys**: Press BACK, HOME, ENTER, etc.
- **App Management**: Launch, install, force stop, clear data
- **Logs**: Access logcat with filters
- **Wait for Elements**: Poll UI for element appearance

## Requirements

- Node.js 18+
- Android SDK with ADB installed
- Android emulator or physical device connected via ADB

## Installation

### From npm

```bash
# Using npm
npm install -g mcp-android-emulator

# Using pnpm
pnpm add -g mcp-android-emulator

# Using yarn
yarn global add mcp-android-emulator
```

### From source

```bash
git clone https://github.com/Anjos2/mcp-android-emulator.git
cd mcp-android-emulator
npm install
npm run build
```

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `ADB_PATH` | `adb` | Path to ADB executable |
| `SCREENSHOT_DIR` | `/tmp/android-screenshots` | Directory for temporary screenshots |

### Claude Code Integration

Add to your Claude Code configuration:

```bash
claude mcp add android-emulator npx mcp-android-emulator
```

Or manually edit `~/.claude.json`:

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

## Available Tools

### Screen Interaction

| Tool | Description |
|------|-------------|
| `screenshot` | Capture screen as base64 PNG image |
| `get_ui_tree` | Get UI element hierarchy with coordinates |
| `tap` | Tap at specific coordinates |
| `tap_text` | Find element by text and tap it |
| `double_tap` | Double tap at specific coordinates |
| `long_press` | Long press for context menus |
| `type_text` | Type text into focused input |
| `swipe` | Swipe between two points |
| `scroll` | Scroll in a direction (up/down/left/right) |
| `drag` | Drag gesture for drag & drop operations |
| `press_key` | Press system key (BACK, HOME, ENTER, etc.) |

### App Management

| Tool | Description |
|------|-------------|
| `launch_app` | Launch app by package name |
| `install_apk` | Install APK file |
| `list_packages` | List installed packages |
| `clear_app_data` | Clear app data |
| `force_stop` | Force stop an app |

### Device Info & Logs

| Tool | Description |
|------|-------------|
| `device_info` | Get device model, Android version, screen size |
| `get_logs` | Get logcat logs with optional filters |
| `get_current_activity` | Get currently focused activity |

### Text Input

| Tool | Description |
|------|-------------|
| `clear_input` | Clear currently focused text field |
| `select_all` | Select all text in focused field |
| `set_text` | Clear field and type new text (combines clear + type) |

### Utilities

| Tool | Description |
|------|-------------|
| `wait_for_element` | Wait for UI element to appear |

## Usage Examples

Once configured, you can ask Claude to:

```
"Take a screenshot of the Android emulator"

"Tap on the Login button"

"Type 'hello@example.com' in the email field"

"Scroll down and find the Submit button"

"Launch the Chrome app"

"Get the logs from the last minute filtered by 'error'"
```

## Running Android Emulator Headless

For server environments without a display:

```bash
emulator -avd YOUR_AVD_NAME \
    -no-window \
    -no-audio \
    -no-boot-anim \
    -gpu swiftshader_indirect \
    -memory 2048 \
    -cores 2
```

## Troubleshooting

### ADB not found

Set the `ADB_PATH` environment variable:

```bash
export ADB_PATH=/path/to/android-sdk/platform-tools/adb
```

### No devices connected

Check device connection:

```bash
adb devices
```

For emulators, ensure the emulator is running and booted:

```bash
adb shell getprop sys.boot_completed  # Should return "1"
```

### Permission denied on screenshots

Ensure the screenshot directory is writable:

```bash
mkdir -p /tmp/android-screenshots
chmod 755 /tmp/android-screenshots
```

## Development

```bash
# Install dependencies
npm install

# Build
npm run build

# Watch mode
npm run dev
```

## License

MIT License - see [LICENSE](LICENSE) for details.

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## Related Projects

- [Model Context Protocol](https://modelcontextprotocol.io/)
- [Android Debug Bridge (ADB)](https://developer.android.com/tools/adb)
- [Claude Code](https://claude.ai/claude-code)
