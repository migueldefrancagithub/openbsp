const DEFAULT_LEO_HUB_BASE_URL = "https://apihub.iasolution.app/api/v1";
const DEFAULT_TIMEOUT_MS = 8_000;

export type LeoHubError = {
  ok: false;
  status?: number;
  reason: string;
  raw?: unknown;
};

export type LeoHubSuccess<T> = {
  ok: true;
  status: number;
  data: T;
  raw?: unknown;
};

export type LeoHubResult<T> = LeoHubSuccess<T> | LeoHubError;

export type LeoHubRecipient = {
  e164: string;
};

export type LeoHubMessageResult = {
  messageId?: string;
  id?: string;
  wamid?: string;
  [key: string]: unknown;
};

export type LeoHubFlowContainer = {
  flow_id?: string;
  id?: string;
  name?: string;
  status?: string;
  [key: string]: unknown;
};

export type LeoHubFlowAssetResult = {
  success?: boolean;
  validation_errors?: unknown[];
  [key: string]: unknown;
};

export function leoHubBaseUrl(raw = process.env.LEO_HUB_BASE_URL ?? DEFAULT_LEO_HUB_BASE_URL) {
  const trimmed = raw.trim().replace(/\/+$/, "");
  return trimmed.endsWith("/api/v1") ? trimmed : `${trimmed}/api/v1`;
}

export function leoHubEndpoint(path: string, baseUrl?: string) {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${leoHubBaseUrl(baseUrl)}${normalizedPath}`;
}

export function leoHubPhone(input: string) {
  return input.replace(/\D/g, "");
}

function timeoutMs(input?: number) {
  const configured = Number(process.env.LEO_HUB_TIMEOUT_MS);
  const value = input ?? configured;
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_TIMEOUT_MS;
}

async function fetchWithTimeout(url: string, init: RequestInit, ms: number) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function extractPayload<T>(raw: unknown): { success: boolean | null; data: T; reason?: string } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { success: null, data: raw as T };
  }

  const body = raw as {
    success?: boolean;
    data?: T;
    message?: string;
    error?: string | { message?: string };
  };
  const errorMessage =
    typeof body.error === "string" ? body.error : typeof body.error === "object" ? body.error.message : undefined;
  return {
    success: typeof body.success === "boolean" ? body.success : null,
    data: "data" in body ? (body.data as T) : (raw as T),
    reason: errorMessage ?? body.message,
  };
}

async function parseLeoHubResponse<T>(response: Response): Promise<LeoHubResult<T>> {
  const status = response.status;
  const text = await response.text();
  let raw: unknown = text;
  if (text.trim()) {
    try {
      raw = JSON.parse(text);
    } catch {
      raw = text;
    }
  }

  const parsed = extractPayload<T>(raw);
  if (!response.ok || parsed.success === false) {
    return {
      ok: false,
      status,
      reason: parsed.reason ?? `Leo Hub HTTP ${status}`,
      raw,
    };
  }

  return {
    ok: true,
    status,
    data: parsed.data,
    raw,
  };
}

export async function leoHubRequest<T>(args: {
  token: string;
  path: string;
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  baseUrl?: string;
  timeoutMs?: number;
  headers?: Record<string, string>;
}): Promise<LeoHubResult<T>> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${args.token}`,
    ...args.headers,
  };
  let body: BodyInit | undefined;
  if (args.body instanceof FormData) {
    body = args.body;
  } else if (args.body !== undefined) {
    headers["Content-Type"] = headers["Content-Type"] ?? "application/json";
    body = JSON.stringify(args.body);
  }

  try {
    const response = await fetchWithTimeout(
      leoHubEndpoint(args.path, args.baseUrl),
      {
        method: args.method ?? (args.body === undefined ? "GET" : "POST"),
        headers,
        body,
      },
      timeoutMs(args.timeoutMs),
    );
    return await parseLeoHubResponse<T>(response);
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "AbortError";
    return {
      ok: false,
      reason: timedOut ? "leo_hub_timeout" : error instanceof Error ? error.message : "leo_hub_request_failed",
    };
  }
}

export function buildLeoHubTextPayload(args: {
  to: LeoHubRecipient | string;
  text: string;
  previewUrl?: boolean;
}) {
  const rawTo = typeof args.to === "string" ? args.to : args.to.e164;
  return {
    to: leoHubPhone(rawTo),
    text: args.text,
    preview_url: args.previewUrl ?? false,
  };
}

export async function sendLeoHubText(args: {
  token: string;
  to: LeoHubRecipient | string;
  text: string;
  previewUrl?: boolean;
  baseUrl?: string;
  timeoutMs?: number;
}) {
  return await leoHubRequest<LeoHubMessageResult>({
    token: args.token,
    path: "/messages/text",
    body: buildLeoHubTextPayload(args),
    baseUrl: args.baseUrl,
    timeoutMs: args.timeoutMs,
  });
}

