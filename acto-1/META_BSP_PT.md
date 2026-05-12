# Meta Business / WhatsApp Business Platform — Checklist PT/UE

Aplica em paralelo com o contacto ao Matias. Algumas etapas demoram semanas a aprovar — o relógio começa hoje.

## Pré-requisitos legais (antes de tocar na Meta)

- [ ] **Entidade jurídica PT/UE registada** (empresa ou empresário em nome individual)
  - NIF de empresa
  - Comprovativo morada comercial (factura serviços, contrato arrendamento)
  - Conta bancária empresarial (para Stripe / pagamentos Meta)
- [ ] **Domínio próprio** (`.pt` ou `.com`) com email no domínio (`tu@dominio.pt`)
- [ ] **Política de Privacidade + Termos de Uso publicados** no domínio (Meta verifica)
  - Linguagem clara sobre tratamento de dados WhatsApp
  - Conformidade RGPD (UE) — incluir DPO se aplicável

## Camada 1 — Meta Business Portfolio (antes Business Manager)

- [ ] Criar **Meta Business Portfolio** em <https://business.facebook.com>
- [ ] Adicionar **domínio verificado** (Settings > Brand Safety > Domains)
- [ ] Adicionar **conta de pagamento** (cartão crédito empresarial)
- [ ] Convidar segundo admin (boa prática — evita lockout se conta primária for suspensa)

## Camada 2 — Business Verification

> Demora **3-30 dias úteis**. Só começa depois de teres entidade jurídica completa. **Aplica imediatamente**, mesmo sem código pronto.

- [ ] Settings > Security Center > Business Verification > Start Verification
- [ ] Submeter:
  - [ ] Nome legal da empresa (igual ao que está no registo comercial)
  - [ ] Morada
  - [ ] Telefone empresarial verificável (não pessoal)
  - [ ] Documento legal (Certidão Permanente, ou equivalente)
  - [ ] Documento de morada (factura serviços últimos 90 dias)
- [ ] **Possíveis rejeições:** nome no documento ≠ nome no Business Portfolio (corrigir e reapelar). Comum precisar de 2-3 tentativas.

## Camada 3 — Meta App + WhatsApp product

> Pode ser feito em paralelo com Business Verification.

- [ ] <https://developers.facebook.com/apps> > Create App
  - **Use case:** Other
  - **App type:** Business
- [ ] Add **WhatsApp** product
- [ ] App Settings > Basic — copiar **App ID** e **App Secret**
- [ ] Configurar **App Domains** e **Privacy Policy URL** + **Terms URL**

## Camada 4 — System User (para tokens long-lived)

- [ ] Business Suite > Settings > Users > System Users > Add
  - Tipo: **Admin**
- [ ] Atribuir o Meta App ao system user com **Full Control**
- [ ] Generate Token com permissões:
  - `business_management`
  - `whatsapp_business_messaging`
  - `whatsapp_business_management`
- [ ] Guardar token (só é mostrado uma vez)

## Camada 5 — WABA + Phone Number

> Pode ser feito antes ou depois de Business Verification ser aprovada — mas envio de mensagens fora de templates de utilidade requer Verification aprovada.

- [ ] WhatsApp Manager > Add WhatsApp Business Account
- [ ] Add Phone Number
  - **Não usar número pessoal.** Usar número novo, dedicado (eSIM ou número virtual aceite pela Meta).
  - **Não usar número que já tenha conta WhatsApp pessoal/business** activa nos últimos 90 dias.
  - Verificar via SMS ou call.
- [ ] Configurar **Display Name** (verificação adicional, 1-3 dias)
  - Tem regras estritas — não pode ser genérico (ex: "WhatsApp Bot" rejeitado), tem de relacionar com a marca

## Camada 6 — Webhook + Subscriptions

- [ ] WhatsApp > Configuration > Callback URL
  - Apontar para a tua HTTP action Convex (ex: `https://<deployment>.convex.site/whatsapp-webhook`)
  - **Verify Token** — qualquer string secreta, configurar no Convex env
- [ ] Subscribe webhook fields:
  - `account_update`
  - `messages`
  - `history`
  - `smb_app_state_sync` (apenas se Coexistence)
  - `smb_message_echoes` (apenas se Coexistence)
- [ ] Testar com botão **Test** na consola Meta — verificar que chega no Convex

## Camada 7 — Tech Provider Programme (opcional, mas necessário para BSP)

> **Só aplicar quando** tiveres conta Meta operacional + algum tracking de mensagens reais. Aplicar muito cedo é rejeição garantida.

- [ ] <https://developers.facebook.com/docs/whatsapp/solution-providers>
- [ ] Requisitos típicos:
  - Volume mínimo de mensagens (varia)
  - Demonstrar capacidade de operar como BSP (compliance, suporte, infra)
  - Estudo de caso ou clientes piloto
- [ ] **Não é obrigatório** se vais só operar para a tua entidade. Só necessário se queres revender capacidade WhatsApp a terceiros.

## Camada 8 — Templates de Mensagem (utility/marketing)

> Cada template requer aprovação Meta (24h-72h). Templates rejeitados podem afectar **rating de qualidade** do número se forem reportados como spam.

- [ ] Criar templates iniciais (welcome, OTP, transaction notification)
- [ ] Categorias: **utility** (fluxos transaccionais), **marketing** (promoções), **authentication** (OTPs)
- [ ] Definir variáveis (`{{1}}`, `{{2}}`, etc.)
- [ ] Submeter para aprovação Meta

## Custos a antecipar (estimativa PT/UE 2026)

| Item | Custo aproximado |
|---|---|
| Conversation rate (utility, PT) | €0.025 — €0.050 por conversa de 24h |
| Conversation rate (marketing, PT) | €0.07 — €0.12 por conversa |
| Conversation rate (authentication) | €0.025 |
| Service window de 24h | Mensagens dentro da janela = grátis (até reset Meta) |
| Free tier | 1000 conversas/mês service window |

> **Atenção:** Tabela Meta muda. Consultar <https://developers.facebook.com/docs/whatsapp/pricing> antes de modelar pricing do produto.

## Riscos operacionais a monitorizar continuamente

1. **Quality Rating do número** (Verde / Amarelo / Vermelho) — se cair para Vermelho 7 dias, número é flagged. Causas: opt-in fraco, spam reports, conteúdo de templates fora de contexto.
2. **Tier de mensagens** — começa em Tier 1 (1000 contactos únicos / 24h). Sobe automaticamente com qualidade alta. Pode ser rebaixado.
3. **Template rejection rate** — Meta pode banir conta se rejection rate alto.
4. **Business Account suspension** — possível por violação de políticas. Recuperação pode demorar semanas e nem sempre é possível.

## Decisões a tomar antes de aplicar

- [ ] **Nome legal** que vai aparecer na Meta (= nome no Business Portfolio = nome em documentos legais — TÊM de coincidir)
- [ ] **Display name WhatsApp** (visível para clientes)
- [ ] **Verticalidade do negócio** (Meta pergunta — escolhe a categoria que melhor descreve)
- [ ] **Opt-in policy** publicada no site (como contactos consentem)
