import { asApplication, gql, metadata, nodes } from 'src/lib/api';
import { decryptMessage, encryptMessage } from 'src/lib/crypto';
import { channelName, cleanBody, cleanLinks, cleanMentions, directKey, isUuid, MESSAGES_PER_MINUTE, type RecordLink } from 'src/lib/rules';

export class ChatError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

type Member = { id: string; name: string; email: string; avatarUrl: string };

type Channel = { id: string; name: string; topic: string | null; kind: 'CHANNEL' | 'DIRECT'; visibility: 'PUBLIC' | 'PRIVATE'; directKey: string | null; lastMessageAt: string | null; archived: boolean; createdByMemberId: string | null };

type Membership = { id: string; channelId: string; workspaceMemberId: string; lastReadAt: string | null; unreadMentions: number | null; muted: boolean | null };

type RawMessage = { id: string; createdAt: string; authorMemberId: string; body: string | null; editedAt: string | null; channelId: string };

type Content = { text: string; mentions: string[]; links: RecordLink[] };

const CHANNEL_FIELDS = 'id name topic kind visibility directKey lastMessageAt archived createdByMemberId';
const MEMBERSHIP_FIELDS = 'id channelId workspaceMemberId lastReadAt unreadMentions muted';
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

const getChannel = async (id: string) => (await gql<{ chatChannel: Channel | null }>(`query($id: UUID!) { chatChannel(filter: { id: { eq: $id } }) { ${CHANNEL_FIELDS} } }`, { id })).chatChannel;

const membershipsOf = async (memberId: string) =>
  nodes((await gql<{ chatMemberships: { edges: { node: Membership }[] } }>(`query($member: String) { chatMemberships(filter: { workspaceMemberId: { eq: $member } }, first: 300) { edges { node { ${MEMBERSHIP_FIELDS} } } } }`, { member: memberId })).chatMemberships);

const channelMemberships = async (channelId: string) =>
  nodes((await gql<{ chatMemberships: { edges: { node: Membership }[] } }>(`query($channel: UUID) { chatMemberships(filter: { channelId: { eq: $channel } }, first: 500) { edges { node { ${MEMBERSHIP_FIELDS} } } } }`, { channel: channelId })).chatMemberships);

const membershipFor = async (channelId: string, memberId: string) =>
  nodes(
    (await gql<{ chatMemberships: { edges: { node: Membership }[] } }>(`query($channel: UUID, $member: String) { chatMemberships(filter: { channelId: { eq: $channel }, workspaceMemberId: { eq: $member } }, first: 1) { edges { node { ${MEMBERSHIP_FIELDS} } } } }`, { channel: channelId, member: memberId }))
      .chatMemberships,
  )[0] ?? null;

const addMembership = (channelId: string, memberId: string) =>
  gql(`mutation($data: ChatMembershipCreateInput!) { createChatMembership(data: $data) { id } }`, { data: { name: 'Member', channelId, workspaceMemberId: memberId, lastReadAt: new Date().toISOString(), unreadMentions: 0 } });

const updateMembership = (id: string, data: Record<string, unknown>) => gql(`mutation($id: UUID!, $data: ChatMembershipUpdateInput!) { updateChatMembership(id: $id, data: $data) { id } }`, { id, data });

// Members read and write; anyone may look into a public channel before joining it.
const requireAccess = async (channelId: unknown, memberId: string, mode: 'read' | 'write') => {
  if (!isUuid(channelId)) throw new ChatError('Choose a channel.');
  const channel = await getChannel(channelId);
  if (!channel) throw new ChatError('This channel no longer exists.', 404);
  const membership = await membershipFor(channelId, memberId);
  if (!membership && !(mode === 'read' && channel.kind === 'CHANNEL' && channel.visibility === 'PUBLIC')) throw new ChatError('You are not in this channel.', 403);
  if (mode === 'write' && channel.archived) throw new ChatError('This channel is archived.');
  return { channel, membership };
};

const ensureGeneral = async (memberId: string) => {
  const find = async () =>
    nodes((await gql<{ chatChannels: { edges: { node: Channel }[] } }>(`{ chatChannels(filter: { name: { eq: "general" }, kind: { eq: CHANNEL } }, orderBy: [{ createdAt: AscNullsLast }], first: 5) { edges { node { ${CHANNEL_FIELDS} } } } }`)).chatChannels);
  let generals = await find();
  if (generals.length === 0) {
    await gql(`mutation($data: ChatChannelCreateInput!) { createChatChannel(data: $data) { id } }`, { data: { name: 'general', topic: 'Everyone in the team', kind: 'CHANNEL', visibility: 'PUBLIC', createdByMemberId: memberId } });
    generals = await find();
    // Two first visits at the same moment can each create one; keep the oldest.
    for (const extra of generals.slice(1)) await gql(`mutation($id: UUID!) { deleteChatChannel(id: $id) { id } }`, { id: extra.id });
  }
  const general = generals[0];
  if (!(await membershipFor(general.id, memberId))) await addMembership(general.id, memberId);
};

