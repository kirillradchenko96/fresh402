import { describe, expect, it } from "vitest";
import {
  declareDiscoveryExtension,
  validateDiscoveryExtension,
} from "@x402/extensions/bazaar";

function createBazaar() {
  return declareDiscoveryExtension({
    toolName: "fresh402_check",
    description: "Check URL freshness",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string" },
      },
    },
    example: {
      url: "https://example.com/",
    },
  }).bazaar;
}

describe("Bazaar schema validation", () => {
  it("accepts valid discovery information", () => {
    expect(validateDiscoveryExtension(createBazaar())).toEqual({
      valid: true,
    });
  });

  it("rejects invalid discovery information", () => {
    const invalid = structuredClone(createBazaar());

    Object.assign(invalid.info.input, {
      toolName: 123,
    });

    const result = validateDiscoveryExtension(invalid);

    expect(result.valid).toBe(false);
    expect(result.errors?.join(" ")).toContain("toolName");
  });
});
describe("Bazaar external schema references", () => {
  it("rejects external $ref URLs", () => {
    const bazaar = createBazaar();

    Object.assign(bazaar.schema, {
      $ref: "https://example.com/external.json",
    });

    const result = validateDiscoveryExtension(bazaar);

    expect(result.valid).toBe(false);
    expect(result.errors?.join(" ")).toContain("external");
  });
});
