# Mensagem para Matias Battocchia

Dois canais possíveis: **(A) WhatsApp Community do wakit** (mais leve, recomendado para abrir conversa) ou **(B) Email directo / GitHub issue / DM** (se a comunidade não for adequada).

Recomendação: começar pela **comunidade WhatsApp** com a versão curta. Se o Matias responder, escalar para conversa privada com a versão longa.

---

## Versão curta (WhatsApp Community)

> Olá Matias, parabéns pelo wakit — arquitectura linda, especialmente o desacoplamento agents↔comunicação e o MCP server embutido.
>
> Estou a estudar fazer um fork sobre Convex + Next.js (em vez de Supabase + React/Vite), para um projecto BSP que quero arrancar em PT/UE. A licença Unlicense torna isto viável, mas antes de escrever uma linha tinha 3-4 perguntas operacionais que só tu podes responder. Posso passar para DM/email?

---

## Versão longa (DM ou email, depois do primeiro contacto)

> Olá Matias,
>
> Sou o Daniel, dev solo a operar entre PT e MZ. Acabei de passar várias horas a estudar o wakit-api e wakit-ui em profundidade — o trabalho é excepcional, especialmente:
>
> - O desacoplamento entre comunicação e lógica de agentes (Chat Completions / A2A externos)
> - Os 97 triggers SQL e 42 funções PL/pgSQL como camada de negócio atómica
> - O MCP server embutido — abre caminhos de integração que ninguém mais oferece
> - A ideia de Prototype Inheritance para Managed Agents em `IDEAS.md` — visão certa do futuro
>
> Estou a planear um fork sério (não brinquedo de fim-de-semana) com objectivo de reescrever sobre **Convex + Vercel + Next.js**, focado em mercado PT/UE inicialmente. Convex como backend reactive, Next.js para a UI com SSR/edge no Vercel. A licença Unlicense torna isto possível e quero fazer bem feito.
>
> **Antes de escrever uma linha de código, gostava de te fazer 4 perguntas operacionais que só quem opera em produção sabe responder:**
>
> 1. **Status Meta:** A Mirlo opera o app.wakit.ai como **Tech Provider sob um BSP autorizado**, ou tem **WABA própria com Business Verification + Tech Provider Programme aprovado pela Meta**? Para alguém a arrancar do zero em PT, qual o caminho que recomendas — directo na Meta, ou começar como cliente de um BSP existente até ter volume?
>
> 2. **Triggers SQL:** Os 97 triggers fazem 80% do trabalho pesado (idempotência de webhooks, máquina de estados de conversa, dedup de mensagens). Qual é a tua leitura sobre quanto disto é **acidental** (porque a Mirlo pensa em Postgres) vs **essencial** (resolve race conditions reais que actions/mutations num runtime serverless reintroduziriam)? Algum trigger específico que dirias "este é o que me salvou de uma catástrofe"?
>
> 3. **Compliance Meta gotchas:** Quais foram os 2-3 problemas operacionais com a Meta que **não estão no README** e que vais lembrar para sempre? (Template approval, qualidade de número, tier rate limits, ban risks, opt-in policy, etc.)
>
> 4. **Parceria/colaboração:** Estarias aberto a (a) ser cliente piloto / dar feedback à versão Convex, (b) eu contribuir de volta features compatíveis para o upstream wakit, ou (c) parceria comercial em mercado PT/PALOP onde a Mirlo provavelmente não opera?
>
> Sem pressa para responder — sei que tens trabalho na Mirlo. Mesmo respostas curtas a 1-2 perguntas serão ouro para mim.
>
> Obrigado pelo trabalho open-source. Quando tiver algo a mostrar, partilho.
>
> Daniel

---

## Notas de execução

- **Não enviar versão longa primeiro.** Começa pela curta na comunidade. Mostra respeito pelo tempo dele.
- **Se ele responder seco ou não responder em 1 semana**, ajusta as perguntas (priorizar 1 e 4 — Meta status + parceria — que são as mais accionáveis).
- **Se ele responder bem**, agendar uma chamada de 30min é melhor que continuar por texto.
- Não mencionar "BSP-as-a-Service para PALOP" antes de teres conta Meta aprovada — soa a discurso de pitch, não a interesse genuíno.
- Não pedir "feedback ao plano" — pedir **factos operacionais** que só ele tem.
