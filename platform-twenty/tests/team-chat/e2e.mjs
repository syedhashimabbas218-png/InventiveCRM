// Team chat end to end on the throwaway test server, as two real users: the admin and Bob (a restricted Member).
// Usage: SERVER_URL=http://localhost:3001 node e2e.mjs <api key file>
import { readFileSync } from 'node:fs';

import { testServerUrl } from '../guard.cjs';

const SERVER_URL = testServerUrl();
const [keyFile] = process.argv.slice(2);
const apiKey = readFileSync(keyFile, 'utf8').trim();
const W = SERVER_URL.replace('//localhost', '//acme.localhost');
const origin = new URL(W).origin;
const run = Date.now().toString(36);

let failures = 0;
let passes = 0;
const assert = (label, condition, detail = '') => {
  if (condition) passes += 1;
  else failures += 1;
  console.log(`${condition ? 'PASS' : 'FAIL'} ${label}${condition ? '' : `  (${detail})`}`);
};

const call = async (url, token, query, variables = {}) => {
  const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin, ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify({ query, variables }) });
  const payload = await response.json();
  if (payload.errors) throw new Error(JSON.stringify(payload.errors.map((error) => error.message)));
  return payload.data;
};
const userToken = async (email, password) => {
  const loginToken = (await call(`${W}/metadata`, null, `mutation($email: String!, $password: String!, $origin: String!) { getLoginTokenFromCredentials(email: $email, password: $password, origin: $origin) { loginToken { token } } }`, { email, password, origin })).getLoginTokenFromCredentials.loginToken.token;
  return (await call(`${W}/metadata`, null, `mutation($loginToken: String!, $origin: String!) { getAuthTokensFromLoginToken(loginToken: $loginToken, origin: $origin) { tokens { accessOrWorkspaceAgnosticToken { token } } } }`, { loginToken, origin })).getAuthTokensFromLoginToken.tokens.accessOrWorkspaceAgnosticToken.token;
};
const chatAs = (token) => async (body) => {
  const response = await fetch(`${W}/s/chat/api`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
  return { status: response.status, body: await response.json().catch(() => null) };
};

const adminToken = await userToken('admin@inventiveweb.test', 'Admin-Pass-1234!');
const bobToken = await userToken('bob@inventiveweb.test', 'Bob-Pass-1234!');
const admin = chatAs(adminToken);
const bob = chatAs(bobToken);

// 1. Both land in #general.
const adminBoot = (await admin({ action: 'bootstrap' })).body;
const bobBoot = (await bob({ action: 'bootstrap' })).body;
const general = adminBoot?.channels.find((channel) => channel.name === 'general');
assert('everyone starts in #general, and there is only one', general && bobBoot?.channels.some((channel) => channel.id === general.id), JSON.stringify(adminBoot?.channels));
const generalKey = (await call(`${SERVER_URL}/graphql`, apiKey, `query($id: UUID!) { chatChannel(filter: { id: { eq: $id } }) { directKey } }`, { id: general.id })).chatChannel.directKey;
const generals = await call(`${SERVER_URL}/graphql`, apiKey, `query($key: String) { chatChannels(filter: { directKey: { eq: $key } }) { totalCount } }`, { key: generalKey });
assert('there is exactly one #general', generals.chatChannels.totalCount === 1, String(generals.chatChannels.totalCount));
const adminId = adminBoot.me;
const bobId = bobBoot.me;
const adminName = adminBoot.members.find((member) => member.id === adminId).name;
const bobName = adminBoot.members.find((member) => member.id === bobId).name;

// 2. Posting, mentions, links and unread counts.
const person = (await call(`${SERVER_URL}/graphql`, apiKey, `mutation($data: PersonCreateInput!) { createPerson(data: $data) { id } }`, { data: { name: { firstName: 'Chat', lastName: run } } })).createPerson;
await bob({ action: 'markRead', channelId: general.id });
const posted = await admin({
  action: 'post',
  channelId: general.id,
  text: `Hi @${bobName}, can you call this customer? ${run}`,
  mentions: [bobId, 'not-a-member'],
  links: [
    { objectNameSingular: 'person', recordId: person.id, label: 'Acme: contract signed' },
    { objectNameSingular: 'person', recordId: '00000000-0000-4000-8000-000000000000', label: 'Does not exist' },
    { objectNameSingular: 'workspaceMember', recordId: bobId, label: 'Not linkable' },
  ],
});
assert('a message is posted with its mention and record link', posted.status === 200 && posted.body.message.mentions.join() === bobId && posted.body.message.links[0]?.recordId === person.id, JSON.stringify(posted.body));
assert('record links take their label from the record, and unknown or other records are dropped', posted.body.message.links.length === 1 && posted.body.message.links[0].label === `Chat ${run}`, JSON.stringify(posted.body.message.links));
const bobChannels = (await bob({ action: 'channels' })).body.channels;
const bobGeneral = bobChannels.find((channel) => channel.id === general.id);
assert('the mentioned person sees an unread message and an unread mention', bobGeneral?.unread >= 1 && bobGeneral.unreadMentions === 1, JSON.stringify(bobGeneral));
const bobSees = (await bob({ action: 'messages', channelId: general.id })).body.messages.find((message) => message.id === posted.body.message.id);
assert('the other person reads the message', bobSees?.text.includes(run), JSON.stringify(bobSees));
await bob({ action: 'markRead', channelId: general.id });
const afterRead = (await bob({ action: 'channels' })).body.channels.find((channel) => channel.id === general.id);
assert('marking read clears unread and mentions', afterRead.unread === 0 && afterRead.unreadMentions === 0, JSON.stringify(afterRead));
const since = posted.body.message.createdAt;
const reply = await bob({ action: 'post', channelId: general.id, text: `On it ${run}` });
const polled = (await admin({ action: 'messages', channelId: general.id, after: since })).body.messages;
assert('polling after the last message returns only newer ones', polled.length === 1 && polled[0].id === reply.body.message.id, JSON.stringify(polled.map((message) => message.text)));

// 3. Messages are encrypted at rest, including mentions and links.
const raw = (await call(`${SERVER_URL}/graphql`, apiKey, `query($id: UUID!) { chatMessage(filter: { id: { eq: $id } }) { name body authorMemberId } }`, { id: posted.body.message.id })).chatMessage;
assert('the stored record holds no readable text, mention, link or author id', raw.body.startsWith('v1.') && !raw.body.includes(run) && !raw.body.includes(person.id) && raw.name === 'Message' && raw.authorMemberId !== adminId, JSON.stringify(raw));
const pollSince = new Date(Date.now() - 1000).toISOString();

// 4. Editing and deleting: own messages only.
const bobEdits = await bob({ action: 'edit', messageId: posted.body.message.id, text: 'hacked' });
const bobDeletes = await bob({ action: 'remove', messageId: posted.body.message.id });
assert("nobody can edit or delete someone else's message", bobEdits.status === 403 && bobDeletes.status === 403, `${bobEdits.status} ${bobDeletes.status}`);
const edited = await admin({ action: 'edit', messageId: posted.body.message.id, text: `Edited ${run} @${bobName}` });
assert('the author can edit; mentions and links are kept', edited.status === 200 && edited.body.message.editedAt && edited.body.message.links.length === 1 && edited.body.message.mentions.length === 1, JSON.stringify(edited.body));
const removed = await bob({ action: 'remove', messageId: reply.body.message.id });
const remaining = (await admin({ action: 'messages', channelId: general.id })).body.messages.map((message) => message.id);
assert('the author can delete', removed.status === 200 && !remaining.includes(reply.body.message.id), String(removed.status));
const caughtUp = (await bob({ action: 'messages', channelId: general.id, after: new Date().toISOString(), changesSince: pollSince })).body;
assert('open screens learn about edits and deletions', caughtUp.changed?.some((message) => message.id === posted.body.message.id && message.text.startsWith('Edited')) && caughtUp.removed?.includes(reply.body.message.id), JSON.stringify({ changed: caughtUp.changed?.length, removed: caughtUp.removed }));

// 5. Private channels and direct messages stay private.
const privateChannel = await admin({ action: 'createChannel', name: `Board ${run}`, visibility: 'PRIVATE', topic: 'Owners only' });
const secret = await admin({ action: 'post', channelId: privateChannel.body.id, text: `Salary review ${run}` });
const bobReadsPrivate = await bob({ action: 'messages', channelId: privateChannel.body.id });
const bobPostsPrivate = await bob({ action: 'post', channelId: privateChannel.body.id, text: 'let me in' });
const bobJoinsPrivate = await bob({ action: 'join', channelId: privateChannel.body.id });
const bobBrowse = (await bob({ action: 'browse' })).body.channels.map((channel) => channel.id);
assert('a private channel cannot be read, posted to, joined or browsed by others', secret.status === 200 && bobReadsPrivate.status === 403 && bobPostsPrivate.status === 403 && bobJoinsPrivate.status === 403 && !bobBrowse.includes(privateChannel.body.id), `${bobReadsPrivate.status} ${bobPostsPrivate.status} ${bobJoinsPrivate.status}`);
// Writing chat records straight through Twenty's API gets nobody in: the app ignores rows it did not seal.
const asBob = (query, variables) => call(`${W}/graphql`, bobToken, query, variables);
const privateRecord = (await asBob(`query($id: UUID!) { chatChannel(filter: { id: { eq: $id } }) { name topic directKey } }`, { id: privateChannel.body.id })).chatChannel;
assert('private channel names and topics are not readable through the API', privateRecord && !privateRecord.name?.includes(run) && !privateRecord.topic?.includes('Owners'), JSON.stringify(privateRecord));
const forgedMembership = await asBob(`mutation($data: ChatMembershipCreateInput!) { createChatMembership(data: $data) { id } }`, { data: { name: 'x', channelId: privateChannel.body.id, workspaceMemberId: bobId } });
const copiedKey = (await asBob(`query($channel: UUID) { chatMemberships(filter: { channelId: { eq: $channel } }) { edges { node { workspaceMemberId seal } } } }`, { channel: general.id })).chatMemberships.edges.map((edge) => edge.node);
const forgedCopy = await asBob(`mutation($data: ChatMembershipCreateInput!) { createChatMembership(data: $data) { id } }`, { data: { name: 'x', channelId: privateChannel.body.id, workspaceMemberId: copiedKey[0]?.workspaceMemberId, seal: copiedKey[0]?.seal } });
const afterForgery = await bob({ action: 'messages', channelId: privateChannel.body.id });
assert('a membership written straight through the API does not open a private channel', Boolean(forgedMembership.createChatMembership && forgedCopy.createChatMembership) && afterForgery.status === 403, String(afterForgery.status));
const forgedChannel = (await asBob(`mutation($data: ChatChannelCreateInput!) { createChatChannel(data: $data) { id } }`, { data: { name: `fake-${run}`, kind: 'CHANNEL', visibility: 'PUBLIC' } })).createChatChannel;
const browseAfterForgery = (await admin({ action: 'browse' })).body.channels.map((channel) => channel.id);
assert('a channel written straight through the API does not show up', forgedChannel && !browseAfterForgery.includes(forgedChannel.id), JSON.stringify(forgedChannel));
const forgedMessage = await asBob(`mutation($data: ChatMessageCreateInput!) { createChatMessage(data: $data) { id } }`, { data: { name: 'Message', channelId: general.id, authorMemberId: raw.authorMemberId, body: raw.body } });
const generalNow = (await admin({ action: 'messages', channelId: general.id })).body.messages.map((message) => message.id);
assert('a message copied or forged through the API is not shown', Boolean(forgedMessage.createChatMessage) && !generalNow.includes(forgedMessage.createChatMessage.id), JSON.stringify(forgedMessage));
await asBob(`mutation($id: UUID!) { updateChatChannel(id: $id, data: { visibility: PUBLIC }) { id } }`, { id: privateChannel.body.id });
const tampered = await bob({ action: 'messages', channelId: privateChannel.body.id });
assert('making a private channel public through the API does not open it', tampered.status === 404 || tampered.status === 403, String(tampered.status));
await asBob(`mutation($id: UUID!) { updateChatChannel(id: $id, data: { visibility: PRIVATE }) { id } }`, { id: privateChannel.body.id });

const mentionOutsider = await admin({ action: 'post', channelId: privateChannel.body.id, text: `@${bobName} look`, mentions: [bobId] });
const stillOut = await bob({ action: 'messages', channelId: privateChannel.body.id });
assert('mentioning someone in a private channel does not let them in', mentionOutsider.body.message.mentions.length === 0 && stillOut.status === 403, JSON.stringify(mentionOutsider.body.message.mentions));
await admin({ action: 'invite', channelId: privateChannel.body.id, memberIds: [bobId] });
const bobInvited = await bob({ action: 'messages', channelId: privateChannel.body.id });
assert('once invited, they can read it', bobInvited.status === 200 && bobInvited.body.messages.some((message) => message.text.includes(run)), String(bobInvited.status));

const direct = await bob({ action: 'openDirect', memberId: adminId });
const directAgain = await admin({ action: 'openDirect', memberId: bobId });
assert('both sides open the same direct conversation', direct.body.id === directAgain.body.id, `${direct.body.id} ${directAgain.body.id}`);
await bob({ action: 'post', channelId: direct.body.id, text: `Private note ${run}` });
const adminDirect = (await admin({ action: 'messages', channelId: direct.body.id })).body.messages;
assert('the other side reads the direct message', adminDirect.some((message) => message.text === `Private note ${run}`), JSON.stringify(adminDirect));
const directLeave = await bob({ action: 'leave', channelId: direct.body.id });
assert('a direct conversation cannot be left', directLeave.status === 400, String(directLeave.status));

// 6. Public channels: browse, look, join; names are unique; #general cannot be left.
const publicChannel = await admin({ action: 'createChannel', name: `Sales ${run}` });
const duplicate = await bob({ action: 'createChannel', name: `sales-${run}` });
assert('channel names are unique', duplicate.status === 400, String(duplicate.status));
const preview = await bob({ action: 'messages', channelId: publicChannel.body.id });
const bobPostsBeforeJoin = await bob({ action: 'post', channelId: publicChannel.body.id, text: 'hi' });
const joined = await bob({ action: 'join', channelId: publicChannel.body.id });
const bobPostsAfterJoin = await bob({ action: 'post', channelId: publicChannel.body.id, text: 'hi' });
assert('a public channel can be looked into, and posted to after joining', preview.status === 200 && preview.body.joined === false && bobPostsBeforeJoin.status === 403 && joined.status === 200 && bobPostsAfterJoin.status === 200, `${preview.status} ${bobPostsBeforeJoin.status} ${bobPostsAfterJoin.status}`);
const leaveGeneral = await bob({ action: 'leave', channelId: general.id });
assert('nobody leaves #general', leaveGeneral.status === 400, String(leaveGeneral.status));

// 7. Abuse limits.
const tooLong = await admin({ action: 'post', channelId: publicChannel.body.id, text: 'x'.repeat(5000) });
assert('very long messages are cut to the limit', tooLong.status === 200 && tooLong.body.message.text.length === 4000, String(tooLong.body?.message?.text.length));
const empty = await admin({ action: 'post', channelId: publicChannel.body.id, text: '   ' });
assert('empty messages are refused', empty.status === 400, String(empty.status));
let limited = null;
for (let index = 0; index < 32 && !limited; index += 1) {
  const response = await bob({ action: 'post', channelId: publicChannel.body.id, text: `flood ${index}` });
  if (response.status === 429) limited = index;
}
assert('flooding is slowed down', limited !== null, 'no 429');
// Rows that only look like Bob's recent channels are enough to reach the hourly cap without creating sixty real ones.
const bobsChannel = await bob({ action: 'createChannel', name: `limit-${run}` });
const bobsKey = (await call(`${SERVER_URL}/graphql`, apiKey, `query($id: UUID!) { chatChannel(filter: { id: { eq: $id } }) { createdByMemberId } }`, { id: bobsChannel.body.id })).chatChannel.createdByMemberId;
const filler = (await call(`${SERVER_URL}/graphql`, apiKey, `mutation($data: [ChatChannelCreateInput!]!) { createChatChannels(data: $data) { id } }`, { data: Array.from({ length: 60 }, (_, index) => ({ name: `filler-${run}-${index}`, kind: 'CHANNEL', visibility: 'PUBLIC', createdByMemberId: bobsKey })) })).createChatChannels.map((channel) => channel.id);
const overCap = await bob({ action: 'createChannel', name: `over-${run}` });
const adminUnaffected = await admin({ action: 'createChannel', name: `fine-${run}` });
await call(`${SERVER_URL}/graphql`, apiKey, `mutation($ids: [UUID]) { deleteChatChannels(filter: { id: { in: $ids } }) { id } }`, { ids: filler });
const underCap = await bob({ action: 'createChannel', name: `under-${run}` });
assert('starting channels is capped per person per hour', bobsChannel.status === 200 && overCap.status === 429 && adminUnaffected.status === 200 && underCap.status === 200, `${bobsChannel.status} ${overCap.status} ${adminUnaffected.status} ${underCap.status}`);
const anonymous = await fetch(`${W}/s/chat/api`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'bootstrap' }) });
const withApiKey = await fetch(`${W}/s/chat/api`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` }, body: JSON.stringify({ action: 'bootstrap' }) });
assert('the chat API needs a signed-in person, not just an API key', (anonymous.status === 401 || anonymous.status === 403) && withApiKey.status === 403, `${anonymous.status} ${withApiKey.status}`);

// 8. Record search follows the caller's permissions.
const search = await admin({ action: 'searchRecords', query: `Chat ${run}` });
assert('record search finds CRM records to link', search.body?.records?.some((record) => record.recordId === person.id), JSON.stringify(search.body));

const metadataAs = (token, query, variables) => call(`${W}/metadata`, token, query, variables);
const { getRoles } = await metadataAs(adminToken, `{ getRoles { id label workspaceMembers { id } } }`);
const bobRole = getRoles.find((role) => role.workspaceMembers.some((member) => member.id === bobId));
const blind =
  getRoles.find((role) => role.label === 'Chat test: reads nothing') ??
  (await metadataAs(adminToken, `mutation($input: CreateRoleInput!) { createOneRole(createRoleInput: $input) { id label } }`, { input: { label: 'Chat test: reads nothing', canReadAllObjectRecords: false, canUpdateAllObjectRecords: false, canSoftDeleteAllObjectRecords: false, canDestroyAllObjectRecords: false, canBeAssignedToUsers: true } })).createOneRole;
const setBobRole = (roleId) => metadataAs(adminToken, `mutation($member: UUID!, $role: UUID!) { updateWorkspaceMemberRole(workspaceMemberId: $member, roleId: $role) { id } }`, { member: bobId, role: roleId });
try {
  await setBobRole(blind.id);
  const blindToken = await userToken('bob@inventiveweb.test', 'Bob-Pass-1234!');
  const blindSearch = await chatAs(blindToken)({ action: 'searchRecords', query: `Chat ${run}` });
  const blindChat = await chatAs(blindToken)({ action: 'messages', channelId: general.id });
  assert("record search uses the caller's permissions: no access, no results", blindSearch.status !== 200 || blindSearch.body.records.length === 0, JSON.stringify(blindSearch.body));
  assert('chat itself still works for that person', blindChat.status === 200, String(blindChat.status));
} finally {
  await setBobRole(bobRole.id);
}

console.log(`${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
