import { describe, expect, it } from "vitest";
import { passwordError } from "../lib/signup";
describe("signup password limits", () => {
  it("counts Unicode characters rather than UTF-16 units", () => {
    expect(passwordError("😀".repeat(14))).toContain("15 characters");
    expect(passwordError("😀".repeat(15))).toBe("");
  });
  it("enforces the bcrypt byte boundary without truncation", () => {
    expect(passwordError("a".repeat(72))).toBe("");
    expect(passwordError("a".repeat(73))).toContain("72 UTF-8 bytes");
    expect(passwordError("😀".repeat(18))).toBe("");
    expect(passwordError("😀".repeat(19))).toContain("72 UTF-8 bytes");
  });
});
