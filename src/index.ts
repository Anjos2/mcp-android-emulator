#!/usr/bin/env node
/**
 * MCP Server for Android Emulator.
 *
 * Finalidad:
 *   Expone 43 tools MCP que permiten a un asistente LLM controlar un device
 *   Android vía ADB (screenshot, tap, type, launch apps, logs, asserts...).
 *
 * Interrelación:
 *   - src/adb/runner.ts    → ejecución segura de adb (execFile, sin shell del host).
 *   - src/adb/validators.ts → allowlists zod para inputs que llegan al sh del device.
 *   - test/                 → smoke tests que validan que payloads shell-metachar son
 *                             rechazados por los validators y que los argv construidos
 *                             son los esperados.
 *
 * Seguridad:
 *   Fix de la issue #1 (command injection). TODOS los argumentos derivados del
 *   LLM pasan por zod.refine antes de llegar al runner, y el runner usa execFile
 *   (no exec), por lo que /bin/sh del host nunca reinterpreta la línea de comando.
 *
 * @license MIT
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
  runAdb,
  runAdbShell,
  runAdbExecOutBinary,
} from "./adb/runner.js";
import {
  packageNameSchema,
  apkPathSchema,
  resourceIdSchema,
  freeTextSchema,
  typeableTextSchema,
  searchFilterSchema,
  positiveCountSchema,
  coordinateSchema,
  durationMsSchema,
} from "./adb/validators.js";

// =====================================================
// Configuration
// =====================================================
const SCREENSHOT_DIR = process.env.SCREENSHOT_DIR || "/tmp/android-screenshots";

if (!fs.existsSync(SCREENSHOT_DIR)) {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
}

// =====================================================
// MCP Server
// =====================================================
const server = new McpServer({
  name: "android-emulator",
  version: "2.0.0",
});

// =====================================================
// TOOL: screenshot
// =====================================================
server.tool(
  "screenshot",
  "Take a screenshot of the Android device/emulator and return it as a base64 image",
  {},
  async () => {
    const buffer = await runAdbExecOutBinary(["screencap", "-p"]);
    return {
      content: [
        {
          type: "image",
          data: buffer.toString("base64"),
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
    await runAdbShell(["uiautomator", "dump", "/sdcard/ui_dump.xml"]);
    const xml = await runAdbShell(["cat", "/sdcard/ui_dump.xml"]);

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
    x: coordinateSchema.describe("X coordinate"),
    y: coordinateSchema.describe("Y coordinate"),
  },
  async ({ x, y }) => {
    await runAdbShell(["input", "tap", String(x), String(y)]);
    return { content: [{ type: "text", text: `Tapped at (${x}, ${y})` }] };
  }
);

// =====================================================
// TOOL: tap_text
// =====================================================
server.tool(
  "tap_text",
  "Find an element by its text content and tap on it",
  {
    text: freeTextSchema.describe("Text of the element to find and tap"),
    exact: z.boolean().optional().describe("If true, match exact text. Default: false (partial match)"),
  },
  async ({ text, exact = false }) => {
    await runAdbShell(["uiautomator", "dump", "/sdcard/ui_dump.xml"]);
    const xml = await runAdbShell(["cat", "/sdcard/ui_dump.xml"]);

    const escapedText = text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = exact
      ? `text="${escapedText}".*?bounds="\\[(\\d+),(\\d+)\\]\\[(\\d+),(\\d+)\\]"`
      : `text="[^"]*${escapedText}[^"]*".*?bounds="\\[(\\d+),(\\d+)\\]\\[(\\d+),(\\d+)\\]"`;
    const regex = new RegExp(pattern, "i");
    const match = regex.exec(xml);

    if (!match) {
      return { content: [{ type: "text", text: `Element with text "${text}" not found` }] };
    }

    const [, x1, y1, x2, y2] = match;
    const centerX = Math.round((parseInt(x1) + parseInt(x2)) / 2);
    const centerY = Math.round((parseInt(y1) + parseInt(y2)) / 2);
    await runAdbShell(["input", "tap", String(centerX), String(centerY)]);

    return {
      content: [{ type: "text", text: `Tapped on "${text}" at (${centerX}, ${centerY})` }],
    };
  }
);

// =====================================================
// TOOL: type_text
// =====================================================
/**
 * Android `input text` interpreta %s como espacio y %XX como byte URL-encoded.
 * Percent-encodear el UTF-8 del texto:
 *   - soporta acentos, CJK, emoji (Android decodifica %XX internamente)
 *   - evita el NPE conocido de `input text` con UTF-8 directo
 *   - los metacaracteres shell ya fueron rechazados por typeableTextSchema
 */
function encodeTextForInput(text: string): string {
  return encodeURIComponent(text).replace(/%20/g, "%s");
}

server.tool(
  "type_text",
  "Type text into the currently focused input field. Unicode is supported via URL-encoding. Shell metacharacters (; & | ` $ ( ) < > \\ quotes) are rejected.",
  {
    text: typeableTextSchema.describe("Text to type"),
  },
  async ({ text }) => {
    await runAdbShell(["input", "text", encodeTextForInput(text)]);
    return { content: [{ type: "text", text: `Typed: "${text}"` }] };
  }
);

