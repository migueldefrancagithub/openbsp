import type { Locale } from "@/lib/i18n";

/**
 * Single place that turns a thrown Convex error into words an operator can
 * act on, in PT (default) or EN. Every `ConvexError({ code })` in `convex/`
 * must have an entry here — `npm run check:errors` fails the build otherwise.
 *
 * Style: what happened + what to do. No codes, no JSON, no stack traces.
 */
type Pair = readonly [pt: string, en: string];

export const CONVEX_ERROR_MESSAGES: Record<string, Pair> = {
  // ----- session / tenancy / permissions
  UNAUTHENTICATED: ["A sessão expirou. Entre novamente.", "Your session expired. Sign in again."],
  NO_ACTIVE_TENANT: ["Nenhuma clínica ativa nesta sessão. Escolha ou crie uma clínica.", "No active workspace in this session. Choose or create one."],
  FORBIDDEN: ["Não tem permissão para esta ação.", "You do not have permission for this action."],
  FORBIDDEN_CAPABILITY: ["O seu papel não permite esta ação. Peça a um administrador.", "Your role does not allow this action. Ask an administrator."],
  CROSS_TENANT_ACCESS: ["Este registo pertence a outra clínica.", "This record belongs to another workspace."],
  NOT_FOUND: ["O registo já não existe.", "The record no longer exists."],
  TENANT_NOT_FOUND: ["Clínica não encontrada.", "Workspace not found."],
  ALREADY_MEMBER: ["Esta pessoa já faz parte da equipa.", "This person is already on the team."],
  MEMBER_NOT_ACTIVE: ["Este membro está inativo.", "This member is inactive."],
  MEMBER_NOT_IN_TEAM: ["Este membro não pertence à equipa escolhida.", "This member is not in the selected team."],
  INVITE_EXPIRED: ["O convite expirou. Peça um novo.", "The invite expired. Ask for a new one."],
  INVITE_NOT_ACTIVE: ["O convite já não está ativo.", "The invite is no longer active."],
  INVITE_NOT_FOUND: ["Convite não encontrado.", "Invite not found."],
  INVALID_EMAIL: ["Email inválido.", "Invalid email."],
  INVALID_TEAM_NAME: ["Nome da equipa inválido (2 a 60 caracteres).", "Invalid team name (2 to 60 characters)."],
  TEAM_NAME_EXISTS: ["Já existe uma equipa com este nome.", "A team with this name already exists."],
  CANNOT_CHANGE_OWN_ROLE: ["Não pode alterar o seu próprio papel ou estado. Peça a outro administrador.", "You cannot change your own role or status. Ask another administrator."],
  OWNER_ROLE_RESTRICTED: ["Só um proprietário pode atribuir ou retirar o papel de proprietário.", "Only an owner can grant or revoke the owner role."],
  LAST_OWNER: ["A clínica precisa de pelo menos um proprietário ativo.", "The workspace needs at least one active owner."],
  TEAM_NOT_FOUND: ["Equipa não encontrada.", "Team not found."],
  CAMPAIGN_AUDIENCE_NOT_READY: ["O público ainda está a ser calculado. Aguarde uns segundos.", "The audience is still being calculated. Wait a few seconds."],
  CAMPAIGN_NO_ELIGIBLE_RECIPIENTS: ["Nenhum destinatário elegível: todos estão bloqueados pelo piloto, DND ou já receberam uma campanha recente.", "No eligible recipients: all are blocked by the pilot, DND or a recent campaign."],
  CAMPAIGN_CONSENT_ATTESTATION_REQUIRED: ["Confirme que tem consentimento de marketing para este público antes de lançar.", "Confirm you have marketing consent for this audience before launching."],
  CAMPAIGN_INVALID_STATE: ["Esta ação não é possível no estado atual da campanha.", "This action is not possible in the campaign's current state."],
  CAMPAIGN_KIND_UNSUPPORTED: ["Esta campanha usa o motor antigo; abra-a no estúdio legado.", "This campaign uses the legacy engine; open it in the legacy studio."],
  INVALID_SCHEDULE: ["A data de envio tem de ser no futuro (até 30 dias).", "The send time must be in the future (up to 30 days)."],
  INVALID_VARIABLE_BINDINGS: ["Preencha todas as variáveis do template.", "Fill in every template variable."],
  INVALID_TRACKED_LINK: ["O link rastreado tem de ser um URL https válido.", "The tracked link must be a valid https URL."],
  AUDIENCE_TOO_LARGE: ["Público demasiado grande para o piloto (máx. 5000 conversas).", "Audience too large for the pilot (max 5000 conversations)."],
  TRACKED_LINK_NOT_FOUND: ["Link não encontrado.", "Link not found."],
  INVALID_CAMPAIGN_NAME: ["O nome da campanha tem de ter entre 2 e 80 caracteres.", "The campaign name must be 2 to 80 characters."],
  APPOINTMENT_NOT_BOOKABLE: ["Esta marcação já não está ativa (cancelada ou concluída).", "This appointment is no longer active (cancelled or finished)."],
  APPOINTMENT_IN_PAST: ["A hora escolhida já passou ou é demasiado próxima.", "The chosen time is in the past or too soon."],
  PROFESSIONAL_NOT_FOUND: ["Profissional não encontrado.", "Professional not found."],
  PROFESSIONAL_NOT_ACTIVE: ["Este profissional está arquivado.", "This professional is archived."],
  PROFESSIONAL_NOT_FOR_SERVICE: ["Este profissional não realiza este serviço.", "This professional does not perform this service."],
  PROFESSIONAL_LIMIT: ["Limite de profissionais atingido (100).", "Professional limit reached (100)."],
  INVALID_TIMEZONE: ["Fuso horário inválido (ex.: Africa/Maputo).", "Invalid time zone (e.g. Africa/Maputo)."],
  INVALID_RANGE: ["Intervalo de datas inválido (máximo 31 dias).", "Invalid date range (max 31 days)."],
  INVALID_COLOR: ["Cor inválida (use #RRGGBB).", "Invalid colour (use #RRGGBB)."],
  INVALID_BUSINESS_KEY: ["Chave de idempotência inválida.", "Invalid idempotency key."],
  FOLLOW_UP_TASK_NOT_ACTIVE: ["Este follow-up já não está pendente.", "This follow-up is no longer pending."],
  FOLLOW_UP_NOT_RETRYABLE: ["Este follow-up não pode ser reenviado automaticamente.", "This follow-up cannot be resent automatically."],
  OUTBOX_UNKNOWN: ["O provedor não confirmou o envio; não reenviamos automaticamente para evitar duplicados.", "The provider did not confirm the send; we do not resend automatically to avoid duplicates."],
  STALE_CLAIM: ["O envio ficou pendente demasiado tempo e foi abandonado.", "The send stayed pending too long and was abandoned."],
  ACCEPTANCE_INCOMPLETE: ["Aceite o DPA e confirme a DPIA para continuar.", "Accept the DPA and confirm the DPIA to continue."],
  INVALID_CONTROLLER_NAME: ["Indique o nome da entidade responsável pelos dados.", "Enter the data controller name."],
  INVALID_CONTROLLER_EMAIL: ["Indique um email válido para o responsável pelos dados.", "Enter a valid email for the data controller."],
  DPA_REQUIRED: ["Assine o acordo de tratamento de dados (DPA) antes de ligar o WhatsApp.", "Sign the data processing agreement (DPA) before connecting WhatsApp."],
  DPIA_REQUIRED: ["Conclua a avaliação de impacto (DPIA) antes de ligar o WhatsApp.", "Complete the impact assessment (DPIA) before connecting WhatsApp."],

  // ----- inbox / threads
  THREAD_NOT_FOUND: ["Conversa não encontrada.", "Conversation not found."],
  CONVERSATION_NOT_FOUND: ["Conversa não encontrada.", "Conversation not found."],
  CHANNEL_NOT_FOUND: ["Canal não encontrado. Escolha um canal ativo.", "Channel not found. Choose an active channel."],
  INVALID_SNOOZE_TIME: ["Escolha uma hora futura para adiar.", "Pick a future time to snooze."],
  INVALID_CLOSE_REASON: ["Indique um motivo de encerramento (2 a 80 caracteres).", "Enter a close reason (2 to 80 characters)."],
  INVALID_INTERNAL_NOTE: ["A nota interna precisa de 1 a 4000 caracteres.", "The internal note needs 1 to 4000 characters."],
  INVALID_REMINDER: ["Indique a nota do lembrete e uma hora futura.", "Enter the reminder note and a future time."],
  ATTACHMENT_NOT_ALLOWED: ["Tipo de ficheiro não permitido ou maior que 16 MB.", "File type not allowed or larger than 16 MB."],
  ATTACHMENT_NOT_FOUND: ["Anexo não encontrado.", "Attachment not found."],
  EMPTY_TEXT: ["Escreva a mensagem antes de enviar.", "Write the message before sending."],
  INVALID_TEXT: ["Mensagem vazia ou com mais de 4096 caracteres.", "Message is empty or longer than 4096 characters."],
  TEXT_TOO_LONG: ["A mensagem excede 4096 caracteres.", "The message exceeds 4096 characters."],
  EMPTY_BODY: ["O corpo da mensagem está vazio.", "The message body is empty."],
  INVALID_BODY: ["Corpo da mensagem inválido.", "Invalid message body."],
  BODY_TOO_LONG: ["O corpo da mensagem é demasiado longo.", "The message body is too long."],
  NO_RECIPIENT: ["Sem destinatário para esta conversa.", "No recipient for this conversation."],
  INVALID_RECIPIENT: ["O número do paciente não é válido para envio.", "The patient number is not valid for sending."],
  RECIPIENT_NOT_ALLOWLISTED: ["Este número está fora da lista autorizada do piloto. Peça a um administrador para o adicionar em Definições › WhatsApp.", "This number is outside the pilot allowlist. Ask an administrator to add it in Settings › WhatsApp."],
  SERVICE_WINDOW_EXPIRED: ["A janela de 24h fechou. Use um template aprovado para retomar a conversa.", "The 24h window closed. Use an approved template to resume the conversation."],
  CONSENT_REQUIRED: ["Falta o consentimento do paciente para este tipo de mensagem.", "Patient consent is missing for this kind of message."],
  MISSING_IDENTITY: ["Não foi possível identificar o remetente.", "The sender could not be identified."],
  INVALID_REPLY_CONTEXT: ["A mensagem a que quer responder não pertence a esta conversa.", "The message you are replying to does not belong to this conversation."],
  INVALID_CLIENT_NONCE: ["Pedido de envio inválido. Tente novamente.", "Invalid send request. Try again."],
  AI_NOT_CTWA_LEAD: ["A IA só atende leads vindos de anúncios nesta configuração.", "The AI only handles ad leads in this configuration."],
  AI_PAUSED_BY_OPPORTUNITY: ["A IA está pausada nesta oportunidade.", "The AI is paused on this opportunity."],

  // ----- Hub channel / pilot
  HUB_CHANNEL_NOT_FOUND: ["Canal do piloto não encontrado nesta clínica.", "Pilot channel not found in this workspace."],
  HUB_PILOT_KILL_SWITCH_ACTIVE: ["O envio está desativado neste canal. Ative o piloto em Definições › WhatsApp.", "Sending is disabled on this channel. Enable the pilot in Settings › WhatsApp."],
  PILOT_NOT_READY: ["O piloto ainda não está pronto: confirme o webhook, o número e a lista autorizada.", "The pilot is not ready: confirm the webhook, the number and the allowlist."],
  USE_PROVIDER_PILOT_GATE: ["Use os controlos do piloto em Definições › WhatsApp para este canal.", "Use the pilot controls in Settings › WhatsApp for this channel."],
  ALLOWLIST_REQUIRED: ["Indique pelo menos um número autorizado para o piloto.", "Enter at least one authorized pilot number."],
  INVALID_ALLOWLIST_PHONE: ["Um dos números da lista autorizada não é válido (só dígitos, com indicativo).", "One of the allowlist numbers is invalid (digits only, with country code)."],
  INVALID_DISPLAY_NAME: ["Nome do canal inválido (2 a 60 caracteres).", "Invalid channel name (2 to 60 characters)."],
  INVALID_EXTERNAL_CHANNEL_ID: ["ID do canal Hub inválido.", "Invalid Hub channel ID."],
  INVALID_PHONE_NUMBER: ["Número de telefone inválido (só dígitos, com indicativo).", "Invalid phone number (digits only, with country code)."],
  INVALID_WABA_ID: ["ID da conta WhatsApp Business inválido.", "Invalid WhatsApp Business Account ID."],
  INVALID_CHANNEL_TOKEN: ["Token do canal inválido.", "Invalid channel token."],
  WEAK_WEBHOOK_SECRET: ["O segredo do webhook é demasiado curto. Gere um novo.", "The webhook secret is too short. Generate a new one."],
  CHANNEL_ALREADY_CONNECTED: ["Este canal já está ligado.", "This channel is already connected."],
  PHONE_ALREADY_CONNECTED: ["Este número já está ligado a outro canal.", "This number is already connected to another channel."],
  OPENBSP_CHANNEL_ALLOWLIST_NOT_CONFIGURED: ["A lista de canais autorizados não está configurada no servidor. Contacte o suporte técnico.", "The server-side channel allowlist is not configured. Contact technical support."],
  OPENBSP_CHANNEL_NOT_ALLOWLISTED: ["Este canal, número ou WABA não está autorizado no servidor.", "This channel, number or WABA is not authorized on the server."],
  PROTECTED_CHANNEL_HARD_DENY: ["Este canal está protegido e não pode ser usado pelo OpenBSP.", "This channel is protected and cannot be used by OpenBSP."],
  HUB_HEALTH_VALIDATION_FAILED: ["O Hub não confirmou a saúde do canal. Verifique o ID e o token.", "The Hub did not confirm channel health. Check the ID and token."],
  HUB_PHONE_NOT_CONNECTED: ["O número ainda não está ligado no Hub.", "The number is not connected on the Hub yet."],
  HUB_PHONE_MISMATCH: ["O número indicado não corresponde ao canal do Hub.", "The number entered does not match the Hub channel."],
  HUB_WABA_MISMATCH: ["A conta WhatsApp Business não corresponde ao canal do Hub.", "The WhatsApp Business Account does not match the Hub channel."],
  HUB_TOKEN_VALIDATION_FAILED: ["O Hub rejeitou o token.", "The Hub rejected the token."],
  HUB_TEMPLATE_SYNC_FAILED: ["Não foi possível sincronizar os templates do canal. Tente de novo.", "Could not sync the channel templates. Try again."],
  HUB_FLOWS_FAILED: ["Não foi possível ler os Flows do canal.", "Could not read the channel Flows."],
  HUB_FLOW_CREATE_FAILED: ["Não foi possível criar o Flow no canal.", "Could not create the Flow on the channel."],
  HUB_FLOW_UPLOAD_FAILED: ["Não foi possível carregar o Flow no canal.", "Could not upload the Flow to the channel."],
  HUB_FLOW_PUBLISH_FAILED: ["Não foi possível publicar o Flow.", "Could not publish the Flow."],
  CHANNEL_RATE_LIMITED: ["Limite de envios por minuto atingido. Aguarde um momento.", "Per-minute send limit reached. Wait a moment."],
  CHANNEL_TEMPLATE_NOT_FOUND: ["Template não encontrado neste canal. Sincronize os templates.", "Template not found on this channel. Sync the templates."],
  CHANNEL_TEMPLATE_NOT_APPROVED: ["Este template ainda não está aprovado neste canal.", "This template is not approved on this channel yet."],
  INVALID_TEMPLATE: ["Template inválido: indique nome e idioma.", "Invalid template: enter name and language."],
  INVALID_INTERACTIVE_PAYLOAD: ["Botões ou lista inválidos.", "Invalid buttons or list."],
  TOO_MANY_BUTTONS: ["Máximo de 3 botões por mensagem.", "Maximum of 3 buttons per message."],
  INVALID_BUTTON_TEXT: ["Texto de botão inválido (1 a 20 caracteres).", "Invalid button text (1 to 20 characters)."],
  INVALID_BUTTON_URL: ["URL do botão inválido.", "Invalid button URL."],
  INVALID_BUTTON_PHONE: ["Número do botão inválido.", "Invalid button phone number."],
  DOCUMENT_REQUIRES_EXACTLY_ONE_SOURCE: ["Indique o ficheiro a enviar (uma única origem).", "Provide the file to send (a single source)."],
  FLOW_CONTEXT_REQUIRED: ["Esta resposta de Flow perdeu o contexto original.", "This Flow reply lost its original context."],
  FLOW_DRAFT_NOT_FOUND: ["Rascunho de Flow não encontrado.", "Flow draft not found."],
  FLOW_NAME_EXISTS: ["Já existe um Flow com este nome.", "A Flow with this name already exists."],
  INVALID_FLOW_ID: ["ID do Flow inválido.", "Invalid Flow ID."],
  INVALID_FLOW_JSON: ["O JSON do Flow é inválido.", "The Flow JSON is invalid."],
  INVALID_FLOW_JSON_7_3: ["O Flow tem de seguir a versão 7.3.", "The Flow must follow version 7.3."],
  INVALID_FLOW_CATEGORIES: ["Categorias do Flow inválidas.", "Invalid Flow categories."],
  INVALID_FLOW_MESSAGE: ["Mensagem do Flow inválida.", "Invalid Flow message."],
  FORBIDDEN_FLOW_DOMAIN_MARKER: ["O Flow não pode usar este domínio.", "The Flow cannot use this domain."],
  OPENBSP_FLOW_NAME_REQUIRED: ["O nome do Flow tem de começar por obsp_.", "The Flow name must start with obsp_."],
  PUBLISHED_FLOW_IMMUTABLE: ["Um Flow publicado não pode ser alterado. Crie uma nova versão.", "A published Flow cannot be changed. Create a new version."],
  PUBLISHED_FLOW_NOT_FOUND: ["Flow publicado não encontrado.", "Published Flow not found."],
  LAB_CHANNEL_NOT_ACTIVE: ["O canal de laboratório não está ativo.", "The lab channel is not active."],
  LAB_CHANNEL_NOT_FOUND: ["Canal de laboratório não encontrado.", "Lab channel not found."],
  LAB_FLOW_NOT_FOUND: ["Flow de laboratório não encontrado.", "Lab Flow not found."],
  LAB_FLOW_PREFIX_REQUIRED: ["O nome do Flow tem de começar por obsp_lab_.", "The Flow name must start with obsp_lab_."],
  LAB_TEMPLATE_PREFIX_REQUIRED: ["O template de laboratório tem de começar por obsp_lab_.", "The lab template must start with obsp_lab_."],
  LAB_KILL_SWITCH_ACTIVE: ["O envio de laboratório está desativado.", "Lab sending is disabled."],
  LAB_LIVE_MODE_FORBIDDEN: ["O canal de laboratório não pode entrar em modo live.", "The lab channel cannot enter live mode."],

  // ----- agents / flows
  AUTOMATION_CHANNEL_NOT_FOUND: ["Ligue o agente ao canal WhatsApp do piloto antes de continuar.", "Bind the agent to the pilot WhatsApp channel before continuing."],
  CHATBOT_NOT_FOUND: ["Agente não encontrado.", "Agent not found."],
  FLOW_INVALID: ["O fluxo tem erros. Corrija os passos assinalados antes de publicar.", "The flow has errors. Fix the flagged steps before publishing."],
  FOLDER_NAME_EXISTS: ["Já existe uma pasta com este nome.", "A folder with this name already exists."],
  UNKNOWN_FLOW_TEMPLATE: ["Modelo de fluxo desconhecido.", "Unknown flow template."],
  INVALID_NAME: ["Nome inválido: use 2 a 80 caracteres (respostas rápidas: letras minúsculas, números, _ ou -).", "Invalid name: use 2 to 80 characters (quick replies: lowercase letters, digits, _ or -)."],
  NAME_TAKEN: ["Já existe uma resposta rápida com este atalho.", "A quick reply with this shortcut already exists."],
  EMPTY_CONTENT: ["Escreva o conteúdo da resposta rápida.", "Write the quick reply content."],
  CONTENT_TOO_LONG: ["O conteúdo excede 4096 caracteres.", "The content exceeds 4096 characters."],

  // ----- clinic
  INVALID_TEXT_LENGTH: ["Texto demasiado curto ou demasiado longo. Verifique os campos obrigatórios.", "Text too short or too long. Check the required fields."],
  INVALID_TIME: ["Hora inválida. Use o formato 08:30.", "Invalid time. Use the 08:30 format."],
  INVALID_WEEKDAY: ["Dia da semana inválido.", "Invalid weekday."],
  INVALID_AVAILABILITY_RANGE: ["A hora de início tem de ser anterior à hora de fim.", "The start time must be before the end time."],
  INVALID_DATE: ["Data inválida. Use o formato AAAA-MM-DD.", "Invalid date. Use the YYYY-MM-DD format."],
  INVALID_DURATION: ["A duração tem de estar entre 10 e 480 minutos.", "Duration must be between 10 and 480 minutes."],
  INVALID_BUFFER: ["Os intervalos antes/depois têm de estar entre 0 e 240 minutos.", "Buffers before/after must be between 0 and 240 minutes."],
  INVALID_DELAY: ["O atraso do follow-up tem de estar entre 5 minutos e 30 dias.", "The follow-up delay must be between 5 minutes and 30 days."],
  FOLLOW_UP_RULE_PAUSED: ["Esta regra de follow-up está pausada.", "This follow-up rule is paused."],
  FOLLOW_UP_TARGET_REQUIRED: ["Escolha a conversa ou o caso humano a acompanhar.", "Choose the conversation or human case to follow up."],
  SERVICE_NOT_ACTIVE: ["Este serviço está pausado ou arquivado.", "This service is paused or archived."],
  APPOINTMENT_OUTSIDE_AVAILABILITY: ["Este horário está fora da disponibilidade do serviço.", "This time is outside the service availability."],
  APPOINTMENT_SLOT_UNAVAILABLE: ["Este horário já está ocupado. Escolha outro.", "This slot is already taken. Choose another."],
  HUMAN_CASE_OPEN: ["Resolva o caso humano aberto antes de devolver a conversa à IA.", "Resolve the open human case before returning the conversation to the AI."],
  CUSTOM_FIELD_UNKNOWN: ["Este campo personalizado já não existe. Recarregue a página.", "This custom field no longer exists. Reload the page."],
  CUSTOM_FIELD_INVALID: ["Valor inválido para o campo personalizado.", "Invalid value for the custom field."],
  CUSTOM_FIELD_LIMIT: ["Limite de 20 campos personalizados ativos atingido.", "Limit of 20 active custom fields reached."],
  CUSTOM_FIELD_EXISTS: ["Já existe um campo com este nome.", "A field with this name already exists."],
  INVALID_FIELD_LABEL: ["Nome do campo inválido (2 a 40 caracteres).", "Invalid field name (2 to 40 characters)."],
  INVALID_FIELD_KEY: ["Nome do campo inválido: use letras ou números.", "Invalid field name: use letters or digits."],
  INVALID_CONSENT_PROOF: ["Indique como o consentimento foi obtido (mínimo 5 caracteres).", "Describe how consent was obtained (at least 5 characters)."],

  // ----- contacts / campaigns / templates (legacy Meta stack)
  CONTACT_NOT_FOUND: ["Contacto não encontrado.", "Contact not found."],
  CONTACT_INSERT_FAILED: ["Não foi possível guardar o contacto.", "Could not save the contact."],
  CONTACT_NOT_SENDABLE: ["Um dos contactos não tem número válido ou consentimento.", "One of the contacts has no valid number or consent."],
  INVALID_E164: ["Número inválido. Use o formato internacional (+258...).", "Invalid number. Use the international format (+258...)."],
  INVALID_BSUID: ["Identificador do contacto inválido.", "Invalid contact identifier."],
  EMPTY_IMPORT: ["O ficheiro não tem linhas para importar.", "The file has no rows to import."],
  IMPORT_TOO_LARGE: ["Importe no máximo 5000 contactos de cada vez.", "Import at most 5000 contacts at a time."],
  LIST_NAME_EXISTS: ["Já existe uma lista com este nome.", "A list with this name already exists."],
  EMPTY_CONTACT_LIST: ["A lista escolhida está vazia.", "The selected list is empty."],
  CAMPAIGN_NOT_FOUND: ["Campanha não encontrada.", "Campaign not found."],
  CAMPAIGN_NOT_DRAFT: ["Só é possível lançar campanhas em rascunho.", "Only draft campaigns can be launched."],
  CAMPAIGN_NOT_PAUSED: ["A campanha não está pausada.", "The campaign is not paused."],
  CAMPAIGN_NOT_RUNNING: ["A campanha não está em execução.", "The campaign is not running."],
  CAMPAIGN_TERMINAL: ["A campanha já terminou.", "The campaign has already ended."],
  CAMPAIGN_HAS_NO_RECIPIENTS: ["A campanha não tem destinatários enviáveis.", "The campaign has no sendable recipients."],
  CAMPAIGN_RECIPIENT_NOT_FOUND: ["Destinatário não encontrado.", "Recipient not found."],
  CAMPAIGN_TEMPLATE_MISSING: ["A campanha não tem template.", "The campaign has no template."],
  CAMPAIGN_TEMPLATE_REQUIRED: ["Escolha um template aprovado para a campanha.", "Choose an approved template for the campaign."],
  INVALID_BATCH_SIZE: ["O tamanho do lote tem de estar entre 1 e 50.", "Batch size must be between 1 and 50."],
  MICRO_CAMPAIGN_EMPTY: ["Escolha pelo menos uma conversa com janela aberta.", "Choose at least one conversation with an open window."],
  MICRO_CAMPAIGN_TOO_LARGE: ["A micro-campanha aceita no máximo 10 conversas.", "A micro campaign accepts at most 10 conversations."],
  VARIABLE_TEMPLATES_UNSUPPORTED: ["Campanhas em massa ainda não suportam templates com variáveis.", "Bulk campaigns do not support templates with variables yet."],
  LEGACY_WABA_REQUIRED: ["Campanhas por template ainda exigem uma ligação WhatsApp direta (Meta). No canal do piloto use a micro-campanha.", "Template campaigns still require a direct WhatsApp (Meta) connection. On the pilot channel use the micro campaign."],
  TEMPLATE_NOT_FOUND: ["Template não encontrado.", "Template not found."],
  TEMPLATE_NOT_APPROVED: ["Este template ainda não está aprovado pela Meta.", "This template is not approved by Meta yet."],
  TEMPLATE_NAME_EXISTS: ["Já existe um template com este nome e idioma.", "A template with this name and language already exists."],
  TEMPLATE_VERSION_MISSING: ["O template não tem versão aprovada.", "The template has no approved version."],
  VERSION_NOT_FOUND: ["Versão do template não encontrada.", "Template version not found."],
  VERSION_LOCKED: ["Esta versão já foi submetida e não pode ser alterada.", "This version was submitted and cannot be changed."],
  MISSING_TEMPLATE_VARIABLE: ["Preencha todas as variáveis do template.", "Fill in every template variable."],
  PARAM_SCHEMA_MISMATCH: ["As variáveis do corpo não correspondem ao esquema declarado.", "The body variables do not match the declared schema."],
  META_LIST_FAILED: ["A Meta não devolveu a lista de templates. Tente de novo.", "Meta did not return the template list. Try again."],
  META_REQUEST_FAILED: ["Pedido à Meta falhou. Tente de novo mais tarde.", "The Meta request failed. Try again later."],
  META_SUBMIT_FAILED: ["A Meta rejeitou a submissão do template.", "Meta rejected the template submission."],
  NO_WABA_CONNECTED: ["Nenhuma conta WhatsApp Business (Meta) ligada.", "No WhatsApp Business Account (Meta) connected."],
  NO_WABA_TOKEN: ["A conta WhatsApp não tem token válido. Volte a ligar.", "The WhatsApp account has no valid token. Reconnect."],
  NO_TOKEN: ["Sem token de acesso disponível.", "No access token available."],
  TOKEN_UNAVAILABLE: ["Token indisponível. Volte a ligar a conta.", "Token unavailable. Reconnect the account."],
  TOKEN_DECRYPTION_FAILED: ["Não foi possível ler o token guardado. Volte a ligar a conta.", "Could not read the stored token. Reconnect the account."],
  TOKEN_VALIDATION_FAILED: ["A Meta rejeitou o token.", "Meta rejected the token."],
  NO_PHONE_NUMBER_CONNECTED: ["Nenhum número WhatsApp (Meta) ligado.", "No WhatsApp (Meta) number connected."],
  NO_AVAILABLE_PHONE_NUMBER: ["Nenhum número disponível para enviar.", "No number available to send."],
  PHONE_NUMBER_NOT_CONNECTED: ["O número desta campanha já não está ligado.", "The number for this campaign is no longer connected."],
  PHONE_NUMBER_NOT_FOUND: ["Número não encontrado.", "Number not found."],
  PHONE_NUMBER_ALREADY_CONNECTED: ["Este número já está ligado.", "This number is already connected."],
  SIGNUP_LINK_EXPIRED: ["O link de ligação expirou. Gere um novo.", "The connection link expired. Generate a new one."],
  SIGNUP_LINK_NOT_FOUND: ["Link de ligação não encontrado.", "Connection link not found."],
  SIGNUP_SESSION_NOT_FOUND: ["Sessão de ligação não encontrada. Recomece.", "Connection session not found. Start again."],
  INVALID_ADMISSION_CHECK: ["Verificação inválida.", "Invalid check."],
};

