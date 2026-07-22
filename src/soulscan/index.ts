/**
 * SoulScan — Inline soul package scanner for SoulClaw.
 * Delegates to clawsouls scanner package for security rules.
 * Falls back to basic structural checks when clawsouls is not installed.
 *
 * @example
 * ```ts
 * import { scanSoul, formatReport } from './soulscan/index.ts';
 *
 * const result = await scanSoul('/path/to/soul');
 * console.log(formatReport(result));
 * ```
 */

export { scanSoul, SOULSCAN_VERSION, type ScanResult, type Issue } from "./engine.ts";
export { formatReport, formatSummary } from "./report.ts";
export { scanGate, isSoulSafe, type ScanHookOptions, type ScanGateResult } from "./hook.ts";