// =====================================================
// TOOL: swipe
// =====================================================
server.tool(
  "swipe",
  "Perform a swipe gesture on the screen",
  {
    x1: coordinateSchema.describe("Starting X coordinate"),
    y1: coordinateSchema.describe("Starting Y coordinate"),
    x2: coordinateSchema.describe("Ending X coordinate"),
    y2: coordinateSchema.describe("Ending Y coordinate"),
    duration: durationMsSchema.optional().describe("Duration in milliseconds (default: 300)"),
  },
  async ({ x1, y1, x2, y2, duration = 300 }) => {
    await runAdbShell([
      "input", "swipe",
      String(x1), String(y1), String(x2), String(y2), String(duration),
    ]);
    return { content: [{ type: "text", text: `Swiped from (${x1}, ${y1}) to (${x2}, ${y2})` }] };
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
    amount: z.number().int().min(1).max(10_000).optional().describe("Scroll amount in pixels (default: 500)"),
  },
  async ({ direction, amount = 500 }) => {
    const sizeOutput = await runAdbShell(["wm", "size"]);
    const sizeMatch = sizeOutput.match(/(\d+)x(\d+)/);
    const width = sizeMatch ? parseInt(sizeMatch[1]) : 1080;
    const height = sizeMatch ? parseInt(sizeMatch[2]) : 2400;

    const centerX = Math.round(width / 2);
    const centerY = Math.round(height / 2);
    let x1 = centerX, y1 = centerY, x2 = centerX, y2 = centerY;
    const half = Math.round(amount / 2);

    switch (direction) {
      case "up":    y1 = centerY + half; y2 = centerY - half; break;
      case "down":  y1 = centerY - half; y2 = centerY + half; break;
      case "left":  x1 = centerX + half; x2 = centerX - half; break;
      case "right": x1 = centerX - half; x2 = centerX + half; break;
    }

    await runAdbShell([
      "input", "swipe",
      String(x1), String(y1), String(x2), String(y2), "300",
    ]);
    return { content: [{ type: "text", text: `Scrolled ${direction}` }] };
  }
);

// =====================================================
// TOOL: press_key
// =====================================================
server.tool(
  "press_key",
  "Press a system key (BACK, HOME, ENTER, etc)",
  {
    key: z.enum([
      "BACK", "HOME", "ENTER", "TAB", "DELETE", "MENU", "POWER",
      "VOLUME_UP", "VOLUME_DOWN",
    ]).describe("Key to press"),
  },
  async ({ key }) => {
    const keycodes: Record<string, number> = {
      BACK: 4, HOME: 3, ENTER: 66, TAB: 61, DELETE: 67,
      MENU: 82, POWER: 26, VOLUME_UP: 24, VOLUME_DOWN: 25,
    };
    await runAdbShell(["input", "keyevent", String(keycodes[key])]);
    return { content: [{ type: "text", text: `Pressed ${key} key` }] };
  }
);

// =====================================================
// TOOL: launch_app
// =====================================================
server.tool(
  "launch_app",
  "Launch an application by its package name (e.g., com.android.chrome). Package name is validated against the Android package naming convention.",
  {
    package: packageNameSchema.describe("Package name of the app (e.g., com.android.chrome)"),
  },
  async ({ package: pkg }) => {
    await runAdbShell([
      "monkey",
      "-p", pkg,
      "-c", "android.intent.category.LAUNCHER",
      "1",
    ]);
    return { content: [{ type: "text", text: `Launched ${pkg}` }] };
  }
);

// =====================================================
// TOOL: install_apk
// =====================================================
server.tool(
  "install_apk",
  "Install an APK file on the device. Path must end in .apk and contain no shell metacharacters.",
  {
    path: apkPathSchema.describe("Path to the APK file on the host"),
  },
  async ({ path: apkPath }) => {
    if (!fs.existsSync(apkPath)) {
      throw new Error(`APK file not found: ${apkPath}`);
    }
    const result = await runAdb(["install", "-r", apkPath]);
    return { content: [{ type: "text", text: `APK installed: ${result}` }] };
  }
);

// =====================================================
// TOOL: list_packages
// =====================================================
server.tool(
  "list_packages",
  "List installed packages on the device. Optional filter is applied in-process (JavaScript), never on the device shell.",
  {
    filter: searchFilterSchema.optional().describe("Filter packages by name (optional)"),
  },
  async ({ filter }) => {
    const raw = await runAdbShell(["pm", "list", "packages"]);
    const needle = filter?.toLowerCase();
    const packages = raw
      .split("\n")
      .map((line) => line.replace("package:", "").trim())
      .filter((p) => p.length > 0)
      .filter((p) => !needle || p.toLowerCase().includes(needle));

    return {
      content: [{ type: "text", text: `Installed packages:\n${packages.join("\n")}` }],
    };
  }
);

