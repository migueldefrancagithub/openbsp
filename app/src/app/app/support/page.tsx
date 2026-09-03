"use client";

import Link from "next/link";
import {
  AlertTriangle,
  CheckCircle2,
  CreditCard,
  FileQuestion,
  LifeBuoy,
  ShieldAlert,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { PageHeader } from "@/components/app/EmptyState";
import { BRAND_NAME } from "@/components/Brand";
import { useI18n } from "@/lib/i18n";

export default function SupportPage() {
  const { locale, tr } = useI18n();
  const clientChecklist = locale === "pt"
    ? [
        "ID do portefólio empresarial e acesso de administrador disponíveis.",
        "Designação legal, site público, política de privacidade e termos alinhados.",
        "Cartão de pagamento ativo e autorizado para cobranças da Meta.",
        "A clínica compreende a coexistência com a app WhatsApp Business.",
        "Existe um contacto responsável por verificações ou recursos de restrição.",
      ]
    : [
        "Business Manager ID and admin access are available.",
        "Legal name, public website, privacy policy, and terms are aligned.",
        "Billing card is active and allowed for Meta charges.",
        "The clinic understands WhatsApp Business App coexistence before onboarding.",
        "A support contact is ready for Business verification or restriction appeals.",
      ];
  const guides = buildGuides(locale);

  return (
    <>
      <PageHeader
        eyebrow={tr("Operação", "Operations")}
        title={tr("Centro de suporte", "Support center")}
        description={tr(
          "Procedimentos para ligação, faturação Meta, restrições e incidentes de qualidade.",
          "Connection, Meta billing, restriction, and quality incident procedures.",
        )}
      />

      <div className="max-w-7xl space-y-6 px-4 py-5 sm:px-6 lg:px-8 lg:py-8">
        <section className="rounded-lg border border-line bg-surface p-5">
          <div className="mb-4 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-nav-active text-white">
              <LifeBuoy size={18} />
            </div>
            <div>
              <h2 className="font-[var(--font-outfit)] text-[18px] font-medium text-ink">
                {tr("Antes de ligar uma clínica", "Before onboarding a clinic")}
              </h2>
              <p className="text-sm text-muted">
                {tr(
                  "Validações mínimas antes de campanhas ou atendimento por IA.",
                  "Minimum validation before campaigns or AI handoff.",
                )}
              </p>
            </div>
          </div>
          <div className="grid gap-2 md:grid-cols-2">
            {clientChecklist.map((item) => (
              <div
                key={item}
                className="flex items-start gap-2 rounded-lg border border-line-soft bg-surface-2 px-3 py-2 text-[13px] text-body"
              >
                <CheckCircle2
                  size={15}
                  className="mt-0.5 shrink-0 text-emerald-600"
                />
                {item}
              </div>
            ))}
          </div>
        </section>

        <section className="grid gap-4 lg:grid-cols-2">
          {guides.map((guide) => (
            <GuideCard key={guide.title} {...guide} />
          ))}
        </section>

        <section className="rounded-lg border border-line bg-surface p-5">
          <h2 className="font-[var(--font-outfit)] text-[18px] font-medium text-ink">
            {tr("Acessos rápidos", "Fast links")}
          </h2>
          <div className="mt-4 flex flex-wrap gap-2">
            <SupportLink href="/app/settings">{tr("Configuração de ligações", "Connection settings")}</SupportLink>
            <SupportLink href="/app/campaigns">{tr("Falhas de campanhas", "Campaign failures")}</SupportLink>
            <SupportLink href="/app/leads">{tr("Leads de anúncios", "Ad leads")}</SupportLink>
            <SupportLink href="/privacy">{tr("Política de privacidade", "Privacy policy")}</SupportLink>
            <SupportLink href="/terms">{tr("Termos", "Terms")}</SupportLink>
          </div>
        </section>
      </div>
    </>
  );
}

function GuideCard({
  icon: Icon,
  title,
  body,
  bullets,
}: {
  icon: LucideIcon;
  title: string;
  body: string;
  bullets: string[];
}) {
  return (
    <article className="rounded-lg border border-line bg-surface p-5">
      <div className="mb-3 flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-surface-3 text-ink">
          <Icon size={17} />
        </div>
        <div>
          <h3 className="font-[var(--font-outfit)] text-[16px] font-medium text-ink">
            {title}
          </h3>
          <p className="mt-1 text-sm leading-relaxed text-muted">{body}</p>
        </div>
      </div>
      <ul className="space-y-2">
        {bullets.map((bullet) => (
          <li key={bullet} className="flex gap-2 text-[13px] text-body">
            <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-faint/50" />
            {bullet}
          </li>
        ))}
      </ul>
    </article>
  );
}

function buildGuides(locale: "pt" | "en") {
  if (locale === "pt") {
    return [
      {
        icon: CheckCircle2,
        title: "Guia de ligação",
        body: "Valide portefólio empresarial, verificação, faturação, permissões, webhook e propriedade do número.",
        bullets: [
          "Confirme que o número não está ligado a outro fornecedor.",
          "Prefira o Embedded Signup; a configuração manual é apenas alternativa.",
          "Depois de ligar, faça um pequeno envio de utilidade antes de campanhas.",
        ],
      },
      {
        icon: FileQuestion,
        title: "O que confirmar com a clínica",
        body: "Recolha o contexto operacional antes do primeiro erro da Meta.",
        bullets: [
          "Que mensagens serão enviadas e para que público com consentimento?",
          "Que equipa continua a usar diariamente a app WhatsApp Business?",
          "Quem aprova templates, faturação e resposta a incidentes?",
        ],
      },
      {
        icon: CreditCard,
        title: "Faturação Meta",
        body: "Falhas de pagamento não são seguras para repetição automática. Resolva a conta antes de retomar campanhas.",
        bullets: [
          "Verifique o método de pagamento e limites da conta empresarial.",
          "Confirme que não existem faturas em atraso ou dependências desativadas.",
          "Retome apenas depois de a Meta aceitar um pequeno envio de teste.",
        ],
      },
      {
        icon: ShieldAlert,
        title: "Número bloqueado ou restrito",
        body: "Uma falha de política deve pausar envios e iniciar a recolha de evidências.",
        bullets: [
          "Exporte contactos falhados e categorias de erro da campanha.",
          "Reúna templates, exemplos, WABA ID, Phone Number ID e horários.",
          "Prepare um número alternativo apenas após rever consentimento e coexistência.",
        ],
      },
      {
        icon: AlertTriangle,
        title: "Incidente de qualidade ou ritmo",
        body: `Quando surgem erros de qualidade ou ritmo, ${BRAND_NAME} ativa proteção e pausa campanhas associadas.`,
        bullets: [
          "Pare envios de marketing até a proteção terminar e a qualidade estabilizar.",
          "Reduza frequência, refine o segmento e evite ofertas genéricas repetidas.",
          "Retome com um grupo pequeno e acompanhe as causas de falha.",
        ],
      },
      {
        icon: AlertTriangle,
        title: "Limites da coexistência",
        body: "A coexistência mantém a app Business e a Cloud API juntas, com diferenças de sincronização.",
        bullets: [
          "Escolha coexistência no onboarding; migrar primeiro pode remover o acesso à app.",
          "Editar ou revogar na app pode não gerar os mesmos eventos da API.",
          "Verifique registos críticos após ligar, sobretudo histórico e media antigos.",
        ],
      },
      {
        icon: CreditCard,
        title: "Janela de entrada gratuita",
        body: "Leads de anúncios Click-to-WhatsApp exigem resposta rápida para aproveitar o período de entrada gratuita.",
        bullets: [
          "Priorize leads de anúncios antes de passarem as primeiras 24 horas.",
          "Acompanhe o limite de 72 horas e encaminhe leads quentes à equipa.",
          "O período gratuito não elimina consentimento, opt-out nem regras de qualidade.",
        ],
      },
    ];
  }

  return [
    {
      icon: CheckCircle2,
      title: "Connection guide",
      body: "Validate Business Manager, verification, billing, scopes, webhook, and number ownership.",
      bullets: [
        "Confirm the number is not already attached to another provider.",
        "Prefer Embedded Signup; manual token setup is fallback only.",
        "After connection, send a small utility test before any campaign.",
      ],
    },
    {
      icon: FileQuestion,
      title: "What to confirm with the clinic",
      body: "Collect operational context before the first Meta error.",
      bullets: [
        "What messages will be sent and to which opted-in audience?",
        "Which team still uses the WhatsApp Business App daily?",
        "Who approves templates, billing changes, and quality incidents?",
      ],
    },
    {
      icon: CreditCard,
      title: "Meta billing",
      body: "Payment failures are not retry-safe. Fix account health before resuming campaigns.",
      bullets: [
        "Check the Business payment method and spending limits.",
        "Confirm there are no unpaid invoices or disabled dependencies.",
        "Resume only after Meta accepts a small test send.",
      ],
    },
    {
      icon: ShieldAlert,
      title: "Blocked or restricted number",
      body: "A policy failure should pause sends and start evidence gathering.",
      bullets: [
        "Export failed contacts and error categories from the campaign.",
        "Collect templates, examples, WABA ID, Phone Number ID, and timestamps.",
        "Prepare a fallback number only after reviewing consent and coexistence.",
      ],
    },
    {
      icon: AlertTriangle,
      title: "Quality or pacing incident",
      body: `When quality or pacing errors appear, ${BRAND_NAME} activates protection and pauses linked campaigns.`,
      bullets: [
        "Stop marketing sends until protection ends and quality stabilizes.",
        "Reduce frequency, narrow segments, and avoid repeated generic offers.",
        "Restart with a small cohort and monitor failure causes.",
      ],
    },
    {
      icon: AlertTriangle,
      title: "Coexistence limitations",
      body: "Coexistence keeps the Business App and Cloud API together with synchronization differences.",
      bullets: [
        "Choose coexistence during onboarding; migrating first can remove Business App access.",
        "Editing or revoking in the app may not produce the same API events.",
        "Verify critical history and media records after onboarding.",
      ],
    },
    {
      icon: CreditCard,
      title: "Free-entry window",
      body: "Click-to-WhatsApp ad leads need a fast response to use the free-entry period.",
      bullets: [
        "Prioritize ad leads before the first 24 hours pass.",
        "Track the 72-hour limit and move hot leads to the team.",
        "The free period does not remove consent, opt-out, or quality rules.",
      ],
    },
  ];
}

function SupportLink({
  href,
  children,
}: {
  href: string;
  children: string;
}) {
  return (
    <Link
      href={href}
      className="rounded-lg border border-line bg-surface px-3 py-2 text-[13px] font-medium text-ink transition-colors hover:border-line hover:bg-surface-2"
    >
      {children}
    </Link>
  );
}
