import { randomUUID } from 'node:crypto';

import { asApplication, gql, metadata, nodes } from 'src/lib/api';
import { channelNameKey, channelSeal, decryptText, directConversationKey, encryptText, memberKey, membershipSeal, sealMatches } from 'src/lib/crypto';
import { CHANNELS_PER_HOUR, channelName, cleanBody, cleanLinks, cleanMentions, isUuid, LINKABLE_OBJECTS, MESSAGES_PER_MINUTE, type RecordLink } from 'src/lib/rules';

export class ChatError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

type Member = { id: string; name: string; email: string; avatarUrl: string };

type RawChannel = { id: string; name: string | null; topic: string | null; kind: 'CHANNEL' | 'DIRECT'; visibility: 'PUBLIC' | 'PRIVATE'; directKey: string | null; lastMessageAt: string | null; archived: boolean; createdByMemberId: string | null; seal: string | null };

type Membership = { id: string; channelId: string; workspaceMemberId: string; seal: string | null; lastReadAt: string | null; unreadMentions: number | null; muted: boolean | null };

type RawMessage = { id: string; createdAt: string; authorMemberId: string; body: string | null; editedAt: string | null; channelId: string };

type Content = { text: string; mentions: string[]; links: RecordLink[] };

const CHANNEL_FIELDS = 'id name topic kind visibility directKey lastMessageAt archived createdByMemberId seal';
const MEMBERSHIP_FIELDS = 'id channelId workspaceMemberId seal lastReadAt unreadMentions muted';
const MESSAGE_FIELDS = 'id createdAt authorMemberId body editedAt channelId';

// Who is calling comes from the user's own token, before anything runs with the app's access.
const currentMember = async () => {
  const result = await metadata<{ currentUser: { workspaceMember: { id: string } | null } | null }>(`{ currentUser { workspaceMember { id } } }`).catch(() => null);
  const memberId = result?.currentUser?.workspaceMember?.id;
  if (!memberId) throw new ChatError('Team chat is for people signed in to this workspace.', 403);
  return memberId;
};

const listMembers = async (): Promise<Member[]> =>
  nodes(
    (await gql<{ workspaceMembers: { edges: { node: { id: string; name: { firstName: string; lastName: string } | null; userEmail: string | null; avatarUrl: string | null } }[] } }>(`{ workspaceMembers(first: 500) { edges { node { id name { firstName lastName } userEmail avatarUrl } } } }`))
      .workspaceMembers,
  ).map((member) => ({ id: member.id, name: [member.name?.firstName, member.name?.lastName].filter(Boolean).join(' ') || member.userEmail || 'Someone', email: member.userEmail ?? '', avatarUrl: member.avatarUrl ?? '' }));

const memberIdsByKey = (members: Member[]) => new Map(members.map((member) => [memberKey(member.id), member.id]));

// Channels and memberships written straight through the API carry no valid seal, so they are ignored.
const isSealed = (channel: RawChannel) => sealMatches(channelSeal(channel), channel.seal);

const nameOf = (channel: RawChannel) => decryptText(channel.name, `channel-name:${channel.id}`) ?? '';
const topicOf = (channel: RawChannel) => decryptText(channel.topic, `channel-topic:${channel.id}`) ?? '';

const channelsWhere = async (filter: string, variables: Record<string, unknown>, declarations: string) =>
  nodes((await gql<{ chatChannels: { edges: { node: RawChannel }[] } }>(`query${declarations ? `(${declarations})` : ''} { chatChannels(filter: ${filter}, orderBy: [{ createdAt: AscNullsLast }], first: 300) { edges { node { ${CHANNEL_FIELDS} } } } }`, variables)).chatChannels).filter(isSealed);

const getChannel = async (id: string) => (await channelsWhere('{ id: { eq: $id } }', { id }, '$id: UUID'))[0] ?? null;