// =====================================================
// TOOL: get_logs
// =====================================================
server.tool(
  "get_logs",
  "Get device logs (logcat). Filtering is applied in-process, never on the device shell.",
  {
    filter: searchFilterSchema.optional().describe("Filter logs by tag or keyword (substring match in-process)"),
    lines: positiveCountSchema.optional().describe("Number of lines to retrieve (default: 50, max 100000)"),
    level: z.enum(["V", "D", "I", "W", "E"]).optional().describe("Minimum log level"),
  },
  async ({ filter, lines = 50, level }) => {
    const argv = ["logcat", "-d", "-t", String(lines)];
    if (level) argv.push(`*:${level}`);

    const raw = await runAdbShell(argv);
    const needle = filter?.toLowerCase();
    const filtered = needle
      ? raw.split("\n").filter((l) => l.toLowerCase().includes(needle)).join("\n")
      : raw;

    return { content: [{ type: "text", text: `Logs:\n${filtered}` }] };
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
    const [model, android, sdk, density, size, batteryDump] = await Promise.all([
      runAdbShell(["getprop", "ro.product.model"]),
      runAdbShell(["getprop", "ro.build.version.release"]),
      runAdbShell(["getprop", "ro.build.version.sdk"]),
      runAdbShell(["wm", "density"]),
      runAdbShell(["wm", "size"]),
      runAdbShell(["dumpsys", "battery"]),
    ]);

    const batteryLine = batteryDump.split("\n").find((l) => /level:/i.test(l)) || "";

    return {
      content: [
        {
          type: "text",
          text: `Device: ${model}
Android: ${android} (SDK ${sdk})
Screen: ${size.replace("Physical size: ", "")}
Density: ${density.replace("Physical density: ", "")}
Battery: ${batteryLine.replace(/^\s*level:\s*/, "")}%`,
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
    package: packageNameSchema.describe("Package name of the app"),
  },
  async ({ package: pkg }) => {
    await runAdbShell(["pm", "clear", pkg]);
    return { content: [{ type: "text", text: `Data cleared for ${pkg}` }] };
  }
);

// =====================================================
// TOOL: force_stop
// =====================================================
server.tool(
  "force_stop",
  "Force stop an application",
  {
    package: packageNameSchema.describe("Package name of the app"),
  },
  async ({ package: pkg }) => {
    await runAdbShell(["am", "force-stop", pkg]);
    return { content: [{ type: "text", text: `Force stopped ${pkg}` }] };
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
    let activity = "Unknown";

    try {
      const dump = await runAdbShell(["dumpsys", "activity", "activities"]);
      const line = dump.split("\n").find((l) => /mResumedActivity|mCurrentFocus/.test(l));
      if (line?.trim()) activity = line.trim();
    } catch { /* ignore */ }

    if (activity === "Unknown") {
      try {
        const top = await runAdbShell(["dumpsys", "activity", "top"]);
        const first5 = top.split("\n").slice(0, 5).join("\n").trim();
        if (first5) activity = first5;
      } catch { /* ignore */ }
    }

    if (activity === "Unknown") {
      try {
        const win = await runAdbShell(["dumpsys", "window"]);
        const line = win.split("\n").find((l) => /mCurrentFocus|mFocusedApp/.test(l));
        if (line?.trim()) activity = line.trim();
      } catch { /* ignore */ }
    }

    return { content: [{ type: "text", text: `Current activity:\n${activity}` }] };
  }
);

// =====================================================
// TOOL: wait_for_element
// =====================================================
server.tool(
  "wait_for_element",
  "Wait for a UI element with specific text to appear",
  {
    text: freeTextSchema.describe("Text of the element to wait for"),
    timeout: z.number().int().min(1).max(600).optional().describe("Timeout in seconds (default: 10)"),
  },
  async ({ text, timeout = 10 }) => {
    const startTime = Date.now();
    const timeoutMs = timeout * 1000;

    while (Date.now() - startTime < timeoutMs) {
      await runAdbShell(["uiautomator", "dump", "/sdcard/ui_dump.xml"]);
      const xml = await runAdbShell(["cat", "/sdcard/ui_dump.xml"]);

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
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    return {
      content: [{ type: "text", text: `Timeout: Element "${text}" not found after ${timeout}s` }],
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
    x: coordinateSchema.describe("X coordinate"),
    y: coordinateSchema.describe("Y coordinate"),
    duration: durationMsSchema.optional().describe("Duration in milliseconds (default: 1000)"),
  },
  async ({ x, y, duration = 1000 }) => {
    await runAdbShell([
      "input", "swipe",
      String(x), String(y), String(x), String(y), String(duration),
    ]);
    return { content: [{ type: "text", text: `Long pressed at (${x}, ${y}) for ${duration}ms` }] };
  }
);

// =====================================================
// TOOL: clear_input
// =====================================================
server.tool(
  "clear_input",
  "Clear the currently focused text input field",
  {
    maxChars: z.number().int().min(1).max(10_000).optional().describe("Maximum characters to delete (default: 100)"),
  },
  async ({ maxChars = 100 }) => {
    await runAdbShell(["input", "keyevent", "123"]); // MOVE_END
    for (let i = 0; i < maxChars; i++) {
      await runAdbShell(["input", "keyevent", "67"]); // DEL
    }
    return { content: [{ type: "text", text: `Cleared input field (deleted up to ${maxChars} characters)` }] };
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
    // CTRL+A = KEYCODE_CTRL_LEFT (113) + KEYCODE_A (29) via --longpress combo
    await runAdbShell(["input", "keyevent", "--longpress", "113", "29"]);
    return { content: [{ type: "text", text: "Selected all text in focused field" }] };
  }
);

// =====================================================
// TOOL: set_text
// =====================================================
server.tool(
  "set_text",
  "Clear the current input field and type new text. Unicode is supported via URL-encoding. Shell metacharacters are rejected.",
  {
    text: typeableTextSchema.describe("Text to type after clearing"),
    maxClearChars: z.number().int().min(1).max(10_000).optional().describe("Maximum characters to clear (default: 100)"),
  },
  async ({ text, maxClearChars = 100 }) => {
    await runAdbShell(["input", "keyevent", "123"]);
    for (let i = 0; i < maxClearChars; i++) {
      await runAdbShell(["input", "keyevent", "67"]);
    }
    await runAdbShell(["input", "text", encodeTextForInput(text)]);
    return { content: [{ type: "text", text: `Cleared field and typed: "${text}"` }] };
  }
);

// =====================================================
// TOOL: drag
// =====================================================
server.tool(
  "drag",
  "Perform a drag gesture from one point to another (slower than swipe, for drag & drop)",
  {
    x1: coordinateSchema.describe("Starting X coordinate"),
    y1: coordinateSchema.describe("Starting Y coordinate"),
    x2: coordinateSchema.describe("Ending X coordinate"),
    y2: coordinateSchema.describe("Ending Y coordinate"),
    duration: durationMsSchema.optional().describe("Duration in milliseconds (default: 1000)"),
  },
  async ({ x1, y1, x2, y2, duration = 1000 }) => {
    await runAdbShell([
      "input", "swipe",
      String(x1), String(y1), String(x2), String(y2), String(duration),
    ]);
    return {
      content: [{ type: "text", text: `Dragged from (${x1}, ${y1}) to (${x2}, ${y2}) over ${duration}ms` }],
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
    x: coordinateSchema.describe("X coordinate"),
    y: coordinateSchema.describe("Y coordinate"),
  },
  async ({ x, y }) => {
    await runAdbShell(["input", "tap", String(x), String(y)]);
    await new Promise((resolve) => setTimeout(resolve, 100));
    await runAdbShell(["input", "tap", String(x), String(y)]);
    return { content: [{ type: "text", text: `Double tapped at (${x}, ${y})` }] };
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
      runAdbShell(["wm", "size"]),
      runAdbShell(["wm", "density"]),
    ]);
    const sizeMatch = sizeOutput.match(/(\d+)x(\d+)/);
    const densityMatch = densityOutput.match(/(\d+)/);
    const width = sizeMatch ? parseInt(sizeMatch[1]) : 0;
    const height = sizeMatch ? parseInt(sizeMatch[2]) : 0;
    const density = densityMatch ? parseInt(densityMatch[1]) : 0;
    return { content: [{ type: "text", text: JSON.stringify({ width, height, density }, null, 2) }] };
  }
);

// =====================================================
// TOOL: is_element_visible
// =====================================================
server.tool(
  "is_element_visible",
  "Check if an element with specific text or resource-id is visible on screen",
  {
    text: freeTextSchema.optional().describe("Text to search for"),
    resourceId: resourceIdSchema.optional().describe("Resource ID to search for"),
  },
  async ({ text, resourceId }) => {
    if (!text && !resourceId) {
      return {
        content: [{ type: "text", text: JSON.stringify({ visible: false, error: "Must provide text or resourceId" }) }],
      };
    }

    await runAdbShell(["uiautomator", "dump", "/sdcard/ui_dump.xml"]);
    const xml = await runAdbShell(["cat", "/sdcard/ui_dump.xml"]);

    let found = false;
    let bounds: unknown = null;

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
          x: parseInt(x1), y: parseInt(y1),
          width: parseInt(x2) - parseInt(x1), height: parseInt(y2) - parseInt(y1),
          centerX: Math.round((parseInt(x1) + parseInt(x2)) / 2),
          centerY: Math.round((parseInt(y1) + parseInt(y2)) / 2),
        };
      }
    }

    if (resourceId && !found) {
      const regex = new RegExp(
        `resource-id="${resourceId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}".*?bounds="\\[(\\d+),(\\d+)\\]\\[(\\d+),(\\d+)\\]"`,
        "i"
      );
      const match = regex.exec(xml);
      if (match) {
        found = true;
        const [, x1, y1, x2, y2] = match;
        bounds = {
          x: parseInt(x1), y: parseInt(y1),
          width: parseInt(x2) - parseInt(x1), height: parseInt(y2) - parseInt(y1),
          centerX: Math.round((parseInt(x1) + parseInt(x2)) / 2),
          centerY: Math.round((parseInt(y1) + parseInt(y2)) / 2),
        };
      }
    }

    return { content: [{ type: "text", text: JSON.stringify({ visible: found, bounds }, null, 2) }] };
  }
);

// =====================================================
// TOOL: get_element_bounds
// =====================================================
server.tool(
  "get_element_bounds",
  "Get the exact bounds and center coordinates of an element",
  {
    text: freeTextSchema.optional().describe("Text of the element"),
    resourceId: resourceIdSchema.optional().describe("Resource ID of the element"),
    index: z.number().int().min(0).max(10_000).optional().describe("Index if multiple matches (0-based, default: 0)"),
  },
  async ({ text, resourceId, index = 0 }) => {
    if (!text && !resourceId) {
      return { content: [{ type: "text", text: JSON.stringify({ error: "Must provide text or resourceId" }) }] };
    }

    await runAdbShell(["uiautomator", "dump", "/sdcard/ui_dump.xml"]);
    const xml = await runAdbShell(["cat", "/sdcard/ui_dump.xml"]);

    let pattern: string;
    if (text) {
      const escapedText = text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      pattern = `text="[^"]*${escapedText}[^"]*".*?bounds="\\[(\\d+),(\\d+)\\]\\[(\\d+),(\\d+)\\]"`;
    } else {
      pattern = `resource-id="${resourceId!.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}".*?bounds="\\[(\\d+),(\\d+)\\]\\[(\\d+),(\\d+)\\]"`;
    }

    const regex = new RegExp(pattern, "gi");
    const matches: Array<{ x1: number; y1: number; x2: number; y2: number }> = [];
    let match;
    while ((match = regex.exec(xml)) !== null) {
      matches.push({
        x1: parseInt(match[1]), y1: parseInt(match[2]),
        x2: parseInt(match[3]), y2: parseInt(match[4]),
      });
    }

    if (matches.length === 0) {
      return { content: [{ type: "text", text: JSON.stringify({ found: false, error: "Element not found" }) }] };
    }

    if (index >= matches.length) {
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            found: false,
            error: `Index ${index} out of range. Found ${matches.length} matches.`,
          }),
        }],
      };
    }

    const m = matches[index];
    const result = {
      found: true,
      matchCount: matches.length,
      index,
      bounds: { x: m.x1, y: m.y1, width: m.x2 - m.x1, height: m.y2 - m.y1 },
      center: { x: Math.round((m.x1 + m.x2) / 2), y: Math.round((m.y1 + m.y2) / 2) },
    };
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

