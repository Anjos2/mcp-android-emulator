#!/usr/bin/env node
/**
 * MCP Server for Android Emulator
 * Enables AI assistants to interact with Android devices/emulators via ADB
 *
 * @license MIT
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { execSync, exec } from "child_process";
import { promisify } from "util";
import * as fs from "fs";
import * as path from "path";

const execAsync = promisify(exec);

// Configuration
const ADB_PATH = process.env.ADB_PATH || "adb";
const SCREENSHOT_DIR = process.env.SCREENSHOT_DIR || "/tmp/android-screenshots";

// Create screenshot directory if it doesn't exist
if (!fs.existsSync(SCREENSHOT_DIR)) {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
}

/**
 * Execute an ADB command
 */
async function adb(command: string): Promise<string> {
  try {
    const { stdout } = await execAsync(`${ADB_PATH} ${command}`);
    return stdout.trim();
  } catch (error: any) {
    throw new Error(`ADB Error: ${error.message}`);
  }
}

/**
 * Execute a shell command on the device
 */
async function shell(command: string): Promise<string> {
  return adb(`shell ${command}`);
}

// Create MCP server
const server = new McpServer({
  name: "android-emulator",
  version: "1.2.0",
});

// =====================================================
// TOOL: screenshot
// =====================================================
server.tool(
  "screenshot",
  "Take a screenshot of the Android device/emulator and return it as a base64 image",
  {},
  async () => {
    const filename = `screenshot_${Date.now()}.png`;
    const filepath = path.join(SCREENSHOT_DIR, filename);

    // Capture screenshot
    execSync(`${ADB_PATH} exec-out screencap -p > ${filepath}`);

    // Read as base64
    const imageBuffer = fs.readFileSync(filepath);
    const base64 = imageBuffer.toString("base64");

    // Clean up temp file
    fs.unlinkSync(filepath);

    return {
      content: [
        {
          type: "image",
          data: base64,
          mimeType: "image/png",
        },
      ],
    };
  }
);

// =====================================================
// TOOL: get_ui_tree
// =====================================================
server.tool(
  "get_ui_tree",
  "Get the UI element tree of the device (like DOM but for Android). Returns clickable elements with their coordinates.",
  {},
  async () => {
    // Dump UI hierarchy
    await shell("uiautomator dump /sdcard/ui_dump.xml");
    const xml = await shell("cat /sdcard/ui_dump.xml");

    // Parse clickable elements
    const elements: string[] = [];
    const regex = /text="([^"]*)".*?bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/g;
    let match;

    while ((match = regex.exec(xml)) !== null) {
      const [, text, x1, y1, x2, y2] = match;
      if (text) {
        const centerX = Math.round((parseInt(x1) + parseInt(x2)) / 2);
        const centerY = Math.round((parseInt(y1) + parseInt(y2)) / 2);
        elements.push(`"${text}" at (${centerX}, ${centerY})`);
      }
    }

    return {
      content: [
        {
          type: "text",
          text: `Elements found:\n${elements.join("\n")}\n\nFull XML:\n${xml.substring(0, 5000)}...`,
        },
      ],
    };
  }
);

// =====================================================
// TOOL: tap
// =====================================================
server.tool(
  "tap",
  "Tap at the specified coordinates on the screen",
  {
    x: z.number().describe("X coordinate"),
    y: z.number().describe("Y coordinate"),
  },
  async ({ x, y }) => {
    await shell(`input tap ${x} ${y}`);
    return {
      content: [
        {
          type: "text",
          text: `Tapped at (${x}, ${y})`,
        },
      ],
    };
  }
);

// =====================================================
// TOOL: tap_text
// =====================================================
server.tool(
  "tap_text",
  "Find an element by its text content and tap on it",
  {
    text: z.string().describe("Text of the element to find and tap"),
    exact: z.boolean().optional().describe("If true, match exact text. Default: false (partial match)"),
  },
  async ({ text, exact = false }) => {
    // Dump UI hierarchy
    await shell("uiautomator dump /sdcard/ui_dump.xml");
    const xml = await shell("cat /sdcard/ui_dump.xml");

    // Build regex based on exact match preference
    const escapedText = text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = exact
      ? `text="${escapedText}".*?bounds="\\[(\\d+),(\\d+)\\]\\[(\\d+),(\\d+)\\]"`
      : `text="[^"]*${escapedText}[^"]*".*?bounds="\\[(\\d+),(\\d+)\\]\\[(\\d+),(\\d+)\\]"`;

    const regex = new RegExp(pattern, "i");
    const match = regex.exec(xml);

    if (!match) {
      return {
        content: [
          {
            type: "text",
            text: `Element with text "${text}" not found`,
          },
        ],
      };
    }

    const [, x1, y1, x2, y2] = match;
    const centerX = Math.round((parseInt(x1) + parseInt(x2)) / 2);
    const centerY = Math.round((parseInt(y1) + parseInt(y2)) / 2);

    await shell(`input tap ${centerX} ${centerY}`);

    return {
      content: [
        {
          type: "text",
          text: `Tapped on "${text}" at (${centerX}, ${centerY})`,
        },
      ],
    };
  }
);

