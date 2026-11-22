import { describe, expect, it } from "vitest";

import { webAuthnConfig } from "./webauthn.js";

describe("webAuthnConfig", () => {
  it("takes the domain and the origin of the site", () => {
    expect(webAuthnConfig("https://partneroj.com.br")).toEqual({
      rpID: "partneroj.com.br",
      rpName: "Partneroj",
      origin: "https://partneroj.com.br",
    });
  });

  it("leaves out a path and a trailing slash, which an origin has not", () => {
    expect(webAuthnConfig("https://partneroj.com.br/app/").origin).toBe(
      "https://partneroj.com.br",
    );
  });

  it("keeps the port in the origin, not in the domain", () => {
    expect(webAuthnConfig("http://localhost:5173")).toEqual({
      rpID: "localhost",
      rpName: "Partneroj",
      origin: "http://localhost:5173",
    });
  });

  it.each([undefined, ""])(
    "refuses to start without PUBLIC_URL (%j)",
    (url) => {
      expect(() => webAuthnConfig(url)).toThrow("PUBLIC_URL is not set");
    },
  );

  it("refuses plain http outside localhost", () => {
    expect(() => webAuthnConfig("http://partneroj.com.br")).toThrow(
      "PUBLIC_URL must be https, or http on localhost",
    );
  });

  it("refuses what is not a URL", () => {
    expect(() => webAuthnConfig("partneroj.com.br")).toThrow();
  });
});
