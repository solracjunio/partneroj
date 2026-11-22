// @vitest-environment jsdom
import {
  platformAuthenticatorIsAvailable,
  type PublicKeyCredentialCreationOptionsJSON,
  type RegistrationResponseJSON,
  startRegistration,
  WebAuthnError,
  type WebAuthnErrorCode,
} from "@simplewebauthn/browser";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PasskeyCard } from "./PasskeyCard";
import { type Answer, fakeServer, later } from "./testing";

// jsdom has no WebAuthn: the phone's side is the library's, stubbed here.
// The card, passkey.ts and api.ts run for real, against the fake server.
vi.mock(import("@simplewebauthn/browser"), async (original) => ({
  ...(await original()),
  platformAuthenticatorIsAvailable: vi.fn(),
  startRegistration: vi.fn(),
}));
const available = vi.mocked(platformAuthenticatorIsAvailable);
const register = vi.mocked(startRegistration);

const OPTIONS = "POST /api/auth/passkeys/register/options";
const REGISTER = "POST /api/auth/passkeys/register";

/** What the API's generateRegistrationOptions gives, trimmed. */
const options: PublicKeyCredentialCreationOptionsJSON = {
  rp: { name: "Partneroj", id: "partneroj.test" },
  user: { id: "AaHCW3v4fOqzfVGUlguaoA", name: "Ana", displayName: "Ana" },
  challenge: "q2Rz6xUoJ7cWvYtQ0aD1hA",
  pubKeyCredParams: [{ type: "public-key", alg: -7 }],
  excludeCredentials: [],
  authenticatorSelection: {
    residentKey: "required",
    userVerification: "required",
  },
  attestation: "none",
};

/** What the phone answers, as startRegistration hands it over. */
const response: RegistrationResponseJSON = {
  id: "c3BhcmtsaW5nLXBhc3NrZXk",
  rawId: "c3BhcmtsaW5nLXBhc3NrZXk",
  type: "public-key",
  response: {
    clientDataJSON: "eyJ0eXBlIjoid2ViYXV0aG4uY3JlYXRlIn0",
    attestationObject: "o2NmbXRkbm9uZQ",
    transports: ["internal", "hybrid"],
  },
  clientExtensionResults: {},
  authenticatorAttachment: "platform",
};

/** The phone's refusal, as the library throws it (identifyRegistrationError). */
function phoneError(name: string, code: WebAuthnErrorCode) {
  return new WebAuthnError({
    message: "refused",
    code,
    cause: new DOMException("refused", name),
  });
}

function server(routes: Record<string, Answer> = {}) {
  return fakeServer({
    [OPTIONS]: { status: 200, body: options },
    [REGISTER]: { status: 204 },
    ...routes,
  });
}

const offer = () => screen.findByRole("button", { name: "Cadastrar digital" });
const done = () =>
  screen.findByText("Pronto: sua conta está protegida pela digital.");

