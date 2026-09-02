/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as ai from "../ai.js";
import type * as analytics from "../analytics.js";
import type * as api_ from "../api.js";
import type * as apiKeys from "../apiKeys.js";
import type * as audiences from "../audiences.js";
import type * as auth from "../auth.js";
import type * as campaigns from "../campaigns.js";
import type * as channelAutomation from "../channelAutomation.js";
import type * as channels from "../channels.js";
import type * as chatbotFlows from "../chatbotFlows.js";
import type * as chatbots from "../chatbots.js";
import type * as clinic from "../clinic.js";
import type * as compliance from "../compliance.js";
import type * as contactRequest from "../contactRequest.js";
import type * as contacts from "../contacts.js";
import type * as conversations from "../conversations.js";
import type * as crons from "../crons.js";
import type * as ctwa from "../ctwa.js";
import type * as embeddedSignup from "../embeddedSignup.js";
import type * as http from "../http.js";
import type * as iaSolutionHub from "../iaSolutionHub.js";
import type * as inboxOperations from "../inboxOperations.js";
import type * as integrations_iaSolutionHub_client from "../integrations/iaSolutionHub/client.js";
import type * as integrations_iaSolutionHub_webhook from "../integrations/iaSolutionHub/webhook.js";
import type * as integrations_leoHub_client from "../integrations/leoHub/client.js";
import type * as integrations_leoHub_webhook from "../integrations/leoHub/webhook.js";
import type * as leoHubLab from "../leoHubLab.js";
import type * as lib_aiControl from "../lib/aiControl.js";
import type * as lib_apiAuth from "../lib/apiAuth.js";
import type * as lib_channels_outboxStatus from "../lib/channels/outboxStatus.js";
import type * as lib_channels_projection from "../lib/channels/projection.js";
import type * as lib_channels_systemEvents from "../lib/channels/systemEvents.js";
import type * as lib_consent from "../lib/consent.js";
import type * as lib_customFunctions from "../lib/customFunctions.js";
import type * as lib_flow_window from "../lib/flow/window.js";
import type * as lib_idempotency from "../lib/idempotency.js";
import type * as lib_meta_errorClassifier from "../lib/meta/errorClassifier.js";
import type * as lib_meta_graph from "../lib/meta/graph.js";
import type * as lib_meta_parsePayload from "../lib/meta/parsePayload.js";
import type * as lib_meta_verify from "../lib/meta/verify.js";
import type * as lib_money from "../lib/money.js";
import type * as lib_roles from "../lib/roles.js";
import type * as lib_secrets from "../lib/secrets.js";
import type * as memberInvites from "../memberInvites.js";
import type * as messages from "../messages.js";
import type * as metaAdmission from "../metaAdmission.js";
import type * as metaEvidence from "../metaEvidence.js";
import type * as operation from "../operation.js";
import type * as overview from "../overview.js";
import type * as quickReplies from "../quickReplies.js";
import type * as teams from "../teams.js";
import type * as templates from "../templates.js";
import type * as tenants from "../tenants.js";
import type * as tenantsQueries from "../tenantsQueries.js";
import type * as webhooks from "../webhooks.js";
import type * as whatsappAccounts from "../whatsappAccounts.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  ai: typeof ai;
  analytics: typeof analytics;
  api: typeof api_;
  apiKeys: typeof apiKeys;
  audiences: typeof audiences;
  auth: typeof auth;
  campaigns: typeof campaigns;
  channelAutomation: typeof channelAutomation;
  channels: typeof channels;
  chatbotFlows: typeof chatbotFlows;
  chatbots: typeof chatbots;
  clinic: typeof clinic;
  compliance: typeof compliance;
  contactRequest: typeof contactRequest;
  contacts: typeof contacts;
  conversations: typeof conversations;
  crons: typeof crons;
  ctwa: typeof ctwa;
  embeddedSignup: typeof embeddedSignup;
  http: typeof http;
  iaSolutionHub: typeof iaSolutionHub;
  inboxOperations: typeof inboxOperations;
  "integrations/iaSolutionHub/client": typeof integrations_iaSolutionHub_client;
  "integrations/iaSolutionHub/webhook": typeof integrations_iaSolutionHub_webhook;
  "integrations/leoHub/client": typeof integrations_leoHub_client;
  "integrations/leoHub/webhook": typeof integrations_leoHub_webhook;
  leoHubLab: typeof leoHubLab;
  "lib/aiControl": typeof lib_aiControl;
  "lib/apiAuth": typeof lib_apiAuth;
  "lib/channels/outboxStatus": typeof lib_channels_outboxStatus;
  "lib/channels/projection": typeof lib_channels_projection;
  "lib/channels/systemEvents": typeof lib_channels_systemEvents;
  "lib/consent": typeof lib_consent;
  "lib/customFunctions": typeof lib_customFunctions;
  "lib/flow/window": typeof lib_flow_window;
  "lib/idempotency": typeof lib_idempotency;
  "lib/meta/errorClassifier": typeof lib_meta_errorClassifier;
  "lib/meta/graph": typeof lib_meta_graph;
  "lib/meta/parsePayload": typeof lib_meta_parsePayload;
  "lib/meta/verify": typeof lib_meta_verify;
  "lib/money": typeof lib_money;
  "lib/roles": typeof lib_roles;
  "lib/secrets": typeof lib_secrets;
  memberInvites: typeof memberInvites;
  messages: typeof messages;
  metaAdmission: typeof metaAdmission;
  metaEvidence: typeof metaEvidence;
  operation: typeof operation;
  overview: typeof overview;
  quickReplies: typeof quickReplies;
  teams: typeof teams;
  templates: typeof templates;
  tenants: typeof tenants;
  tenantsQueries: typeof tenantsQueries;
  webhooks: typeof webhooks;
  whatsappAccounts: typeof whatsappAccounts;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
