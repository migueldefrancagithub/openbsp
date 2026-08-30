import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildInteractivePayload,
  buildTemplatePayload,
  buildTextPayload,
  endpoint,
  createFlow,
  getPhoneHealth,
  getPhoneInfo,
  listFlows,
  publishFlow,
  providerMessageId,
  sendTemplate,
  sendText,
  uploadFlowAsset,
} from "../integrations/leoHub/client";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Leo Hub laboratory client", () => {
  it("normalizes endpoints and E.164 recipients", () => {
    expect(endpoint("/messages/text", "https://hub.example/")).toBe(
      "https://hub.example/api/v1/messages/text",
    );
    expect(buildTextPayload({ to: "+258 84 000 0099", text: "Ola" })).toEqual({
      to: "258840000099",
      text: "Ola",
      preview_url: false,
    });
  });

  it("sends text with a channel-scoped bearer token", async () => {
    const calls: Array<{
      url: string;
      headers: Record<string, string>;
      body: unknown;
    }> = [];
    vi.stubGlobal(
      "fetch",
      async (input: string | URL | Request, init?: RequestInit) => {
        const headers = new Headers(init?.headers);
        calls.push({
          url: input.toString(),
          headers: { authorization: headers.get("authorization") ?? "" },
          body: init?.body ? JSON.parse(String(init.body)) : null,
        });
        return Response.json({
          success: true,
          data: { messageId: "hub_msg_1" },
        });
      },
    );

    const result = await sendText({
      token: "channel-token",
      customBaseUrl: "https://hub.example",
      to: "+258840000099",
      text: "Teste",
    });

    expect(result).toMatchObject({
      ok: true,
      data: { messageId: "hub_msg_1" },
    });
    expect(calls[0]).toMatchObject({
      url: "https://hub.example/api/v1/messages/text",
      body: { to: "258840000099", text: "Teste", preview_url: false },
    });
    expect(calls[0].headers.authorization).toBe("Bearer channel-token");
  });

  it("builds templates and interactive payloads", () => {
    expect(
      buildTemplatePayload({
        to: "+258840000099",
        templateName: "obsp_lab_booking",
        languageCode: "pt_PT",
        bodyVariables: ["Maria", "10:30"],
      }),
    ).toMatchObject({
      to: "258840000099",
      template: {
        name: "obsp_lab_booking",
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
    expect(
      buildInteractivePayload({
        to: "+258840000099",
        interactive: {
          type: "list",
          header: "Agenda",
          body: "Escolha",
          action: { button: "Opcoes", sections: [] },
        },
      }),
    ).toMatchObject({
      interactive: {
        type: "list",
        header: { type: "text", text: "Agenda" },
        body: { text: "Escolha" },
      },
    });
  });

  it("uses the documented phone health endpoints", async () => {
    const urls: string[] = [];
    vi.stubGlobal("fetch", async (input: string | URL | Request) => {
      urls.push(input.toString());
      return Response.json({ success: true, data: { health_status: "GREEN" } });
    });
    await getPhoneInfo({ token: "token", customBaseUrl: "https://hub.example" });
    await getPhoneHealth({ token: "token", customBaseUrl: "https://hub.example" });
    expect(urls).toEqual([
      "https://hub.example/api/v1/phone/info",
      "https://hub.example/api/v1/phone/health",
    ]);
  });

  it("supports the isolated WhatsApp Flow lifecycle", async () => {
    const urls: string[] = [];
    vi.stubGlobal(
      "fetch",
      async (input: string | URL | Request, init?: RequestInit) => {
        const url = input.toString();
        urls.push(url);
        if (url.endsWith("/flows") && init?.method === "GET") {
          return Response.json({ success: true, data: [] });
        }
        if (url.endsWith("/flows")) {
          return Response.json({
            success: true,
            data: { flow_id: "FLOW_LAB", name: "obsp_lab_booking" },
          });
        }
        if (url.endsWith("/assets")) {
          return Response.json({ success: true, data: { success: true } });
        }
        return Response.json({
          success: true,
          data: { flow_id: "FLOW_LAB", status: "PUBLISHED" },
        });
      },
    );

    await listFlows({ token: "token", customBaseUrl: "https://hub.example" });
    await createFlow({
      token: "token",
      customBaseUrl: "https://hub.example",
      name: "obsp_lab_booking",
      categories: ["APPOINTMENT_BOOKING"],
    });
    await uploadFlowAsset({
      token: "token",
      customBaseUrl: "https://hub.example",
      flowId: "FLOW_LAB",
      flowJson: { version: "7.3", screens: [] },
    });
    await publishFlow({
      token: "token",
      customBaseUrl: "https://hub.example",
      flowId: "FLOW_LAB",
    });
    expect(urls).toEqual([
      "https://hub.example/api/v1/flows",
      "https://hub.example/api/v1/flows",
      "https://hub.example/api/v1/flows/FLOW_LAB/assets",
      "https://hub.example/api/v1/flows/FLOW_LAB/publish",
    ]);
  });

  it("classifies timeouts and extracts provider message identifiers", async () => {
    vi.stubGlobal("fetch", async () => {
      const error = new Error("aborted");
      error.name = "AbortError";
      throw error;
    });
    await expect(
      sendTemplate({
        token: "token",
        customBaseUrl: "https://hub.example",
        to: "+258840000099",
        templateName: "obsp_lab_test",
        languageCode: "pt_PT",
      }),
    ).resolves.toMatchObject({ ok: false, reason: "hub_timeout" });
    expect(providerMessageId({ message_id: "wamid.1" })).toBe("wamid.1");
  });
});
