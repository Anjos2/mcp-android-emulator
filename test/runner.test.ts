/**
 * Tests del runner — verifica que execFile recibe argv separado, no un
 * string compuesto. Esto demuestra que el HOST está protegido contra
 * command injection aunque los argumentos contengan metacaracteres.
 *
 * Nota: usamos un adb "falso" apuntando a un script de echo que imprime
 * sus argumentos uno por línea — así podemos verificar exactamente qué
 * argumentos recibió el binario.
 */

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const IS_WINDOWS = process.platform === "win32";

// Skip estos tests en Windows: execFile no corre scripts (.cmd/.sh) sin
// shell:true, que es justo lo que el runner evita por diseño. En Linux
// (donde corre el servidor y el release real) los tests corren con un
// shebang POSIX. La verificación funcional en Windows no es crítica
// porque adb real se distribuye principalmente para Linux/macOS.
const SKIP_RUNNER_TESTS = IS_WINDOWS;

const FAKE_ADB_DIR = SKIP_RUNNER_TESTS
  ? ""
  : fs.mkdtempSync(path.join(os.tmpdir(), "mcp-fake-adb-"));
const FAKE_ADB = SKIP_RUNNER_TESTS
  ? ""
  : path.join(FAKE_ADB_DIR, "fake-adb.sh");

function installFakeAdb() {
  const content = '#!/bin/sh\nfor a in "$@"; do echo "$a"; done\n';
  fs.writeFileSync(FAKE_ADB, content);
  fs.chmodSync(FAKE_ADB, 0o755);
  process.env.ADB_PATH = FAKE_ADB;
}

before(() => {
  if (SKIP_RUNNER_TESTS) return;
  installFakeAdb();
});

after(() => {
  if (SKIP_RUNNER_TESTS) return;
  try {
    fs.rmSync(FAKE_ADB_DIR, { recursive: true, force: true });
  } catch { /* ignore */ }
});

if (SKIP_RUNNER_TESTS) {
  test("runner tests skipped on Windows (execFile cannot run scripts without shell)", { skip: true }, () => {});
} else {
  // Importar DESPUÉS de setear ADB_PATH; el módulo lo lee en import time.
  const { runAdb, runAdbShell } = await import("../src/adb/runner.ts");

  test("runAdb passes each argument separately to adb binary", async () => {
    const out = await runAdb(["arg1", "arg2 with spaces", "arg3"]);
    assert.equal(out, "arg1\narg2 with spaces\narg3");
  });

  test("runAdb does NOT interpret shell metacharacters on the host", async () => {
    const out = await runAdb(["hello; id"]);
    assert.equal(out, "hello; id");
    assert.ok(!out.includes("uid="), "should not contain uid= (would indicate id ran)");
  });

  test("runAdb protects against $(...) command substitution on host", async () => {
    const out = await runAdb(["test$(id)"]);
    assert.equal(out, "test$(id)");
    assert.ok(!out.includes("uid="));
  });

  test("runAdb protects against backtick command substitution on host", async () => {
    const out = await runAdb(["test`id`"]);
    assert.equal(out, "test`id`");
    assert.ok(!out.includes("uid="));
  });

  test("runAdbShell prepends 'shell' as first argument", async () => {
    const out = await runAdbShell(["pm", "list", "packages"]);
    const lines = out.split("\n");
    assert.equal(lines[0], "shell");
    assert.equal(lines[1], "pm");
    assert.equal(lines[2], "list");
    assert.equal(lines[3], "packages");
  });

  test("runAdbShell requires at least one argument", async () => {
    // Este caso no depende de ejecutar adb — se valida antes.
    await assert.rejects(() => runAdbShell([]), /requires at least one argument/);
  });
}
