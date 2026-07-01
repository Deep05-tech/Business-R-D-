import { describe, expect, it } from "vitest";
import { parseBusinessInput } from "./input.js";

describe("parseBusinessInput", () => {
  it("accepts only websiteUrl and socialUrls", () => {
    expect(() =>
      parseBusinessInput({
        websiteUrl: "https://example.com",
        socialUrls: [],
        companyName: "Forbidden",
      }),
    ).toThrow();
  });

  it("normalizes allowed inputs", () => {
    expect(
      parseBusinessInput({
        websiteUrl: "https://example.com/#top",
        socialUrls: ["https://linkedin.com/company/example#about"],
      }),
    ).toEqual({
      websiteUrl: "https://example.com/",
      socialUrls: ["https://linkedin.com/company/example"],
    });
  });
});
