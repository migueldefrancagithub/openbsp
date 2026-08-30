const DEFAULT_BASE_URL = "https://apihub.iasolution.app/api/v1";
const DEFAULT_TIMEOUT_MS = 8_000;

export type HubError = {
  ok: false;
  status?: number;
  reason: string;
  raw?: unknown;
};

export type HubSuccess<T> = {
  ok: true;
  status: number;
  data: T;
  raw?: unknown;
};

export type HubResult<T> = HubSuccess<T> | HubError;

export type HubMessageResult = {
  messageId?: string;
  message_id?: string;
  id?: string;
  wamid?: string;
  [key: string]: unknown;
};

export type HubPhoneInfo = {
  display_phone_number?: string;
  phone_number_id?: string;
  verified_name?: string;
  quality_rating?: string;
  health_status?: string;
  [key: string]: unknown;
};

export type HubFlowContainer = {
  flow_id?: string;
  id?: string;
  name?: string;
  status?: string;
  [key: string]: unknown;
};

export type HubFlowAssetResult = {
  success?: boolean;
  validation_errors?: unknown[];
  [key: string]: unknown;
};

export function baseUrl(
  raw =
    process.env.WHATSAPP_HUB_BASE_URL ??
    process.env.LEO_HUB_BASE_URL ??
    DEFAULT_BASE_URL,
): string {
  const trimmed = raw.trim().replace(/\/+$/, "");
  return trimmed.endsWith("/api/v1") ? trimmed : `${trimmed}/api/v1`;
}