const GENERIC: Record<string, Pair> = {
  server: ["O servidor devolveu um erro inesperado. Tente novamente; se persistir, contacte o suporte.", "The server returned an unexpected error. Try again; if it persists, contact support."],
  missingFunction: ["A aplicação está mais recente do que o servidor. Aguarde a publicação do backend e recarregue.", "The app is newer than the server. Wait for the backend release and reload."],
  validation: ["Os dados enviados não têm o formato esperado. Recarregue a página e tente de novo.", "The submitted data has an unexpected format. Reload the page and try again."],
  network: ["Sem ligação ao servidor. Verifique a internet e tente de novo.", "No connection to the server. Check the internet and try again."],
  unknownCode: ["A operação falhou", "The operation failed"],
  unknown: ["A operação falhou. Tente novamente.", "The operation failed. Try again."],
};

function pick(pair: Pair, locale: Locale): string {
  return locale === "en" ? pair[1] : pair[0];
}

function errorData(error: unknown): Record<string, unknown> | null {
  if (!error || typeof error !== "object" || !("data" in error)) return null;
  const data = (error as { data?: unknown }).data;
  if (data && typeof data === "object") return data as Record<string, unknown>;
  if (typeof data === "string") {
    try {
      const parsed = JSON.parse(data) as unknown;
      return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  }
  return null;
}

function rawMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "";
}

