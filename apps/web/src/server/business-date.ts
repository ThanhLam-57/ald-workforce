import { toBusinessDateString } from "@ald/domain";

export function toBusinessDate(now: Date): Date {
  return parseBusinessDate(toBusinessDateString(now));
}

export function parseBusinessDate(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}
