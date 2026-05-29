import {
  parseStrictFiniteNumber,
  parseStrictPositiveInteger,
} from "openclaw/plugin-sdk/number-runtime";

function hasInputValue(value: unknown): boolean {
  return value != null;
}

export function readRouteFiniteNumber(value: unknown, fieldName: string): number | undefined {
  const parsed = parseStrictFiniteNumber(value);
  if (parsed === undefined && hasInputValue(value)) {
    throw new Error(`${fieldName} must be a finite number.`);
  }
  return parsed;
}

export function readRoutePositiveInteger(value: unknown, fieldName: string): number | undefined {
  const parsed = parseStrictPositiveInteger(value);
  if (parsed === undefined && hasInputValue(value)) {
    throw new Error(`${fieldName} must be a positive integer.`);
  }
  return parsed;
}