// =====================================================
// TOOL: scroll_to_text
// =====================================================
server.tool(
  "scroll_to_text",
  "Scroll the screen until an element with specific text is visible",
  {
    text: freeTextSchema.describe("Text to search for"),
    direction: z.enum(["up", "down"]).optional().describe("Scroll direction (default: down)"),
    maxScrolls: z.number().int().min(1).max(100).optional().describe("Maximum scroll attempts (default: 10)"),
  },
  async ({ text, direction = "down", maxScrolls = 10 }) => {
    const sizeOutput = await runAdbShell(["wm", "size"]);
    const sizeMatch = sizeOutput.match(/(\d+)x(\d+)/);
    const width = sizeMatch ? parseInt(sizeMatch[1]) : 1080;
    const height = sizeMatch ? parseInt(sizeMatch[2]) : 2400;

    const centerX = Math.round(width / 2);
    const startY = direction === "down" ? Math.round(height * 0.7) : Math.round(height * 0.3);
    const endY = direction === "down" ? Math.round(height * 0.3) : Math.round(height * 0.7);

    for (let i = 0; i < maxScrolls; i++) {
      await runAdbShell(["uiautomator", "dump", "/sdcard/ui_dump.xml"]);
      const xml = await runAdbShell(["cat", "/sdcard/ui_dump.xml"]);
      if (xml.toLowerCase().includes(text.toLowerCase())) {
        return { content: [{ type: "text", text: `Found "${text}" after ${i} scroll(s)` }] };
      }
      await runAdbShell([
        "input", "swipe",
        String(centerX), String(startY), String(centerX), String(endY), "300",
      ]);
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    return { content: [{ type: "text", text: `Text "${text}" not found after ${maxScrolls} scrolls` }] };
  }
);

// =====================================================
// TOOL: wait_for_ui_stable
// =====================================================
function extractUIFingerprint(xml: string): string {
  const elements: string[] = [];
  const regex = /(?:text="([^"]*)")?[^>]*(?:class="([^"]*)")?[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/g;
  let match;
  while ((match = regex.exec(xml)) !== null) {
    const [, text, className, x1, y1, x2, y2] = match;
    if (text || className) {
      elements.push(`${text || ""}|${className || ""}|${x1},${y1},${x2},${y2}`);
    }
  }
  return elements.sort().join("\n");
}

server.tool(
  "wait_for_ui_stable",
  "Wait for the UI to stop changing (useful after animations)",
  {
    timeout: z.number().int().min(100).max(600_000).optional().describe("Timeout in milliseconds (default: 5000)"),
    checkInterval: z.number().int().min(50).max(10_000).optional().describe("Check interval in milliseconds (default: 500)"),
  },
  async ({ timeout = 5000, checkInterval = 500 }) => {
    const startTime = Date.now();
    let lastFingerprint = "";
    let stableCount = 0;

    while (Date.now() - startTime < timeout) {
      await runAdbShell(["uiautomator", "dump", "/sdcard/ui_dump.xml"]);
      const currentXml = await runAdbShell(["cat", "/sdcard/ui_dump.xml"]);
      const currentFingerprint = extractUIFingerprint(currentXml);

      if (currentFingerprint === lastFingerprint) {
        stableCount++;
        if (stableCount >= 2) {
          const elapsed = Date.now() - startTime;
          return {
            content: [{
              type: "text",
              text: `UI stable after ${elapsed < 1000 ? elapsed + "ms" : Math.round(elapsed / 1000) + "s"}`,
            }],
          };
        }
      } else {
        stableCount = 0;
        lastFingerprint = currentFingerprint;
      }
      await new Promise((resolve) => setTimeout(resolve, checkInterval));
    }

    return { content: [{ type: "text", text: `Timeout: UI did not stabilize within ${timeout}ms` }] };
  }
);

// =====================================================
// TOOL: wait_for_element_gone
// =====================================================
server.tool(
  "wait_for_element_gone",
  "Wait for an element to disappear from the screen",
  {
    text: freeTextSchema.describe("Text of the element to wait for disappearance"),
    timeout: z.number().int().min(100).max(600_000).optional().describe("Timeout in milliseconds (default: 10000)"),
  },
  async ({ text, timeout = 10_000 }) => {
    const startTime = Date.now();
    while (Date.now() - startTime < timeout) {
      await runAdbShell(["uiautomator", "dump", "/sdcard/ui_dump.xml"]);
      const xml = await runAdbShell(["cat", "/sdcard/ui_dump.xml"]);
      if (!xml.toLowerCase().includes(text.toLowerCase())) {
        return {
          content: [{
            type: "text",
            text: `Element "${text}" disappeared after ${Math.round((Date.now() - startTime) / 1000)}s`,
          }],
        };
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    return { content: [{ type: "text", text: `Timeout: Element "${text}" still visible after ${timeout}ms` }] };
  }
);

// =====================================================
// TOOL: multi_tap
// =====================================================
server.tool(
  "multi_tap",
  "Perform multiple rapid taps at the same position",
  {
    x: coordinateSchema.describe("X coordinate"),
    y: coordinateSchema.describe("Y coordinate"),
    taps: z.number().int().min(1).max(100).optional().describe("Number of taps (default: 2)"),
    interval: durationMsSchema.optional().describe("Interval between taps in ms (default: 100)"),
  },
  async ({ x, y, taps = 2, interval = 100 }) => {
    for (let i = 0; i < taps; i++) {
      await runAdbShell(["input", "tap", String(x), String(y)]);
      if (i < taps - 1) {
        await new Promise((resolve) => setTimeout(resolve, interval));
      }
    }
    return { content: [{ type: "text", text: `Performed ${taps} taps at (${x}, ${y})` }] };
  }
);

// =====================================================
// TOOL: pinch_zoom
// =====================================================
server.tool(
  "pinch_zoom",
  "Perform a pinch zoom gesture (requires Android 8+)",
  {
    x: coordinateSchema.describe("Center X coordinate"),
    y: coordinateSchema.describe("Center Y coordinate"),
    scale: z.number().min(0.1).max(10).describe("Scale factor (>1 zoom in, <1 zoom out)"),
    duration: durationMsSchema.optional().describe("Duration in milliseconds (default: 500)"),
  },
  async ({ x, y, scale, duration = 500 }) => {
    const distance = 200;
    const scaledDistance = Math.round(distance * scale);

    if (scale > 1) {
      const halfDist = Math.round(scaledDistance / 2);
      await runAdbShell([
        "input", "swipe",
        String(x), String(y - 50), String(x), String(y - halfDist), String(duration),
      ]);
      await runAdbShell([
        "input", "swipe",
        String(x), String(y + 50), String(x), String(y + halfDist), String(duration),
      ]);
    } else {
      const halfDist = Math.round(distance / 2);
      const targetDist = Math.round((distance * scale) / 2);
      await runAdbShell([
        "input", "swipe",
        String(x), String(y - halfDist), String(x), String(y - targetDist), String(duration),
      ]);
      await runAdbShell([
        "input", "swipe",
        String(x), String(y + halfDist), String(x), String(y + targetDist), String(duration),
      ]);
    }

    return {
      content: [{
        type: "text",
        text: `Pinch zoom at (${x}, ${y}) with scale ${scale}. Note: True multitouch requires instrumentation.`,
      }],
    };
  }
);

// =====================================================
// TOOL: set_clipboard
// =====================================================
server.tool(
  "set_clipboard",
  "Set text to the device clipboard. Text is transferred via `adb push` (binary transfer, no shell involvement, full Unicode support).",
  {
    text: freeTextSchema.describe("Text to copy to clipboard"),
  },
  async ({ text }) => {
    const paths = ["/data/local/tmp/clipboard_temp.txt", "/sdcard/clipboard_temp.txt"];

    const tmpLocal = path.join(os.tmpdir(), `mcp-clipboard-${process.pid}-${Date.now()}.txt`);
    fs.writeFileSync(tmpLocal, text, "utf8");

    let success = false;
    let usedPath = "";

    try {
      for (const clipPath of paths) {
        try {
          await runAdb(["push", tmpLocal, clipPath]);
          // Verificar con cat (ruta fija, sin input de LLM)
          const verify = await runAdbShell(["cat", clipPath]);
          if (verify && verify.length > 0) {
            success = true;
            usedPath = clipPath;
            break;
          }
        } catch { /* try next path */ }
      }
    } finally {
      try { fs.unlinkSync(tmpLocal); } catch { /* ignore */ }
    }

    if (!success) {
      return {
        content: [{
          type: "text",
          text: `Error: Could not write clipboard. Tried paths: ${paths.join(", ")}`,
        }],
      };
    }

    return {
      content: [{
        type: "text",
        text: `Clipboard set to: "${text.substring(0, 50)}${text.length > 50 ? "..." : ""}" (stored at ${usedPath})`,
      }],
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
    const paths = ["/data/local/tmp/clipboard_temp.txt", "/sdcard/clipboard_temp.txt"];

    for (const clipPath of paths) {
      try {
        const content = await runAdbShell(["cat", clipPath]);
        if (content && content.trim()) {
          return { content: [{ type: "text", text: `Clipboard content: "${content}"` }] };
        }
      } catch { /* try next */ }
    }

    return { content: [{ type: "text", text: `Clipboard content: ""` }] };
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
    await runAdbShell(["settings", "put", "system", "accelerometer_rotation", "0"]);
    const rotation = orientation === "portrait" ? "0" : "1";
    await runAdbShell(["settings", "put", "system", "user_rotation", rotation]);
    return { content: [{ type: "text", text: `Device rotated to ${orientation}` }] };
  }
);

// =====================================================
// TOOL: tap_safe
// =====================================================
server.tool(
  "tap_safe",
  "Tap at coordinates while avoiding system navigation bars",
  {
    x: coordinateSchema.describe("X coordinate"),
    y: coordinateSchema.describe("Y coordinate"),
    avoidStatusBar: z.boolean().optional().describe("Avoid status bar area (default: true)"),
    avoidNavBar: z.boolean().optional().describe("Avoid navigation bar area (default: true)"),
  },
  async ({ x, y, avoidStatusBar = true, avoidNavBar = true }) => {
    const sizeOutput = await runAdbShell(["wm", "size"]);
    const sizeMatch = sizeOutput.match(/(\d+)x(\d+)/);
    const screenWidth = sizeMatch ? parseInt(sizeMatch[1]) : 1080;
    const screenHeight = sizeMatch ? parseInt(sizeMatch[2]) : 2400;

    const statusBarHeight = 50;
    const navBarHeight = 120;

    let safeY = y;
    let adjusted = false;
    const adjustments: string[] = [];

    if (avoidStatusBar && y < statusBarHeight) {
      safeY = statusBarHeight + 10;
      adjusted = true;
      adjustments.push(`status bar (${y} -> ${safeY})`);
    }
    if (avoidNavBar && y > screenHeight - navBarHeight) {
      safeY = screenHeight - navBarHeight - 10;
      adjusted = true;
      adjustments.push(`nav bar (${y} -> ${safeY})`);
    }

    const safeX = Math.max(10, Math.min(x, screenWidth - 10));
    await runAdbShell(["input", "tap", String(safeX), String(safeY)]);

    const message = adjusted
      ? `Tapped at (${safeX}, ${safeY}) [adjusted to avoid ${adjustments.join(", ")}]`
      : `Tapped at (${safeX}, ${safeY})`;
    return { content: [{ type: "text", text: message }] };
  }
);

// =====================================================
// TOOL: tap_element
// =====================================================
server.tool(
  "tap_element",
  "Find and tap an element by text or resource-id (more reliable than tap_text)",
  {
    text: freeTextSchema.optional().describe("Text to search for"),
    resourceId: resourceIdSchema.optional().describe("Resource ID to search for"),
    index: z.number().int().min(0).max(10_000).optional().describe("Index if multiple matches (0-based, default: 0)"),
    exact: z.boolean().optional().describe("Exact text match (default: false)"),
  },
  async ({ text, resourceId, index = 0, exact = false }) => {
    if (!text && !resourceId) {
      return { content: [{ type: "text", text: "Error: Must provide either text or resourceId" }] };
    }

    await runAdbShell(["uiautomator", "dump", "/sdcard/ui_dump.xml"]);
    const xml = await runAdbShell(["cat", "/sdcard/ui_dump.xml"]);

    let pattern: string;
    let searchType: string;

    if (resourceId) {
      const escId = resourceId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      pattern = `resource-id="${escId}"[^>]*bounds="\\[(\\d+),(\\d+)\\]\\[(\\d+),(\\d+)\\]"`;
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
        x1: parseInt(match[1]), y1: parseInt(match[2]),
        x2: parseInt(match[3]), y2: parseInt(match[4]),
      });
    }

    if (matches.length === 0) {
      return { content: [{ type: "text", text: `Element with ${searchType} not found` }] };
    }
    if (index >= matches.length) {
      return {
        content: [{ type: "text", text: `Index ${index} out of range. Found ${matches.length} matches for ${searchType}` }],
      };
    }

    const m = matches[index];
    const centerX = Math.round((m.x1 + m.x2) / 2);
    const centerY = Math.round((m.y1 + m.y2) / 2);
    await runAdbShell(["input", "tap", String(centerX), String(centerY)]);

    return {
      content: [{
        type: "text",
        text: `Tapped element with ${searchType} at (${centerX}, ${centerY})${matches.length > 1 ? ` [match ${index + 1}/${matches.length}]` : ""}`,
      }],
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
    await runAdbShell(["uiautomator", "dump", "/sdcard/ui_dump.xml"]);
    const xml = await runAdbShell(["cat", "/sdcard/ui_dump.xml"]);

    const focusedRegex = /focused="true"[^>]*text="([^"]*)"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/;
    const match = focusedRegex.exec(xml);

    if (!match) {
      const altRegex = /bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"[^>]*focused="true"[^>]*text="([^"]*)"/;
      const altMatch = altRegex.exec(xml);
      if (!altMatch) {
        return { content: [{ type: "text", text: JSON.stringify({ focused: false, element: null }) }] };
      }
      const [, x1, y1, x2, y2, text] = altMatch;
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            focused: true,
            element: {
              text,
              bounds: { x: parseInt(x1), y: parseInt(y1), width: parseInt(x2) - parseInt(x1), height: parseInt(y2) - parseInt(y1) },
              center: { x: Math.round((parseInt(x1) + parseInt(x2)) / 2), y: Math.round((parseInt(y1) + parseInt(y2)) / 2) },
            },
          }, null, 2),
        }],
      };
    }

    const [, text, x1, y1, x2, y2] = match;
    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          focused: true,
          element: {
            text,
            bounds: { x: parseInt(x1), y: parseInt(y1), width: parseInt(x2) - parseInt(x1), height: parseInt(y2) - parseInt(y1) },
            center: { x: Math.round((parseInt(x1) + parseInt(x2)) / 2), y: Math.round((parseInt(y1) + parseInt(y2)) / 2) },
          },
        }, null, 2),
      }],
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
    text: freeTextSchema.describe("Text that should be visible"),
    exact: z.boolean().optional().describe("Exact match (default: false)"),
  },
  async ({ text, exact = false }) => {
    await runAdbShell(["uiautomator", "dump", "/sdcard/ui_dump.xml"]);
    const xml = await runAdbShell(["cat", "/sdcard/ui_dump.xml"]);
    const found = exact
      ? xml.includes(`text="${text}"`)
      : xml.toLowerCase().includes(text.toLowerCase());
    return {
      content: [{
        type: "text",
        text: JSON.stringify({ assertion: found ? "PASS" : "FAIL", expected: text, found }, null, 2),
      }],
    };
  }
);

