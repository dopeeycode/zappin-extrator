import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatPhone, pnJidToDigits } from './phone.js';
import { resolveParticipants, type ResolveContext } from './resolver.js';

const ctx = (over: Partial<ResolveContext> = {}): ResolveContext => ({
  me: { id: '5511999990000:7@s.whatsapp.net', lid: '99999999999999:7@lid' },
  lidCache: new Map(),
  names: new Map(),
  ...over,
});

test('pnJidToDigits aceita só JID de telefone exato', () => {
  assert.equal(pnJidToDigits('5511917551613@s.whatsapp.net'), '5511917551613');
  assert.equal(pnJidToDigits('5511917551613:12@s.whatsapp.net'), '5511917551613');
  // nunca "conserta" valores: qualquer coisa estranha vira null
  assert.equal(pnJidToDigits('123456789012345@lid'), null);
  assert.equal(pnJidToDigits('5511917551613@hosted'), null);
  assert.equal(pnJidToDigits('120363000000000000@g.us'), null);
  assert.equal(pnJidToDigits('+5511917551613@s.whatsapp.net'), null);
  assert.equal(pnJidToDigits('55 11 917551613@s.whatsapp.net'), null);
  assert.equal(pnJidToDigits('05511917551613@s.whatsapp.net'), null);
  assert.equal(pnJidToDigits('1234567@s.whatsapp.net'), null);
  assert.equal(pnJidToDigits('1234567890123456@s.whatsapp.net'), null);
  assert.equal(pnJidToDigits(undefined), null);
  assert.equal(pnJidToDigits(''), null);
});

test('formatPhone preserva todos os dígitos', () => {
  assert.equal(formatPhone('5511917551613'), '+55 11 91755-1613');
  assert.equal(formatPhone('558988133723'), '+55 89 8813-3723');
  assert.equal(formatPhone('351912345678'), '+351912345678');
  for (const d of ['5511917551613', '558988133723', '14155550123']) {
    assert.equal(formatPhone(d).replace(/\D/g, ''), d);
  }
});

test('grupo em modo PN: ID é o telefone', () => {
  const [m] = resolveParticipants(
    [{ id: '5511917551613@s.whatsapp.net', lid: '111@lid', admin: 'admin' }],
    ctx(),
  );
  assert.equal(m.phone, '5511917551613');
  assert.equal(m.source, 'jid');
  assert.equal(m.lid, '111');
  assert.equal(m.role, 'admin');
});

test('grupo em modo LID: usa phone_number do servidor', () => {
  const [m] = resolveParticipants(
    [{ id: '222@lid', phoneNumber: '5519995938814@s.whatsapp.net' }],
    ctx(),
  );
  assert.equal(m.phone, '5519995938814');
  assert.equal(m.source, 'server');
  assert.equal(m.lid, '222');
});

test('LID sem phone_number e sem cache: fica oculto, nunca inventa', () => {
  const [m] = resolveParticipants([{ id: '333@lid' }], ctx());
  assert.equal(m.phone, null);
  assert.equal(m.hiddenReason, 'lid-hidden');
  assert.equal(m.formatted, null);
});

test('LID resolvido pelo cache vem marcado como lid-cache (precisa verificação)', () => {
  const [m] = resolveParticipants(
    [{ id: '444@lid' }],
    ctx({ lidCache: new Map([['444', '5511942146331:0@s.whatsapp.net']]) }),
  );
  assert.equal(m.phone, '5511942146331');
  assert.equal(m.source, 'lid-cache');
  assert.equal(m.verified, false);
});

test('cache com valor inválido é ignorado', () => {
  const [m] = resolveParticipants(
    [{ id: '445@lid' }],
    ctx({ lidCache: new Map([['445', '5511942146331@hosted']]) }),
  );
  assert.equal(m.phone, null);
});

test('própria conta é resolvida pelo sock.user', () => {
  const [m] = resolveParticipants([{ id: '99999999999999@lid' }], ctx());
  assert.equal(m.phone, '5511999990000');
  assert.equal(m.source, 'self');
  assert.equal(m.verified, true);
});

test('mesmo número em dois participantes → descarta os dois', () => {
  const members = resolveParticipants(
    [
      { id: '555@lid', phoneNumber: '5511917548401@s.whatsapp.net' },
      { id: '666@lid' },
    ],
    ctx({ lidCache: new Map([['666', '5511917548401@s.whatsapp.net']]) }),
  );
  for (const m of members) {
    assert.equal(m.phone, null);
    assert.equal(m.hiddenReason, 'conflict');
  }
});

test('ID não-telefone e não-LID é marcado inválido', () => {
  const [m] = resolveParticipants([{ id: '777@hosted.lid' }], ctx());
  assert.equal(m.phone, null);
  assert.equal(m.hiddenReason, 'invalid');
});

test('983 participantes: nenhum número duplicado, alterado ou perdido', () => {
  const input = Array.from({ length: 983 }, (_, i) => {
    const phone = `55119${String(10000000 + i).padStart(8, '0')}`;
    return i % 2
      ? { id: `${phone}@s.whatsapp.net`, lid: `${900000 + i}@lid` }
      : { id: `${900000 + i}@lid`, phoneNumber: `${phone}@s.whatsapp.net` };
  });
  const members = resolveParticipants(input, ctx());
  assert.equal(members.length, 983);
  input.forEach((p, i) => {
    const expected = (p.phoneNumber ?? p.id).split('@')[0];
    assert.equal(members[i].phone, expected);
    assert.equal(members[i].formatted!.replace(/\D/g, ''), expected);
  });
});