const unreadCount = async (membership: Membership, memberId: string) =>
  (
    await gql<{ chatMessages: { totalCount: number } }>(`query($channel: UUID, $since: DateTime, $me: String) { chatMessages(filter: { channelId: { eq: $channel }, createdAt: { gt: $since }, authorMemberId: { neq: $me } }) { totalCount } }`, {
      channel: membership.channelId,
      since: membership.lastReadAt ?? '1970-01-01T00:00:00.000Z',
      me: memberId,
    })
  ).chatMessages.totalCount;

const channelsFor = async (memberId: string) => {
  const memberships = await membershipsOf(memberId);
  if (memberships.length === 0) return [];
  const channels = nodes(
    (await gql<{ chatChannels: { edges: { node: Channel }[] } }>(`query($ids: [UUID]) { chatChannels(filter: { id: { in: $ids } }, first: 300) { edges { node { ${CHANNEL_FIELDS} } } } }`, { ids: memberships.map((membership) => membership.channelId) })).chatChannels,
  );
  const byId = new Map(channels.map((channel) => [channel.id, channel]));
  const directPartners = await Promise.all(
    memberships.map(async (membership) => {
      const channel = byId.get(membership.channelId);
      if (channel?.kind !== 'DIRECT') return null;
      return channel.directKey?.split(':').find((id) => id !== memberId) ?? memberId;
    }),
  );
  const unread = await Promise.all(memberships.map((membership) => (byId.has(membership.channelId) ? unreadCount(membership, memberId) : Promise.resolve(0))));
  return memberships
    .map((membership, index) => {
      const channel = byId.get(membership.channelId);
      if (!channel || channel.archived) return null;
      return {
        id: channel.id,
        name: channel.name,
        topic: channel.topic ?? '',
        kind: channel.kind,
        visibility: channel.visibility,
        partnerId: directPartners[index],
        lastMessageAt: channel.lastMessageAt,
        unread: unread[index],
        unreadMentions: membership.unreadMentions ?? 0,
        muted: Boolean(membership.muted),
      };
    })
    .filter((channel) => channel !== null);
};

const seal = (content: Content, channelId: string) => encryptMessage(JSON.stringify(content), channelId);

const open = (raw: RawMessage): Content | null => {
  const plain = decryptMessage(raw.body, raw.channelId);
  if (plain === null) return null;
  try {
    const parsed = JSON.parse(plain) as Partial<Content>;
    return { text: typeof parsed.text === 'string' ? parsed.text : '', mentions: Array.isArray(parsed.mentions) ? parsed.mentions.filter(isUuid) : [], links: cleanLinks(parsed.links) };
  } catch {
    return null;
  }
};

const toMessage = (raw: RawMessage) => {
  const content = open(raw);
  return { id: raw.id, createdAt: raw.createdAt, authorId: raw.authorMemberId, text: content?.text ?? '', unreadable: content === null, mentions: content?.mentions ?? [], links: content?.links ?? [], editedAt: raw.editedAt };
};

const PAGE = 50;

const loadMessages = async (channelId: string, { after, before }: { after?: string; before?: string }) => {
  const filter = after ? `, createdAt: { gt: $at }` : before ? `, createdAt: { lt: $at }` : '';
  const at = after ?? before ?? null;
  const raw = nodes(
    (
      await gql<{ chatMessages: { edges: { node: RawMessage }[] } }>(
        `query($channel: UUID${at ? ', $at: DateTime' : ''}) { chatMessages(filter: { channelId: { eq: $channel }${filter} }, orderBy: [{ createdAt: ${after ? 'AscNullsLast' : 'DescNullsLast'} }], first: ${PAGE}) { edges { node { ${MESSAGE_FIELDS} } } } }`,
        at ? { channel: channelId, at } : { channel: channelId },
      )
    ).chatMessages,
  );
  const ordered = after ? raw : raw.reverse();
  return { messages: ordered.map(toMessage), hasMore: !after && raw.length === PAGE };
};