// =====================================================
// TOOL: get_all_text
// =====================================================
server.tool(
  "get_all_text",
  "Get all visible text elements on screen (useful for debugging and verification)",
  {
    includeEmpty: z.boolean().optional().describe("Include elements with empty text (default: false)"),
  },
  async ({ includeEmpty = false }) => {
    await runAdbShell(["uiautomator", "dump", "/sdcard/ui_dump.xml"]);
    const xml = await runAdbShell(["cat", "/sdcard/ui_dump.xml"]);

    const texts: Array<{ text: string; centerX: number; centerY: number }> = [];
    const regex = /text="([^"]*)"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/g;
    let match;
    while ((match = regex.exec(xml)) !== null) {
      const [, text, x1, y1, x2, y2] = match;
      if (text || includeEmpty) {
        texts.push({
          text: text || "(empty)",
          centerX: Math.round((parseInt(x1) + parseInt(x2)) / 2),
          centerY: Math.round((parseInt(y1) + parseInt(y2)) / 2),
        });
      }
    }
    texts.sort((a, b) => a.centerY - b.centerY || a.centerX - b.centerX);
    const textList = texts.map((t) => `"${t.text}" at (${t.centerX}, ${t.centerY})`).join("\n");
    return {
      content: [{ type: "text", text: `Found ${texts.length} text elements:\n${textList}` }],
    };
  }
);

