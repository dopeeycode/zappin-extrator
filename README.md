# Zapin Extrator

Extração de membros (com validação estrita de número) + banco de contatos salvos +
adição segura a grupos em lotes espaçados + envio de mensagem individual.

Mesma stack do **zapin**: Fastify + Baileys + Prisma/SQLite (API) e React + Vite + Tailwind (web).

## Como rodar

```bash
npm install
npm run dev
```

- Web: http://localhost:5174
- API: http://localhost:3334

1. Abra o frontend e clique em **Gerar QR Code**; escaneie em *WhatsApp → Aparelhos conectados*.
   (Sessão própria em `apps/api/.baileys_auth`, independente do zapin.)
2. **Aba Extrair**: escolha um grupo na lista. Os membros são extraídos, validados e exportados
   automaticamente para `apps/api/exports/<grupo>_<data>.csv` e `.json`.
   - Você pode selecionar quais membros quer guardar e clicar em **Salvar contatos** (opção
     "Não incluir admins" já vem ligada por padrão).
3. **Aba Contatos**: lista seus contatos salvos, com busca e filtro por grupo de origem.
   - **Importar .txt**: anexe um arquivo `.txt` (1 número por linha, igual ao gerado na exportação) ou cole a lista diretamente, definindo um nome de identificação para a lista.
   - Selecione vários contatos e clique em **Adicionar ao grupo…** para abrir o modal de job.
   - Clique em um contato para abrir o painel lateral e mandar uma **mensagem individual**
     (com digitação humanizada e histórico salvo).
4. **Aba Adicionar a grupo**: acompanha os jobs de adição em andamento, em lotes pequenos e
   espaçados. Mostra o tempo para o próximo lote, contagem de status e botão para enviar convite
   individual para quem bloqueia ser adicionado via privacidade.

## Endpoints

| Método | Rota | Descrição |
| --- | --- | --- |
| GET | `/api/session` | status + QR code |
| POST | `/api/session/connect` | inicia conexão / gera QR |
| POST | `/api/session/logout` | desconecta e apaga a sessão |
| GET | `/api/groups` | grupos em que a conta participa |
| GET | `/api/groups/admin` | grupos onde a conta é admin |
| GET | `/api/groups/:jid/members` | extrai membros e salva CSV/JSON |
| GET | `/api/exports` | lista arquivos salvos |
| GET | `/api/exports/:file` | baixa um arquivo |
| POST | `/api/contacts/import` | salva contatos extraídos (upsert por telefone) |
| GET | `/api/contacts` | lista contatos salvos (busca e filtro por grupo) |
| DELETE | `/api/contacts` | exclui contatos salvos |
| POST | `/api/contacts/:id/message` | envia texto individual e humanizado para um contato |
| GET | `/api/contacts/:id/messages` | histórico de mensagens do contato |
| GET | `/api/add-jobs` | lista jobs de adição |
| POST | `/api/add-jobs` | cria novo job de adição (pula quem já está no grupo) |
| GET | `/api/add-jobs/limits` | limites de segurança e consumo diário |
| GET | `/api/add-jobs/:id` | detalhes e progresso de um job |
| POST | `/api/add-jobs/:id/pause` | pausa job em andamento |
| POST | `/api/add-jobs/:id/resume` | retoma job pausado |
| POST | `/api/add-jobs/:id/cancel` | cancela job |
| POST | `/api/add-jobs/:id/items/:itemId/invite` | envia link de convite para quem bloqueou adição |

## Proteções anti-bloqueio

1. **Adições em lotes e espaçadas**:
   - Padrão: 5 pessoas por lote (máx. 10).
   - Intervalo padrão: 60 a 180 s entre lotes (mín. 30 s).
   - Limite diário padrão: 50 pessoas por 24h (máx. 200).
   - Pausa automática se atingir o limite diário, se o grupo encher (500) ou se a conta perder admin.
   - Ao reiniciar a API, jobs voltam em `PAUSED` para confirmação antes de continuar.
2. **Sem disparo em massa**:
   - Mensagens individuais manuais (um clique = uma pessoa), com atraso de digitação ("composing") proporcional ao texto.
3. **Privacidade respeitada**:
   - Contatos que bloqueiam ser adicionados (`PRIVACY_BLOCKED`) ficam listados com o botão manual "Enviar convite" contendo o link do grupo.

## Garantia de número correto na extração

Regra: **na dúvida, o número é descartado — nunca exibido errado.**

Cada número vem de uma destas fontes (coluna `origem` no CSV):

| origem | de onde vem | confiança |
| --- | --- | --- |
| `jid` | o ID do membro no grupo já é o telefone (servidor do WhatsApp) | direto do servidor |
| `server` | grupo em modo LID, mas o servidor mandou `phone_number` junto | direto do servidor |
| `self` | sua própria conta conectada | direto da sessão |
| `lid-cache` | mapa LID→telefone salvo localmente | **sempre** reconfirmado no servidor; sem confirmação = descartado |

Testes: `npm test --workspace=apps/api`
Build completo: `npm run build`