const createChannelRecord = async (data: { name: string; topic: string; kind: 'CHANNEL' | 'DIRECT'; visibility: 'PUBLIC' | 'PRIVATE'; directKey: string; createdBy: string }) => {
  const id = randomUUID();
  const sealed = { id, kind: data.kind, visibility: data.visibility, directKey: data.directKey, createdByMemberId: memberKey(data.createdBy) };
  await gql(`mutation($data: ChatChannelCreateInput!) { createChatChannel(data: $data) { id } }`, {
    data: { ...sealed, name: encryptText(data.name, `channel-name:${id}`), topic: encryptText(data.topic, `channel-topic:${id}`), seal: channelSeal(sealed) },
  });
  return id;
};

const isOwnMembership = (row: Membership, memberId: string) => row.workspaceMemberId === memberKey(memberId) && sealMatches(membershipSeal(row.channelId, memberId), row.seal);

const membershipsWhere = async (filter: string, variables: Record<string, unknown>, declarations: string) =>
  nodes((await gql<{ chatMemberships: { edges: { node: Membership }[] } }>(`query(${declarations}) { chatMemberships(filter: ${filter}, first: 500) { edges { node { ${MEMBERSHIP_FIELDS} } } } }`, variables)).chatMemberships);

const ownMemberships = async (memberId: string) => membershipsWhere('{ workspaceMemberId: { eq: $member } }', { member: memberKey(memberId) }, '$member: String').then((rows) => rows.filter((row) => isOwnMembership(row, memberId)));

const ownRowsIn = async (channelId: string, memberId: string) =>
  membershipsWhere('{ channelId: { eq: $channel }, workspaceMemberId: { eq: $member } }', { channel: channelId, member: memberKey(memberId) }, '$channel: UUID, $member: String').then((rows) => rows.filter((row) => isOwnMembership(row, memberId)));

// Member ids of a channel, from the sealed rows only.
const channelMemberIds = async (channelId: string, keys: Map<string, string>) => {
  const rows = await membershipsWhere('{ channelId: { eq: $channel } }', { channel: channelId }, '$channel: UUID');
  const ids = new Set<string>();
  for (const row of rows) {
    const memberId = keys.get(row.workspaceMemberId);
    if (memberId && isOwnMembership(row, memberId)) ids.add(memberId);
  }
  return { ids, rows };
};

const addMembership = async (channelId: string, memberId: string, extra: Record<string, unknown> = {}) => {
  if ((await ownRowsIn(channelId, memberId)).length) return false;
  await gql(`mutation($data: ChatMembershipCreateInput!) { createChatMembership(data: $data) { id } }`, {
    data: { name: 'Member', channelId, workspaceMemberId: memberKey(memberId), seal: membershipSeal(channelId, memberId), lastReadAt: new Date().toISOString(), unreadMentions: 0, ...extra },
  });
  return true;
};

const updateMemberships = (rows: Membership[], data: Record<string, unknown>) =>
  Promise.all(rows.map((row) => gql(`mutation($id: UUID!, $data: ChatMembershipUpdateInput!) { updateChatMembership(id: $id, data: $data) { id } }`, { id: row.id, data })));

// Members read and write; anyone may look into a public channel before joining it.
const requireAccess = async (channelId: unknown, memberId: string, mode: 'read' | 'write') => {
  if (!isUuid(channelId)) throw new ChatError('Choose a channel.');
  const channel = await getChannel(channelId);
  if (!channel) throw new ChatError('This channel no longer exists.', 404);
  const own = await ownRowsIn(channelId, memberId);
  if (own.length === 0 && !(mode === 'read' && channel.kind === 'CHANNEL' && channel.visibility === 'PUBLIC')) throw new ChatError('You are not in this channel.', 403);
  if (mode === 'write' && channel.archived) throw new ChatError('This channel is archived.');
  return { channel, own };
};

const GENERAL = 'general';

