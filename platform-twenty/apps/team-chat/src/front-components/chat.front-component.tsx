import styled from '@emotion/styled';
import { type ReactElement, useEffect, useRef, useState } from 'react';
import { defineFrontComponent } from 'twenty-sdk/define';
import { AppPath, navigate } from 'twenty-sdk/front-component';
import { Callout } from 'twenty-ui/components/feedback';
import { IconHash, IconLink, IconLock, IconPlus, IconSend, IconX } from 'twenty-ui/icon';
import { Text } from 'twenty-ui/primitives/typography';
import { themeCssVariables } from 'twenty-ui/theme';

import { IDS } from 'src/constants/ids';
import { FAST_POLL_MS, pollChanges, pollDelay, unreadPollDelay } from 'src/lib/rules';
import {
  callChat,
  CheckboxLabel,
  ErrorState,
  FieldLabel,
  FieldTitle,
  Hint,
  Input,
  LoadingState,
  Page,
  PrimaryButton,
  QuietButton,
  Row,
  SecondaryButton,
  Stack,
  TextArea,
} from 'src/front-components/shared';

type Member = { id: string; name: string; email: string; avatarUrl: string };
type ChannelSummary = { id: string; name: string; topic: string; kind: 'CHANNEL' | 'DIRECT'; visibility: 'PUBLIC' | 'PRIVATE'; partnerId: string | null; lastMessageAt: string | null; unread: number; unreadMentions: number; muted: boolean };
type RecordLink = { objectNameSingular: string; recordId: string; label: string };
type Message = { id: string; createdAt: string; authorId: string; text: string; mentions: string[]; links: RecordLink[]; editedAt: string | null };
type Bootstrap = { me: string; members: Member[]; channels: ChannelSummary[] };
type Overlay = null | 'create' | 'browse' | 'direct' | 'invite';

const Shell = styled.div`
  box-sizing: border-box;
  color: ${() => themeCssVariables.font.color.primary};
  display: grid;
  font-family: ${() => themeCssVariables.font.family};
  font-size: ${() => themeCssVariables.font.size.md};
  grid-template-columns: 260px minmax(0, 1fr);
  height: 100%;
  min-height: 560px;

  @media (max-width: 720px) {
    grid-template-columns: minmax(0, 1fr);
  }
`;

const Sidebar = styled.nav<{ hiddenOnPhone: boolean }>`
  background: ${() => themeCssVariables.background.secondary};
  border-right: 1px solid ${() => themeCssVariables.border.color.light};
  display: flex;
  flex-direction: column;
  gap: ${() => themeCssVariables.spacing[1]};
  overflow-y: auto;
  padding: ${() => themeCssVariables.spacing[3]};

  @media (max-width: 720px) {
    display: ${({ hiddenOnPhone }) => (hiddenOnPhone ? 'none' : 'flex')};
  }
`;

const SectionTitle = styled.div`
  align-items: center;
  color: ${() => themeCssVariables.font.color.tertiary};
  display: flex;
  font-size: ${() => themeCssVariables.font.size.sm};
  justify-content: space-between;
  margin-top: ${() => themeCssVariables.spacing[3]};
  padding: 0 ${() => themeCssVariables.spacing[1]};
`;

const ChannelButton = styled.button<{ active: boolean; unread: boolean }>`
  align-items: center;
  background: ${({ active }) => (active ? themeCssVariables.background.transparent.medium : 'transparent')};
  border: 0;
  border-radius: ${() => themeCssVariables.border.radius.sm};
  color: ${({ unread }) => (unread ? themeCssVariables.font.color.primary : themeCssVariables.font.color.secondary)};
  cursor: pointer;
  display: flex;
  font: inherit;
  font-weight: ${({ unread }) => (unread ? themeCssVariables.font.weight.semiBold : themeCssVariables.font.weight.regular)};
  gap: ${() => themeCssVariables.spacing[2]};
  padding: ${() => themeCssVariables.spacing[1]} ${() => themeCssVariables.spacing[2]};
  text-align: left;
  width: 100%;

  &:hover {
    background: ${() => themeCssVariables.background.transparent.light};
  }

  span.name {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
`;

const Count = styled.span<{ strong: boolean }>`
  background: ${({ strong }) => (strong ? themeCssVariables.color.red : themeCssVariables.background.transparent.strong)};
  border-radius: 10px;
  color: ${({ strong }) => (strong ? '#ffffff' : themeCssVariables.font.color.primary)};
  font-size: ${() => themeCssVariables.font.size.xs};
  font-weight: ${() => themeCssVariables.font.weight.semiBold};
  min-width: 18px;
  padding: 1px 6px;
  text-align: center;
`;

