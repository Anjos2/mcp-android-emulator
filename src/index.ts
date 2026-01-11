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
  version: "1.0.0",
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

// Start server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("MCP Android Emulator Server running on stdio");
}

main().catch(console.error);
