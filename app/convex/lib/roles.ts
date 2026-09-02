export const ROLES = ["owner", "admin", "agent", "marketing"] as const;
export type Role = (typeof ROLES)[number];

const ROLE_RANK: Record<Role, number> = {
  owner: 4,
  admin: 3,
  marketing: 2,
  agent: 1,
};

export function roleAtLeast(actual: Role, required: Role): boolean {
  return ROLE_RANK[actual] >= ROLE_RANK[required];
}

export const CAPABILITIES = [
  "messages.send",
  "messages.send_template",
  "conversations.assign_self",
  "conversations.assign_other",
  "conversations.close",
  "campaigns.create",
  "campaigns.start",
  "campaigns.cancel",
  "templates.create",
  "templates.submit",
  "contacts.import",
  "contacts.erase",
  "members.invite",
  "members.remove",
  "members.change_role",
  "tenant.update_settings",
  "tenant.disable_healthcare_guard",
  "audit.export",
  "compliance.export_contact",
  "feature_flag.set",
  "pilot.request_allowlist",
  "leads.update",
  "inbox.handoff",
  "inbox.custom_fields",
  "contacts.record_consent",
] as const;
export type Capability = (typeof CAPABILITIES)[number];

const CAPABILITY_MATRIX: Record<Role, Set<Capability>> = {
  owner: new Set(CAPABILITIES),
  admin: new Set<Capability>([
    "messages.send",
    "messages.send_template",
    "conversations.assign_self",
    "conversations.assign_other",
    "conversations.close",
    "campaigns.create",
    "campaigns.start",
    "campaigns.cancel",
    "templates.create",
    "templates.submit",
    "contacts.import",
    "contacts.erase",
    "members.invite",
    "members.remove",
    "members.change_role",
    "tenant.update_settings",
    "audit.export",
    "compliance.export_contact",
    "pilot.request_allowlist",
    "leads.update",
    "inbox.handoff",
    "inbox.custom_fields",
    "contacts.record_consent",
  ]),
  marketing: new Set<Capability>([
    "campaigns.create",
    "campaigns.start",
    "campaigns.cancel",
    "templates.create",
    "templates.submit",
    "contacts.import",
  ]),
  agent: new Set<Capability>([
    "messages.send",
    "messages.send_template",
    "conversations.assign_self",
    "conversations.close",
    "pilot.request_allowlist",
    "leads.update",
    "inbox.handoff",
    "inbox.custom_fields",
    "contacts.record_consent",
  ]),
};

export function hasCapability(role: Role, capability: Capability): boolean {
  return CAPABILITY_MATRIX[role].has(capability);
}
