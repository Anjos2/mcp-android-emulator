/**
 * Runner seguro para comandos adb.
 *
 * Finalidad:
 *   Centraliza toda interacción con el binario adb usando execFile (NO exec),
 *   lo que elimina la interpretación de metacaracteres shell en el HOST.
 *   El host queda protegido aunque se pasen argumentos con ';', '|', '`', etc.
 *
 * Nota sobre adb shell:
 *   Cuando se usa 'adb shell', adb concatena los argv con espacios y los
 *   entrega al /system/bin/sh del device. El sh del device SÍ reinterpreta
 *   metacaracteres. Por lo tanto, la defensa en profundidad exige que los
 *   argumentos vengan validados (allowlist) por src/adb/validators.ts antes
 *   de llegar aquí.
 *
 * Interrelación:
 *   - Usado por src/index.ts (todas las tools migradas).
 *   - Complementado por src/adb/validators.ts (allowlists zod).
 *   - Config externa: variable de entorno ADB_PATH.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const ADB_PATH = process.env.ADB_PATH || "adb";

export interface RunOptions {
  /** Timeout en ms; default 30s. 0 o negativo = sin timeout. */
  timeoutMs?: number;
  /** Buffer máximo de stdout/stderr en bytes; default 10 MB. */
  maxBufferBytes?: number;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_BUFFER = 10 * 1024 * 1024;

function normalizeOpts(opts: RunOptions): { timeout: number; maxBuffer: number } {
  const t = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  return {
    timeout: t > 0 ? t : 0,
    maxBuffer: opts.maxBufferBytes ?? DEFAULT_MAX_BUFFER,
  };
}

/**
 * Ejecuta `adb <args...>` sin pasar por shell del host.
 * Cada elemento de args llega como argumento separado al binario adb.
 */
export async function runAdb(args: string[], opts: RunOptions = {}): Promise<string> {
  const { timeout, maxBuffer } = normalizeOpts(opts);
  try {
    const { stdout } = await execFileAsync(ADB_PATH, args, { timeout, maxBuffer });
    return stdout.trim();
  } catch (error: unknown) {
    throw wrapAdbError(error);
  }
}

/**
 * Ejecuta `adb shell <argv...>`. Los tokens serán re-ensamblados por adb y
 * pasados al sh del device. Los argumentos DEBEN estar validados contra
 * shell metacharacters antes de invocar esta función (ver validators.ts).
 */
export async function runAdbShell(argv: string[], opts: RunOptions = {}): Promise<string> {
  if (argv.length === 0) {
    throw new Error("runAdbShell requires at least one argument");
  }
  return runAdb(["shell", ...argv], opts);
}

/**
 * Ejecuta `adb exec-out <argv...>`. Útil para obtener bytes binarios sin
 * transformación (screencap, pull de archivos). Los argumentos DEBEN estar
 * validados. Devuelve un Buffer.
 */
export async function runAdbExecOutBinary(argv: string[], opts: RunOptions = {}): Promise<Buffer> {
  if (argv.length === 0) {
    throw new Error("runAdbExecOutBinary requires at least one argument");
  }
  const { timeout, maxBuffer } = normalizeOpts(opts);
  return new Promise<Buffer>((resolve, reject) => {
    execFile(
      ADB_PATH,
      ["exec-out", ...argv],
      { timeout, maxBuffer, encoding: "buffer" },
      (error, stdout) => {
        if (error) {
          reject(wrapAdbError(error));
          return;
        }
        resolve(stdout as Buffer);
      }
    );
  });
}

function wrapAdbError(error: unknown): Error {
  if (error instanceof Error) {
    // @ts-expect-error — stderr no es estándar pero lo añade child_process
    const stderr: string | undefined = error.stderr;
    const msg = stderr?.toString?.().trim() || error.message;
    return new Error(`adb error: ${msg}`);
  }
  return new Error(`adb error: ${String(error)}`);
}
