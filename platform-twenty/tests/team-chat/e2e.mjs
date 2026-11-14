// Team chat end to end on the throwaway test server, as two real users: the admin and Bob (a restricted Member).
// Usage: SERVER_URL=http://localhost:3001 node e2e.mjs <api key file>
import { readFileSync } from 'node:fs';

const SERVER_URL = process.env.SERVER_URL;
if (!SERVER_URL) throw new Error('Set SERVER_URL to the test server. Never run this against production.');
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
const generals = await call(`${SERVER_URL}/graphql`, apiKey, `{ chatChannels(filter: { name: { eq: "general" } }) { totalCount } }`);
assert('there is exactly one #general', generals.chatChannels.totalCount === 1, String(generals.chatChannels.totalCount));
const adminId = adminBoot.me;
const bobId = bobBoot.me;
const adminName = adminBoot.members.find((member) => member.id === adminId).name;
const bobName = adminBoot.members.find((member) => member.id === bobId).name;

// 2. Posting, mentions, links and unread counts.
const person = (await call(`${SERVER_URL}/graphql`, apiKey, `mutation($data: PersonCreateInput!) { createPerson(data: $data) { id } }`, { data: { name: { firstName: 'Chat', lastName: run } } })).createPerson;
await bob({ action: 'markRead', channelId: general.id });
const posted = await admin({ action: 'post', channelId: general.id, text: `Hi @${bobName}, can you call this customer? ${run}`, mentions: [bobId, 'not-a-member'], links: [{ objectNameSingular: 'person', recordId: person.id, label: `Chat ${run}` }] });
assert('a message is posted with its mention and record link', posted.status === 200 && posted.body.message.mentions.join() === bobId && posted.body.message.links[0]?.recordId === person.id, JSON.stringify(posted.body));
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
const raw = (await call(`${SERVER_URL}/graphql`, apiKey, `query($id: UUID!) { chatMessage(filter: { id: { eq: $id } }) { name body } }`, { id: posted.body.message.id })).chatMessage;
assert('the stored record holds no readable text, mention or link', raw.body.startsWith('v1.') && !raw.body.includes(run) && !raw.body.includes(person.id) && raw.name === 'Message', JSON.stringify(raw));

// 4. Editing and deleting: own messages only.
const bobEdits = await bob({ action: 'edit', messageId: posted.body.message.id, text: 'hacked' });
const bobDeletes = await bob({ action: 'remove', messageId: posted.body.message.id });
assert("nobody can edit or delete someone else's message", bobEdits.status === 403 && bobDeletes.status === 403, `${bobEdits.status} ${bobDeletes.status}`);
const edited = await admin({ action: 'edit', messageId: posted.body.message.id, text: `Edited ${run} @${bobName}` });
assert('the author can edit; mentions and links are kept', edited.status === 200 && edited.body.message.editedAt && edited.body.message.links.length === 1 && edited.body.message.mentions.length === 1, JSON.stringify(edited.body));
const removed = await bob({ action: 'remove', messageId: reply.body.message.id });
const remaining = (await admin({ action: 'messages', channelId: general.id })).body.messages.map((message) => message.id);
assert('the author can delete', removed.status === 200 && !remaining.includes(reply.body.message.id), String(removed.status));

// 5. Private channels and direct messages stay private.
const privateChannel = await admin({ action: 'createChannel', name: `Board ${run}`, visibility: 'PRIVATE', topic: 'Owners only' });
const secret = await admin({ action: 'post', channelId: privateChannel.body.id, text: `Salary review ${run}` });
const bobReadsPrivate = await bob({ action: 'messages', channelId: privateChannel.body.id });
const bobPostsPrivate = await bob({ action: 'post', channelId: privateChannel.body.id, text: 'let me in' });
const bobJoinsPrivate = await bob({ action: 'join', channelId: privateChannel.body.id });
const bobBrowse = (await bob({ action: 'browse' })).body.channels.map((channel) => channel.id);
assert('a private channel cannot be read, posted to, joined or browsed by others', secret.status === 200 && bobReadsPrivate.status === 403 && bobPostsPrivate.status === 403 && bobJoinsPrivate.status === 403 && !bobBrowse.includes(privateChannel.body.id), `${bobReadsPrivate.status} ${bobPostsPrivate.status} ${bobJoinsPrivate.status}`);
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
