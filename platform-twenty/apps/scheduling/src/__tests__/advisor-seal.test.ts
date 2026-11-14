import { afterEach, describe, expect, it } from 'vitest';

import { linkedMember } from 'src/lib/calendar/connections';
import { advisorMemberSeal } from 'src/lib/tokens';

const tokenFor = (workspaceId: string) => `x.${Buffer.from(JSON.stringify({ workspaceId })).toString('base64url')}.y`;
const ADVISOR = '11111111-1111-4111-8111-111111111111';
const ALICE = '22222222-2222-4222-8222-222222222222';
const MALLORY = '33333333-3333-4333-8333-333333333333';

describe('advisor calendar link', () => {
  afterEach(() => {
    delete process.env.BOOKING_LINK_SECRET;
    delete process.env.TWENTY_APP_ACCESS_TOKEN;
  });

  it("uses a member's calendars only for an advisor that member sealed", async () => {
    process.env.BOOKING_LINK_SECRET = 's'.repeat(40);
    process.env.TWENTY_APP_ACCESS_TOKEN = tokenFor('workspace-a');
    const seal = advisorMemberSeal(ADVISOR, ALICE);
    expect(await linkedMember({ id: ADVISOR, workspaceMemberId: ALICE, memberSeal: seal })).toBe(ALICE);
    expect(await linkedMember({ id: ADVISOR, workspaceMemberId: MALLORY, memberSeal: seal })).toBeNull();
    expect(await linkedMember({ id: '44444444-4444-4444-8444-444444444444', workspaceMemberId: ALICE, memberSeal: seal })).toBeNull();
    expect(await linkedMember({ id: ADVISOR, workspaceMemberId: ALICE, memberSeal: null })).toBeNull();
    process.env.TWENTY_APP_ACCESS_TOKEN = tokenFor('workspace-b');
    expect(await linkedMember({ id: ADVISOR, workspaceMemberId: ALICE, memberSeal: seal })).toBeNull();
  });
});