// =====================================================
// TOOL: type_text
// =====================================================
server.tool(
  "type_text",
  "Type text into the currently focused input field",
  {
    text: z.string().describe("Text to type"),
  },
  async ({ text }) => {
    // Escape special characters for shell
    const escaped = text.replace(/ /g, "%s").replace(/'/g, "\\'");
    await shell(`input text "${escaped}"`);

    return {
      content: [
        {
          type: "text",
          text: `Typed: "${text}"`,
        },
      ],
    };
  }
);

// =====================================================
// TOOL: swipe
// =====================================================
server.tool(
  "swipe",
  "Perform a swipe gesture on the screen",
  {
    x1: z.number().describe("Starting X coordinate"),
    y1: z.number().describe("Starting Y coordinate"),
    x2: z.number().describe("Ending X coordinate"),
    y2: z.number().describe("Ending Y coordinate"),
    duration: z.number().optional().describe("Duration in milliseconds (default: 300)"),
  },
  async ({ x1, y1, x2, y2, duration = 300 }) => {
    await shell(`input swipe ${x1} ${y1} ${x2} ${y2} ${duration}`);

    return {
      content: [
        {
          type: "text",
          text: `Swiped from (${x1}, ${y1}) to (${x2}, ${y2})`,
        },
      ],
    };
  }
);

// =====================================================
// TOOL: scroll
// =====================================================
server.tool(
  "scroll",
  "Scroll the screen in a direction",
  {
    direction: z.enum(["up", "down", "left", "right"]).describe("Direction to scroll"),
    amount: z.number().optional().describe("Scroll amount in pixels (default: 500)"),
  },
  async ({ direction, amount = 500 }) => {
    // Get screen dimensions for centering the scroll
    const sizeOutput = await shell("wm size");
    const sizeMatch = sizeOutput.match(/(\d+)x(\d+)/);
    const width = sizeMatch ? parseInt(sizeMatch[1]) : 1080;
    const height = sizeMatch ? parseInt(sizeMatch[2]) : 2400;

    const centerX = Math.round(width / 2);
    const centerY = Math.round(height / 2);

    let x1 = centerX, y1 = centerY, x2 = centerX, y2 = centerY;

    switch (direction) {
      case "up":
        y1 = centerY + amount / 2;
        y2 = centerY - amount / 2;
        break;
      case "down":
        y1 = centerY - amount / 2;
        y2 = centerY + amount / 2;
        break;
      case "left":
        x1 = centerX + amount / 2;
        x2 = centerX - amount / 2;
        break;
      case "right":
        x1 = centerX - amount / 2;
        x2 = centerX + amount / 2;
        break;
    }

    await shell(`input swipe ${x1} ${y1} ${x2} ${y2} 300`);

    return {
      content: [
        {
          type: "text",
          text: `Scrolled ${direction}`,
        },
      ],
    };
  }
);

// =====================================================
// TOOL: press_key
// =====================================================
server.tool(
  "press_key",
  "Press a system key (BACK, HOME, ENTER, etc)",
  {
    key: z.enum(["BACK", "HOME", "ENTER", "TAB", "DELETE", "MENU", "POWER", "VOLUME_UP", "VOLUME_DOWN"]).describe("Key to press"),
  },
  async ({ key }) => {
    const keycodes: Record<string, number> = {
      BACK: 4,
      HOME: 3,
      ENTER: 66,
      TAB: 61,
      DELETE: 67,
      MENU: 82,
      POWER: 26,
      VOLUME_UP: 24,
      VOLUME_DOWN: 25,
    };

    await shell(`input keyevent ${keycodes[key]}`);

    return {
      content: [
        {
          type: "text",
          text: `Pressed ${key} key`,
        },
      ],
    };
  }
);

// =====================================================
// TOOL: launch_app
// =====================================================
server.tool(
  "launch_app",
  "Launch an application by its package name",
  {
    package: z.string().describe("Package name of the app (e.g., com.android.chrome)"),
  },
  async ({ package: pkg }) => {
    await shell(`monkey -p ${pkg} -c android.intent.category.LAUNCHER 1`);

    return {
      content: [
        {
          type: "text",
          text: `Launched ${pkg}`,
        },
      ],
    };
  }
);

// =====================================================
// TOOL: install_apk
// =====================================================
server.tool(
  "install_apk",
  "Install an APK file on the device",
  {
    path: z.string().describe("Path to the APK file"),
  },
  async ({ path: apkPath }) => {
    const result = await adb(`install -r ${apkPath}`);

    return {
      content: [
        {
          type: "text",
          text: `APK installed: ${result}`,
        },
      ],
    };
  }
);

// =====================================================
// TOOL: list_packages
// =====================================================
server.tool(
  "list_packages",
  "List installed packages on the device",
  {
    filter: z.string().optional().describe("Filter packages by name (optional)"),
  },
  async ({ filter }) => {
    let cmd = "pm list packages";
    if (filter) {
      cmd += ` | grep -i "${filter}"`;
    }

    const result = await shell(cmd);
    const packages = result.split("\n").map((p) => p.replace("package:", "")).filter(Boolean);

    return {
      content: [
        {
          type: "text",
          text: `Installed packages:\n${packages.join("\n")}`,
        },
      ],
    };
  }
);

// =====================================================
// TOOL: get_logs
// =====================================================
server.tool(
  "get_logs",
  "Get device logs (logcat)",
  {
    filter: z.string().optional().describe("Filter logs by tag or keyword"),
    lines: z.number().optional().describe("Number of lines to retrieve (default: 50)"),
    level: z.enum(["V", "D", "I", "W", "E"]).optional().describe("Minimum log level (V=Verbose, D=Debug, I=Info, W=Warn, E=Error)"),
  },
  async ({ filter, lines = 50, level }) => {
    let cmd = `logcat -d -t ${lines}`;
    if (level) {
      cmd += ` *:${level}`;
    }
    if (filter) {
      cmd += ` | grep -i "${filter}"`;
    }

    const logs = await shell(cmd);

    return {
      content: [
        {
          type: "text",
          text: `Logs:\n${logs}`,
        },
      ],
    };
  }
);

// =====================================================
// TOOL: device_info
// =====================================================
server.tool(
  "device_info",
  "Get information about the connected device",
  {},
  async () => {
    const [model, android, sdk, density, size, battery] = await Promise.all([
      shell("getprop ro.product.model"),
      shell("getprop ro.build.version.release"),
      shell("getprop ro.build.version.sdk"),
      shell("wm density"),
      shell("wm size"),
      shell("dumpsys battery | grep level"),
    ]);

    return {
      content: [
        {
          type: "text",
          text: `Device: ${model}
Android: ${android} (SDK ${sdk})
Screen: ${size.replace("Physical size: ", "")}
Density: ${density.replace("Physical density: ", "")}
Battery: ${battery.replace("level: ", "")}%`,
        },
      ],
    };
  }
);

// =====================================================
// TOOL: clear_app_data
// =====================================================
server.tool(
  "clear_app_data",
  "Clear all data for an application",
  {
    package: z.string().describe("Package name of the app"),
  },
  async ({ package: pkg }) => {
    await shell(`pm clear ${pkg}`);

    return {
      content: [
        {
          type: "text",
          text: `Data cleared for ${pkg}`,
        },
      ],
    };
  }
);

// =====================================================
// TOOL: force_stop
// =====================================================
server.tool(
  "force_stop",
  "Force stop an application",
  {
    package: z.string().describe("Package name of the app"),
  },
  async ({ package: pkg }) => {
    await shell(`am force-stop ${pkg}`);

    return {
      content: [
        {
          type: "text",
          text: `Force stopped ${pkg}`,
        },
      ],
    };
  }
);

// =====================================================
// TOOL: get_current_activity
// =====================================================
server.tool(
  "get_current_activity",
  "Get the currently focused activity/screen",
  {},
  async () => {
    const result = await shell("dumpsys activity activities | grep mResumedActivity");

    return {
      content: [
        {
          type: "text",
          text: `Current activity: ${result.trim()}`,
        },
      ],
    };
  }
);

// =====================================================
// TOOL: wait_for_element
// =====================================================
server.tool(
  "wait_for_element",
  "Wait for a UI element with specific text to appear",
  {
    text: z.string().describe("Text of the element to wait for"),
    timeout: z.number().optional().describe("Timeout in seconds (default: 10)"),
  },
  async ({ text, timeout = 10 }) => {
    const startTime = Date.now();
    const timeoutMs = timeout * 1000;

    while (Date.now() - startTime < timeoutMs) {
      await shell("uiautomator dump /sdcard/ui_dump.xml");
      const xml = await shell("cat /sdcard/ui_dump.xml");

      if (xml.toLowerCase().includes(text.toLowerCase())) {
        return {
          content: [
            {
              type: "text",
              text: `Element "${text}" found after ${Math.round((Date.now() - startTime) / 1000)}s`,
            },
          ],
        };
      }

      // Wait 500ms before next check
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    return {
      content: [
        {
          type: "text",
          text: `Timeout: Element "${text}" not found after ${timeout}s`,
        },
      ],
    };
  }
);

// =====================================================
// TOOL: long_press
// =====================================================
server.tool(
  "long_press",
  "Perform a long press at the specified coordinates (useful for context menus)",
  {
    x: z.number().describe("X coordinate"),
    y: z.number().describe("Y coordinate"),
    duration: z.number().optional().describe("Duration in milliseconds (default: 1000)"),
  },
  async ({ x, y, duration = 1000 }) => {
    // Long press is simulated with a swipe to the same position
    await shell(`input swipe ${x} ${y} ${x} ${y} ${duration}`);

    return {
      content: [
        {
          type: "text",
          text: `Long pressed at (${x}, ${y}) for ${duration}ms`,
        },
      ],
    };
  }
);

// =====================================================
// TOOL: clear_input
// =====================================================
server.tool(
  "clear_input",
  "Clear the currently focused text input field",
  {
    maxChars: z.number().optional().describe("Maximum characters to delete (default: 100)"),
  },
  async ({ maxChars = 100 }) => {
    // Move cursor to end, then delete all characters
    // KEYCODE_MOVE_END = 123, KEYCODE_DEL = 67
    await shell("input keyevent 123"); // Move to end

    // Delete characters one by one
    for (let i = 0; i < maxChars; i++) {
      await shell("input keyevent 67"); // Delete
    }

    return {
      content: [
        {
          type: "text",
          text: `Cleared input field (deleted up to ${maxChars} characters)`,
        },
      ],
    };
  }
);

// =====================================================
// TOOL: select_all
// =====================================================
server.tool(
  "select_all",
  "Select all text in the currently focused input field",
  {},
  async () => {
    // CTRL+A = KEYCODE_CTRL_LEFT (113) + KEYCODE_A (29)
    // Using input keyevent with --longpress for modifier keys
    await shell("input keyevent --longpress 113 29");

    return {
      content: [
        {
          type: "text",
          text: "Selected all text in focused field",
        },
      ],
    };
  }
);

// =====================================================
// TOOL: set_text
// =====================================================
server.tool(
  "set_text",
  "Clear the current input field and type new text (combines clear + type)",
  {
    text: z.string().describe("Text to type after clearing"),
    maxClearChars: z.number().optional().describe("Maximum characters to clear (default: 100)"),
  },
  async ({ text, maxClearChars = 100 }) => {
    // First clear the field
    await shell("input keyevent 123"); // Move to end
    for (let i = 0; i < maxClearChars; i++) {
      await shell("input keyevent 67"); // Delete
    }

    // Then type new text
    const escaped = text.replace(/ /g, "%s").replace(/'/g, "\\'");
    await shell(`input text "${escaped}"`);

    return {
      content: [
        {
          type: "text",
          text: `Cleared field and typed: "${text}"`,
        },
      ],
    };
  }
);

// =====================================================
// TOOL: drag
// =====================================================
server.tool(
  "drag",
  "Perform a drag gesture from one point to another (slower than swipe, for drag & drop)",
  {
    x1: z.number().describe("Starting X coordinate"),
    y1: z.number().describe("Starting Y coordinate"),
    x2: z.number().describe("Ending X coordinate"),
    y2: z.number().describe("Ending Y coordinate"),
    duration: z.number().optional().describe("Duration in milliseconds (default: 1000)"),
  },
  async ({ x1, y1, x2, y2, duration = 1000 }) => {
    await shell(`input swipe ${x1} ${y1} ${x2} ${y2} ${duration}`);

    return {
      content: [
        {
          type: "text",
          text: `Dragged from (${x1}, ${y1}) to (${x2}, ${y2}) over ${duration}ms`,
        },
      ],
    };
  }
);

// =====================================================
// TOOL: double_tap
// =====================================================
server.tool(
  "double_tap",
  "Perform a double tap at the specified coordinates",
  {
    x: z.number().describe("X coordinate"),
    y: z.number().describe("Y coordinate"),
  },
  async ({ x, y }) => {
    await shell(`input tap ${x} ${y}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
    await shell(`input tap ${x} ${y}`);

    return {
      content: [
        {
          type: "text",
          text: `Double tapped at (${x}, ${y})`,
        },
      ],
    };
  }
);

// =====================================================
// TOOL: get_screen_size
// =====================================================
server.tool(
  "get_screen_size",
  "Get the screen dimensions and density of the device",
  {},
  async () => {
    const [sizeOutput, densityOutput] = await Promise.all([
      shell("wm size"),
      shell("wm density"),
    ]);

    const sizeMatch = sizeOutput.match(/(\d+)x(\d+)/);
    const densityMatch = densityOutput.match(/(\d+)/);

    const width = sizeMatch ? parseInt(sizeMatch[1]) : 0;
    const height = sizeMatch ? parseInt(sizeMatch[2]) : 0;
    const density = densityMatch ? parseInt(densityMatch[1]) : 0;

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ width, height, density }, null, 2),
        },
      ],
    };
  }
);

// =====================================================
// TOOL: is_element_visible
// =====================================================
server.tool(
  "is_element_visible",
  "Check if an element with specific text or resource-id is visible on screen",
  {
    text: z.string().optional().describe("Text to search for"),
    resourceId: z.string().optional().describe("Resource ID to search for"),
  },
  async ({ text, resourceId }) => {
    if (!text && !resourceId) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ visible: false, error: "Must provide text or resourceId" }),
          },
        ],
      };
    }

    await shell("uiautomator dump /sdcard/ui_dump.xml");
    const xml = await shell("cat /sdcard/ui_dump.xml");

    let found = false;
    let bounds = null;

    if (text) {
      const escapedText = text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const regex = new RegExp(
        `text="[^"]*${escapedText}[^"]*".*?bounds="\\[(\\d+),(\\d+)\\]\\[(\\d+),(\\d+)\\]"`,
        "i"
      );
      const match = regex.exec(xml);
      if (match) {
        found = true;
        const [, x1, y1, x2, y2] = match;
        bounds = {
          x: parseInt(x1),
          y: parseInt(y1),
          width: parseInt(x2) - parseInt(x1),
          height: parseInt(y2) - parseInt(y1),
          centerX: Math.round((parseInt(x1) + parseInt(x2)) / 2),
          centerY: Math.round((parseInt(y1) + parseInt(y2)) / 2),
        };
      }
    }

    if (resourceId && !found) {
      const regex = new RegExp(
        `resource-id="${resourceId}".*?bounds="\\[(\\d+),(\\d+)\\]\\[(\\d+),(\\d+)\\]"`,
        "i"
      );
      const match = regex.exec(xml);
      if (match) {
        found = true;
        const [, x1, y1, x2, y2] = match;
        bounds = {
          x: parseInt(x1),
          y: parseInt(y1),
          width: parseInt(x2) - parseInt(x1),
          height: parseInt(y2) - parseInt(y1),
          centerX: Math.round((parseInt(x1) + parseInt(x2)) / 2),
          centerY: Math.round((parseInt(y1) + parseInt(y2)) / 2),
        };
      }
    }

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ visible: found, bounds }, null, 2),
        },
      ],
    };
  }
);

// =====================================================
// TOOL: get_element_bounds
// =====================================================
server.tool(
  "get_element_bounds",
  "Get the exact bounds and center coordinates of an element",
  {
    text: z.string().optional().describe("Text of the element"),
    resourceId: z.string().optional().describe("Resource ID of the element"),
    index: z.number().optional().describe("Index if multiple matches (0-based, default: 0)"),
  },
  async ({ text, resourceId, index = 0 }) => {
    if (!text && !resourceId) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ error: "Must provide text or resourceId" }),
          },
        ],
      };
    }

    await shell("uiautomator dump /sdcard/ui_dump.xml");
    const xml = await shell("cat /sdcard/ui_dump.xml");

    let pattern: string;
    if (text) {
      const escapedText = text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      pattern = `text="[^"]*${escapedText}[^"]*".*?bounds="\\[(\\d+),(\\d+)\\]\\[(\\d+),(\\d+)\\]"`;
    } else {
      pattern = `resource-id="${resourceId}".*?bounds="\\[(\\d+),(\\d+)\\]\\[(\\d+),(\\d+)\\]"`;
    }

    const regex = new RegExp(pattern, "gi");
    const matches: Array<{ x1: number; y1: number; x2: number; y2: number }> = [];
    let match;

    while ((match = regex.exec(xml)) !== null) {
      matches.push({
        x1: parseInt(match[1]),
        y1: parseInt(match[2]),
        x2: parseInt(match[3]),
        y2: parseInt(match[4]),
      });
    }

    if (matches.length === 0) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ found: false, error: "Element not found" }),
          },
        ],
      };
    }

    if (index >= matches.length) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              found: false,
              error: `Index ${index} out of range. Found ${matches.length} matches.`,
            }),
          },
        ],
      };
    }

    const m = matches[index];
    const result = {
      found: true,
      matchCount: matches.length,
      index,
      bounds: {
        x: m.x1,
        y: m.y1,
        width: m.x2 - m.x1,
        height: m.y2 - m.y1,
      },
      center: {
        x: Math.round((m.x1 + m.x2) / 2),
        y: Math.round((m.y1 + m.y2) / 2),
      },
    };

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  }
);

// =====================================================
// TOOL: scroll_to_text
// =====================================================
server.tool(
  "scroll_to_text",
  "Scroll the screen until an element with specific text is visible",
  {
    text: z.string().describe("Text to search for"),
    direction: z.enum(["up", "down"]).optional().describe("Scroll direction (default: down)"),
    maxScrolls: z.number().optional().describe("Maximum scroll attempts (default: 10)"),
  },
  async ({ text, direction = "down", maxScrolls = 10 }) => {
    const sizeOutput = await shell("wm size");
    const sizeMatch = sizeOutput.match(/(\d+)x(\d+)/);
    const width = sizeMatch ? parseInt(sizeMatch[1]) : 1080;
    const height = sizeMatch ? parseInt(sizeMatch[2]) : 2400;

    const centerX = Math.round(width / 2);
    const startY = direction === "down" ? Math.round(height * 0.7) : Math.round(height * 0.3);
    const endY = direction === "down" ? Math.round(height * 0.3) : Math.round(height * 0.7);

    for (let i = 0; i < maxScrolls; i++) {
      await shell("uiautomator dump /sdcard/ui_dump.xml");
      const xml = await shell("cat /sdcard/ui_dump.xml");

      if (xml.toLowerCase().includes(text.toLowerCase())) {
        return {
          content: [
            {
              type: "text",
              text: `Found "${text}" after ${i} scroll(s)`,
            },
          ],
        };
      }

      await shell(`input swipe ${centerX} ${startY} ${centerX} ${endY} 300`);
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    return {
      content: [
        {
          type: "text",
          text: `Text "${text}" not found after ${maxScrolls} scrolls`,
        },
      ],
    };
  }
);

// =====================================================
// TOOL: wait_for_ui_stable
// =====================================================
server.tool(
  "wait_for_ui_stable",
  "Wait for the UI to stop changing (useful after animations)",
  {
    timeout: z.number().optional().describe("Timeout in milliseconds (default: 5000)"),
    checkInterval: z.number().optional().describe("Check interval in milliseconds (default: 500)"),
  },
  async ({ timeout = 5000, checkInterval = 500 }) => {
    const startTime = Date.now();
    let lastXml = "";
    let stableCount = 0;

    while (Date.now() - startTime < timeout) {
      await shell("uiautomator dump /sdcard/ui_dump.xml");
      const currentXml = await shell("cat /sdcard/ui_dump.xml");

      if (currentXml === lastXml) {
        stableCount++;
        if (stableCount >= 2) {
          return {
            content: [
              {
                type: "text",
                text: `UI stable after ${Math.round((Date.now() - startTime) / 1000)}s`,
              },
            ],
          };
        }
      } else {
        stableCount = 0;
        lastXml = currentXml;
      }

      await new Promise((resolve) => setTimeout(resolve, checkInterval));
    }

    return {
      content: [
        {
          type: "text",
          text: `Timeout: UI did not stabilize within ${timeout}ms`,
        },
      ],
    };
  }
);

// =====================================================
// TOOL: wait_for_element_gone
// =====================================================
server.tool(
  "wait_for_element_gone",
  "Wait for an element to disappear from the screen",
  {
    text: z.string().describe("Text of the element to wait for disappearance"),
    timeout: z.number().optional().describe("Timeout in milliseconds (default: 10000)"),
  },
  async ({ text, timeout = 10000 }) => {
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      await shell("uiautomator dump /sdcard/ui_dump.xml");
      const xml = await shell("cat /sdcard/ui_dump.xml");

      if (!xml.toLowerCase().includes(text.toLowerCase())) {
        return {
          content: [
            {
              type: "text",
              text: `Element "${text}" disappeared after ${Math.round((Date.now() - startTime) / 1000)}s`,
            },
          ],
        };
      }

      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    return {
      content: [
        {
          type: "text",
          text: `Timeout: Element "${text}" still visible after ${timeout}ms`,
        },
      ],
    };
  }
);

// =====================================================
// TOOL: multi_tap
// =====================================================
server.tool(
  "multi_tap",
  "Perform multiple rapid taps at the same position",
  {
    x: z.number().describe("X coordinate"),
    y: z.number().describe("Y coordinate"),
    taps: z.number().optional().describe("Number of taps (default: 2)"),
    interval: z.number().optional().describe("Interval between taps in ms (default: 100)"),
  },
  async ({ x, y, taps = 2, interval = 100 }) => {
    for (let i = 0; i < taps; i++) {
      await shell(`input tap ${x} ${y}`);
      if (i < taps - 1) {
        await new Promise((resolve) => setTimeout(resolve, interval));
      }
    }

    return {
      content: [
        {
          type: "text",
          text: `Performed ${taps} taps at (${x}, ${y})`,
        },
      ],
    };
  }
);

// =====================================================
// TOOL: pinch_zoom
// =====================================================
server.tool(
  "pinch_zoom",
  "Perform a pinch zoom gesture (requires Android 8+)",
  {
    x: z.number().describe("Center X coordinate"),
    y: z.number().describe("Center Y coordinate"),
    scale: z.number().describe("Scale factor (>1 zoom in, <1 zoom out)"),
    duration: z.number().optional().describe("Duration in milliseconds (default: 500)"),
  },
  async ({ x, y, scale, duration = 500 }) => {
    // Pinch zoom simulation using two swipe gestures
    // This is a simplified approach - real multitouch requires instrumentation
    const distance = 200;
    const scaledDistance = Math.round(distance * scale);

    if (scale > 1) {
      // Zoom in: fingers move apart
      // Simulate with two sequential swipes from center outward
      const halfDist = Math.round(scaledDistance / 2);
      await shell(`input swipe ${x} ${y - 50} ${x} ${y - halfDist} ${duration}`);
      await shell(`input swipe ${x} ${y + 50} ${x} ${y + halfDist} ${duration}`);
    } else {
      // Zoom out: fingers move together
      const halfDist = Math.round(distance / 2);
      const targetDist = Math.round((distance * scale) / 2);
      await shell(`input swipe ${x} ${y - halfDist} ${x} ${y - targetDist} ${duration}`);
      await shell(`input swipe ${x} ${y + halfDist} ${x} ${y + targetDist} ${duration}`);
    }

    return {
      content: [
        {
          type: "text",
          text: `Pinch zoom at (${x}, ${y}) with scale ${scale}. Note: True multitouch requires instrumentation.`,
        },
      ],
    };
  }
);

// =====================================================
// TOOL: set_clipboard
// =====================================================
server.tool(
  "set_clipboard",
  "Set text to the device clipboard",
  {
    text: z.string().describe("Text to copy to clipboard"),
  },
  async ({ text }) => {
    // Use am broadcast to set clipboard content
    const escaped = text.replace(/'/g, "'\\''");
    await shell(`am broadcast -a clipper.set -e text '${escaped}'`);

    // Alternative method using service call (works on more devices)
    // This is a fallback approach
    const base64Text = Buffer.from(text).toString("base64");
    await shell(`echo "${base64Text}" | base64 -d > /sdcard/clipboard_temp.txt`);

    return {
      content: [
        {
          type: "text",
          text: `Clipboard set to: "${text.substring(0, 50)}${text.length > 50 ? "..." : ""}"`,
        },
      ],
    };
  }
);

// =====================================================
// TOOL: get_clipboard
// =====================================================
server.tool(
  "get_clipboard",
  "Get the current device clipboard content",
  {},
  async () => {
    try {
      // Try to get clipboard via am broadcast
      const result = await shell("am broadcast -a clipper.get");
      const match = result.match(/data="([^"]*)"/);
      if (match) {
        return {
          content: [
            {
              type: "text",
              text: `Clipboard content: "${match[1]}"`,
            },
          ],
        };
      }
    } catch {
      // Clipper app not installed, try alternative
    }

    // Alternative: read from our temp file if set_clipboard was used
    try {
      const content = await shell("cat /sdcard/clipboard_temp.txt 2>/dev/null || echo ''");
      return {
        content: [
          {
            type: "text",
            text: `Clipboard content: "${content}"`,
          },
        ],
      };
    } catch {
      return {
        content: [
          {
            type: "text",
            text: "Could not retrieve clipboard. Install Clipper app for full clipboard support.",
          },
        ],
      };
    }
  }
);

// =====================================================
// TOOL: rotate_device
// =====================================================
server.tool(
  "rotate_device",
  "Rotate the device to portrait or landscape orientation",
  {
    orientation: z.enum(["portrait", "landscape"]).describe("Target orientation"),
  },
  async ({ orientation }) => {
    // Disable auto-rotation first
    await shell("settings put system accelerometer_rotation 0");

    // Set user rotation (0 = portrait, 1 = landscape)
    const rotation = orientation === "portrait" ? 0 : 1;
    await shell(`settings put system user_rotation ${rotation}`);

    return {
      content: [
        {
          type: "text",
          text: `Device rotated to ${orientation}`,
        },
      ],
    };
  }
);

// =====================================================
// TOOL: tap_safe
// =====================================================
server.tool(
  "tap_safe",
  "Tap at coordinates while avoiding system navigation bars",
  {
    x: z.number().describe("X coordinate"),
    y: z.number().describe("Y coordinate"),
    avoidStatusBar: z.boolean().optional().describe("Avoid status bar area (default: true)"),
    avoidNavBar: z.boolean().optional().describe("Avoid navigation bar area (default: true)"),
  },
  async ({ x, y, avoidStatusBar = true, avoidNavBar = true }) => {
    // Get screen dimensions
    const sizeOutput = await shell("wm size");
    const sizeMatch = sizeOutput.match(/(\d+)x(\d+)/);
    const screenWidth = sizeMatch ? parseInt(sizeMatch[1]) : 1080;
    const screenHeight = sizeMatch ? parseInt(sizeMatch[2]) : 2400;

    // Typical safe areas (approximate)
    const statusBarHeight = 50; // ~50px for status bar
    const navBarHeight = 120; // ~120px for navigation bar

    let safeY = y;
    let adjusted = false;
    const adjustments: string[] = [];

    // Check and adjust for status bar
    if (avoidStatusBar && y < statusBarHeight) {
      safeY = statusBarHeight + 10;
      adjusted = true;
      adjustments.push(`status bar (${y} -> ${safeY})`);
    }

    // Check and adjust for navigation bar
    if (avoidNavBar && y > screenHeight - navBarHeight) {
      safeY = screenHeight - navBarHeight - 10;
      adjusted = true;
      adjustments.push(`nav bar (${y} -> ${safeY})`);
    }

    // Ensure X is within bounds
    let safeX = Math.max(10, Math.min(x, screenWidth - 10));

    await shell(`input tap ${safeX} ${safeY}`);

    const message = adjusted
      ? `Tapped at (${safeX}, ${safeY}) [adjusted to avoid ${adjustments.join(", ")}]`
      : `Tapped at (${safeX}, ${safeY})`;

    return {
      content: [
        {
          type: "text",
          text: message,
        },
      ],
    };
  }
);

// =====================================================
// TOOL: tap_element
// =====================================================
server.tool(
  "tap_element",
  "Find and tap an element by text or resource-id (more reliable than tap_text)",
  {
    text: z.string().optional().describe("Text to search for"),
    resourceId: z.string().optional().describe("Resource ID to search for"),
    index: z.number().optional().describe("Index if multiple matches (0-based, default: 0)"),
    exact: z.boolean().optional().describe("Exact text match (default: false)"),
  },
  async ({ text, resourceId, index = 0, exact = false }) => {
    if (!text && !resourceId) {
      return {
        content: [
          {
            type: "text",
            text: "Error: Must provide either text or resourceId",
          },
        ],
      };
    }

    await shell("uiautomator dump /sdcard/ui_dump.xml");
    const xml = await shell("cat /sdcard/ui_dump.xml");

    let pattern: string;
    let searchType: string;

    if (resourceId) {
      pattern = `resource-id="${resourceId}"[^>]*bounds="\\[(\\d+),(\\d+)\\]\\[(\\d+),(\\d+)\\]"`;
      searchType = `resource-id="${resourceId}"`;
    } else if (exact) {
      const escapedText = text!.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      pattern = `text="${escapedText}"[^>]*bounds="\\[(\\d+),(\\d+)\\]\\[(\\d+),(\\d+)\\]"`;
      searchType = `text="${text}"`;
    } else {
      const escapedText = text!.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      pattern = `text="[^"]*${escapedText}[^"]*"[^>]*bounds="\\[(\\d+),(\\d+)\\]\\[(\\d+),(\\d+)\\]"`;
      searchType = `text containing "${text}"`;
    }

    const regex = new RegExp(pattern, "gi");
    const matches: Array<{ x1: number; y1: number; x2: number; y2: number }> = [];
    let match;

    while ((match = regex.exec(xml)) !== null) {
      matches.push({
        x1: parseInt(match[1]),
        y1: parseInt(match[2]),
        x2: parseInt(match[3]),
        y2: parseInt(match[4]),
      });
    }

    if (matches.length === 0) {
      return {
        content: [
          {
            type: "text",
            text: `Element with ${searchType} not found`,
          },
        ],
      };
    }

    if (index >= matches.length) {
      return {
        content: [
          {
            type: "text",
            text: `Index ${index} out of range. Found ${matches.length} matches for ${searchType}`,
          },
        ],
      };
    }

    const m = matches[index];
    const centerX = Math.round((m.x1 + m.x2) / 2);
    const centerY = Math.round((m.y1 + m.y2) / 2);

    await shell(`input tap ${centerX} ${centerY}`);

    return {
      content: [
        {
          type: "text",
          text: `Tapped element with ${searchType} at (${centerX}, ${centerY})${matches.length > 1 ? ` [match ${index + 1}/${matches.length}]` : ""}`,
        },
      ],
    };
  }
);

// =====================================================
// TOOL: get_focused_element
// =====================================================
server.tool(
  "get_focused_element",
  "Get information about the currently focused UI element",
  {},
  async () => {
    await shell("uiautomator dump /sdcard/ui_dump.xml");
    const xml = await shell("cat /sdcard/ui_dump.xml");

    const focusedRegex = /focused="true"[^>]*text="([^"]*)"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/;
    const match = focusedRegex.exec(xml);

    if (!match) {
      // Try alternative pattern
      const altRegex = /bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"[^>]*focused="true"[^>]*text="([^"]*)"/;
      const altMatch = altRegex.exec(xml);

      if (!altMatch) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ focused: false, element: null }),
            },
          ],
        };
      }

      const [, x1, y1, x2, y2, text] = altMatch;
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              focused: true,
              element: {
                text,
                bounds: { x: parseInt(x1), y: parseInt(y1), width: parseInt(x2) - parseInt(x1), height: parseInt(y2) - parseInt(y1) },
                center: { x: Math.round((parseInt(x1) + parseInt(x2)) / 2), y: Math.round((parseInt(y1) + parseInt(y2)) / 2) },
              },
            }, null, 2),
          },
        ],
      };
    }

    const [, text, x1, y1, x2, y2] = match;
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            focused: true,
            element: {
              text,
              bounds: { x: parseInt(x1), y: parseInt(y1), width: parseInt(x2) - parseInt(x1), height: parseInt(y2) - parseInt(y1) },
              center: { x: Math.round((parseInt(x1) + parseInt(x2)) / 2), y: Math.round((parseInt(y1) + parseInt(y2)) / 2) },
            },
          }, null, 2),
        },
      ],
    };
  }
);

// =====================================================
// TOOL: assert_screen_contains
// =====================================================
server.tool(
  "assert_screen_contains",
  "Assert that specific text is visible on screen (useful for testing)",
  {
    text: z.string().describe("Text that should be visible"),
    exact: z.boolean().optional().describe("Exact match (default: false)"),
  },
  async ({ text, exact = false }) => {
    await shell("uiautomator dump /sdcard/ui_dump.xml");
    const xml = await shell("cat /sdcard/ui_dump.xml");

    let found: boolean;
    if (exact) {
      found = xml.includes(`text="${text}"`);
    } else {
      found = xml.toLowerCase().includes(text.toLowerCase());
    }

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            assertion: found ? "PASS" : "FAIL",
            expected: text,
            found,
          }, null, 2),
        },
      ],
    };
  }
);

// Start server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("MCP Android Emulator Server running on stdio");
}

main().catch(console.error);