// =====================================================
// TOOL: get_clickable_elements
// =====================================================
server.tool(
  "get_clickable_elements",
  "Get all clickable elements on screen with their text, resource-id, and coordinates (useful when tap_text fails)",
  {
    includeDisabled: z.boolean().optional().describe("Include disabled elements (default: false)"),
  },
  async ({ includeDisabled = false }) => {
    await runAdbShell(["uiautomator", "dump", "/sdcard/ui_dump.xml"]);
    const xml = await runAdbShell(["cat", "/sdcard/ui_dump.xml"]);

    const elements: Array<{
      text: string; resourceId: string; className: string;
      centerX: number; centerY: number; bounds: string;
    }> = [];

    const regex = /<node[^>]*clickable="true"[^>]*>/g;
    let nodeMatch;
    while ((nodeMatch = regex.exec(xml)) !== null) {
      const node = nodeMatch[0];
      if (!includeDisabled && node.includes('enabled="false"')) continue;

      const textMatch = node.match(/text="([^"]*)"/);
      const resourceIdMatch = node.match(/resource-id="([^"]*)"/);
      const classMatch = node.match(/class="([^"]*)"/);
      const boundsMatch = node.match(/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/);

      if (boundsMatch) {
        const [, x1, y1, x2, y2] = boundsMatch;
        const centerX = Math.round((parseInt(x1) + parseInt(x2)) / 2);
        const centerY = Math.round((parseInt(y1) + parseInt(y2)) / 2);
        elements.push({
          text: textMatch ? textMatch[1] : "",
          resourceId: resourceIdMatch ? resourceIdMatch[1] : "",
          className: classMatch ? classMatch[1].split(".").pop() || "" : "",
          centerX, centerY,
          bounds: `[${x1},${y1}][${x2},${y2}]`,
        });
      }
    }

    elements.sort((a, b) => a.centerY - b.centerY || a.centerX - b.centerX);
    const formatted = elements.map((el, i) => {
      const parts: string[] = [];
      if (el.text) parts.push(`text="${el.text}"`);
      if (el.resourceId) parts.push(`id="${el.resourceId.split("/").pop()}"`);
      if (el.className) parts.push(`[${el.className}]`);
      return `${i + 1}. ${parts.join(" ") || "(no text/id)"} at (${el.centerX}, ${el.centerY})`;
    }).join("\n");

    return {
      content: [{ type: "text", text: `Found ${elements.length} clickable elements:\n${formatted}` }],
    };
  }
);

