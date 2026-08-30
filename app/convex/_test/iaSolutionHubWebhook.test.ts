import { describe, expect, it } from "vitest";
import { normalizeWebhook } from "../integrations/iaSolutionHub/webhook";
import {
  buildInteractivePayload,
  buildTextPayload,
} from "../integrations/iaSolutionHub/client";

describe("iaSolution Hub webhook normalizer", () => {
  it("places ReplyContext at the payload top level", () => {
    expect(
      buildTextPayload({
        to: "+258 84 000 0099",
        text: "Resposta",
        contextMessageId: "wamid.inbound",
      }),
    ).toMatchObject({
      to: "258840000099",
      context: { message_id: "wamid.inbound" },
    });
    const payload = buildInteractivePayload({
      to: "258840000099",
      interactive: {
        type: "button",
        body: "Escolha",
        action: {},
        context: { message_id: "wamid.flow" },
      },
    });
    expect(payload).toHaveProperty("context.message_id", "wamid.flow");
    expect(payload.interactive).not.toHaveProperty("context");
  });

  it("parses nfm_reply, ReplyContext and response_json as an object", () => {
    const events = normalizeWebhook(
      {
        contacts: [{ wa_id: "258840000099" }],
        messages: [
          {
            from: "258840000099",
            id: "wamid.reply",
            type: "interactive",
            context: { id: "wamid.original" },
            interactive: {
              type: "nfm_reply",
              nfm_reply: {
                response_json: JSON.stringify({
                  flow_token: "token-123",
                  choice: "yes",
                }),
              },
            },
          },
        ],
      },
      "sha",
    );

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      eventKey: "message:wamid.reply",
      eventKind: "message.nfm_reply",
      replyToProviderMessageId: "wamid.original",
      flowToken: "token-123",
      payload: {
        flowResponse: { flow_token: "token-123", choice: "yes" },
      },
    });
  });

  it("does not accept arrays or malformed response_json as Flow data", () => {
    for (const response_json of ["[]", "not-json"]) {
      const [event] = normalizeWebhook(
        {
          messages: [
            {
              from: "258840000099",
              id: `wamid.${response_json}`,
              type: "interactive",
              interactive: {
                type: "nfm_reply",
                nfm_reply: { response_json },
              },
            },
          ],
        },
        "sha",
      );
      expect(event.eventKind).toBe("message.nfm_reply");
      expect(event.payload).not.toHaveProperty("flowResponse");
      expect(event.payload).toHaveProperty("flowResponseError");
    }
  });
});
