import { describe, expect, it } from "vitest";
import {
  detectPromises,
  promiseAlertTitle,
  promiseOwnership,
  promiseSummary,
} from "../lib/ai/promises";

const NOTHING_DONE = {
  toolsRan: false,
  followUpAlive: false,
  appointmentTouched: false,
  humanCaseOpen: false,
  memberOwns: false,
};

describe("promises the reply makes", () => {
  it("reads a commitment out of the way people actually write", () => {
    expect(detectPromises("Vou confirmar o preço com a equipa e digo-lhe.").map((p) => p.kind)).toContain("check_info");
    expect(detectPromises("Entro em contacto ainda hoje.").map((p) => p.kind)).toContain("callback");
    expect(detectPromises("Vou marcar para quinta às 10h.").map((p) => p.kind)).toContain("booking");
    expect(detectPromises("Alguém da equipa vai entrar em contacto consigo.").map((p) => p.kind)).toContain("team_contact");
  });

  it("does not invent a promise out of an ordinary answer", () => {
    expect(detectPromises("A consulta de rotina custa 1500 MZN.")).toEqual([]);
    expect(detectPromises("Estamos abertos de segunda a sexta, das 8h às 17h.")).toEqual([]);
    expect(detectPromises("")).toEqual([]);
  });

  it("counts one commitment per kind, however many ways it is phrased", () => {
    const promises = detectPromises("Vou confirmar isso. Assim que souber, vou verificar e aviso-lhe.");
    const kinds = promises.map((p) => p.kind);
    // "vou confirmar" and "vou verificar" are the same commitment; counting
    // both would inflate an indicator until people learn to ignore it.
    expect(kinds.filter((kind) => kind === "check_info")).toHaveLength(1);
  });

  it("says nobody is responsible — never that the promise was broken", () => {
    const promises = detectPromises("Vou confirmar com a equipa e volto a contactar.");
    const verdict = promiseOwnership(promises, NOTHING_DONE);
    expect(verdict).toMatchObject({ owned: false, why: "no_action_taken" });
    const title = promiseAlertTitle(promises, "pt");
    expect(title).toContain("nada no sistema está a garantir");
    expect(title).not.toMatch(/cumpri|falhou|quebr/i);
  });

  it("treats any of the three places responsibility can live as ownership", () => {
    const promises = detectPromises("Vou confirmar e digo-lhe.");
    for (const fact of ["toolsRan", "followUpAlive", "appointmentTouched", "humanCaseOpen", "memberOwns"] as const) {
      expect(promiseOwnership(promises, { ...NOTHING_DONE, [fact]: true }), fact).toEqual({ owned: true });
    }
  });

  it("a reply with no promise is owned by definition", () => {
    expect(promiseOwnership([], NOTHING_DONE)).toEqual({ owned: true });
  });

  it("describes the debt in both languages", () => {
    const promises = detectPromises("Vou marcar e a equipa vai ligar.");
    expect(promiseSummary(promises, "pt")).toContain("marcar");
    expect(promiseSummary(promises, "en")).toContain("book");
    expect(promiseAlertTitle(promises, "en")).toContain("nothing in the system");
  });
});
