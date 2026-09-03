"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { Phone, Clock, Megaphone, Bot, UserRound, Users } from "lucide-react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { MessageBubble } from "./MessageBubble";
import { Composer } from "./Composer";
import { relativeTime } from "@/lib/relativeTime";
import { friendlyId } from "@/lib/friendlyId";

type Props = { conversationId: Id<"conversations"> };

export function ConversationThread({ conversationId }: Props) {
  const conversation = useQuery(api.conversations.getById, { conversationId });
  const messages = useQuery(api.messages.listForConversation, {
    conversationId,
    limit: 200,
  });
  const setOpportunityStatus = useMutation(api.conversations.setOpportunityStatus);
  const setAiState = useMutation(api.conversations.setAiState);
  const assignTeam = useMutation(api.conversations.assignTeam);
  const assignAgent = useMutation(api.conversations.assignAgent);
  const teams = useQuery(api.teams.list, {});
  const members = useQuery(api.memberInvites.listMembers, {});
  const recordAiAuditEvent = useMutation(api.ai.recordAuditEvent);
  const aiAuditEvents = useQuery(api.ai.listForConversation, {
    conversationId,
    limit: 5,
  });
  const [assignmentBusy, setAssignmentBusy] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages?.length]);

  if (conversation === undefined || messages === undefined) {
    return (
      <div className="flex-1 flex items-center justify-center text-faint text-sm">
        Loading conversation…
      </div>
    );
  }
  if (conversation === null) {
    return (
      <div className="flex-1 flex items-center justify-center text-faint text-sm">
        Conversation not found.
      </div>
    );
  }

  const within24h =
    conversation.serviceWindowExpiresAt &&
    conversation.serviceWindowExpiresAt > Date.now();

  return (
    <div className="flex-1 flex flex-col h-full bg-background">
      {/* Header */}
      <div className="px-6 py-3 border-b border-line bg-surface flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-full flex-shrink-0 bg-gradient-to-br from-[#F5C344] via-[#F28482] to-[#B567C2] flex items-center justify-center text-white text-[12px] font-semibold">
            {(conversation.contactName ?? conversation.contactE164)
              .charAt(conversation.contactName ? 0 : 1)
              .toUpperCase()}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <div className="text-[14px] font-semibold text-ink leading-tight">
                {conversation.contactName ?? conversation.contactE164}
              </div>
              <span className="text-[10px] font-[var(--font-mono)] text-faint">
                {friendlyId("CONV", conversationId)}
              </span>
            </div>
            <div className="flex items-center gap-1.5 text-[11px] text-muted mt-0.5">
              <Phone size={10} />
              <span>{conversation.contactE164}</span>
              {conversation.leadSource === "ctwa" && (
                <>
                  <span className="text-faint">·</span>
                  <span className="inline-flex items-center gap-1 text-chip-success-fg">
                    <Megaphone size={10} />
                    CTWA lead
                  </span>
                </>
              )}
              {conversation.aiState && (
                <>
                  <span className="text-faint">·</span>
                  <span className="inline-flex items-center gap-1 text-body">
                    <Bot size={10} />
                    AI {conversation.aiState}
                  </span>
                </>
              )}
            </div>
          </div>
        </div>

        {conversation.serviceWindowExpiresAt && (
          <div
            className={
              within24h
                ? "inline-flex items-center gap-1.5 text-chip-success-fg bg-chip-success border border-chip-success-fg/25 px-2 py-1 rounded-md text-[11px] font-medium"
                : "inline-flex items-center gap-1.5 text-chip-warn-fg bg-chip-warn border border-chip-warn-fg/25 px-2 py-1 rounded-md text-[11px] font-medium"
            }
          >
            <Clock size={11} />
            {within24h
              ? `Service window: ${relativeTime(conversation.serviceWindowExpiresAt - 24 * 60 * 60 * 1000)} of 24h`
              : "Service window expired"}
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2 border-b border-line bg-surface px-6 py-2.5 text-[11px]">
        <span className="inline-flex items-center gap-1 font-medium text-muted">
          <Users size={11} />
          Queue
        </span>
        <select
          value={conversation.assignedTeamId ?? ""}
          disabled={assignmentBusy || teams === undefined}
          onChange={async (event) => {
            if (!event.target.value) return;
            setAssignmentBusy(true);
            try {
              await assignTeam({
                conversationId,
                teamId: event.target.value as Id<"teams">,
              });
            } finally {
              setAssignmentBusy(false);
            }
          }}
          className="rounded-md border border-line bg-surface-2 px-2 py-1 text-ink outline-none disabled:opacity-50"
        >
          <option value="">No team</option>
          {(teams ?? []).map((team) => (
            <option key={team._id} value={team._id}>
              {team.name}
            </option>
          ))}
        </select>
        <span className="inline-flex items-center gap-1 font-medium text-muted">
          <UserRound size={11} />
          Agent
        </span>
        <select
          value={conversation.assignedAgentId ?? ""}
          disabled={assignmentBusy || members === undefined}
          onChange={async (event) => {
            if (!event.target.value) return;
            setAssignmentBusy(true);
            try {
              await assignAgent({
                conversationId,
                memberId: event.target.value as Id<"members">,
              });
            } finally {
              setAssignmentBusy(false);
            }
          }}
          className="rounded-md border border-line bg-surface-2 px-2 py-1 text-ink outline-none disabled:opacity-50"
        >
          <option value="">Unassigned</option>
          {(members ?? [])
            .filter((member) => member.status === "active")
            .map((member) => (
              <option key={member._id} value={member._id}>
                {member.email ?? member.role}
              </option>
            ))}
        </select>
        {(conversation.assignedTeamName || conversation.assignedAgentName) && (
          <span className="text-faint">
            {conversation.assignedTeamName ?? "No team"}
            {conversation.assignedAgentName
              ? ` · ${conversation.assignedAgentName}`
              : ""}
          </span>
        )}
      </div>

      {(conversation.leadSource === "ctwa" || conversation.aiState) && (
        <div className="border-b border-line bg-surface px-6 py-2.5 flex flex-wrap items-center gap-2 text-[11px]">
          <span className="font-medium text-muted">Lead</span>
          <select
            value={conversation.opportunityStatus ?? "new"}
            onChange={(event) =>
              setOpportunityStatus({
                conversationId,
                status: event.target.value as
                  | "new"
                  | "contacted"
                  | "replied"
                  | "opportunity"
                  | "booked"
                  | "lost",
              })
            }
            className="rounded-md border border-line bg-surface-2 px-2 py-1 text-ink outline-none"
          >
            <option value="new">new</option>
            <option value="contacted">contacted</option>
            <option value="replied">replied</option>
            <option value="opportunity">opportunity</option>
            <option value="booked">booked</option>
            <option value="lost">lost</option>
          </select>
          <span className="ml-2 font-medium text-muted">AI</span>
          <button
            type="button"
            onClick={() =>
              setAiState({
                conversationId,
                state: conversation.aiState === "paused" ? "eligible" : "paused",
                reason:
                  conversation.aiState === "paused"
                    ? undefined
                    : "manual_override",
              })
            }
            className="rounded-md border border-line bg-surface-2 px-2 py-1 font-medium text-ink hover:border-line"
          >
            {conversation.aiState === "paused" ? "Resume AI" : "Pause AI"}
          </button>
          {conversation.aiPausedReason && (
            <span className="text-faint">
              reason: {conversation.aiPausedReason}
            </span>
          )}
          <button
            type="button"
            onClick={() =>
              recordAiAuditEvent({
                conversationId,
                kind:
                  conversation.aiState === "eligible" ? "eligible" : "paused",
                reason: conversation.aiPausedReason ?? "manual_audit",
                payload: {
                  opportunityStatus: conversation.opportunityStatus ?? "new",
                  serviceWindowExpiresAt: conversation.serviceWindowExpiresAt,
                },
              })
            }
            className="ml-auto rounded-md border border-line bg-surface-2 px-2 py-1 font-medium text-ink hover:border-line"
          >
            Audit AI
          </button>
          {(aiAuditEvents ?? []).length > 0 && (
            <span className="text-faint">
              last audit: {aiAuditEvents![0].kind}
            </span>
          )}
        </div>
      )}

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-6 py-5 space-y-3">
        {messages.length === 0 ? (
          <div className="text-center text-faint text-sm py-12">
            No messages in this conversation yet.
          </div>
        ) : (
          messages.map((m) => (
            <MessageBubble
              key={m._id}
              direction={m.direction}
              type={m.type}
              content={m.content}
              status={m.status}
              createdAt={m.createdAt}
            />
          ))
        )}
      </div>

      <Composer
        conversationId={conversationId}
        serviceWindowExpiresAt={conversation.serviceWindowExpiresAt}
      />
    </div>
  );
}