// =====================================================
// TOOL: is_keyboard_visible
// =====================================================
server.tool(
  "is_keyboard_visible",
  "Check if the soft keyboard is currently visible on screen",
  {},
  async () => {
    let isShowingViaIme = false;
    let hasKeyboardWindow = false;
    let heightMethod = false;

    try {
      const imeDump = await runAdbShell(["dumpsys", "input_method"]);
      isShowingViaIme = imeDump
        .split("\n")
        .some((l) => /mInputShown=true/.test(l));
    } catch { /* ignore */ }

    try {
      const windowDump = await runAdbShell(["dumpsys", "window", "windows"]);
      hasKeyboardWindow = windowDump
        .split("\n")
        .some((l) => /inputmethod/i.test(l) && /mHasSurface=true/.test(l));
    } catch { /* ignore */ }

    try {
      const win = await runAdbShell(["dumpsys", "window"]);
      const sizeOutput = await runAdbShell(["wm", "size"]);
      const sizeMatch = sizeOutput.match(/(\d+)x(\d+)/);
      const visibleFrame = win.split("\n").find((l) => /mVisibleFrame/.test(l)) || "";
      if (sizeMatch && visibleFrame) {
        const screenHeight = parseInt(sizeMatch[2]);
        const frameMatch = visibleFrame.match(/mVisibleFrame=\[\d+,\d+\]\[\d+,(\d+)\]/);
        if (frameMatch) {
          const visibleHeight = parseInt(frameMatch[1]);
          heightMethod = visibleHeight < screenHeight * 0.8;
        }
      }
    } catch { /* ignore */ }

    const isVisible = isShowingViaIme || hasKeyboardWindow || heightMethod;
    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          visible: isVisible,
          checks: {
            inputMethodShown: isShowingViaIme,
            keyboardWindowVisible: hasKeyboardWindow,
            heightReduced: heightMethod,
          },
        }, null, 2),
      }],
    };
  }
);

