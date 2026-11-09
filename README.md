# Zapin Extrator

Extrai todos os membros (números) de um grupo do WhatsApp. Mesma stack do **zapin**:
Fastify + Baileys (API) e React + Vite + Tailwind (web).

## Rodar

```bash
npm install
npm run dev
```

- Web: http://localhost:5174
- API: http://localhost:3334

1. Abra o frontend e clique em **Gerar QR Code**; escaneie em *WhatsApp → Aparelhos conectados*.
   (Sessão própria em `apps/api/.baileys_auth`, independente do zapin.)
2. Escolha um grupo na lista — os membros são lidos e salvos automaticamente em
   `apps/api/exports/<grupo>_<data>.csv` e `.json`.
3. Na tela: copiar todos os números, baixar CSV / TXT / VCF / JSON, filtrar e buscar.

## Endpoints

| Método | Rota | Descrição |
| --- | --- | --- |
| GET | `/api/session` | status + QR code |
| POST | `/api/session/connect` | inicia conexão / gera QR |
| POST | `/api/session/logout` | desconecta e apaga a sessão |
| GET | `/api/groups` | grupos em que a conta participa |
| GET | `/api/groups/:jid/members` | extrai membros e salva CSV/JSON |
| GET | `/api/exports` | lista arquivos salvos |
| GET | `/api/exports/:file` | baixa um arquivo |

## Garantia de número correto

Regra: **na dúvida, o número é descartado — nunca exibido errado.**

Cada número vem de uma destas fontes (coluna `origem` no CSV):

| origem | de onde vem | confiança |
| --- | --- | --- |
| `jid` | o ID do membro no grupo já é o telefone (servidor do WhatsApp) | direto do servidor |
| `server` | grupo em modo LID, mas o servidor mandou `phone_number` junto | direto do servidor |
| `self` | sua própria conta conectada | direto da sessão |
| `lid-cache` | mapa LID→telefone salvo localmente | **sempre** reconfirmado no servidor; sem confirmação = descartado |

Proteções:
- O JID precisa ser exatamente `<dígitos>@s.whatsapp.net` com 8–15 dígitos (E.164). Nada é "limpo" ou corrigido.
- Os metadados do grupo são lidos duas vezes e só são aceitos quando as duas leituras batem.
- Se o mesmo número aparece em dois membros, ou o servidor diz que o número pertence a outro LID, o número é descartado nos dois.
- Uma checagem final aborta a extração se sobrar algum número inválido ou repetido.
- Opção **Reconfirmar todos** no front: pergunta ao servidor o LID de cada número e compara com o membro (badge ✔ verde).
- Testes: `npm test --workspace=apps/api`.

**Número oculto:** em grupos grandes o WhatsApp pode esconder o telefone (só manda o LID).
Nesse caso o membro aparece como *Número oculto* — não existe forma legítima de obter esse número.

**Excel:** abra pela coluna `telefone_formatado` (texto) ou use o `.txt`; a coluna `telefone`
só com dígitos pode aparecer em notação científica no Excel (o valor continua certo).

## Aviso

Use apenas em grupos que você administra ou com o consentimento dos membros — números de
telefone são dados pessoais (LGPD) e envio em massa para essas listas viola os termos do
WhatsApp e pode banir a conta.