const Main = styled.section<{ hiddenOnPhone: boolean }>`
  display: flex;
  flex-direction: column;
  min-height: 0;
  min-width: 0;

  @media (max-width: 720px) {
    display: ${({ hiddenOnPhone }) => (hiddenOnPhone ? 'none' : 'flex')};
  }
`;

const Header = styled.header`
  align-items: center;
  border-bottom: 1px solid ${() => themeCssVariables.border.color.light};
  display: flex;
  gap: ${() => themeCssVariables.spacing[2]};
  justify-content: space-between;
  padding: ${() => themeCssVariables.spacing[3]} ${() => themeCssVariables.spacing[4]};
`;

// Reversed so the newest message sits at the bottom without scripting the scroll position.
const Timeline = styled.div`
  display: flex;
  flex: 1;
  flex-direction: column-reverse;
  gap: ${() => themeCssVariables.spacing[1]};
  min-height: 0;
  overflow-y: auto;
  padding: ${() => themeCssVariables.spacing[3]} ${() => themeCssVariables.spacing[4]};
`;

const MessageRow = styled.div<{ mentionsMe: boolean }>`
  background: ${({ mentionsMe }) => (mentionsMe ? themeCssVariables.background.transparent.blue : 'transparent')};
  border-radius: ${() => themeCssVariables.border.radius.sm};
  display: grid;
  gap: ${() => themeCssVariables.spacing[3]};
  grid-template-columns: 32px minmax(0, 1fr);
  padding: ${() => themeCssVariables.spacing[2]};

  .actions {
    display: none;
  }

  &:hover .actions,
  &:focus-within .actions {
    display: flex;
  }
`;

const Avatar = styled.div<{ hue: number }>`
  align-items: center;
  background: ${({ hue }) => `hsl(${hue} 55% 88%)`};
  border-radius: 50%;
  color: ${({ hue }) => `hsl(${hue} 45% 28%)`};
  display: flex;
  font-size: ${() => themeCssVariables.font.size.sm};
  font-weight: ${() => themeCssVariables.font.weight.semiBold};
  height: 32px;
  justify-content: center;
  width: 32px;
`;

const Body = styled.div`
  line-height: 1.5;
  overflow-wrap: anywhere;
  white-space: pre-wrap;
`;

const Mention = styled.span<{ me: boolean }>`
  background: ${({ me }) => (me ? themeCssVariables.color.blue : themeCssVariables.background.transparent.blue)};
  border-radius: 3px;
  color: ${({ me }) => (me ? '#ffffff' : themeCssVariables.color.blue)};
  padding: 0 2px;
`;

const Chip = styled.button`
  align-items: center;
  background: ${() => themeCssVariables.background.transparent.light};
  border: 1px solid ${() => themeCssVariables.border.color.medium};
  border-radius: ${() => themeCssVariables.border.radius.sm};
  color: inherit;
  cursor: pointer;
  display: inline-flex;
  font: inherit;
  font-size: ${() => themeCssVariables.font.size.sm};
  gap: ${() => themeCssVariables.spacing[1]};
  padding: 2px ${() => themeCssVariables.spacing[2]};
`;

const DaySeparator = styled.div`
  color: ${() => themeCssVariables.font.color.tertiary};
  font-size: ${() => themeCssVariables.font.size.sm};
  padding: ${() => themeCssVariables.spacing[2]} 0;
  text-align: center;
`;

const Composer = styled.div`
  border-top: 1px solid ${() => themeCssVariables.border.color.light};
  display: flex;
  flex-direction: column;
  gap: ${() => themeCssVariables.spacing[2]};
  padding: ${() => themeCssVariables.spacing[3]} ${() => themeCssVariables.spacing[4]};
`;

const Suggestions = styled.div`
  border: 1px solid ${() => themeCssVariables.border.color.medium};
  border-radius: ${() => themeCssVariables.border.radius.sm};
  display: flex;
  flex-direction: column;
  max-height: 200px;
  overflow-y: auto;
`;

const Suggestion = styled.button`
  background: transparent;
  border: 0;
  color: inherit;
  cursor: pointer;
  font: inherit;
  padding: ${() => themeCssVariables.spacing[2]};
  text-align: left;

  &:hover {
    background: ${() => themeCssVariables.background.transparent.light};
  }
`;

const PhoneOnly = styled.span`
  display: none;

  @media (max-width: 720px) {
    display: inline-flex;
  }
`;

const OverlayCard = styled.div`
  border: 1px solid ${() => themeCssVariables.border.color.medium};
  border-radius: ${() => themeCssVariables.border.radius.md};
  margin: ${() => themeCssVariables.spacing[4]};
  padding: ${() => themeCssVariables.spacing[4]};
`;

