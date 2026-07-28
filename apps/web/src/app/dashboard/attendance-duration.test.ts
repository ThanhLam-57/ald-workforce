import { describe, expect, it } from "vitest";

import {
  durationInputError,
  formatDurationMinutes,
  isDurationInputDraft,
  parseDurationMinutes,
} from "./attendance-duration";

describe("attendance duration HH:mm", () => {
  it.each([
    [0, "00:00"],
    [90, "01:30"],
    [495, "08:15"],
    [2_880, "48:00"],
  ])("formats %i minutes as %s", (minutes, expected) => {
    expect(formatDurationMinutes(minutes)).toBe(expected);
  });

  it.each([
    ["01:30", 90],
    ["00:45", 45],
    ["1:05", 65],
    ["48:00", 2_880],
  ])("parses %s as %i minutes", (value, expected) => {
    expect(parseDurationMinutes(value)).toBe(expected);
  });

  it.each(["01:60", "-1:00", "text", "49:00", "1:5", ""])(
    "rejects invalid duration %s",
    (value) => {
      expect(parseDurationMinutes(value)).toBeNull();
      expect(durationInputError(value)).not.toBeNull();
    },
  );

  it.each(["", "0", "01", "1:", "01:", "1:3", "01:30", "48:00"])(
    "accepts editable duration draft %s",
    (value) => {
      expect(isDurationInputDraft(value)).toBe(true);
    },
  );

  it.each(["text", "01::30", "001:30", "49", "49:00", "48:01", "01:60", "01:300"])(
    "blocks invalid duration draft %s",
    (value) => {
      expect(isDurationInputDraft(value)).toBe(false);
    },
  );
});