const ensureGeneral = async (memberId: string) => {
  const find = () => channelsWhere('{ directKey: { eq: $key }, kind: { eq: CHANNEL } }', { key: channelNameKey(GENERAL) }, '$key: String');
  let generals = await find();
  if (generals.length === 0) {
    await createChannelRecord({ name: GENERAL, topic: 'Everyone in the team', kind: 'CHANNEL', visibility: 'PUBLIC', directKey: channelNameKey(GENERAL), createdBy: memberId });
    generals = await find();
    // Two first visits at the same moment can each create one; keep the oldest.
    for (const extra of generals.slice(1)) await gql(`mutation($id: UUID!) { deleteChatChannel(id: $id) { id } }`, { id: extra.id });
  }
  const [general] = generals;
  if (!general) throw new Error('The general channel could not be created.');
  await addMembership(general.id, memberId);
};

// Counting is skipped for channels with nothing new, which is most of them on most polls.
const unreadCount = async (row: Membership, channel: RawChannel, memberId: string) => {
  const since = row.lastReadAt ?? '1970-01-01T00:00:00.000Z';
  if (!channel.lastMessageAt || channel.lastMessageAt <= since) return 0;
  return (
    await gql<{ chatMessages: { totalCount: number } }>(`query($channel: UUID, $since: DateTime, $me: String) { chatMessages(filter: { channelId: { eq: $channel }, createdAt: { gt: $since }, authorMemberId: { neq: $me } }) { totalCount } }`, {
      channel: row.channelId,
      since,
      me: memberKey(memberId),
    })
  ).chatMessages.totalCount;
};

const channelsFor = async (memberId: string, members: Member[]) => {
  const rows = new Map<string, Membership>();
  for (const row of await ownMemberships(memberId)) if (!rows.has(row.channelId)) rows.set(row.channelId, row);
  if (rows.size === 0) return [];
  const channels = (await channelsWhere('{ id: { in: $ids } }', { ids: [...rows.keys()] }, '$ids: [UUID]')).filter((channel) => !channel.archived);
  const keys = memberIdsByKey(members);
  const directIds = channels.filter((channel) => channel.kind === 'DIRECT').map((channel) => channel.id);
  const partners = new Map<string, string>();
  if (directIds.length)
    for (const row of await membershipsWhere('{ channelId: { in: $ids } }', { ids: directIds }, '$ids: [UUID]')) {
      const id = keys.get(row.workspaceMemberId);
      if (id && id !== memberId && isOwnMembership(row, id)) partners.set(row.channelId, id);
    }
  const unread = await Promise.all(channels.map((channel) => unreadCount(rows.get(channel.id) as Membership, channel, memberId)));
  return channels.map((channel, index) => {
    const row = rows.get(channel.id) as Membership;
    return {
      id: channel.id,
      name: channel.kind === 'CHANNEL' ? nameOf(channel) : '',
      topic: channel.kind === 'CHANNEL' ? topicOf(channel) : '',
      kind: channel.kind,
      visibility: channel.visibility,
      partnerId: channel.kind === 'DIRECT' ? (partners.get(channel.id) ?? memberId) : null,
      lastMessageAt: channel.lastMessageAt,
      unread: unread[index],
      unreadMentions: row.unreadMentions ?? 0,
      muted: Boolean(row.muted),
    };
  });
};

const messageContext = (message: { id: string; channelId: string; authorMemberId: string }) => `message:${message.channelId}:${message.authorMemberId}:${message.id}`;

const openContent = (raw: RawMessage): Content | null => {
  const plain = decryptText(raw.body, messageContext(raw));
  if (plain === null) return null;
  try {
    const parsed = JSON.parse(plain) as Partial<Content>;
    return { text: typeof parsed.text === 'string' ? parsed.text : '', mentions: Array.isArray(parsed.mentions) ? parsed.mentions.filter(isUuid) : [], links: cleanLinks(parsed.links) };
  } catch {
    return null;
  }
};

// Messages that do not decrypt were not written by this app (or the secret changed) and are left out.
const toMessage = (raw: RawMessage, keys: Map<string, string>) => {
  const content = openContent(raw);
  const authorId = keys.get(raw.authorMemberId);
  if (!content || !authorId) return null;
  return { id: raw.id, createdAt: raw.createdAt, authorId, text: content.text, mentions: content.mentions, links: content.links, editedAt: raw.editedAt };
};