const hueFor = (id: string) => [...id].reduce((total, character) => (total * 31 + character.charCodeAt(0)) % 360, 7);
const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('') || '?';
const TIME_FORMAT = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' });
const DAY_FORMAT = new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
const time = (iso: string) => TIME_FORMAT.format(new Date(iso));
const day = (iso: string) => DAY_FORMAT.format(new Date(iso));

// Highlights "@Name" for each mentioned member; everything else stays plain text.
const renderText = (text: string, mentions: string[], members: Map<string, Member>, me: string) => {
  const names = mentions.map((id) => ({ id, label: `@${members.get(id)?.name ?? ''}` })).filter((entry) => entry.label.length > 1);
  if (names.length === 0) return text;
  const parts: (string | { id: string; label: string })[] = [text];
  for (const name of names)
    for (let index = 0; index < parts.length; index += 1) {
      const part = parts[index];
      if (typeof part !== 'string') continue;
      const at = part.indexOf(name.label);
      if (at < 0) continue;
      parts.splice(index, 1, part.slice(0, at), name, part.slice(at + name.label.length));
    }
  return parts.map((part, index) =>
    typeof part === 'string' ? (
      part
    ) : (
      <Mention key={index} me={part.id === me}>
        {part.label}
      </Mention>
    ),
  );
};

const openRecord = (link: RecordLink) => navigate(AppPath.RecordShowPage, { objectNameSingular: link.objectNameSingular, objectRecordId: link.recordId });