const isoOrUndefined = (value: unknown) => (typeof value === 'string' && !Number.isNaN(Date.parse(value)) ? new Date(value).toISOString() : undefined);

type Handler = (body: Record<string, unknown>, memberId: string) => Promise<unknown>;

const bootstrap: Handler = async (_body, memberId) => {
  await ensureGeneral(memberId);
  const [members, channels] = await Promise.all([listMembers(), channelsFor(memberId)]);
  return { me: memberId, members, channels };
};

const channels: Handler = async (_body, memberId) => ({ channels: await channelsFor(memberId) });

const messages: Handler = async (body, memberId) => {
  const { channel, membership } = await requireAccess(body.channelId, memberId, 'read');
  const result = await loadMessages(channel.id, { after: isoOrUndefined(body.after), before: isoOrUndefined(body.before) });
  return { ...result, joined: Boolean(membership) };
};

const post: Handler = async (body, memberId) => {
  const { channel } = await requireAccess(body.channelId, memberId, 'write');
  const text = cleanBody(body.text);
  const links = cleanLinks(body.links);
  if (!text && links.length === 0) throw new ChatError('Write a message first.');
  const recent = (
    await gql<{ chatMessages: { totalCount: number } }>(`query($me: String, $since: DateTime) { chatMessages(filter: { authorMemberId: { eq: $me }, createdAt: { gt: $since } }) { totalCount } }`, { me: memberId, since: new Date(Date.now() - 60_000).toISOString() })
  ).chatMessages.totalCount;
  if (recent >= MESSAGES_PER_MINUTE) throw new ChatError('You are sending messages very fast. Wait a moment and try again.', 429);

  const memberships = await channelMemberships(channel.id);
  const inChannel = new Set(memberships.map((membership) => membership.workspaceMemberId));
  // In a public channel anyone in the workspace can be mentioned; they are added so they see it.
  const mentionable = channel.kind === 'CHANNEL' && channel.visibility === 'PUBLIC' ? new Set((await listMembers()).map((member) => member.id)) : inChannel;
  const mentions = cleanMentions(body.mentions, mentionable).filter((id) => id !== memberId);

  const created = await gql<{ createChatMessage: RawMessage }>(`mutation($data: ChatMessageCreateInput!) { createChatMessage(data: $data) { ${MESSAGE_FIELDS} } }`, {
    data: { name: 'Message', channelId: channel.id, authorMemberId: memberId, body: seal({ text, mentions, links }, channel.id) },
  });
  const now = created.createChatMessage.createdAt;
  await gql(`mutation($id: UUID!, $data: ChatChannelUpdateInput!) { updateChatChannel(id: $id, data: $data) { id } }`, { id: channel.id, data: { lastMessageAt: now } });
  for (const mentioned of mentions) {
    const existing = memberships.find((membership) => membership.workspaceMemberId === mentioned);
    if (existing) await updateMembership(existing.id, { unreadMentions: (existing.unreadMentions ?? 0) + 1 });
    else {
      await addMembership(channel.id, mentioned);
      const added = await membershipFor(channel.id, mentioned);
      if (added) await updateMembership(added.id, { unreadMentions: 1, lastReadAt: new Date(Date.parse(now) - 1).toISOString() });
    }
  }
  const own = memberships.find((membership) => membership.workspaceMemberId === memberId);
  if (own) await updateMembership(own.id, { lastReadAt: now });
  return { message: toMessage(created.createChatMessage) };
};

const ownMessage = async (messageId: unknown, memberId: string) => {
  if (!isUuid(messageId)) throw new ChatError('Choose a message.');
  const message = (await gql<{ chatMessage: RawMessage | null }>(`query($id: UUID!) { chatMessage(filter: { id: { eq: $id } }) { ${MESSAGE_FIELDS} } }`, { id: messageId })).chatMessage;
  if (!message) throw new ChatError('This message no longer exists.', 404);
  if (message.authorMemberId !== memberId) throw new ChatError('You can only change your own messages.', 403);
  await requireAccess(message.channelId, memberId, 'write');
  return message;
};

const edit: Handler = async (body, memberId) => {
  const message = await ownMessage(body.messageId, memberId);
  const text = cleanBody(body.text);
  if (!text) throw new ChatError('A message cannot be empty. Delete it instead.');
  const updated = await gql<{ updateChatMessage: RawMessage }>(`mutation($id: UUID!, $data: ChatMessageUpdateInput!) { updateChatMessage(id: $id, data: $data) { ${MESSAGE_FIELDS} } }`, {
    id: message.id,
    data: { body: seal({ ...(open(message) ?? { mentions: [], links: [] }), text }, message.channelId), editedAt: new Date().toISOString() },
  });
  return { message: toMessage(updated.updateChatMessage) };
};

