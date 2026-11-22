// @vitest-environment jsdom
import {
  type AuthenticationResponseJSON,
  browserSupportsWebAuthn,
  type PublicKeyCredentialRequestOptionsJSON,
  startAuthentication,
  WebAuthnError,
} from "@simplewebauthn/browser";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PasskeyLogin } from "./PasskeyLogin";
import { type Answer, fakeServer, later } from "./testing";

// jsdom has no WebAuthn: the phone's side is the library's, stubbed here.
// The button, passkey.ts and api.ts run for real, against the fake server.
vi.mock(import("@simplewebauthn/browser"), async (original) => ({
  ...(await original()),
  browserSupportsWebAuthn: vi.fn(),
  startAuthentication: vi.fn(),
}));
const supports = vi.mocked(browserSupportsWebAuthn);
const authenticate = vi.mocked(startAuthentication);

const OPTIONS = "POST /api/auth/passkeys/login/options";
const LOGIN = "POST /api/auth/passkeys/login";

/** What the API's generateAuthenticationOptions gives, trimmed. */
const options: PublicKeyCredentialRequestOptionsJSON = {
  challenge: "q2Rz6xUoJ7cWvYtQ0aD1hA",
  rpId: "partneroj.test",
  userVerification: "required",
};

/** What the phone answers, as startAuthentication hands it over. */
const response: AuthenticationResponseJSON = {
  id: "c3BhcmtsaW5nLXBhc3NrZXk",
  rawId: "c3BhcmtsaW5nLXBhc3NrZXk",
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

function server(routes: Record<string, Answer> = {}) {
  return fakeServer({
    [OPTIONS]: { status: 200, body: options },
    [LOGIN]: { status: 204 },
    ...routes,
  });
}

const enter = () =>
  screen.findByRole("button", { name: "Entrar com a digital" });

beforeEach(() => {
  supports.mockReset().mockReturnValue(true);
  authenticate.mockReset().mockResolvedValue(response);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Entrar com a digital", () => {
  it("is not shown in a browser without WebAuthn, and asks nothing", () => {
    const api = server();
    supports.mockReturnValue(false);
    const { container } = render(<PasskeyLogin onSignedIn={vi.fn()} />);
    expect(container.textContent).toBe("");
    expect(api.sent()).toEqual([]);
  });

  it("signs in with the API's options and the phone's answer", async () => {
    const api = server();
    const onSignedIn = vi.fn();
    render(<PasskeyLogin onSignedIn={onSignedIn} />);
    expect(api.sent()).toEqual([]);

    await userEvent.click(await enter());

    await vi.waitFor(() => expect(onSignedIn).toHaveBeenCalledOnce());
    expect(authenticate).toHaveBeenCalledWith({ optionsJSON: options });
    expect(api.sent().map((r) => r.route)).toEqual([OPTIONS, LOGIN]);
    const [sent] = api.sent(LOGIN);
    expect(JSON.parse(sent!.body as string)).toEqual(response);
    expect(sent!.headers.get("Content-Type")).toBe("application/json");
  });

  it("waits for the fingerprint without a button to tap twice", async () => {
    server();
    const phone = later<AuthenticationResponseJSON>();
    authenticate.mockReturnValue(phone.promise);
    const onSignedIn = vi.fn();
    render(<PasskeyLogin onSignedIn={onSignedIn} />);

    await userEvent.click(await enter());

    expect(await screen.findByText("Aguardando a digital…")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
    phone.settle(response);
    await vi.waitFor(() => expect(onSignedIn).toHaveBeenCalledOnce());
  });

  it("says so when the partner closes the phone's question, and can try again", async () => {
    server();
    authenticate.mockRejectedValueOnce(
      new WebAuthnError({
        message: "closed",
        code: "ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY",
        cause: new DOMException("closed", "NotAllowedError"),
      }),
    );
    const onSignedIn = vi.fn();
    render(<PasskeyLogin onSignedIn={onSignedIn} />);

    await userEvent.click(await enter());

    expect((await screen.findByRole("status")).textContent).toBe(
      "Entrada cancelada. Tente de novo quando quiser.",
    );
    await userEvent.click(await enter());
    await vi.waitFor(() => expect(onSignedIn).toHaveBeenCalledOnce());
  });

  it("sends to an invite when the API doesn't know the passkey", async () => {
    server({ [LOGIN]: { status: 401 } });
    const onSignedIn = vi.fn();
    render(<PasskeyLogin onSignedIn={onSignedIn} />);

    await userEvent.click(await enter());

    expect((await screen.findByRole("alert")).textContent).toBe(
      "Esta digital não está cadastrada no Partneroj. Peça um convite a um administrador.",
    );
    expect(onSignedIn).not.toHaveBeenCalled();
  });

  it.each<{ when: string; routes: Record<string, Answer> }>([
    { when: "the options", routes: { [OPTIONS]: { status: 429 } } },
    { when: "the sign-in", routes: { [LOGIN]: { status: 429 } } },
  ])(
    "asks to wait a minute when $when are over the limit",
    async ({ routes }) => {
      server(routes);
      render(<PasskeyLogin onSignedIn={vi.fn()} />);

      await userEvent.click(await enter());

      expect((await screen.findByRole("alert")).textContent).toBe(
        "Muitas tentativas. Espere um minuto e tente de novo.",
      );
      expect(await enter()).toBeTruthy();
    },
  );

  it.each<{ when: string; arrange: () => void }>([
    {
      when: "the phone fails",
      arrange: () => authenticate.mockRejectedValue(new Error("broken")),
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
      arrange: () => server({ [LOGIN]: { status: 400 } }),
    },
  ])("says to try again when $when", async ({ arrange }) => {
    server();
    arrange();
    const onSignedIn = vi.fn();
    render(<PasskeyLogin onSignedIn={onSignedIn} />);

    await userEvent.click(await enter());

    expect((await screen.findByRole("alert")).textContent).toBe(
      "Não deu para entrar com a digital. Tente de novo.",
    );
    expect(onSignedIn).not.toHaveBeenCalled();
    expect(await enter()).toBeTruthy();
  });

  it("doesn't ask the phone when the API gives no options", async () => {
    server({ [OPTIONS]: { status: 429 } });
    render(<PasskeyLogin onSignedIn={vi.fn()} />);
    await userEvent.click(await enter());
    await screen.findByRole("alert");
    expect(authenticate).not.toHaveBeenCalled();
  });
});
