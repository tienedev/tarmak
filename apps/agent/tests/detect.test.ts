import { describe, it, expect } from "vitest";
import { normalizeUrl } from "../src/detect.js";

describe("detect", () => {
  describe("normalizeUrl", () => {
    it("strips .git suffix", () => {
      expect(normalizeUrl("https://github.com/user/repo.git")).toBe(
        "github.com/user/repo"
      );
    });

    it("converts SSH to canonical form", () => {
      expect(normalizeUrl("git@github.com:user/repo.git")).toBe(
        "github.com/user/repo"
      );
    });

    it("strips protocol", () => {
      expect(normalizeUrl("https://github.com/user/repo")).toBe(
        "github.com/user/repo"
      );
    });

    it("lowercases", () => {
      expect(normalizeUrl("https://GitHub.com/User/REPO")).toBe(
        "github.com/user/repo"
      );
    });
  });
});