const PAGE = 50;

const loadMessages = async (channelId: string, keys: Map<string, string>, { after, before }: { after?: string; before?: string }) => {
  const filter = after ? `, createdAt: { gt: $at }` : before ? `, createdAt: { lt: $at }` : '';
  const at = after ?? before ?? null;
  const raw = nodes(
    (
      await gql<{ chatMessages: { edges: { node: RawMessage }[] } }>(
        `query($channel: UUID${at ? ', $at: DateTime' : ''}) { chatMessages(filter: { channelId: { eq: $channel }${filter} }, orderBy: [{ createdAt: ${after ? 'AscNullsLast' : 'DescNullsLast'} }, { id: AscNullsLast }], first: ${PAGE}) { edges { node { ${MESSAGE_FIELDS} } } } }`,
        at ? { channel: channelId, at } : { channel: channelId },
      )
    ).chatMessages,
  );
  const ordered = after ? raw : raw.reverse();
  return { messages: ordered.map((message) => toMessage(message, keys)).filter((message) => message !== null), hasMore: !after && raw.length === PAGE };
};

// Edits and deletions since the client's last poll, so every open screen catches up.
const changesSince = async (channelId: string, keys: Map<string, string>, since: string) => {
  const edited = nodes(
    (await gql<{ chatMessages: { edges: { node: RawMessage }[] } }>(`query($channel: UUID, $since: DateTime) { chatMessages(filter: { channelId: { eq: $channel }, editedAt: { gt: $since } }, first: 100) { edges { node { ${MESSAGE_FIELDS} } } } }`, { channel: channelId, since })).chatMessages,
  );
  const removed = nodes(
    (await gql<{ chatMessages: { edges: { node: { id: string } }[] } }>(`query($channel: UUID, $since: DateTime) { chatMessages(filter: { channelId: { eq: $channel }, deletedAt: { gt: $since } }, first: 100) { edges { node { id } } } }`, { channel: channelId, since })).chatMessages,
  );
  return { changed: edited.map((message) => toMessage(message, keys)).filter((message) => message !== null), removed: removed.map((message) => message.id) };
};

const isoOrUndefined = (value: unknown) => (typeof value === 'string' && !Number.isNaN(Date.parse(value)) ? new Date(value).toISOString() : undefined);

type Handler = (body: Record<string, unknown>, memberId: string) => Promise<unknown>;

const bootstrap: Handler = async (_body, memberId) => {
  await ensureGeneral(memberId);
  const members = await listMembers();
  return { me: memberId, members, channels: await channelsFor(memberId, members) };
};

const channels: Handler = async (_body, memberId) => ({ channels: await channelsFor(memberId, await listMembers()) });

const messages: Handler = async (body, memberId) => {
  const { channel, own } = await requireAccess(body.channelId, memberId, 'read');
  const keys = memberIdsByKey(await listMembers());
  const after = isoOrUndefined(body.after);
  const result = await loadMessages(channel.id, keys, { after, before: isoOrUndefined(body.before) });
  const since = isoOrUndefined(body.changesSince);
  return { ...result, ...(since ? await changesSince(channel.id, keys, since) : {}), joined: own.length > 0 };
};

const recentPostCount = async (memberId: string) => {
  const variables = { me: memberKey(memberId), since: new Date(Date.now() - 60_000).toISOString() };
  // Deleted messages count too, so posting and deleting in a loop is limited as well.
  const [live, deleted] = await Promise.all([
    gql<{ chatMessages: { totalCount: number } }>(`query($me: String, $since: DateTime) { chatMessages(filter: { authorMemberId: { eq: $me }, createdAt: { gt: $since } }) { totalCount } }`, variables),
    gql<{ chatMessages: { totalCount: number } }>(`query($me: String, $since: DateTime) { chatMessages(filter: { authorMemberId: { eq: $me }, createdAt: { gt: $since }, deletedAt: { is: NOT_NULL } }) { totalCount } }`, variables),
  ]);
  return live.chatMessages.totalCount + deleted.chatMessages.totalCount;
};

