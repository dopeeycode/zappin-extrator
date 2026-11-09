# Plano: Contatos salvos + Adicionar a grupo + Mensagem individual (zapin-extrator)

## Contexto
Hoje o `zapin-extrator` extrai os membros de um grupo (com número verificado) e só exporta arquivos.
O usuário quer:
1. **Salvar** os números extraídos num "banco de contatos", escolhendo quais salvar (multiselect) e com
   opção de **ignorar admins** do grupo de origem.
2. **Adicionar contatos salvos a um grupo onde ele é admin**, em lotes pequenos e espaçados
   (X pessoas por vez, intervalo configurável) para o grupo e o número não serem bloqueados.
3. **Mandar mensagem** clicando num contato (envio individual e manual, uma pessoa por vez).

Continua a mesma stack. Para guardar dados, uso **Prisma + SQLite**, igual ao `zapin/apps/api`.

## Banco: Prisma + SQLite (novo em `apps/api/prisma/schema.prisma`)
- `Contact`: `id`, `phone` (único, só dígitos, E.164), `name?`, `sourceGroupId?`, `sourceGroupName?`, `wasAdmin`, `tags?`, `createdAt`.
- `AddJob`: `id`, `groupJid`, `groupName`, `status` (RUNNING | PAUSED | DONE | CANCELED), `batchSize`, `minDelaySec`, `maxDelaySec`, `dailyLimit`, `createdAt`.
- `AddJobItem`: `id`, `jobId`, `contactId`, `status` (PENDING | ADDED | ALREADY_IN | PRIVACY_BLOCKED | RECENTLY_LEFT | FAILED), `code?`, `processedAt?`.
- `MessageLog`: `id`, `contactId`, `text`, `status`, `sentAt` (histórico do que foi enviado).
- `apps/api/src/database/prisma.ts`: cópia simplificada do `zapin/apps/api/src/database/prisma.ts` (resolve o caminho do `file:` do SQLite).
- `.env`: `DATABASE_URL="file:./dev.db"`. Novos scripts: `db:push`, `db:generate`. Adicionar `postinstall: prisma generate`.

## API (Fastify), novos arquivos de rotas
**`src/routes/contacts.ts`**
- `POST /api/contacts/import`: recebe `{ sourceGroup, members: [{phone, name, role}] }`. Revalida cada número com `pnJidToDigits` (`src/phone.ts`) e faz upsert por `phone`. Retorna `{ created, updated, skipped }`.
- `GET /api/contacts?search=&sourceGroup=`: lista com busca. `DELETE /api/contacts` recebe `{ ids }`.

**`src/routes/messages.ts`**
- `POST /api/contacts/:id/message` recebe `{ text }`: envia **para um contato**, usando o mesmo padrão "humanizado" do zapin (`sendHumanizedResponse` em `zapin/apps/api/src/baileys/whatsapp-service.ts`: presença "digitando", atraso proporcional ao tamanho do texto, depois envia). Grava em `MessageLog`.
- Não haverá envio em massa / disparo para a lista toda. Isso é proposital: disparo em massa para pessoas que não salvaram seu número é o que mais derruba número no WhatsApp.

**`src/routes/add-jobs.ts`** + **`src/add-runner.ts`** (worker)
- `GET /api/groups/admin`: reaproveita `listGroups()` de `src/whatsapp.ts`, filtrando `isAdmin`.
- `POST /api/add-jobs` recebe `{ groupJid, contactIds, batchSize, minDelaySec, maxDelaySec, dailyLimit }`. Cria o job com os itens, mas antes **pula quem já está no grupo** (via `groupMetadata`).
- `GET /api/add-jobs/:id` (progresso), `POST /api/add-jobs/:id/pause|resume|cancel`.
- Como o worker funciona:
  - Pega `batchSize` itens PENDING e chama `sock.groupParticipantsUpdate(groupJid, jids, 'add')`.
  - Mapeia o `status` de cada item retornado: 200 → ADDED, 409 → ALREADY_IN, 403 → PRIVACY_BLOCKED (a pessoa não permite ser adicionada), 408 → RECENTLY_LEFT, e o resto → FAILED.
  - Espera um tempo aleatório entre `minDelaySec` e `maxDelaySec` e repete.
  - Para sozinho quando: atinge `dailyLimit` em 24h (soma de todos os jobs), o grupo fica cheio (500), perde o admin (401/403 no grupo todo) ou o WhatsApp desconecta. Nesses casos marca o job como PAUSED, com o motivo.
  - O job fica salvo no banco: se a API reiniciar, ele volta como PAUSED e o usuário clica em retomar.