/** The `code` of a thrown `ConvexError({ code })`, if any. */
export function convexErrorCode(error: unknown): string | undefined {
  const data = errorData(error);
  if (data && typeof data.code === "string") return data.code;
  const match = /"code"\s*:\s*"([A-Za-z0-9_]+)"/.exec(rawMessage(error));
  return match ? match[1] : undefined;
}

/** True when the error is a `ConvexError` carrying the given code. */
export function isConvexErrorCode(error: unknown, code: string): boolean {
  return convexErrorCode(error) === code;
}

export function convexErrorMessage(
  error: unknown,
  locale: Locale,
  fallback?: string,
): string {
  const code = convexErrorCode(error);
  if (code && CONVEX_ERROR_MESSAGES[code]) {
    return pick(CONVEX_ERROR_MESSAGES[code], locale);
  }
  const data = errorData(error);
  if (data && typeof data.message === "string" && data.message.trim()) {
    return data.message;
  }
  if (code) return `${pick(GENERIC.unknownCode, locale)} (${code}).`;
  const raw = rawMessage(error);
  if (/Could not find public function/i.test(raw)) return pick(GENERIC.missingFunction, locale);
  if (/ArgumentValidationError|ReturnsValidationError|Validator error/i.test(raw)) {
    return pick(GENERIC.validation, locale);
  }
  if (/Server Error|Request ID|Uncaught/i.test(raw)) return pick(GENERIC.server, locale);
  if (/Failed to fetch|NetworkError|WebSocket|ECONN/i.test(raw)) return pick(GENERIC.network, locale);
  if (fallback) return fallback;
  return raw && raw.length <= 160 ? raw : pick(GENERIC.unknown, locale);
}