const post: Handler = async (body, memberId) => {
  const { channel } = await requireAccess(body.channelId, memberId, 'write');
  const text = cleanBody(body.text);
  const links = (body.verifiedLinks ?? []) as RecordLink[];
  if (!text && links.length === 0) throw new ChatError('Write a message first.');
  if ((await recentPostCount(memberId)) >= MESSAGES_PER_MINUTE) throw new ChatError('You are sending messages very fast. Wait a moment and try again.', 429);

  const members = await listMembers();
  const keys = memberIdsByKey(members);
  const { ids: inChannel, rows } = await channelMemberIds(channel.id, keys);
  // In a public channel anyone in the workspace can be mentioned; they are added so they see it.
  const mentionable = channel.kind === 'CHANNEL' && channel.visibility === 'PUBLIC' ? new Set(members.map((member) => member.id)) : inChannel;
  const mentions = cleanMentions(body.mentions, mentionable).filter((id) => id !== memberId);

  const id = randomUUID();
  const authorMemberId = memberKey(memberId);
  const created = await gql<{ createChatMessage: RawMessage }>(`mutation($data: ChatMessageCreateInput!) { createChatMessage(data: $data) { ${MESSAGE_FIELDS} } }`, {
    data: { id, name: 'Message', channelId: channel.id, authorMemberId, body: encryptText(JSON.stringify({ text, mentions, links }), messageContext({ id, channelId: channel.id, authorMemberId })) },
  });
  const now = created.createChatMessage.createdAt;
  await gql(`mutation($id: UUID!, $data: ChatChannelUpdateInput!) { updateChatChannel(id: $id, data: $data) { id } }`, { id: channel.id, data: { lastMessageAt: now } });
  for (const mentioned of mentions) {
    const existing = rows.find((row) => row.workspaceMemberId === memberKey(mentioned) && isOwnMembership(row, mentioned));
    if (existing) await updateMemberships([existing], { unreadMentions: (existing.unreadMentions ?? 0) + 1 });
    else await addMembership(channel.id, mentioned, { unreadMentions: 1, lastReadAt: new Date(Date.parse(now) - 1).toISOString() });
  }
  await updateMemberships(
    rows.filter((row) => row.workspaceMemberId === authorMemberId && isOwnMembership(row, memberId)),
    { lastReadAt: now },
  );
  return { message: toMessage(created.createChatMessage, keys) };
};

const ownMessage = async (messageId: unknown, memberId: string) => {
  if (!isUuid(messageId)) throw new ChatError('Choose a message.');
  const message = (await gql<{ chatMessage: RawMessage | null }>(`query($id: UUID!) { chatMessage(filter: { id: { eq: $id } }) { ${MESSAGE_FIELDS} } }`, { id: messageId })).chatMessage;
  const content = message ? openContent(message) : null;
  if (!message || !content) throw new ChatError('This message no longer exists.', 404);
  if (message.authorMemberId !== memberKey(memberId)) throw new ChatError('You can only change your own messages.', 403);
  await requireAccess(message.channelId, memberId, 'write');
  return { message, content };
};

const edit: Handler = async (body, memberId) => {
  const { message, content } = await ownMessage(body.messageId, memberId);
  const text = cleanBody(body.text);
  if (!text) throw new ChatError('A message cannot be empty. Delete it instead.');
  const updated = await gql<{ updateChatMessage: RawMessage }>(`mutation($id: UUID!, $data: ChatMessageUpdateInput!) { updateChatMessage(id: $id, data: $data) { ${MESSAGE_FIELDS} } }`, {
    id: message.id,
    data: { body: encryptText(JSON.stringify({ ...content, text }), messageContext(message)), editedAt: new Date().toISOString() },
  });
  return { message: toMessage(updated.updateChatMessage, memberIdsByKey(await listMembers())) };
};