- Limites de segurança (o usuário pode diminuir, mas não passar do máximo):
  - lote padrão de 5 pessoas (máx. 10);
  - intervalo padrão de 60 a 180 s (mín. 30 s);
  - limite diário padrão de 50 pessoas (máx. 200).
- PRIVACY_BLOCKED: o WhatsApp não deixa adicionar. Na tela aparece o botão **"Enviar convite"**, que manda o link do grupo (`groupInviteCode`) **para aquela pessoa, só quando o usuário clica**. Não há envio automático.

## Frontend (React + Tailwind): navegação por abas em `App.tsx`
Divido o `App.tsx` atual em `pages/` + `components/`:
- **Extrair** (tela atual, `MembersPanel`): adicionar:
  - checkbox por linha, "Selecionar todos (visíveis)" e o toggle **"Não incluir admins"**, que já vem ligado e desmarca superadmin/admin;
  - membros sem número não podem ser selecionados;
  - botão **"Salvar N contatos"**, que chama `POST /api/contacts/import` e mostra um toast com criados/atualizados.
- **Contatos**: tabela com busca, filtro por grupo de origem e multiselect. Ações:
  - "Adicionar ao grupo…" abre o modal de job;
  - "Excluir";
  - clicar no contato abre um **painel de mensagem**: textarea, botão enviar, histórico do `MessageLog` e link "Abrir no WhatsApp" (`wa.me/<phone>`).
- **Adicionar a grupo**: modal/página com:
  - select dos grupos onde sou admin;
  - campos lote / intervalo mín-máx / limite diário (com os limites acima e um texto explicando);
  - resumo do tipo "~X min para Y contatos".
  - Depois de iniciar, uma tela de progresso que atualiza a cada 3 s: barra de progresso, contagem por status, lista de PRIVACY_BLOCKED com o botão "Enviar convite", e botões Pausar / Retomar / Cancelar.

## Arquivos
- Novos: `apps/api/prisma/schema.prisma`, `apps/api/src/database/prisma.ts`, `apps/api/src/routes/{contacts,messages,add-jobs}.ts`, `apps/api/src/add-runner.ts`, `apps/web/src/pages/{ExtractPage,ContactsPage,AddJobPage}.tsx`, `apps/web/src/components/{Modal,Toast,MessagePanel}.tsx`.
- Alterados:
  - `apps/api/src/server.ts`: registra as rotas e, no boot, coloca jobs RUNNING como PAUSED;
  - `apps/api/src/whatsapp.ts`: expõe `getSocket()`, `sendText(phone, text)` e `listAdminGroups()`;
  - `apps/api/package.json`: `prisma`, `@prisma/client`;
  - `apps/web/src/api.ts` e `apps/web/src/App.tsx` (abas);
  - README.

## Verificação
1. `npm install`, depois `npm run db:push --workspace=apps/api`, depois `npm run build` sem erros de tipo.
2. Testes unitários (`node:test` + tsx):
   - mapeamento status→resultado do `groupParticipantsUpdate`;
   - respeito ao lote/limite diário pelo runner, usando um socket falso;
   - import rejeitando número inválido/duplicado.
3. Teste manual com a API rodando:
   - extrair um grupo, desmarcar alguns, ligar "não incluir admins" e salvar, conferindo a contagem na aba Contatos;
   - enviar uma mensagem para um contato de teste (seu próprio número);
   - criar um job com 1–2 contatos de teste num grupo de teste onde você é admin, lote 1 e intervalo de 30 s; conferir que ADDED/ALREADY_IN aparecem e que Pausar/Retomar funcionam.