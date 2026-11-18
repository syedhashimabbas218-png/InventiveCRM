import { asApplication, gql, metadata, nodes } from 'src/lib/api';
import { describeError, InventiveChatError, listTemplates, type TemplateMessage } from 'src/lib/inventivechat';
import { createChangeSet, realtimeTokenFor } from 'src/lib/realtime';
import { getConversation, getPerson, recentSendCount, recountUnread, updateConversation } from 'src/lib/records';
import { cleanText, isLanguageCode, isTemplateName, isUuid, SENDS_PER_MINUTE, templateValues } from 'src/lib/rules';
import { type OutboundContent, SendRefused, sendTemplateToPerson, sendToConversation } from 'src/lib/sending';
import { contextFor, loadSettings } from 'src/lib/settings';

export class InboxError extends Error {
  constructor(
    message: string,
    readonly status = 400,
    readonly extra: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

type Member = { id: string; name: string };

const STATUS_ORDER = ['approved', 'pending', 'paused', 'rejected', 'disabled'];

// Who is calling comes from the user's own token, before anything runs with the app's access.
const currentMember = async (): Promise<Member> => {
  const result = await metadata<{ currentUser: { workspaceMember: { id: string; name: { firstName: string | null; lastName: string | null } | null } | null } | null }>(
    `{ currentUser { workspaceMember { id name { firstName lastName } } } }`,
  ).catch(() => null);
  const member = result?.currentUser?.workspaceMember;
  if (!member) throw new InboxError('WhatsApp is for people signed in to this workspace.', 403);
  return { id: member.id, name: [member.name?.firstName, member.name?.lastName].filter(Boolean).join(' ') || 'Someone' };
};

// Read with the caller's own token: someone who cannot see a conversation or contact cannot act on it either.
const requireReadableConversation = async (id: unknown) => {
  if (!isUuid(id)) throw new InboxError('Choose a conversation.');
  const visible = nodes((await gql<{ whatsappConversations: { edges: { node: { id: string } }[] } }>(`query($id: UUID) { whatsappConversations(filter: { id: { eq: $id } }, first: 1) { edges { node { id } } } }`, { id }).catch(() => null))?.whatsappConversations);
  if (visible.length === 0) throw new InboxError('This conversation does not exist or you cannot see it.', 404);
  return id;
};

const requireReadablePerson = async (id: unknown) => {
  if (!isUuid(id)) throw new InboxError('Choose a contact.');
  const visible = nodes((await gql<{ people: { edges: { node: { id: string } }[] } }>(`query($id: UUID) { people(filter: { id: { eq: $id } }, first: 1) { edges { node { id } } } }`, { id }).catch(() => null))?.people);
  if (visible.length === 0) throw new InboxError('This contact does not exist or you cannot see it.', 404);
  return id;
};

const templateFrom = (value: unknown, defaultLanguage: string): TemplateMessage => {
  const template = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  if (!isTemplateName(template.name)) throw new InboxError('Choose a template.');
  return { name: template.name, languageCode: isLanguageCode(template.languageCode) ? template.languageCode : defaultLanguage, parameters: templateValues(template.parameters) };
};

const SEND_BUDGET_MS = 12_000;

type Handler = (body: Record<string, unknown>, member: Member) => Promise<unknown>;

const send: Handler = async (body, member) => {
  const conversationId = body.conversationId === undefined ? null : await requireReadableConversation(body.conversationId);
  const personId = conversationId ? null : await requireReadablePerson(body.personId);
  if (body.clientMessageId !== undefined && !isUuid(body.clientMessageId)) throw new InboxError('clientMessageId must be a UUID.');
  const recordId = isUuid(body.clientMessageId) ? body.clientMessageId : undefined;
  return asApplication(async () => {
    if ((await recentSendCount(member.id)) >= SENDS_PER_MINUTE) throw new InboxError('You are sending messages very fast. Wait a moment and try again.', 429);
    const settings = await loadSettings();
    const context = await contextFor(settings).catch((error: Error) => {
      throw new InboxError(error.message, 409);
    });
    const defaultLanguage = settings?.defaultLanguageCode || 'en_GB';
    const changes = createChangeSet();
    const deadline = Date.now() + SEND_BUDGET_MS;
    const sender = { kind: 'member' as const, member };
    try {
      if (conversationId) {
        const conversation = await getConversation(conversationId);
        if (!conversation || !settings) throw new InboxError('This conversation no longer exists.', 404);
        const text = cleanText(body.text);
        const content: OutboundContent = body.template ? { kind: 'template', template: templateFrom(body.template, defaultLanguage) } : { kind: 'text', text };
        if (content.kind === 'text' && !text) throw new InboxError('Write a message first.');
        return { message: await sendToConversation({ context, conversation, content, sender, recordId, deadline, changes }) };
      }
      // A conversation the business starts is always a template: WhatsApp allows free text only as a reply.
      const person = await getPerson(personId as string);
      if (!person || !settings) throw new InboxError('This contact no longer exists.', 404);
      return { message: await sendTemplateToPerson({ context, settings, person, template: templateFrom(body.template, defaultLanguage), sender, recordId, deadline, changes }) };
    } catch (error) {
      if (error instanceof SendRefused) throw new InboxError(error.message, error.status, error.record ? { message: error.record } : {});
      throw error;
    } finally {
      await changes.publish();
    }
  });
};

const templates: Handler = async () =>
  asApplication(async () => {
    try {
      const all = await listTemplates(await contextFor(await loadSettings()));
      // Templates that cannot be sent are listed too, so the picker can show them greyed out with their status.
      const rank = (status: string) => (STATUS_ORDER.includes(status) ? STATUS_ORDER.indexOf(status) : STATUS_ORDER.length);
      return { templates: all.filter((template) => template.name).sort((left, right) => rank(left.status) - rank(right.status) || left.name.localeCompare(right.name)) };
    } catch (error) {
      throw new InboxError(error instanceof InventiveChatError ? describeError(error) : (error as Error).message, 502);
    }
  });

const withConversation = (work: (conversationId: string, member: Member, body: Record<string, unknown>) => Promise<unknown>): Handler => async (body, member) => {
  const conversationId = await requireReadableConversation(body.conversationId);
  return asApplication(async () => {
    const changes = createChangeSet();
    try {
      const result = await work(conversationId, member, body);
      changes.conversation(conversationId);
      return result;
    } finally {
      await changes.publish();
    }
  });
};

const markRead = withConversation(async (conversationId) => {
  await updateConversation(conversationId, { lastReadAt: new Date().toISOString() });
  return { unread: await recountUnread(conversationId) };
});

const assign = withConversation(async (conversationId, member, body) => {
  const target = body.memberId === null ? null : body.memberId === undefined ? member.id : body.memberId;
  if (target !== null) {
    if (!isUuid(target)) throw new InboxError('Choose someone in the workspace.');
    const exists = nodes((await gql<{ workspaceMembers: { edges: { node: { id: string } }[] } }>(`query($id: UUID) { workspaceMembers(filter: { id: { eq: $id } }, first: 1) { edges { node { id } } } }`, { id: target })).workspaceMembers).length > 0;
    if (!exists) throw new InboxError('Choose someone in the workspace.');
  }
  await updateConversation(conversationId, { assigneeId: target });
  return { assigneeId: target };
});

const setStatus = (status: 'OPEN' | 'CLOSED') =>
  withConversation(async (conversationId) => {
    await updateConversation(conversationId, { status });
    return { status };
  });

const realtimeToken: Handler = async (_body, member) => realtimeTokenFor(member.id) ?? { url: null };

const HANDLERS: Record<string, Handler> = { send, templates, markRead, assign, close: setStatus('CLOSED'), reopen: setStatus('OPEN'), realtimeToken };

export const handleInbox = async (body: Record<string, unknown>) => {
  const handler = HANDLERS[String(body.action ?? '')];
  if (!handler) throw new InboxError('Unknown action.');
  return handler(body, await currentMember());
};