const remove: Handler = async (body, memberId) => {
  const message = await ownMessage(body.messageId, memberId);
  await gql(`mutation($id: UUID!) { deleteChatMessage(id: $id) { id } }`, { id: message.id });
  return { removed: true };
};

const markRead: Handler = async (body, memberId) => {
  const { membership } = await requireAccess(body.channelId, memberId, 'read');
  if (membership) await updateMembership(membership.id, { lastReadAt: new Date().toISOString(), unreadMentions: 0 });
  return { read: true };
};

const createChannel: Handler = async (body, memberId) => {
  const name = channelName(body.name);
  if (name.length < 2) throw new ChatError('Give the channel a name of at least two letters.');
  const taken = nodes((await gql<{ chatChannels: { edges: { node: { id: string } }[] } }>(`query($name: String) { chatChannels(filter: { name: { eq: $name }, kind: { eq: CHANNEL }, archived: { eq: false } }, first: 1) { edges { node { id } } } }`, { name })).chatChannels);
  if (taken.length) throw new ChatError(`There is already a #${name} channel.`);
  const visibility = body.visibility === 'PRIVATE' ? 'PRIVATE' : 'PUBLIC';
  const created = await gql<{ createChatChannel: { id: string } }>(`mutation($data: ChatChannelCreateInput!) { createChatChannel(data: $data) { id } }`, {
    data: { name, topic: typeof body.topic === 'string' ? body.topic.trim().slice(0, 250) : '', kind: 'CHANNEL', visibility, createdByMemberId: memberId },
  });
  const valid = new Set((await listMembers()).map((member) => member.id));
  const invited = [...new Set([memberId, ...(Array.isArray(body.memberIds) ? body.memberIds : [])])].filter((id): id is string => isUuid(id) && valid.has(id)).slice(0, 200);
  for (const id of invited) await addMembership(created.createChatChannel.id, id);
  return { id: created.createChatChannel.id };
};

const browse: Handler = async (_body, memberId) => {
  const publicChannels = nodes(
    (await gql<{ chatChannels: { edges: { node: Channel }[] } }>(`{ chatChannels(filter: { kind: { eq: CHANNEL }, visibility: { eq: PUBLIC }, archived: { eq: false } }, orderBy: [{ name: AscNullsLast }], first: 200) { edges { node { ${CHANNEL_FIELDS} } } } }`)).chatChannels,
  );
  const mine = new Set((await membershipsOf(memberId)).map((membership) => membership.channelId));
  return { channels: publicChannels.map((channel) => ({ id: channel.id, name: channel.name, topic: channel.topic ?? '', joined: mine.has(channel.id) })) };
};

const join: Handler = async (body, memberId) => {
  const { channel, membership } = await requireAccess(body.channelId, memberId, 'read');
  if (channel.archived) throw new ChatError('This channel is archived.');
  if (!membership) await addMembership(channel.id, memberId);
  return { joined: true };
};

const leave: Handler = async (body, memberId) => {
  const { channel, membership } = await requireAccess(body.channelId, memberId, 'write');
  if (channel.kind === 'DIRECT') throw new ChatError('You cannot leave a direct conversation.');
  if (channel.name === 'general' && channel.visibility === 'PUBLIC') throw new ChatError('Everyone stays in #general.');
  if (membership) await gql(`mutation($id: UUID!) { deleteChatMembership(id: $id) { id } }`, { id: membership.id });
  return { left: true };
};

const invite: Handler = async (body, memberId) => {
  const { channel } = await requireAccess(body.channelId, memberId, 'write');
  if (channel.kind === 'DIRECT') throw new ChatError('Start a channel to talk with more people.');
  const valid = new Set((await listMembers()).map((member) => member.id));
  const present = new Set((await channelMemberships(channel.id)).map((membership) => membership.workspaceMemberId));
  const ids = (Array.isArray(body.memberIds) ? body.memberIds : []).filter((id): id is string => isUuid(id) && valid.has(id) && !present.has(id)).slice(0, 200);
  for (const id of ids) await addMembership(channel.id, id);
  return { added: ids.length };
};

const channelMembers: Handler = async (body, memberId) => {
  const { channel } = await requireAccess(body.channelId, memberId, 'read');
  return { memberIds: (await channelMemberships(channel.id)).map((membership) => membership.workspaceMemberId) };
};

