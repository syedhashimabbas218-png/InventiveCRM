import { describe, expect, it, vi } from 'vitest';

vi.mock('twenty-sdk/logic-function', () => ({
  listConnections: async () => [
    { id: 'a-old', externalAccountId: 'inventivechat-1111111111111111', accessToken: 'wa_old_key', authFailedAt: null },
    { id: 'b-new', externalAccountId: 'inventivechat-2222222222222222', accessToken: 'wa_new_key', authFailedAt: null },
    { id: 'c-broken', externalAccountId: 'inventivechat-3333333333333333', accessToken: 'wa_broken_key', authFailedAt: '2026-11-18T09:00:00Z' },
  ],
}));

const { connectedKey } = await import('src/lib/settings');

describe('which InventiveChat key the app uses', () => {
  it('uses the key the settings were saved for, even when an older connection is still there', async () => {
    expect(await connectedKey('2222222222222222')).toBe('wa_new_key');
  });

  it('falls back to the same connection every time when the settings name none or a broken one', async () => {
    expect(await connectedKey(null)).toBe('wa_old_key');
    expect(await connectedKey('3333333333333333')).toBe('wa_old_key');
  });
});
