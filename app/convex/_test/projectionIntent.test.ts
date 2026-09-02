import { describe, expect, it } from "vitest";
import { classifyInbound, THREAD_INTENTS } from "../lib/channels/intents";

const cases: Array<[string, { leadStatus?: string; intent?: string }]> = [
  ["", { leadStatus: "interested" }],
  ["Olá!", { leadStatus: "interested", intent: "greeting" }],
  ["bom dia", { leadStatus: "interested", intent: "greeting" }],
  ["Qual é o preço da consulta?", { leadStatus: "wants_booking", intent: "booking_request" }],
  ["Quanto custa a limpeza?", { leadStatus: "asked_price", intent: "price_request" }],
  ["Queria marcar para amanhã", { leadStatus: "wants_booking", intent: "booking_request" }],
  ["Posso remarcar a consulta?", { leadStatus: "wants_booking", intent: "reschedule" }],
  ["Quero cancelar a marcação", { intent: "cancel" }],
  ["Confirmo, estarei lá", { leadStatus: "confirmed", intent: "confirm_attendance" }],
  ["Prefiro falar com uma pessoa", { leadStatus: "awaiting_human", intent: "human_request" }],
  ["Não quero mais mensagens", { leadStatus: "lost", intent: "opt_out" }],
  ["STOP", { leadStatus: "lost", intent: "opt_out" }],
  ["Tenho dor de dentes há dois dias", { leadStatus: "interested", intent: "clinical_question" }],
  ["O atendimento foi péssimo", { leadStatus: "interested", intent: "complaint" }],
  ["Não consigo abrir o link", { leadStatus: "interested", intent: "support" }],
  ["Onde fica a clínica?", { leadStatus: "interested", intent: "info_request" }],
  ["ok obrigado", { leadStatus: "interested", intent: "other" }],
];

describe("classifyInbound", () => {
  it.each(cases)("classifies %j", (text, expected) => {
    expect(classifyInbound(text)).toEqual(expected);
  });

  it("only produces known intents", () => {
    for (const [text] of cases) {
      const { intent } = classifyInbound(text);
      if (intent) expect(THREAD_INTENTS).toContain(intent);
    }
  });

  it("ignores accents and casing", () => {
    expect(classifyInbound("MARCAÇÃO para sexta")).toEqual(classifyInbound("marcacao para sexta"));
  });
});
