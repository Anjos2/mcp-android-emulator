/**
 * Validators zod — allowlists estrictas para todo input que eventualmente
 * llegará a `adb shell` (donde el sh del device reinterpreta metacaracteres).
 *
 * Finalidad:
 *   Actuar como segunda línea de defensa sobre src/adb/runner.ts. El runner
 *   protege el host (no invoca sh local); estos validators protegen el device
 *   (bloquean metacaracteres antes de llegar al sh del device).
 *
 * Interrelación:
 *   - Usado por los schemas de tool en src/index.ts.
 *   - Combinable con z.object() normal de la librería zod.
 */

import { z } from "zod";

/**
 * Regex para metacaracteres shell peligrosos.
 * Usado para rechazo en allowlists que admiten ciertos caracteres
 * pero quieren excluir los más peligrosos explícitamente.
 */
export const SHELL_METACHARS = /[;&|`$()<>\\"'\n\r\t\x00-\x1f]/;

// ---------------------------------------------------------------------------
// Android package name
// Formato Java-compatible: segmentos separados por puntos, cada segmento
// empieza con letra o underscore, continúa con alfanumérico/underscore.
// Mínimo dos segmentos (no hay package top-level sin punto en Android real).
// ---------------------------------------------------------------------------
const PACKAGE_NAME_REGEX = /^[a-zA-Z_][a-zA-Z0-9_]*(\.[a-zA-Z_][a-zA-Z0-9_]*)+$/;

export const packageNameSchema = z
  .string()
  .min(3)
  .max(255)
  .regex(PACKAGE_NAME_REGEX, "Invalid Android package name");

// ---------------------------------------------------------------------------
// APK path
// Rechaza metacaracteres shell y exige extensión .apk.
// La existencia del archivo se valida en el handler (no aquí, para que
// los tests puedan usar paths simulados).
// ---------------------------------------------------------------------------
export const apkPathSchema = z
  .string()
  .min(5)
  .max(4096)
  .refine((p) => p.toLowerCase().endsWith(".apk"), {
    message: "Must be a .apk file",
  })
  .refine((p) => !SHELL_METACHARS.test(p), {
    message: "Path contains disallowed characters",
  });

// ---------------------------------------------------------------------------
// Android resource-id (e.g. com.app:id/button_login)
// ---------------------------------------------------------------------------
const RESOURCE_ID_REGEX = /^[a-zA-Z_][a-zA-Z0-9_.]*:[a-zA-Z]+\/[a-zA-Z_][a-zA-Z0-9_]*$/;

export const resourceIdSchema = z
  .string()
  .min(3)
  .max(512)
  .regex(RESOURCE_ID_REGEX, "Invalid Android resource-id");

// ---------------------------------------------------------------------------
// Texto libre del usuario (filter, search, assert)
// Este texto NO llega al shell: se usa en JavaScript (String.includes,
// RegExp.source con escape). Aceptamos caracteres amplios pero limitamos
// longitud y prohibimos control characters para evitar sorpresas.
// ---------------------------------------------------------------------------
const CONTROL_CHARS = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/;

export const freeTextSchema = z
  .string()
  .max(1024)
  .refine((s) => !CONTROL_CHARS.test(s), {
    message: "Text contains control characters",
  });

// ---------------------------------------------------------------------------
// Texto que se va a tipear en un input Android (type_text, set_text).
// Este texto PASA por el shell del device (`input text ...`). Aplicamos
// allowlist amplia (imprimible, espacios, algunos símbolos comunes) y
// rechazamos metacaracteres shell. Es una limitación consciente —
// casos de password con '$' o '`' deben enviar primero la parte segura
// y usar key events para los metacaracteres, o una tool futura dedicada.
// ---------------------------------------------------------------------------
const TYPEABLE_TEXT_REGEX = /^[a-zA-Z0-9 .,:/_\-@+=?!#%*\[\]{}]*$/;

export const typeableTextSchema = z
  .string()
  .min(0)
  .max(2048)
  .regex(TYPEABLE_TEXT_REGEX, "Text contains characters not allowed for safe typing");

// ---------------------------------------------------------------------------
// Filter para list_packages / get_logs — usado en JS, no en shell.
// ---------------------------------------------------------------------------
export const searchFilterSchema = z
  .string()
  .max(256)
  .refine((s) => !CONTROL_CHARS.test(s), {
    message: "Filter contains control characters",
  });

// ---------------------------------------------------------------------------
// Conteo numérico sanitizado (lines en get_logs, etc).
// ---------------------------------------------------------------------------
export const positiveCountSchema = z
  .number()
  .int()
  .positive()
  .max(100_000);

// ---------------------------------------------------------------------------
// Coordenadas (seguras por tipo, pero clamp a límites razonables).
// ---------------------------------------------------------------------------
export const coordinateSchema = z.number().int().min(0).max(100_000);

// ---------------------------------------------------------------------------
// Duración en ms.
// ---------------------------------------------------------------------------
export const durationMsSchema = z.number().int().nonnegative().max(600_000);
