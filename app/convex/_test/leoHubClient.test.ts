import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildLeoHubInteractivePayload,
  buildLeoHubTemplatePayload,
  buildLeoHubTextPayload,
  createLeoHubFlow,
  leoHubEndpoint,
  listLeoHubFlows,
  publishLeoHubFlow,
  sendLeoHubTemplate,
  sendLeoHubText,
  uploadLeoHubFlowAsset,
} from "../lib/leoHub/client";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Leo Hub client", () => {
  it("normalizes endpoints and phone payloads", () => {
    expect(leoHubEndpoint("/messages/text", "https://apihub.iasolution.app")).toBe(
      "https://apihub.iasolution.app/api/v1/messages/text",
    );
    expect(leoHubEndpoint("flows", "https://apihub.iasolution.app/api/v1/")).toBe(
      "https://apihub.iasolution.app/api/v1/flows",
    );
    expect(buildLeoHubTextPayload({ to: "+258 86 043 9352", text: "Ola" })).toEqual({
      to: "258860439352",
      text: "Ola",
      preview_url: false,
    });
  });

  it("adds the Meta-required text header type for interactive payloads", () => {
    expect(
      buildLeoHubInteractivePayload({
        to: "+258860439352",
        interactive: {
          type: "list",
          header: "Agenda",
          body: "Escolha o departamento",
          action: { button: "Departamentos", sections: [] },
        },
      }),
    ).toMatchObject({
      to: "258860439352",
      interactive: {
        type: "list",
        header: { type: "text", text: "Agenda" },
        body: { text: "Escolha o departamento" },
        action: { button: "Departamentos", sections: [] },
      },
    });
  });

  it("sends text through the Hub transport and unwraps success data", async () => {
    const calls: Array<{ url: string; headers: Record<string, string>; body: unknown }> = [];
    vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
      calls.push({
        url: input.toString(),
        headers: Object.fromEntries(new Headers(init?.headers).entries()),
        body: init?.body ? JSON.parse(String(init.body)) : null,
      });
      return Response.json({ success: true, data: { messageId: "hub_msg_1" } });
    });

    const result = await sendLeoHubText({
      token: "channel-token",
      baseUrl: "https://hub.example",
      to: "+258860439352",
      text: "Teste",
    });

    expect(result).toMatchObject({ ok: true, data: { messageId: "hub_msg_1" } });
    expect(calls[0]).toMatchObject({
      url: "https://hub.example/api/v1/messages/text",
      body: { to: "258860439352", text: "Teste", preview_url: false },
    });
    expect(calls[0].headers.authorization).toBe("Bearer channel-token");
  });

  it("builds and sends template payloads for closed service windows", async () => {
    const calls: Array<{ url: string; body: unknown }> = [];
    vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
      calls.push({
        url: input.toString(),
        body: init?.body ? JSON.parse(String(init.body)) : null,
      });
      return Response.json({ success: true, data: { messageId: "template_msg_1" } });
    });

    expect(
      buildLeoHubTemplatePayload({
        to: "+258860439352",
        templateName: "booking_reminder",
        languageCode: "pt_PT",
        bodyVariables: ["Maria", "10:30"],
      }),
    ).toEqual({
      to: "258860439352",
      template: {
        name: "booking_reminder",
        language: { code: "pt_PT" },
        components: [
          {
            type: "body",
            parameters: [
              { type: "text", text: "Maria" },
              { type: "text", text: "10:30" },
            ],
          },
        ],
      },
    });

    await expect(
      sendLeoHubTemplate({
        token: "channel-token",
        baseUrl: "https://hub.example",
        to: "+258860439352",
        templateName: "booking_reminder",
        languageCode: "pt_PT",
        bodyVariables: ["Maria", "10:30"],
      }),
    ).resolves.toMatchObject({ ok: true, data: { messageId: "template_msg_1" } });
    expect(calls[0].url).toBe("https://hub.example/api/v1/messages/template");
  });

  it("supports Flow container lifecycle endpoints", async () => {
    const calls: Array<{ url: string; method?: string; bodyType: string; bodyText?: string }> = [];
    vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
      const url = input.toString();
      const isFormData = init?.body instanceof FormData;
      calls.push({
        url,
        method: init?.method,
        bodyType: isFormData ? "form-data" : typeof init?.body,
        bodyText: !isFormData && init?.body ? String(init.body) : undefined,
      });
      if (url.endsWith("/flows") && init?.method === "GET") {
        return Response.json({ success: true, data: [] });
      }
      if (url.endsWith("/flows")) {
        return Response.json({ success: true, data: { flow_id: "FLOW_1" } });
      }
      if (url.endsWith("/assets")) {
        return Response.json({ success: true, data: { success: true } });
      }
      if (url.endsWith("/publish")) {
        return Response.json({ success: true, data: { flow_id: "FLOW_1", status: "PUBLISHED" } });
      }
      return Response.json({ success: false, message: `unexpected ${url}` }, { status: 500 });
    });

    await expect(listLeoHubFlows({ token: "token", baseUrl: "https://hub.example" })).resolves.toMatchObject({
      ok: true,
      data: [],
    });
    await expect(
      createLeoHubFlow({
        token: "token",
        baseUrl: "https://hub.example",
        name: "iame_booking",
        categories: ["APPOINTMENT_BOOKING"],
      }),
    ).resolves.toMatchObject({ ok: true, data: { flow_id: "FLOW_1" } });
    await expect(
      uploadLeoHubFlowAsset({
        token: "token",
        baseUrl: "https://hub.example",
        flowId: "FLOW_1",
        flowJson: { version: "7.3", screens: [] },
      }),
    ).resolves.toMatchObject({ ok: true, data: { success: true } });
    await expect(
      publishLeoHubFlow({
        token: "token",
        baseUrl: "https://hub.example",
        flowId: "FLOW_1",
      }),
    ).resolves.toMatchObject({ ok: true, data: { status: "PUBLISHED" } });

    expect(calls.map((call) => call.url)).toEqual([
      "https://hub.example/api/v1/flows",
      "https://hub.example/api/v1/flows",
      "https://hub.example/api/v1/flows/FLOW_1/assets",
      "https://hub.example/api/v1/flows/FLOW_1/publish",
    ]);
    expect(calls[2].bodyType).toBe("form-data");
    expect(calls[1].bodyText).toBe(
      JSON.stringify({ name: "iame_booking", categories: ["APPOINTMENT_BOOKING"] }),
    );
  });

  it("normalizes Hub error envelopes", async () => {
    vi.stubGlobal("fetch", async () =>
      Response.json({ success: false, message: "invalid token" }, { status: 401 }),
    );

    await expect(
      sendLeoHubText({
        token: "bad-token",
        baseUrl: "https://hub.example",
        to: "+258860439352",
        text: "Teste",
      }),
    ).resolves.toMatchObject({
      ok: false,
      status: 401,
      reason: "invalid token",
    });
  });
});