const Chat = () => {
  const [boot, setBoot] = useState<Bootstrap | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [joined, setJoined] = useState(true);
  const [draft, setDraft] = useState('');
  const [draftMentions, setDraftMentions] = useState<string[]>([]);
  const [draftLinks, setDraftLinks] = useState<RecordLink[]>([]);
  const [linkSearch, setLinkSearch] = useState<string | null>(null);
  const [linkResults, setLinkResults] = useState<RecordLink[]>([]);
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const [overlay, setOverlay] = useState<Overlay>(null);
  const [sending, setSending] = useState(false);
  const [loadingEarlier, setLoadingEarlier] = useState(false);
  const [mentionable, setMentionable] = useState<Set<string> | null>(null);
  const latest = useRef<string | null>(null);
  const serverClock = useRef<string | null>(null);
  const shownMessages = useRef<Message[]>([]);
  shownMessages.current = messages;
  const quietSince = useRef(Date.now());
  const wakePolling = useRef<() => void>(() => {});
  const noteActivity = () => {
    quietSince.current = Date.now();
    wakePolling.current();
  };
  const activeRef = useRef<string | null>(null);

  const members = new Map((boot?.members ?? []).map((member) => [member.id, member]));
  const me = boot?.me ?? '';
  const active = boot?.channels.find((channel) => channel.id === activeId) ?? null;
  const titleOf = (channel: ChannelSummary) => (channel.kind === 'DIRECT' ? (channel.partnerId === me ? `${members.get(me)?.name ?? 'You'} (you)` : (members.get(channel.partnerId ?? '')?.name ?? 'Someone')) : channel.name);

  const refreshChannels = () =>
    callChat<{ channels: ChannelSummary[] }>({ action: 'channels' })
      .then((result) => setBoot((current) => (current ? { ...current, channels: result.channels } : current)))
      .catch(() => {});

  // Everything tied to the previous channel is cleared, so a draft can never be sent to the wrong conversation.
  const openChannel = async (channelId: string) => {
    activeRef.current = channelId;
    setActiveId(channelId);
    setMessages([]);
    setHasMore(false);
    setJoined(true);
    setEditing(null);
    setOverlay(null);
    setNotice('');
    setDraft('');
    setDraftMentions([]);
    setDraftLinks([]);
    setLinkSearch(null);
    setLinkResults([]);
    setMentionable(null);
    latest.current = null;
    serverClock.current = null;
    noteActivity();
    try {
      const result = await callChat<{ messages: Message[]; hasMore: boolean; joined: boolean; now?: string }>({ action: 'messages', channelId });
      if (activeRef.current !== channelId) return;
      serverClock.current = result.now ?? null;
      setMessages(result.messages);
      setHasMore(result.hasMore);
      setJoined(result.joined);
      latest.current = result.messages[result.messages.length - 1]?.createdAt ?? null;
      const summary = boot?.channels.find((channel) => channel.id === channelId);
      if (summary && (summary.kind === 'DIRECT' || summary.visibility === 'PRIVATE'))
        callChat<{ memberIds: string[] }>({ action: 'channelMembers', channelId })
          .then((members) => activeRef.current === channelId && setMentionable(new Set(members.memberIds)))
          .catch(() => {});
      if (result.joined) await callChat({ action: 'markRead', channelId, ...(latest.current ? { upTo: latest.current } : {}) });
      refreshChannels();
    } catch (openError) {
      setNotice((openError as Error).message);
    }
  };

  const load = () =>
    callChat<Bootstrap>({ action: 'bootstrap' })
      .then((result) => {
        setBoot(result);
        setError('');
        const first = result.channels.find((channel) => channel.name === 'general') ?? result.channels[0];
        if (first && !activeRef.current) openChannel(first.id);
      })
      .catch((loadError: Error) => setError(loadError.message));

  useEffect(() => {
    load();
  }, []);

  const pollOpenChannel = async (channelId: string) => {
    // A few seconds of overlap catch messages saved just before the last poll; rows already shown are skipped.
    const after = latest.current ? new Date(Date.parse(latest.current) - 5000).toISOString() : undefined;
    const changesSince = serverClock.current ? new Date(Date.parse(serverClock.current) - 10_000).toISOString() : undefined;
    const result = await callChat<{ messages: Message[]; changed?: Message[]; removed?: string[]; cursor?: string; now?: string }>({
      action: 'messages',
      channelId,
      ...(changesSince ? { changesSince } : {}),
      ...(after ? { after } : {}),
    });
    if (activeRef.current !== channelId) return;
    if (result.now) serverClock.current = result.now;
    const { fresh, edits, gone, changedAnything } = pollChanges(shownMessages.current, result.messages, result.changed ?? [], result.removed ?? []);
    const newest = fresh.at(-1)?.createdAt;
    for (const candidate of [newest, result.cursor]) if (candidate && (!latest.current || candidate > latest.current)) latest.current = candidate;
    if (!changedAnything) return;
    quietSince.current = Date.now();
    const edited = new Map(edits.map((message) => [message.id, message]));
    const removed = new Set(gone);
    setMessages((current) => {
      const known = new Set(current.map((message) => message.id));
      return [...current.filter((message) => !removed.has(message.id)).map((message) => edited.get(message.id) ?? message), ...fresh.filter((message) => !known.has(message.id))];
    });
    if (newest && latest.current) callChat({ action: 'markRead', channelId, upTo: latest.current }).catch(() => {});
  };

  // One poll at a time, each scheduled when the previous one has finished, so a slow server is never piled on.
  useEffect(() => {
    let stopped = false;
    let polling = false;
    let failures = 0;
    let nextPollAt = 0;
    let fastTimer: ReturnType<typeof setTimeout> | undefined;
    let slowTimer: ReturnType<typeof setTimeout> | undefined;
    const hidden = () => typeof document !== 'undefined' && document.hidden === true;
    const schedule = (delay: number) => {
      clearTimeout(fastTimer);
      nextPollAt = Date.now() + delay;
      fastTimer = setTimeout(poll, delay);
    };
    const poll = async () => {
      polling = true;
      const channelId = activeRef.current;
      if (channelId && !hidden()) {
        try {
          await pollOpenChannel(channelId);
          failures = 0;
        } catch {
          failures += 1;
        }
      }
      polling = false;
      if (!stopped) schedule(pollDelay(Date.now() - quietSince.current, failures));
    };
    const refreshUnread = () => {
      if (!hidden()) refreshChannels();
      if (!stopped) slowTimer = setTimeout(refreshUnread, unreadPollDelay(Date.now() - quietSince.current));
    };
    wakePolling.current = () => {
      if (!stopped && !polling && nextPollAt - Date.now() > FAST_POLL_MS) schedule(FAST_POLL_MS);
    };
    schedule(FAST_POLL_MS);
    slowTimer = setTimeout(refreshUnread, unreadPollDelay(0));
    return () => {
      stopped = true;
      clearTimeout(fastTimer);
      clearTimeout(slowTimer);
      wakePolling.current = () => {};
    };
  }, []);

  const loadEarlier = async () => {
    const channelId = activeId;
    const earliest = messages[0];
    if (!channelId || !earliest || loadingEarlier) return;
    setLoadingEarlier(true);
    try {
      const result = await callChat<{ messages: Message[]; hasMore: boolean }>({ action: 'messages', channelId, before: earliest.createdAt });
      if (activeRef.current !== channelId) return;
      setMessages((current) => {
        const known = new Set(current.map((message) => message.id));
        return [...result.messages.filter((message) => !known.has(message.id)), ...current];
      });
      setHasMore(result.hasMore);
    } finally {
      setLoadingEarlier(false);
    }
  };

  const mentionQuery = /(?:^|\s)@([^\s@]{0,30})$/.exec(draft)?.[1];
  const mentionChoices =
    mentionQuery === undefined
      ? []
      : (boot?.members ?? []).filter((member) => member.id !== me && (!mentionable || mentionable.has(member.id)) && member.name.toLowerCase().includes(mentionQuery.toLowerCase())).slice(0, 6);

  const chooseMention = (member: Member) => {
    setDraft(draft.replace(/@([^\s@]{0,30})$/, `@${member.name} `));
    setDraftMentions((current) => [...new Set([...current, member.id])]);
  };

  const send = async () => {
    const channelId = activeId;
    if (!channelId || sending || (!draft.trim() && draftLinks.length === 0)) return;
    setSending(true);
    const mentions = draftMentions.filter((id) => draft.includes(`@${members.get(id)?.name ?? ''}`));
    try {
      noteActivity();
      const { message } = await callChat<{ message: Message | null }>({ action: 'post', channelId, text: draft, mentions, links: draftLinks });
      // The poll cursor is left alone: moving it here would skip messages others posted since the last poll.
      if (message && activeRef.current === channelId) setMessages((current) => (current.some((existing) => existing.id === message.id) ? current : [...current, message]));
      if (activeRef.current !== channelId) return;
      setDraft('');
      setDraftMentions([]);
      setDraftLinks([]);
      setNotice('');
      refreshChannels();
    } catch (sendError) {
      setNotice((sendError as Error).message);
    } finally {
      setSending(false);
    }
  };

  const searchLinks = (query: string) => {
    setLinkSearch(query);
    if (query.trim().length < 2) return setLinkResults([]);
    callChat<{ records: RecordLink[] }>({ action: 'searchRecords', query })
      .then((result) => setLinkResults(result.records))
      .catch(() => setLinkResults([]));
  };

  const saveEdit = async () => {
    if (!editing) return;
    try {
      const { message } = await callChat<{ message: Message }>({ action: 'edit', messageId: editing.id, text: editing.text });
      setMessages((current) => current.map((existing) => (existing.id === message.id ? message : existing)));
      setEditing(null);
    } catch (editError) {
      setNotice((editError as Error).message);
    }
  };

  const removeMessage = async (id: string) => {
    try {
      await callChat({ action: 'remove', messageId: id });
      setMessages((current) => current.filter((message) => message.id !== id));
    } catch (removeError) {
      setNotice((removeError as Error).message);
    }
  };

  if (error)
    return (
      <Page>
        <ErrorState message={error} onRetry={load} />
      </Page>
    );
  if (!boot)
    return (
      <Page>
        <LoadingState />
      </Page>
    );

  const channelList = boot.channels.filter((channel) => channel.kind === 'CHANNEL').sort((left, right) => left.name.localeCompare(right.name));
  const directList = boot.channels.filter((channel) => channel.kind === 'DIRECT').sort((left, right) => (right.lastMessageAt ?? '').localeCompare(left.lastMessageAt ?? ''));

  const sidebarItem = (channel: ChannelSummary) => (
    <ChannelButton key={channel.id} active={channel.id === activeId} unread={channel.unread > 0 && channel.id !== activeId} onClick={() => openChannel(channel.id)} aria-current={channel.id === activeId ? 'page' : undefined}>
      {channel.kind === 'CHANNEL' ? channel.visibility === 'PRIVATE' ? <IconLock size={14} /> : <IconHash size={14} /> : <Avatar hue={hueFor(channel.partnerId ?? '')} style={{ width: 18, height: 18, fontSize: 9 }}>{initials(titleOf(channel))}</Avatar>}
      <span className="name">{titleOf(channel)}</span>
      {channel.id !== activeId && channel.unreadMentions > 0 && <Count strong aria-label={`${channel.unreadMentions} mentions`}>@{channel.unreadMentions}</Count>}
      {channel.id !== activeId && channel.unread > 0 && channel.unreadMentions === 0 && <Count strong={false} aria-label={`${channel.unread} unread`}>{channel.unread}</Count>}
    </ChannelButton>
  );

  // Messages are shown newest first in a column-reverse list, with a day label after each day's last message.
  const timeline: ReactElement[] = [];
  [...messages].reverse().forEach((message, index, reversed) => {
    const author = members.get(message.authorId);
    const own = message.authorId === me;
    timeline.push(
      <MessageRow key={message.id} mentionsMe={message.mentions.includes(me)}>
        <Avatar hue={hueFor(message.authorId)} aria-hidden>
          {initials(author?.name ?? '?')}
        </Avatar>
        <Stack style={{ gap: 2 }}>
          <Row>
            <Text weight="medium">{author?.name ?? 'Former member'}</Text>
            <Hint>
              {time(message.createdAt)}
              {message.editedAt ? ' (edited)' : ''}
            </Hint>
            {own && editing?.id !== message.id && (
              <Row className="actions">
                <QuietButton onClick={() => setEditing({ id: message.id, text: message.text })}>Edit</QuietButton>
                <QuietButton onClick={() => removeMessage(message.id)}>Delete</QuietButton>
              </Row>
            )}
          </Row>
          {editing?.id === message.id ? (
            <Stack>
              <TextArea value={editing.text} onChange={(event) => setEditing({ id: message.id, text: event.target.value })} />
              <Row>
                <PrimaryButton onClick={saveEdit}>Save</PrimaryButton>
                <QuietButton onClick={() => setEditing(null)}>Cancel</QuietButton>
              </Row>
            </Stack>
          ) : (
            message.text && <Body>{renderText(message.text, message.mentions, members, me)}</Body>
          )}
          {message.links.length > 0 && (
            <Row>
              {message.links.map((link) => (
                <Chip key={link.recordId} onClick={() => openRecord(link)}>
                  <IconLink size={12} />
                  {link.label || link.objectNameSingular}
                </Chip>
              ))}
            </Row>
          )}
        </Stack>
      </MessageRow>,
    );
    const next = reversed[index + 1];
    if (!next || day(next.createdAt) !== day(message.createdAt)) timeline.push(<DaySeparator key={`day-${message.id}`}>{day(message.createdAt)}</DaySeparator>);
  });

  return (
    <Shell>
      <Sidebar hiddenOnPhone={Boolean(activeId) && overlay === null}>
        <Text weight="medium">Team chat</Text>
        <SectionTitle>
          Channels
          <Row style={{ gap: 0 }}>
            <QuietButton onClick={() => setOverlay('browse')}>Browse</QuietButton>
            <QuietButton aria-label="New channel" onClick={() => setOverlay('create')}>
              <IconPlus size={14} />
            </QuietButton>
          </Row>
        </SectionTitle>
        {channelList.map(sidebarItem)}
        <SectionTitle>
          Direct messages
          <QuietButton aria-label="New direct message" onClick={() => setOverlay('direct')}>
            <IconPlus size={14} />
          </QuietButton>
        </SectionTitle>
        {directList.length === 0 ? <Hint>Message someone with the + button.</Hint> : directList.map(sidebarItem)}
      </Sidebar>

      <Main hiddenOnPhone={!activeId && overlay === null}>
        {overlay ? (
          <OverlayPanel overlay={overlay} boot={boot} active={active} onClose={() => setOverlay(null)} onOpen={(id) => { load(); openChannel(id); }} onDone={(text) => { setNotice(text); setOverlay(null); refreshChannels(); }} />
        ) : !active ? (
          <Page>
            <Hint>Choose a channel.</Hint>
          </Page>
        ) : (
          <>
            <Header>
              <Stack style={{ gap: 0, minWidth: 0 }}>
                <Row>
                  <PhoneOnly>
                    <QuietButton onClick={() => { activeRef.current = null; setActiveId(null); }}>All channels</QuietButton>
                  </PhoneOnly>
                  <Text weight="semibold">
                    {active.kind === 'CHANNEL' ? `#${active.name}` : titleOf(active)}
                  </Text>
                  {active.visibility === 'PRIVATE' && active.kind === 'CHANNEL' && <Hint>Private</Hint>}
                </Row>
                {active.topic && <Hint>{active.topic}</Hint>}
              </Stack>
              {active.kind === 'CHANNEL' && (
                <Row>
                  <SecondaryButton onClick={() => setOverlay('invite')}>Add people</SecondaryButton>
                  {active.name !== 'general' && (
                    <QuietButton
                      onClick={async () => {
                        try {
                          await callChat({ action: 'leave', channelId: active.id });
                          activeRef.current = null;
                          setActiveId(null);
                          load();
                        } catch (leaveError) {
                          setNotice((leaveError as Error).message);
                        }
                      }}
                    >
                      Leave
                    </QuietButton>
                  )}
                </Row>
              )}
            </Header>
            {notice && (
              <div style={{ padding: '8px 16px' }}>
                <Callout status="info" title={notice} onDismiss={() => setNotice('')} closeLabel="Dismiss" />
              </div>
            )}
            <Timeline aria-live="polite">
              {timeline}
              {hasMore && (
                <Row style={{ justifyContent: 'center' }}>
                  <QuietButton disabled={loadingEarlier} onClick={loadEarlier}>Load earlier messages</QuietButton>
                </Row>
              )}
              {messages.length === 0 && <Hint>{active.kind === 'DIRECT' ? 'This is the start of your conversation.' : `This is the start of #${active.name}.`}</Hint>}
            </Timeline>
            {joined ? (
              <Composer>
                {mentionChoices.length > 0 && (
                  <Suggestions role="listbox" aria-label="Mention someone">
                    {mentionChoices.map((member) => (
                      <Suggestion key={member.id} role="option" onClick={() => chooseMention(member)}>
                        {member.name} <Hint>{member.email}</Hint>
                      </Suggestion>
                    ))}
                  </Suggestions>
                )}
                {linkSearch !== null && (
                  <Stack>
                    <Row>
                      <Input value={linkSearch} placeholder="Find a contact, company, deal..." style={{ flex: 1 }} onChange={(event) => searchLinks(event.target.value)} />
                      <QuietButton aria-label="Close" onClick={() => { setLinkSearch(null); setLinkResults([]); }}>
                        <IconX size={14} />
                      </QuietButton>
                    </Row>
                    {linkResults.length > 0 && (
                      <Suggestions>
                        {linkResults.map((record) => (
                          <Suggestion
                            key={record.recordId}
                            onClick={() => {
                              setDraftLinks((current) => (current.some((link) => link.recordId === record.recordId) || current.length >= 5 ? current : [...current, record]));
                              setLinkSearch(null);
                              setLinkResults([]);
                            }}
                          >
                            {record.label} <Hint>{record.objectNameSingular}</Hint>
                          </Suggestion>
                        ))}
                      </Suggestions>
                    )}
                  </Stack>
                )}
                {draftLinks.length > 0 && (
                  <Row>
                    {draftLinks.map((link) => (
                      <Chip key={link.recordId} onClick={() => setDraftLinks((current) => current.filter((existing) => existing.recordId !== link.recordId))} aria-label={`Remove ${link.label}`}>
                        <IconLink size={12} />
                        {link.label}
                        <IconX size={12} />
                      </Chip>
                    ))}
                  </Row>
                )}
                <TextArea
                  value={draft}
                  maxLength={4000}
                  placeholder={`Message ${active.kind === 'CHANNEL' ? `#${active.name}` : titleOf(active)}. Type @ to mention someone.`}
                  onChange={(event) => {
                    setDraft(event.target.value);
                    noteActivity();
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && !event.shiftKey && mentionChoices.length === 0) {
                      event.preventDefault();
                      send();
                    }
                  }}
                  style={{ minHeight: 64 }}
                />
                <Row style={{ justifyContent: 'space-between' }}>
                  <QuietButton startIcon={<IconLink size={14} />} onClick={() => setLinkSearch('')}>
                    Link a record
                  </QuietButton>
                  <Row>
                    <Hint>Enter to send, Shift+Enter for a new line</Hint>
                    <PrimaryButton startIcon={<IconSend size={14} />} disabled={sending || (!draft.trim() && draftLinks.length === 0)} onClick={send}>
                      Send
                    </PrimaryButton>
                  </Row>
                </Row>
              </Composer>
            ) : (
              <Composer>
                <Row style={{ justifyContent: 'space-between' }}>
                  <Hint>You are looking at #{active.name}. Join to post.</Hint>
                  <PrimaryButton
                    onClick={async () => {
                      await callChat({ action: 'join', channelId: active.id });
                      openChannel(active.id);
                    }}
                  >
                    Join channel
                  </PrimaryButton>
                </Row>
              </Composer>
            )}
          </>
        )}
      </Main>
    </Shell>
  );
};

