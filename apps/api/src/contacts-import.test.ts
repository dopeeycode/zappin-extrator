import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeImport } from './contacts-import.js';

test('import aceita só números E.164 exatos', () => {
  const { valid, skipped } = normalizeImport([
    { phone: '5511917551613', name: 'Ana', role: 'member' },
    { phone: '+5511917551613' },
    { phone: '55 11 917551613' },
    { phone: '05511917551613' },
    { phone: '1234567' },
    { phone: '1234567890123456' },
    { phone: '123456789012345@lid' },
    { phone: 5511917551614 },
    { phone: null },
    {},
    null,
  ]);
  assert.deepEqual(valid, [{ phone: '5511917551613', name: 'Ana', wasAdmin: false }]);
  assert.equal(skipped, 10);
});

test('import ignora números repetidos no mesmo envio', () => {
  const { valid, skipped } = normalizeImport([
    { phone: '5511917551613', name: 'Ana' },
    { phone: '5511917551613', name: 'Ana de novo' },
    { phone: '558988133723', role: 'admin' },
  ]);
  assert.deepEqual(
    valid.map((c) => c.phone),
    ['5511917551613', '558988133723'],
  );
  assert.equal(valid[0].name, 'Ana');
  assert.equal(skipped, 1);
});

test('import marca admins/criador e limpa nome vazio', () => {
  const { valid } = normalizeImport([
    { phone: '5511900000001', role: 'superadmin', name: '   ' },
    { phone: '5511900000002', role: 'admin' },
    { phone: '5511900000003', role: 'member' },
  ]);
  assert.deepEqual(
    valid.map((c) => c.wasAdmin),
    [true, true, false],
  );
  assert.equal(valid[0].name, null);
});

test('import com entrada que não é lista não quebra', () => {
  assert.deepEqual(normalizeImport(undefined), { valid: [], skipped: 0 });
  assert.deepEqual(normalizeImport('x'), { valid: [], skipped: 0 });
});