function textObject(value: unknown) {
  if (!value) return undefined;
  if (typeof value === "string") return { text: value };
  if (typeof value === "object") return value;
  return { text: String(value) };
}

function textHeaderObject(value: unknown) {
  const text = textObject(value);
  if (!text || typeof text !== "object" || Array.isArray(text)) return text;
  return "type" in text ? text : { type: "text", ...text };
}

export function buildLeoHubInteractivePayload(args: {
  to: LeoHubRecipient | string;
  interactive: {
    type?: unknown;
    header?: unknown;
    body?: unknown;
    footer?: unknown;
    action?: unknown;
    context?: unknown;
  };
}) {
  const rawTo = typeof args.to === "string" ? args.to : args.to.e164;
  const input = args.interactive;
  return {
    to: leoHubPhone(rawTo),
    interactive: {
      type: input.type ?? "button",
      ...(input.header ? { header: textHeaderObject(input.header) } : {}),
      body: textObject(input.body) ?? { text: "" },
      ...(input.footer ? { footer: textObject(input.footer) } : {}),
      action: input.action ?? {},
    },
    ...(input.context ? { context: input.context } : {}),
  };
}

export async function sendLeoHubInteractive(args: {
  token: string;
  to: LeoHubRecipient | string;
  interactive: Parameters<typeof buildLeoHubInteractivePayload>[0]["interactive"];
  baseUrl?: string;
  timeoutMs?: number;
}) {
  return await leoHubRequest<LeoHubMessageResult>({
    token: args.token,
    path: "/messages/interactive",
    body: buildLeoHubInteractivePayload(args),
    baseUrl: args.baseUrl,
    timeoutMs: args.timeoutMs,
  });
}

export function buildLeoHubTemplatePayload(args: {
  to: LeoHubRecipient | string;
  templateName: string;
  languageCode: string;
  bodyVariables?: string[];
}) {
  const rawTo = typeof args.to === "string" ? args.to : args.to.e164;
  const components =
    args.bodyVariables && args.bodyVariables.length > 0
      ? [
          {
            type: "body",
            parameters: args.bodyVariables.map((text) => ({ type: "text", text })),
          },
        ]
      : undefined;

  return {
    to: leoHubPhone(rawTo),
    template: {
      name: args.templateName,
      language: {
        code: args.languageCode,
      },
      ...(components ? { components } : {}),
    },
  };
}

export async function sendLeoHubTemplate(args: {
  token: string;
  to: LeoHubRecipient | string;
  templateName: string;
  languageCode: string;
  bodyVariables?: string[];
  baseUrl?: string;
  timeoutMs?: number;
}) {
  return await leoHubRequest<LeoHubMessageResult>({
    token: args.token,
    path: "/messages/template",
    body: buildLeoHubTemplatePayload(args),
    baseUrl: args.baseUrl,
    timeoutMs: args.timeoutMs,
  });
}

export async function listLeoHubFlows(args: { token: string; baseUrl?: string; timeoutMs?: number }) {
  return await leoHubRequest<LeoHubFlowContainer[]>({
    token: args.token,
    path: "/flows",
    baseUrl: args.baseUrl,
    timeoutMs: args.timeoutMs,
  });
}

export async function createLeoHubFlow(args: {
  token: string;
  name: string;
  categories: string[];
  baseUrl?: string;
  timeoutMs?: number;
}) {
  return await leoHubRequest<LeoHubFlowContainer>({
    token: args.token,
    path: "/flows",
    body: {
      name: args.name,
      categories: args.categories,
    },
    baseUrl: args.baseUrl,
    timeoutMs: args.timeoutMs,
  });
}

export async function uploadLeoHubFlowAsset(args: {
  token: string;
  flowId: string;
  flowJson: unknown;
  filename?: string;
  baseUrl?: string;
  timeoutMs?: number;
}) {
  const form = new FormData();
  form.set(
    "file",
    new Blob([JSON.stringify(args.flowJson)], { type: "application/json" }),
    args.filename ?? "flow.json",
  );

  return await leoHubRequest<LeoHubFlowAssetResult>({
    token: args.token,
    path: `/flows/${args.flowId}/assets`,
    body: form,
    baseUrl: args.baseUrl,
    timeoutMs: args.timeoutMs,
  });
}

export async function publishLeoHubFlow(args: {
  token: string;
  flowId: string;
  baseUrl?: string;
  timeoutMs?: number;
}) {
  return await leoHubRequest<LeoHubFlowContainer>({
    token: args.token,
    path: `/flows/${args.flowId}/publish`,
    body: {},
    baseUrl: args.baseUrl,
    timeoutMs: args.timeoutMs,
  });
}