export function endpoint(path: string, customBaseUrl?: string): string {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${baseUrl(customBaseUrl)}${normalizedPath}`;
}

export function normalizePhone(input: string): string {
  return input.replace(/\D/g, "");
}

function requestTimeout(input?: number): number {
  const configured = Number(
    process.env.WHATSAPP_HUB_TIMEOUT_MS ?? process.env.LEO_HUB_TIMEOUT_MS,
  );
  const value = input ?? configured;
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_TIMEOUT_MS;
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function extractPayload<T>(raw: unknown): {
  success: boolean | null;
  data: T;
  reason?: string;
} {
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
    typeof body.error === "string"
      ? body.error
      : typeof body.error === "object"
        ? body.error.message
        : undefined;
  return {
    success: typeof body.success === "boolean" ? body.success : null,
    data: "data" in body ? (body.data as T) : (raw as T),
    reason: errorMessage ?? body.message,
  };
}

async function parseResponse<T>(response: Response): Promise<HubResult<T>> {
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
      reason: parsed.reason ?? `Hub HTTP ${status}`,
      raw,
    };
  }

  return { ok: true, status, data: parsed.data, raw };
}

export async function request<T>(args: {
  token: string;
  path: string;
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  customBaseUrl?: string;
  timeoutMs?: number;
  headers?: Record<string, string>;
}): Promise<HubResult<T>> {
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
      endpoint(args.path, args.customBaseUrl),
      {
        method: args.method ?? (args.body === undefined ? "GET" : "POST"),
        headers,
        body,
      },
      requestTimeout(args.timeoutMs),
    );
    return await parseResponse<T>(response);
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "AbortError";
    return {
      ok: false,
      reason: timedOut
        ? "hub_timeout"
        : error instanceof Error
          ? error.message
          : "hub_request_failed",
    };
  }
}

export function buildTextPayload(args: {
  to: string;
  text: string;
  previewUrl?: boolean;
  contextMessageId?: string;
}) {
  return {
    to: normalizePhone(args.to),
    text: args.text,
    preview_url: args.previewUrl ?? false,
    ...(args.contextMessageId
      ? { context: { message_id: args.contextMessageId } }
      : {}),
  };
}

export async function sendText(args: {
  token: string;
  to: string;
  text: string;
  previewUrl?: boolean;
  contextMessageId?: string;
  customBaseUrl?: string;
  timeoutMs?: number;
}) {
  return await request<HubMessageResult>({
    token: args.token,
    path: "/messages/text",
    body: buildTextPayload(args),
    customBaseUrl: args.customBaseUrl,
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

export function buildInteractivePayload(args: {
  to: string;
  interactive: {
    type?: unknown;
    header?: unknown;
    body?: unknown;
    footer?: unknown;
    action?: unknown;
    context?: unknown;
  };
}) {
  const input = args.interactive;
  return {
    to: normalizePhone(args.to),
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

export async function sendInteractive(args: {
  token: string;
  to: string;
  interactive: Parameters<typeof buildInteractivePayload>[0]["interactive"];
  customBaseUrl?: string;
  timeoutMs?: number;
}) {
  return await request<HubMessageResult>({
    token: args.token,
    path: "/messages/interactive",
    body: buildInteractivePayload(args),
    customBaseUrl: args.customBaseUrl,
    timeoutMs: args.timeoutMs,
  });
}

export function buildTemplatePayload(args: {
  to: string;
  templateName: string;
  languageCode: string;
  bodyVariables?: string[];
}) {
  const components =
    args.bodyVariables && args.bodyVariables.length > 0
      ? [
          {
            type: "body",
            parameters: args.bodyVariables.map((text) => ({
              type: "text",
              text,
            })),
          },
        ]
      : undefined;

  return {
    to: normalizePhone(args.to),
    template: {
      name: args.templateName,
      language: { code: args.languageCode },
      ...(components ? { components } : {}),
    },
  };
}

export async function sendTemplate(args: {
  token: string;
  to: string;
  templateName: string;
  languageCode: string;
  bodyVariables?: string[];
  customBaseUrl?: string;
  timeoutMs?: number;
}) {
  return await request<HubMessageResult>({
    token: args.token,
    path: "/messages/template",
    body: buildTemplatePayload(args),
    customBaseUrl: args.customBaseUrl,
    timeoutMs: args.timeoutMs,
  });
}

export async function getPhoneInfo(args: {
  token: string;
  customBaseUrl?: string;
  timeoutMs?: number;
}) {
  return await request<HubPhoneInfo>({
    token: args.token,
    path: "/phone/info",
    customBaseUrl: args.customBaseUrl,
    timeoutMs: args.timeoutMs,
  });
}

export async function getPhoneHealth(args: {
  token: string;
  customBaseUrl?: string;
  timeoutMs?: number;
}) {
  return await request<HubPhoneInfo>({
    token: args.token,
    path: "/phone/health",
    customBaseUrl: args.customBaseUrl,
    timeoutMs: args.timeoutMs,
  });
}

export async function listTemplates(args: {
  token: string;
  sync?: boolean;
  customBaseUrl?: string;
  timeoutMs?: number;
}) {
  return await request<unknown[]>({
    token: args.token,
    path: `/templates?sync=${args.sync === false ? "false" : "true"}`,
    customBaseUrl: args.customBaseUrl,
    timeoutMs: args.timeoutMs,
  });
}

export async function getConversationHistory(args: {
  token: string;
  phone: string;
  customBaseUrl?: string;
  timeoutMs?: number;
}) {
  return await request<unknown[]>({
    token: args.token,
    path: `/history/conversation/${encodeURIComponent(normalizePhone(args.phone))}`,
    customBaseUrl: args.customBaseUrl,
    timeoutMs: args.timeoutMs,
  });
}

export async function uploadMedia(args: {
  token: string;
  file: Blob;
  filename: string;
  customBaseUrl?: string;
  timeoutMs?: number;
}) {
  const form = new FormData();
  form.set("file", args.file, args.filename);
  return await request<Record<string, unknown>>({
    token: args.token,
    path: "/media/upload",
    body: form,
    customBaseUrl: args.customBaseUrl,
    timeoutMs: args.timeoutMs ?? 30_000,
  });
}

export async function sendDocument(args: {
  token: string;
  to: string;
  mediaId?: string;
  url?: string;
  filename?: string;
  caption?: string;
  contextMessageId?: string;
  customBaseUrl?: string;
  timeoutMs?: number;
}) {
  if (Boolean(args.mediaId) === Boolean(args.url)) {
    return {
      ok: false as const,
      reason: "document_requires_exactly_one_source",
    };
  }
  return await request<HubMessageResult>({
    token: args.token,
    path: "/messages/document",
    body: {
      to: normalizePhone(args.to),
      ...(args.mediaId ? { media_id: args.mediaId } : { url: args.url }),
      ...(args.filename ? { filename: args.filename } : {}),
      ...(args.caption ? { caption: args.caption } : {}),
      ...(args.contextMessageId
        ? { context: { message_id: args.contextMessageId } }
        : {}),
    },
    customBaseUrl: args.customBaseUrl,
    timeoutMs: args.timeoutMs,
  });
}

export async function listFlows(args: {
  token: string;
  customBaseUrl?: string;
  timeoutMs?: number;
}) {
  return await request<HubFlowContainer[]>({
    token: args.token,
    path: "/flows",
    customBaseUrl: args.customBaseUrl,
    timeoutMs: args.timeoutMs,
  });
}

export async function createFlow(args: {
  token: string;
  name: string;
  categories: string[];
  customBaseUrl?: string;
  timeoutMs?: number;
}) {
  return await request<HubFlowContainer>({
    token: args.token,
    path: "/flows",
    body: { name: args.name, categories: args.categories },
    customBaseUrl: args.customBaseUrl,
    timeoutMs: args.timeoutMs,
  });
}

export async function updateFlow(args: {
  token: string;
  flowId: string;
  name?: string;
  categories?: string[];
  customBaseUrl?: string;
  timeoutMs?: number;
}) {
  return await request<HubFlowContainer>({
    token: args.token,
    path: `/flows/${encodeURIComponent(args.flowId)}`,
    method: "PUT",
    body: {
      ...(args.name ? { name: args.name } : {}),
      ...(args.categories ? { categories: args.categories } : {}),
    },
    customBaseUrl: args.customBaseUrl,
    timeoutMs: args.timeoutMs,
  });
}

export async function uploadFlowAsset(args: {
  token: string;
  flowId: string;
  flowJson: unknown;
  customBaseUrl?: string;
  timeoutMs?: number;
}) {
  const form = new FormData();
  form.set(
    "file",
    new Blob([JSON.stringify(args.flowJson)], { type: "application/json" }),
    "flow.json",
  );
  return await request<HubFlowAssetResult>({
    token: args.token,
    path: `/flows/${encodeURIComponent(args.flowId)}/assets`,
    body: form,
    customBaseUrl: args.customBaseUrl,
    timeoutMs: args.timeoutMs,
  });
}

export async function publishFlow(args: {
  token: string;
  flowId: string;
  customBaseUrl?: string;
  timeoutMs?: number;
}) {
  return await request<HubFlowContainer>({
    token: args.token,
    path: `/flows/${encodeURIComponent(args.flowId)}/publish`,
    body: {},
    customBaseUrl: args.customBaseUrl,
    timeoutMs: args.timeoutMs,
  });
}

export function providerMessageId(result: HubMessageResult): string | null {
  return (
    result.messageId ??
    result.message_id ??
    result.wamid ??
    result.id ??
    null
  );
}
