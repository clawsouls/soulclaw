import { parseStrictPositiveInteger } from "openclaw/plugin-sdk/number-runtime";

export function readRoutePositiveInteger(value: unknown, fieldName: string): number | undefined {
  const parsed = parseStrictPositiveInteger(value);
  if (parsed === undefined && value != null) {
    throw new Error(`${fieldName} must be a positive integer.`);
  }
  return parsed;
}