// =====================================================
// TOOL: get_focused_input_value
// =====================================================
server.tool(
  "get_focused_input_value",
  "Get the current text value of the focused input field",
  {},
  async () => {
    await runAdbShell(["uiautomator", "dump", "/sdcard/ui_dump.xml"]);
    const xml = await runAdbShell(["cat", "/sdcard/ui_dump.xml"]);

    const patterns = [
      /class="[^"]*(?:Edit|Input|Text)[^"]*"[^>]*focused="true"[^>]*text="([^"]*)"/gi,
      /class="[^"]*(?:Edit|Input|Text)[^"]*"[^>]*text="([^"]*)"[^>]*focused="true"/gi,
      /focused="true"[^>]*text="([^"]*)"[^>]*class="[^"]*(?:Edit|Input|Text)[^"]*"/gi,
    ];

    for (const pattern of patterns) {
      const match = pattern.exec(xml);
      if (match) {
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              found: true, value: match[1], isEmpty: match[1] === "",
            }, null, 2),
          }],
        };
      }
    }

    const broadPattern = /focused="true"[^>]*text="([^"]*)"|text="([^"]*)"[^>]*focused="true"/gi;
    const broadMatch = broadPattern.exec(xml);
    if (broadMatch) {
      const value = broadMatch[1] || broadMatch[2] || "";
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            found: true, value, isEmpty: value === "",
            note: "Found focused element (may not be an input field)",
          }, null, 2),
        }],
      };
    }

    return {
      content: [{
        type: "text",
        text: JSON.stringify({ found: false, value: null, error: "No focused input field found" }, null, 2),
      }],
    };
  }
);

// =====================================================
// Start server
// =====================================================
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("MCP Android Emulator Server running on stdio");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