const updateChannel: Handler = async (body, memberId) => {
  const { channel } = await requireAccess(body.channelId, memberId, 'write');
  if (channel.kind === 'DIRECT') throw new ChatError('Direct conversations have no settings.');
  const data: Record<string, unknown> = {};
  if (typeof body.topic === 'string') data.topic = body.topic.trim().slice(0, 250);
  if (body.archived === true) {
    if (channel.createdByMemberId !== memberId) throw new ChatError('Only the person who created the channel can archive it.', 403);
    if (channel.name === 'general') throw new ChatError('#general cannot be archived.');
    data.archived = true;
  }
  if (Object.keys(data).length) await gql(`mutation($id: UUID!, $data: ChatChannelUpdateInput!) { updateChatChannel(id: $id, data: $data) { id } }`, { id: channel.id, data });
  return { saved: true };
};

const openDirect: Handler = async (body, memberId) => {
  const otherId = body.memberId;
  if (!isUuid(otherId) || !(await listMembers()).some((member) => member.id === otherId)) throw new ChatError('Choose someone in the workspace.');
  const key = directKey(memberId, otherId);
  const find = async () => nodes((await gql<{ chatChannels: { edges: { node: { id: string } }[] } }>(`query($key: String) { chatChannels(filter: { directKey: { eq: $key }, kind: { eq: DIRECT } }, orderBy: [{ createdAt: AscNullsLast }], first: 2) { edges { node { id } } } }`, { key })).chatChannels);
  let found = await find();
  if (found.length === 0) {
    await gql(`mutation($data: ChatChannelCreateInput!) { createChatChannel(data: $data) { id } }`, { data: { name: 'Direct message', kind: 'DIRECT', visibility: 'PRIVATE', directKey: key, createdByMemberId: memberId } });
    found = await find();
  }
  const channelId = found[0].id;
  for (const id of new Set([memberId, otherId])) if (!(await membershipFor(channelId, id))) await addMembership(channelId, id);
  return { id: channelId };
};

const HANDLERS: Record<string, Handler> = { bootstrap, channels, messages, post, edit, remove, markRead, createChannel, browse, join, leave, invite, channelMembers, updateChannel, openDirect };

const likeLiteral = (value: string) => `%${value.replace(/[\\%_]/g, (character) => `\\${character}`)}%`;

// Record search runs with the caller's own permissions, so nobody can link (or learn of) records they cannot see.
// Twenty's global search is not open to app tokens, so people, companies and deals are searched directly.
const searchRecords = async (body: Record<string, unknown>) => {
  const query = typeof body.query === 'string' ? body.query.trim().slice(0, 100) : '';
  if (query.length < 2) return { records: [] as RecordLink[] };
  const words = query.split(/\s+/).filter(Boolean).slice(0, 4);
  const personFilter = { and: words.map((word) => ({ or: [{ name: { firstName: { ilike: likeLiteral(word) } } }, { name: { lastName: { ilike: likeLiteral(word) } } }, { emails: { primaryEmail: { ilike: likeLiteral(word) } } }] })) };
  type Named = { id: string; name: string | null };
  const result = await gql<{ people: { edges: { node: { id: string; name: { firstName: string; lastName: string } | null } }[] }; companies: { edges: { node: Named }[] }; opportunities: { edges: { node: Named }[] } }>(
    `query($person: PersonFilterInput, $name: String) { people(filter: $person, first: 5) { edges { node { id name { firstName lastName } } } } companies(filter: { name: { ilike: $name } }, first: 5) { edges { node { id name } } } opportunities(filter: { name: { ilike: $name } }, first: 5) { edges { node { id name } } } }`,
    { person: personFilter, name: likeLiteral(query) },
  );
  return {
    records: [
      ...nodes(result.people).map((person) => ({ objectNameSingular: 'person', recordId: person.id, label: [person.name?.firstName, person.name?.lastName].filter(Boolean).join(' ') || 'Unnamed contact' })),
      ...nodes(result.companies).map((company) => ({ objectNameSingular: 'company', recordId: company.id, label: company.name || 'Unnamed company' })),
      ...nodes(result.opportunities).map((deal) => ({ objectNameSingular: 'opportunity', recordId: deal.id, label: deal.name || 'Unnamed deal' })),
    ],
  };
};

export const handleChat = async (body: Record<string, unknown>) => {
  const action = String(body.action ?? '');
  if (action === 'searchRecords') return searchRecords(body);
  const handler = HANDLERS[action];
  if (!handler) throw new ChatError('Unknown action.');
  const memberId = await currentMember();
  return asApplication(() => handler(body, memberId));
};