const OverlayPanel = ({
  overlay,
  boot,
  active,
  onClose,
  onOpen,
  onDone,
}: {
  overlay: Exclude<Overlay, null>;
  boot: Bootstrap;
  active: ChannelSummary | null;
  onClose: () => void;
  onOpen: (id: string) => void;
  onDone: (notice: string) => void;
}) => {
  const [name, setName] = useState('');
  const [topic, setTopic] = useState('');
  const [isPrivate, setIsPrivate] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [filter, setFilter] = useState('');
  const [problem, setProblem] = useState('');
  const [publicChannels, setPublicChannels] = useState<{ id: string; name: string; topic: string; joined: boolean }[] | null>(null);
  const [present, setPresent] = useState<string[]>([]);

  useEffect(() => {
    if (overlay === 'browse') callChat<{ channels: { id: string; name: string; topic: string; joined: boolean }[] }>({ action: 'browse' }).then((result) => setPublicChannels(result.channels)).catch((error: Error) => setProblem(error.message));
    if (overlay === 'invite' && active) callChat<{ memberIds: string[] }>({ action: 'channelMembers', channelId: active.id }).then((result) => setPresent(result.memberIds)).catch(() => {});
  }, [overlay]);

  const others = boot.members.filter((member) => member.id !== boot.me && member.name.toLowerCase().includes(filter.toLowerCase()));
  const toggle = (id: string) => setPicked((current) => (current.includes(id) ? current.filter((existing) => existing !== id) : [...current, id]));
  const [busy, setBusy] = useState(false);
  const run = async <TResult,>(body: Record<string, unknown>, after: (result: TResult) => void) => {
    if (busy) return;
    setBusy(true);
    try {
      after(await callChat<TResult>(body));
    } catch (error) {
      setProblem((error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const title = { create: 'New channel', browse: 'Browse channels', direct: 'New direct message', invite: `Add people to #${active?.name ?? ''}` }[overlay];

  return (
    <OverlayCard>
      <Stack>
        <Row style={{ justifyContent: 'space-between' }}>
          <Text weight="semibold">{title}</Text>
          <QuietButton aria-label="Close" onClick={onClose}>
            <IconX size={14} />
          </QuietButton>
        </Row>
        {problem && <Callout status="error" title={problem} />}

        {overlay === 'create' && (
          <>
            <FieldLabel>
              <FieldTitle>Name</FieldTitle>
              <Input value={name} placeholder="e.g. sales" maxLength={40} onChange={(event) => setName(event.target.value)} />
            </FieldLabel>
            <FieldLabel>
              <FieldTitle>Topic (optional)</FieldTitle>
              <Input value={topic} maxLength={250} onChange={(event) => setTopic(event.target.value)} />
            </FieldLabel>
            <CheckboxLabel>
              <input type="checkbox" checked={isPrivate} onChange={(event) => setIsPrivate(event.target.checked)} />
              Private: only people you add can see it
            </CheckboxLabel>
          </>
        )}

        {overlay === 'browse' &&
          (publicChannels === null ? (
            <Hint>Loading…</Hint>
          ) : publicChannels.length === 0 ? (
            <Hint>No public channels yet.</Hint>
          ) : (
            publicChannels.map((channel) => (
              <Row key={channel.id} style={{ justifyContent: 'space-between' }}>
                <Stack style={{ gap: 0 }}>
                  <span>#{channel.name}</span>
                  {channel.topic && <Hint>{channel.topic}</Hint>}
                </Stack>
                {channel.joined ? (
                  <QuietButton onClick={() => onOpen(channel.id)}>Open</QuietButton>
                ) : (
                  <SecondaryButton disabled={busy} onClick={() => run({ action: 'join', channelId: channel.id }, () => onOpen(channel.id))}>Join</SecondaryButton>
                )}
              </Row>
            ))
          ))}

        {(overlay === 'create' || overlay === 'invite' || overlay === 'direct') && (
          <>
            <Input value={filter} placeholder="Find people" onChange={(event) => setFilter(event.target.value)} />
            <Stack style={{ maxHeight: 320, overflowY: 'auto' }}>
              {overlay === 'direct' && (
                <QuietButton disabled={busy} onClick={() => run<{ id: string }>({ action: 'openDirect', memberId: boot.me }, (result) => onOpen(result.id))}>Notes to self</QuietButton>
              )}
              {others.map((member) =>
                overlay === 'direct' ? (
                  <QuietButton key={member.id} disabled={busy} onClick={() => run<{ id: string }>({ action: 'openDirect', memberId: member.id }, (result) => onOpen(result.id))}>
                    {member.name}
                  </QuietButton>
                ) : (
                  <CheckboxLabel key={member.id}>
                    <input type="checkbox" disabled={present.includes(member.id)} checked={present.includes(member.id) || picked.includes(member.id)} onChange={() => toggle(member.id)} />
                    {member.name} <Hint>{member.email}</Hint>
                  </CheckboxLabel>
                ),
              )}
            </Stack>
          </>
        )}

        {overlay === 'create' && (
          <Row>
            <PrimaryButton disabled={busy || name.trim().length < 2} onClick={() => run<{ id: string }>({ action: 'createChannel', name, topic, visibility: isPrivate ? 'PRIVATE' : 'PUBLIC', memberIds: picked }, (result) => onOpen(result.id))}>
              Create channel
            </PrimaryButton>
          </Row>
        )}
        {overlay === 'invite' && active && (
          <Row>
            <PrimaryButton disabled={busy || picked.length === 0} onClick={() => run<{ added: number }>({ action: 'invite', channelId: active.id, memberIds: picked }, (result) => onDone(`Added ${result.added} ${result.added === 1 ? 'person' : 'people'}.`))}>
              Add
            </PrimaryButton>
          </Row>
        )}
      </Stack>
    </OverlayCard>
  );
};

export default defineFrontComponent({
  universalIdentifier: IDS.frontComponents.chat,
  name: 'team-chat',
  description: 'Channels, direct messages, mentions and record links for the team.',
  component: Chat,
});