const remove: Handler = async (body, memberId) => {
  const { message } = await ownMessage(body.messageId, memberId);
  await gql(`mutation($id: UUID!) { deleteChatMessage(id: $id) { id } }`, { id: message.id });
  return { removed: true };
};

// Read up to the newest message the client actually showed, never past the present.
const markRead: Handler = async (body, memberId) => {
  const { own } = await requireAccess(body.channelId, memberId, 'read');
  const upTo = isoOrUndefined(body.upTo);
  const now = new Date().toISOString();
  if (own.length) await updateMemberships(own, { lastReadAt: upTo && upTo < now ? upTo : now, unreadMentions: 0 });
  return { read: true };
};

// Channels and direct conversations are never deleted by the app, so starting them is capped per person.
const refuseTooManyChannels = async (memberId: string) => {
  const variables = { me: memberKey(memberId), since: new Date(Date.now() - 3_600_000).toISOString() };
  const recent = await gql<{ chatChannels: { totalCount: number } }>(`query($me: String, $since: DateTime) { chatChannels(filter: { createdByMemberId: { eq: $me }, createdAt: { gt: $since } }) { totalCount } }`, variables);
  if (recent.chatChannels.totalCount >= CHANNELS_PER_HOUR) throw new ChatError('You have started a lot of channels and conversations in the last hour. Try again later.', 429);
};

const createChannel: Handler = async (body, memberId) => {
  const name = channelName(body.name);
  if (name.length < 2) throw new ChatError('Give the channel a name of at least two letters.');
  const taken = (await channelsWhere('{ directKey: { eq: $key }, kind: { eq: CHANNEL } }', { key: channelNameKey(name) }, '$key: String')).some((channel) => !channel.archived);
  if (taken) throw new ChatError(`There is already a #${name} channel.`);
  await refuseTooManyChannels(memberId);
  const id = await createChannelRecord({
    name,
    topic: typeof body.topic === 'string' ? body.topic.trim().slice(0, 250) : '',
    kind: 'CHANNEL',
    visibility: body.visibility === 'PRIVATE' ? 'PRIVATE' : 'PUBLIC',
    directKey: channelNameKey(name),
    createdBy: memberId,
  });
  const valid = new Set((await listMembers()).map((member) => member.id));
  const invited = [...new Set([memberId, ...(Array.isArray(body.memberIds) ? body.memberIds : [])])].filter((candidate): candidate is string => isUuid(candidate) && valid.has(candidate)).slice(0, 200);
  for (const candidate of invited) await addMembership(id, candidate);
  return { id };
};

const browse: Handler = async (_body, memberId) => {
  const publicChannels = (await channelsWhere('{ kind: { eq: CHANNEL }, visibility: { eq: PUBLIC }, archived: { eq: false } }', {}, '')).map((channel) => ({ id: channel.id, name: nameOf(channel), topic: topicOf(channel) }));
  const mine = new Set((await ownMemberships(memberId)).map((row) => row.channelId));
  return { channels: publicChannels.sort((left, right) => left.name.localeCompare(right.name)).map((channel) => ({ ...channel, joined: mine.has(channel.id) })) };
};

const join: Handler = async (body, memberId) => {
  const { channel } = await requireAccess(body.channelId, memberId, 'read');
  if (channel.archived) throw new ChatError('This channel is archived.');
  await addMembership(channel.id, memberId);
  return { joined: true };
};

const leave: Handler = async (body, memberId) => {
  const { channel, own } = await requireAccess(body.channelId, memberId, 'write');
  if (channel.kind === 'DIRECT') throw new ChatError('You cannot leave a direct conversation.');
  if (nameOf(channel) === GENERAL && channel.visibility === 'PUBLIC') throw new ChatError('Everyone stays in #general.');
  for (const row of own) await gql(`mutation($id: UUID!) { deleteChatMembership(id: $id) { id } }`, { id: row.id });
  return { left: true };
};

