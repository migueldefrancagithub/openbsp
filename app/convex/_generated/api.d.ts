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
import type * as aiAgents from "../aiAgents.js";
import type * as aiComposer from "../aiComposer.js";
import type * as aiCopilot from "../aiCopilot.js";
import type * as aiProposals from "../aiProposals.js";
import type * as aiProviders from "../aiProviders.js";
import type * as aiRuntime from "../aiRuntime.js";
import type * as aiSandbox from "../aiSandbox.js";
import type * as aiSettings from "../aiSettings.js";
import type * as aiTools from "../aiTools.js";
import type * as analytics from "../analytics.js";
import type * as analyticsRollups from "../analyticsRollups.js";
import type * as api_ from "../api.js";
import type * as apiKeys from "../apiKeys.js";
import type * as assignmentRules from "../assignmentRules.js";
import type * as audiences from "../audiences.js";
import type * as audit from "../audit.js";
import type * as auth from "../auth.js";
import type * as campaigns from "../campaigns.js";
import type * as channelAutomation from "../channelAutomation.js";
import type * as channelCampaigns from "../channelCampaigns.js";
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
import type * as customFields from "../customFields.js";
import type * as embeddedSignup from "../embeddedSignup.js";
import type * as followUps from "../followUps.js";
import type * as http from "../http.js";
import type * as httpApiV1 from "../httpApiV1.js";
import type * as iaSolutionHub from "../iaSolutionHub.js";
import type * as inboxOperations from "../inboxOperations.js";
import type * as integrations_iaSolutionHub_client from "../integrations/iaSolutionHub/client.js";
import type * as integrations_iaSolutionHub_webhook from "../integrations/iaSolutionHub/webhook.js";
import type * as integrations_leoHub_client from "../integrations/leoHub/client.js";
import type * as integrations_leoHub_webhook from "../integrations/leoHub/webhook.js";
import type * as leads from "../leads.js";
import type * as leoHubLab from "../leoHubLab.js";
import type * as lib_ai_checklist from "../lib/ai/checklist.js";
import type * as lib_ai_control from "../lib/ai/control.js";
import type * as lib_ai_guards from "../lib/ai/guards.js";
import type * as lib_ai_pipeline from "../lib/ai/pipeline.js";
import type * as lib_ai_prerouter from "../lib/ai/prerouter.js";
import type * as lib_ai_pricing from "../lib/ai/pricing.js";
import type * as lib_ai_promises from "../lib/ai/promises.js";
import type * as lib_ai_prompts from "../lib/ai/prompts.js";
import type * as lib_ai_proposals from "../lib/ai/proposals.js";
import type * as lib_ai_provider from "../lib/ai/provider.js";
import type * as lib_ai_providers_anthropic from "../lib/ai/providers/anthropic.js";
import type * as lib_ai_providers_google from "../lib/ai/providers/google.js";
import type * as lib_ai_providers_mock from "../lib/ai/providers/mock.js";
import type * as lib_ai_providers_openai from "../lib/ai/providers/openai.js";
import type * as lib_ai_resilience from "../lib/ai/resilience.js";
import type * as lib_ai_runtime from "../lib/ai/runtime.js";
import type * as lib_ai_settings from "../lib/ai/settings.js";
import type * as lib_ai_toolRegistry from "../lib/ai/toolRegistry.js";
import type * as lib_ai_tools from "../lib/ai/tools.js";
import type * as lib_ai_validators from "../lib/ai/validators.js";
import type * as lib_aiControl from "../lib/aiControl.js";
import type * as lib_apiAuth from "../lib/apiAuth.js";
import type * as lib_assignment from "../lib/assignment.js";
import type * as lib_audit from "../lib/audit.js";
import type * as lib_campaignAttribution from "../lib/campaignAttribution.js";
import type * as lib_campaignStats from "../lib/campaignStats.js";
import type * as lib_channelCampaignEngine from "../lib/channelCampaignEngine.js";
import type * as lib_channels_automationControl from "../lib/channels/automationControl.js";
import type * as lib_channels_contactBridge from "../lib/channels/contactBridge.js";
import type * as lib_channels_intents from "../lib/channels/intents.js";
import type * as lib_channels_outboxStatus from "../lib/channels/outboxStatus.js";
import type * as lib_channels_projection from "../lib/channels/projection.js";
import type * as lib_channels_systemEvents from "../lib/channels/systemEvents.js";
import type * as lib_channels_threadCommand from "../lib/channels/threadCommand.js";
import type * as lib_channels_threadUpdate from "../lib/channels/threadUpdate.js";
import type * as lib_channels_threadVisibility from "../lib/channels/threadVisibility.js";
import type * as lib_clinicAgenda from "../lib/clinicAgenda.js";
import type * as lib_clinicTime from "../lib/clinicTime.js";
import type * as lib_consent from "../lib/consent.js";
import type * as lib_customFunctions from "../lib/customFunctions.js";
import type * as lib_escalation_availability from "../lib/escalation/availability.js";
import type * as lib_escalation_handoffNotice from "../lib/escalation/handoffNotice.js";
import type * as lib_flow_window from "../lib/flow/window.js";
import type * as lib_followUpControl from "../lib/followUpControl.js";
import type * as lib_followUpEngine from "../lib/followUpEngine.js";
import type * as lib_humanCases from "../lib/humanCases.js";
import type * as lib_idempotency from "../lib/idempotency.js";
import type * as lib_meta_errorClassifier from "../lib/meta/errorClassifier.js";
import type * as lib_meta_graph from "../lib/meta/graph.js";
import type * as lib_meta_parsePayload from "../lib/meta/parsePayload.js";
import type * as lib_meta_verify from "../lib/meta/verify.js";
import type * as lib_money from "../lib/money.js";
import type * as lib_opsAlerts from "../lib/opsAlerts.js";
import type * as lib_outboundJobs from "../lib/outboundJobs.js";
import type * as lib_roles from "../lib/roles.js";
import type * as lib_secrets from "../lib/secrets.js";
import type * as lib_webhooks from "../lib/webhooks.js";
import type * as me from "../me.js";
import type * as memberInvites from "../memberInvites.js";
import type * as members from "../members.js";
import type * as messages from "../messages.js";
import type * as metaAdmission from "../metaAdmission.js";
import type * as metaEvidence from "../metaEvidence.js";
import type * as operation from "../operation.js";
import type * as ops from "../ops.js";
import type * as outboundJobs from "../outboundJobs.js";
import type * as outboundWebhooks from "../outboundWebhooks.js";
import type * as overview from "../overview.js";
import type * as presence from "../presence.js";
import type * as quickReplies from "../quickReplies.js";
import type * as retention from "../retention.js";
import type * as teams from "../teams.js";
import type * as templates from "../templates.js";
import type * as tenants from "../tenants.js";
import type * as tenantsQueries from "../tenantsQueries.js";
import type * as trackedLinks from "../trackedLinks.js";
import type * as webhooks from "../webhooks.js";
import type * as whatsappAccounts from "../whatsappAccounts.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  ai: typeof ai;
  aiAgents: typeof aiAgents;
  aiComposer: typeof aiComposer;
  aiCopilot: typeof aiCopilot;
  aiProposals: typeof aiProposals;
  aiProviders: typeof aiProviders;
  aiRuntime: typeof aiRuntime;
  aiSandbox: typeof aiSandbox;
  aiSettings: typeof aiSettings;
  aiTools: typeof aiTools;
  analytics: typeof analytics;
  analyticsRollups: typeof analyticsRollups;
  api: typeof api_;
  apiKeys: typeof apiKeys;
  assignmentRules: typeof assignmentRules;
  audiences: typeof audiences;
  audit: typeof audit;
  auth: typeof auth;
  campaigns: typeof campaigns;
  channelAutomation: typeof channelAutomation;
  channelCampaigns: typeof channelCampaigns;
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
  customFields: typeof customFields;
  embeddedSignup: typeof embeddedSignup;
  followUps: typeof followUps;
  http: typeof http;
  httpApiV1: typeof httpApiV1;
  iaSolutionHub: typeof iaSolutionHub;
  inboxOperations: typeof inboxOperations;
  "integrations/iaSolutionHub/client": typeof integrations_iaSolutionHub_client;
  "integrations/iaSolutionHub/webhook": typeof integrations_iaSolutionHub_webhook;
  "integrations/leoHub/client": typeof integrations_leoHub_client;
  "integrations/leoHub/webhook": typeof integrations_leoHub_webhook;
  leads: typeof leads;
  leoHubLab: typeof leoHubLab;
  "lib/ai/checklist": typeof lib_ai_checklist;
  "lib/ai/control": typeof lib_ai_control;
  "lib/ai/guards": typeof lib_ai_guards;
  "lib/ai/pipeline": typeof lib_ai_pipeline;
  "lib/ai/prerouter": typeof lib_ai_prerouter;
  "lib/ai/pricing": typeof lib_ai_pricing;
  "lib/ai/promises": typeof lib_ai_promises;
  "lib/ai/prompts": typeof lib_ai_prompts;
  "lib/ai/proposals": typeof lib_ai_proposals;
  "lib/ai/provider": typeof lib_ai_provider;
  "lib/ai/providers/anthropic": typeof lib_ai_providers_anthropic;
  "lib/ai/providers/google": typeof lib_ai_providers_google;
  "lib/ai/providers/mock": typeof lib_ai_providers_mock;
  "lib/ai/providers/openai": typeof lib_ai_providers_openai;
  "lib/ai/resilience": typeof lib_ai_resilience;
  "lib/ai/runtime": typeof lib_ai_runtime;
  "lib/ai/settings": typeof lib_ai_settings;
  "lib/ai/toolRegistry": typeof lib_ai_toolRegistry;
  "lib/ai/tools": typeof lib_ai_tools;
  "lib/ai/validators": typeof lib_ai_validators;
  "lib/aiControl": typeof lib_aiControl;
  "lib/apiAuth": typeof lib_apiAuth;
  "lib/assignment": typeof lib_assignment;
  "lib/audit": typeof lib_audit;
  "lib/campaignAttribution": typeof lib_campaignAttribution;
  "lib/campaignStats": typeof lib_campaignStats;
  "lib/channelCampaignEngine": typeof lib_channelCampaignEngine;
  "lib/channels/automationControl": typeof lib_channels_automationControl;
  "lib/channels/contactBridge": typeof lib_channels_contactBridge;
  "lib/channels/intents": typeof lib_channels_intents;
  "lib/channels/outboxStatus": typeof lib_channels_outboxStatus;
  "lib/channels/projection": typeof lib_channels_projection;
  "lib/channels/systemEvents": typeof lib_channels_systemEvents;
  "lib/channels/threadCommand": typeof lib_channels_threadCommand;
  "lib/channels/threadUpdate": typeof lib_channels_threadUpdate;
  "lib/channels/threadVisibility": typeof lib_channels_threadVisibility;
  "lib/clinicAgenda": typeof lib_clinicAgenda;
  "lib/clinicTime": typeof lib_clinicTime;
  "lib/consent": typeof lib_consent;
  "lib/customFunctions": typeof lib_customFunctions;
  "lib/escalation/availability": typeof lib_escalation_availability;
  "lib/escalation/handoffNotice": typeof lib_escalation_handoffNotice;
  "lib/flow/window": typeof lib_flow_window;
  "lib/followUpControl": typeof lib_followUpControl;
  "lib/followUpEngine": typeof lib_followUpEngine;
  "lib/humanCases": typeof lib_humanCases;
  "lib/idempotency": typeof lib_idempotency;
  "lib/meta/errorClassifier": typeof lib_meta_errorClassifier;
  "lib/meta/graph": typeof lib_meta_graph;
  "lib/meta/parsePayload": typeof lib_meta_parsePayload;
  "lib/meta/verify": typeof lib_meta_verify;
  "lib/money": typeof lib_money;
  "lib/opsAlerts": typeof lib_opsAlerts;
  "lib/outboundJobs": typeof lib_outboundJobs;
  "lib/roles": typeof lib_roles;
  "lib/secrets": typeof lib_secrets;
  "lib/webhooks": typeof lib_webhooks;
  me: typeof me;
  memberInvites: typeof memberInvites;
  members: typeof members;
  messages: typeof messages;
  metaAdmission: typeof metaAdmission;
  metaEvidence: typeof metaEvidence;
  operation: typeof operation;
  ops: typeof ops;
  outboundJobs: typeof outboundJobs;
  outboundWebhooks: typeof outboundWebhooks;
  overview: typeof overview;
  presence: typeof presence;
  quickReplies: typeof quickReplies;
  retention: typeof retention;
  teams: typeof teams;
  templates: typeof templates;
  tenants: typeof tenants;
  tenantsQueries: typeof tenantsQueries;
  trackedLinks: typeof trackedLinks;
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
