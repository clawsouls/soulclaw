import chalk, { Chalk } from "chalk";
import { LOBSTER_PALETTE } from "./palette.js";

const hasForceColor =
  typeof process.env.FORCE_COLOR === "string" &&
  process.env.FORCE_COLOR.trim().length > 0 &&
  process.env.FORCE_COLOR.trim() !== "0";

const baseChalk = process.env.NO_COLOR && !hasForceColor ? new Chalk({ level: 0 }) : chalk;

const hex = (value: string) => baseChalk.hex(value);

export const theme = {
  accent: hex(LOBSTER_PALETTE.accent),
  accentBright: hex(LOBSTER_PALETTE.accentBright),
  accentDim: hex(LOBSTER_PALETTE.accentDim),
  info: hex(LOBSTER_PALETTE.info),
  success: hex(LOBSTER_PALETTE.success),
  warn: hex(LOBSTER_PALETTE.warn),
  error: hex(LOBSTER_PALETTE.error),
  muted: hex(LOBSTER_PALETTE.muted),
  heading: baseChalk.bold.hex(LOBSTER_PALETTE.accent),
  command: hex(LOBSTER_PALETTE.accentBright),
  option: hex(LOBSTER_PALETTE.warn),
} as const;

export const isRich = () => Boolean(baseChalk.level > 0);

export function colorize(rich: boolean, color: (value: string) => string, value: string): string;
export function colorize(color: (value: string) => string, value: string): string;
export function colorize(
  richOrColor: boolean | ((value: string) => string),
  colorOrValue: ((value: string) => string) | string,
  maybeValue?: string,
): string {
  if (typeof richOrColor === "boolean") {
    // 3-arg form: colorize(rich, color, value)
    const color = colorOrValue as (v: string) => string;
    const value = maybeValue as string;
    return richOrColor ? color(value) : value;
  }
  // 2-arg form: colorize(color, value) — always rich
  return richOrColor(colorOrValue as string);
}