const invite: Handler = async (body, memberId) => {
  const { channel } = await requireAccess(body.channelId, memberId, 'write');
  if (channel.kind === 'DIRECT') throw new ChatError('Start a channel to talk with more people.');
  const members = await listMembers();
  const valid = new Set(members.map((member) => member.id));
  const { ids: present } = await channelMemberIds(channel.id, memberIdsByKey(members));
  const ids = [...new Set(Array.isArray(body.memberIds) ? body.memberIds : [])].filter((candidate): candidate is string => isUuid(candidate) && valid.has(candidate) && !present.has(candidate)).slice(0, 200);
  for (const candidate of ids) await addMembership(channel.id, candidate);
  return { added: ids.length };
};

const channelMembers: Handler = async (body, memberId) => {
  const { channel } = await requireAccess(body.channelId, memberId, 'read');
  return { memberIds: [...(await channelMemberIds(channel.id, memberIdsByKey(await listMembers()))).ids] };
};

const updateChannel: Handler = async (body, memberId) => {
  const { channel } = await requireAccess(body.channelId, memberId, 'write');
  if (channel.kind === 'DIRECT') throw new ChatError('Direct conversations have no settings.');
  const data: Record<string, unknown> = {};
  if (typeof body.topic === 'string') data.topic = encryptText(body.topic.trim().slice(0, 250), `channel-topic:${channel.id}`);
  if (body.archived === true) {
    if (channel.createdByMemberId !== memberKey(memberId)) throw new ChatError('Only the person who created the channel can archive it.', 403);
    if (nameOf(channel) === GENERAL) throw new ChatError('#general cannot be archived.');
    data.archived = true;
  }
  if (Object.keys(data).length) await gql(`mutation($id: UUID!, $data: ChatChannelUpdateInput!) { updateChatChannel(id: $id, data: $data) { id } }`, { id: channel.id, data });
  return { saved: true };
};

const openDirect: Handler = async (body, memberId) => {
  const otherId = body.memberId;
  if (!isUuid(otherId) || !(await listMembers()).some((member) => member.id === otherId)) throw new ChatError('Choose someone in the workspace.');
  const key = directConversationKey(memberId, otherId);
  const find = () => channelsWhere('{ directKey: { eq: $key }, kind: { eq: DIRECT } }', { key }, '$key: String');
  let found = await find();
  if (found.length === 0) {
    await refuseTooManyChannels(memberId);
    await createChannelRecord({ name: '', topic: '', kind: 'DIRECT', visibility: 'PRIVATE', directKey: key, createdBy: memberId });
    found = await find();
  }
  const channelId = found[0]?.id;
  if (!channelId) throw new Error('The conversation could not be created.');
  for (const id of new Set([memberId, otherId])) await addMembership(channelId, id);
  return { id: channelId };
};

const HANDLERS: Record<string, Handler> = { bootstrap, channels, messages, post, edit, remove, markRead, createChannel, browse, join, leave, invite, channelMembers, updateChannel, openDirect };

const likeLiteral = (value: string) => `%${value.replace(/[\\%_]/g, (character) => `\\${character}`)}%`;

type Named = { id: string; name: string | null };
type PersonNode = { id: string; name: { firstName: string; lastName: string } | null };

const personLabel = (person: PersonNode) => [person.name?.firstName, person.name?.lastName].filter(Boolean).join(' ') || 'Unnamed contact';

