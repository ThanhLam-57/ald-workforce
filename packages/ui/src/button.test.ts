import { describe, expect, it } from "vitest";

import { buttonClassName } from "./button";

describe("buttonClassName", () => {
  it("does not mix the primary white text with light variants", () => {
    for (const variant of [
      "secondary",
      "soft",
      "outline-sky",
      "outline-violet",
      "outline-danger",
      "link",
    ] as const) {
      const className = buttonClassName({ variant });

      expect(className).not.toContain("bg-slate-950");
      expect(className).not.toContain("text-white");
    }
  });

  it("keeps the primary button high contrast", () => {
    const className = buttonClassName();

    expect(className).toContain("bg-slate-950");
    expect(className).toContain("text-white");
  });
});
