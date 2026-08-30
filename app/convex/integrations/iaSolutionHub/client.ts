/**
 * Production iaSolution Hub adapter.
 *
 * The transport implementation is shared with the removable laboratory for
 * compatibility, but production callers import this path and use the generic
 * WHATSAPP_HUB_* configuration names. No channel or credential fallback lives
 * here; the caller must resolve the tenant-scoped channel secret explicitly.
 */
export * from "../leoHub/client";