/** Lets the card's first effects settle before checking it shows nothing. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  available.mockReset().mockResolvedValue(true);
  register.mockReset().mockResolvedValue(response);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  sessionStorage.clear();
});

describe("the passkey card", () => {
  it("offers a passkey to a member without one, asking the API nothing yet", async () => {
    const api = server();
    render(<PasskeyCard hasPasskey={false} />);
    expect(await offer()).toBeTruthy();
    expect(screen.getByText("Proteja sua conta com a digital.")).toBeTruthy();
    expect(api.sent()).toEqual([]);
  });

  it("is not shown to a member who has one, without asking the phone", async () => {
    server();
    const { container } = render(<PasskeyCard hasPasskey />);
    await settle();
    expect(container.textContent).toBe("");
    expect(available).not.toHaveBeenCalled();
  });

  it("is not shown on a phone without a fingerprint or screen lock", async () => {
    server();
    available.mockResolvedValue(false);
    const { container } = render(<PasskeyCard hasPasskey={false} />);
    await settle();
    expect(container.textContent).toBe("");
  });

  it("is not shown when the phone can't say", async () => {
    server();
    available.mockRejectedValue(new Error("no WebAuthn"));
    const { container } = render(<PasskeyCard hasPasskey={false} />);
    await settle();
    expect(container.textContent).toBe("");
  });

  it("makes the passkey with the API's options and sends the phone's answer", async () => {
    const api = server();
    render(<PasskeyCard hasPasskey={false} />);

    await userEvent.click(await offer());

    expect(await done()).toBeTruthy();
    expect(register).toHaveBeenCalledWith({ optionsJSON: options });
    expect(api.sent().map((r) => r.route)).toEqual([OPTIONS, REGISTER]);
    const [sent] = api.sent(REGISTER);
    expect(JSON.parse(sent!.body as string)).toEqual(response);
    expect(sent!.headers.get("Content-Type")).toBe("application/json");
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("waits for the fingerprint without buttons to tap twice", async () => {
    server();
    const phone = later<RegistrationResponseJSON>();
    register.mockReturnValue(phone.promise);
    render(<PasskeyCard hasPasskey={false} />);

    await userEvent.click(await offer());

    expect(await screen.findByText("Aguardando a digital…")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
    phone.settle(response);
    expect(await done()).toBeTruthy();
  });

  it("says so when the partner closes the phone's question, and can try again", async () => {
    const api = server();
    register.mockRejectedValueOnce(
      phoneError("NotAllowedError", "ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY"),
    );
    render(<PasskeyCard hasPasskey={false} />);

    await userEvent.click(await offer());

    expect(
      await screen.findByText(
        "Cadastro cancelado. Tente de novo quando quiser.",
      ),
    ).toBeTruthy();
    expect(api.sent(REGISTER)).toEqual([]);

    await userEvent.click(await offer());
    expect(await done()).toBeTruthy();
  });

  it("takes a passkey the phone already had as done", async () => {
    const api = server();
    register.mockRejectedValue(
      phoneError(
        "InvalidStateError",
        "ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED",
      ),
    );
    render(<PasskeyCard hasPasskey={false} />);

    await userEvent.click(await offer());

    expect(await done()).toBeTruthy();
    expect(api.sent(REGISTER)).toEqual([]);
  });

  it("takes a passkey the API already had (409) as done", async () => {
    server({ [REGISTER]: { status: 409 } });
    render(<PasskeyCard hasPasskey={false} />);
    await userEvent.click(await offer());
    expect(await done()).toBeTruthy();
  });

  it.each<{ when: string; arrange: () => void }>([
    {
      when: "the phone fails",
      arrange: () =>
        register.mockRejectedValue(
          phoneError(
            "ConstraintError",
            "ERROR_AUTHENTICATOR_MISSING_USER_VERIFICATION_SUPPORT",
          ),
        ),
    },
    {
      when: "the phone throws something else",
      arrange: () => register.mockRejectedValue("?"),
    },
    {
      when: "the options fail",
      arrange: () => server({ [OPTIONS]: { status: 500 } }),
    },
    {
      when: "there is no connection",
      arrange: () => server({ [OPTIONS]: "offline" }),
    },
    {
      when: "the API refuses the answer",
      arrange: () => server({ [REGISTER]: { status: 400 } }),
    },
  ])("says to try again when $when", async ({ arrange }) => {
    server();
    arrange();
    render(<PasskeyCard hasPasskey={false} />);

    await userEvent.click(await offer());

    expect((await screen.findByRole("alert")).textContent).toBe(
      "Não deu para cadastrar a digital. Tente de novo.",
    );
    expect(await offer()).toBeTruthy();
  });

  it("doesn't ask the phone when the API gives no options", async () => {
    server({ [OPTIONS]: { status: 500 } });
    render(<PasskeyCard hasPasskey={false} />);
    await userEvent.click(await offer());
    await screen.findByRole("alert");
    expect(register).not.toHaveBeenCalled();
  });

  it("hides on 'Agora não' until the app is opened again", async () => {
    const api = server();
    render(<PasskeyCard hasPasskey={false} />);

    await userEvent.click(
      await screen.findByRole("button", { name: "Agora não" }),
    );

    expect(screen.queryByText("Proteja sua conta com a digital.")).toBeNull();
    cleanup();
    const { container } = render(<PasskeyCard hasPasskey={false} />);
    await settle();
    expect(container.textContent).toBe("");
    expect(api.sent()).toEqual([]);
  });

  it("still hides on 'Agora não' when the phone keeps nothing", async () => {
    server();
    vi.stubGlobal("sessionStorage", {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    });
    render(<PasskeyCard hasPasskey={false} />);

    await userEvent.click(
      await screen.findByRole("button", { name: "Agora não" }),
    );

    expect(screen.queryByText("Proteja sua conta com a digital.")).toBeNull();
  });
});