// Record search runs with the caller's own permissions, so nobody can link (or learn of) records they cannot see.
// Twenty's global search is not open to app tokens, so people, companies and deals are searched directly.
const searchRecords = async (body: Record<string, unknown>) => {
  const query = typeof body.query === 'string' ? body.query.trim().slice(0, 100) : '';
  if (query.length < 2) return { records: [] as RecordLink[] };
  const words = query.split(/\s+/).filter(Boolean).slice(0, 4);
  const personFilter = { and: words.map((word) => ({ or: [{ name: { firstName: { ilike: likeLiteral(word) } } }, { name: { lastName: { ilike: likeLiteral(word) } } }, { emails: { primaryEmail: { ilike: likeLiteral(word) } } }] })) };
  const result = await gql<{ people: { edges: { node: PersonNode }[] }; companies: { edges: { node: Named }[] }; opportunities: { edges: { node: Named }[] } }>(
    `query($person: PersonFilterInput, $name: String) { people(filter: $person, first: 5) { edges { node { id name { firstName lastName } } } } companies(filter: { name: { ilike: $name } }, first: 5) { edges { node { id name } } } opportunities(filter: { name: { ilike: $name } }, first: 5) { edges { node { id name } } } }`,
    { person: personFilter, name: likeLiteral(query) },
  );
  return {
    records: [
      ...nodes(result.people).map((person) => ({ objectNameSingular: 'person', recordId: person.id, label: personLabel(person) })),
      ...nodes(result.companies).map((company) => ({ objectNameSingular: 'company', recordId: company.id, label: company.name || 'Unnamed company' })),
      ...nodes(result.opportunities).map((deal) => ({ objectNameSingular: 'opportunity', recordId: deal.id, label: deal.name || 'Unnamed deal' })),
    ],
  };
};

// Links are looked up with the poster's own token and get their label from the record, so a chip can neither point
// at a record the poster cannot see nor claim to be something it is not.
const verifyLinks = async (value: unknown): Promise<RecordLink[]> => {
  const links = cleanLinks(value).filter((link) => LINKABLE_OBJECTS.includes(link.objectNameSingular as (typeof LINKABLE_OBJECTS)[number]));
  if (links.length === 0) return [];
  const idsOf = (object: string) => links.filter((link) => link.objectNameSingular === object).map((link) => link.recordId);
  // Twenty refuses an empty "in" list, so only the record types actually linked are queried.
  const queries = [
    idsOf('person').length ? 'people(filter: { id: { in: $people } }) { edges { node { id name { firstName lastName } } } }' : '',
    idsOf('company').length ? 'companies(filter: { id: { in: $companies } }) { edges { node { id name } } }' : '',
    idsOf('opportunity').length ? 'opportunities(filter: { id: { in: $deals } }) { edges { node { id name } } }' : '',
  ];
  const declarations = [idsOf('person').length ? '$people: [UUID]' : '', idsOf('company').length ? '$companies: [UUID]' : '', idsOf('opportunity').length ? '$deals: [UUID]' : ''].filter(Boolean);
  const result = await gql<{ people?: { edges: { node: PersonNode }[] }; companies?: { edges: { node: Named }[] }; opportunities?: { edges: { node: Named }[] } }>(
    `query(${declarations.join(', ')}) { ${queries.join(' ')} }`,
    { ...(idsOf('person').length ? { people: idsOf('person') } : {}), ...(idsOf('company').length ? { companies: idsOf('company') } : {}), ...(idsOf('opportunity').length ? { deals: idsOf('opportunity') } : {}) },
  );
  const labels = new Map<string, string>([
    ...nodes(result.people).map((person) => [person.id, personLabel(person)] as const),
    ...nodes(result.companies).map((company) => [company.id, company.name || 'Unnamed company'] as const),
    ...nodes(result.opportunities).map((deal) => [deal.id, deal.name || 'Unnamed deal'] as const),
  ]);
  return links.filter((link) => labels.has(link.recordId)).map((link) => ({ ...link, label: labels.get(link.recordId) as string }));
};

export const handleChat = async (body: Record<string, unknown>) => {
  const action = String(body.action ?? '');
  if (action === 'searchRecords') return searchRecords(body);
  const handler = HANDLERS[action];
  if (!handler) throw new ChatError('Unknown action.');
  const memberId = await currentMember();
  const prepared = action === 'post' ? { ...body, verifiedLinks: await verifyLinks(body.links) } : body;
  return asApplication(() => handler(prepared, memberId));
};
