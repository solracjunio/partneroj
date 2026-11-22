import { describe, expect, it } from "vitest";

import { passkeyLogin, passkeyRegistration } from "./passkeys.js";

const valid = {
  id: "Y3JlZGVudGlhbA",
  rawId: "Y3JlZGVudGlhbA",
  type: "public-key",
  response: {
    clientDataJSON: "eyJ0eXBlIjoid2ViYXV0aG4uY3JlYXRlIn0",
    attestationObject: "o2NmbXRkbm9uZQ",
    transports: ["internal", "hybrid"],
  },
  clientExtensionResults: {},
  authenticatorAttachment: "platform",
};

describe("passkeyRegistration", () => {
  it("accepts a browser's answer", () => {
    expect(passkeyRegistration.parse(valid)).toEqual(valid);
  });

  it("accepts an answer without the optional fields", () => {
    const bare = {
      id: valid.id,
      rawId: valid.rawId,
      type: valid.type,
      response: {
        clientDataJSON: valid.response.clientDataJSON,
        attestationObject: valid.response.attestationObject,
      },
      clientExtensionResults: {},
    };
    expect(passkeyRegistration.parse(bare)).toEqual(bare);
  });

  it("drops the fields a browser adds, and any extension", () => {
    const parsed = passkeyRegistration.parse({
      ...valid,
      response: {
        ...valid.response,
        publicKey: "cHVi",
        publicKeyAlgorithm: -7,
      },
      clientExtensionResults: { credProps: { rk: true } },
    });
    expect(parsed).toEqual(valid);
  });

  it.each([
    ["an id not in base64url", { ...valid, id: "a+b" }],
    ["a rawId with padding", { ...valid, rawId: "YQ==" }],
    ["an empty id", { ...valid, id: "" }],
    ["another type", { ...valid, type: "password" }],
    [
      "client data not in base64url",
      { ...valid, response: { ...valid.response, clientDataJSON: "{}" } },
    ],
    [
      "no attestation object",
      {
        ...valid,
        response: { clientDataJSON: valid.response.clientDataJSON },
      },
    ],
    [
      "transports that aren't strings",
      { ...valid, response: { ...valid.response, transports: [1] } },
    ],
    ["no extension results", { ...valid, clientExtensionResults: undefined }],
    ["an unknown attachment", { ...valid, authenticatorAttachment: "usb" }],
  ])("refuses %s", (_case, body) => {
    expect(passkeyRegistration.safeParse(body).success).toBe(false);
  });
});

const login = {
  id: "Y3JlZGVudGlhbA",
  rawId: "Y3JlZGVudGlhbA",
  type: "public-key",
  response: {
    clientDataJSON: "eyJ0eXBlIjoid2ViYXV0aG4uZ2V0In0",
    authenticatorData: "SZYN5YgOjGh0NBcPZHZgW4",
    signature: "MEUCIQDsaWduYXR1cmU",
    userHandle: "AaHCW3v4fOqzfVGUlguaoA",
  },
  clientExtensionResults: {},
  authenticatorAttachment: "platform",
};

describe("passkeyLogin", () => {
  it("accepts a browser's answer", () => {
    expect(passkeyLogin.parse(login)).toEqual(login);
  });

  it("drops the fields a browser adds, and any extension", () => {
    const parsed = passkeyLogin.parse({
      ...login,
      response: { ...login.response, extra: "x" },
      clientExtensionResults: { credProps: { rk: true } },
    });
    expect(parsed).toEqual(login);
  });

  it.each([
    ["an id not in base64url", { ...login, id: "a+b" }],
    ["another type", { ...login, type: "password" }],
    [
      "no user handle",
      {
        ...login,
        response: {
          clientDataJSON: login.response.clientDataJSON,
          authenticatorData: login.response.authenticatorData,
          signature: login.response.signature,
        },
      },
    ],
    [
      "a signature not in base64url",
      { ...login, response: { ...login.response, signature: "MEU=" } },
    ],
    [
      "authenticator data not in base64url",
      { ...login, response: { ...login.response, authenticatorData: "a b" } },
    ],
    ["no extension results", { ...login, clientExtensionResults: undefined }],
    ["an unknown attachment", { ...login, authenticatorAttachment: "usb" }],
  ])("refuses %s", (_case, body) => {
    expect(passkeyLogin.safeParse(body).success).toBe(false);
  });
});
