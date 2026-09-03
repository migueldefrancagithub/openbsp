"use client";

import { PageHeader } from "@/components/app/EmptyState";
import { TeamPresence } from "@/components/operation/TeamPresence";
import { AssignmentRulesSection } from "@/components/settings/AssignmentRulesSection";
import { MembersSection } from "@/components/settings/MembersSection";
import { TeamsSection } from "@/components/settings/TeamsSection";
import { useI18n } from "@/lib/i18n";

export default function AdminMembersPage() {
  const { tr } = useI18n();
  return (
    <div className="flex min-h-full flex-col">
      <PageHeader eyebrow="Admin" title={tr("Membros e equipas", "Members and teams")} description={tr("Quem faz parte da clínica, com que papel, em que equipa e como as conversas são distribuídas.", "Who is part of the clinic, with which role, in which team, and how conversations are distributed.")} />
      <div className="mx-auto w-full max-w-6xl space-y-6 px-4 py-5 sm:px-6 xl:px-8">
        <div className="grid gap-5 xl:grid-cols-[1.4fr_1fr]">
          <MembersSection />
          <TeamPresence />
        </div>
        <TeamsSection />
        <AssignmentRulesSection />
      </div>
    </div>
  );
}
