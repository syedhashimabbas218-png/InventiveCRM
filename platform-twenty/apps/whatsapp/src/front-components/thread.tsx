import styled from '@emotion/styled';
import { type FormEvent, type KeyboardEvent, memo, type ReactElement, useEffect, useRef, useState } from 'react';
import { AppPath, navigate } from 'twenty-sdk/front-component';
import { Callout } from 'twenty-ui/components/feedback';
import { IconAlertCircle, IconArchive, IconArrowLeft, IconBuildingSkyscraper, IconCheck, IconClock, IconFile, IconInbox, IconMicrophone, IconPhoto, IconRefresh, IconSend, IconUser, IconUsers } from 'twenty-ui/icon';
import { Tag } from 'twenty-ui/primitives/data-display';
import { Skeleton } from 'twenty-ui/primitives/feedback';
import { Text } from 'twenty-ui/primitives/typography';
import { themeCssVariables } from 'twenty-ui/theme';

import { callWhatsApp, type LiveConnection, loadTemplates, newMessageId, subscribeToConversation, type TemplateOption, type ThreadState } from 'src/front-components/live';
import { FieldLabel, FieldTitle, Hint, Input, PrimaryButton, QuietButton, Row, Select, SecondaryButton, Stack } from 'src/front-components/shared';
import { isWindowOpen } from 'src/lib/rules';
import { clockTime, conversationTitle, type ConversationItem, dayLabel, fullName, type MessageItem, tickState, type TickState, windowLeft } from 'src/lib/thread';

export type TemplateChoice = { name: string; languageCode: string; parameters: Record<string, string> };
type SendBody = { text: string } | { template: TemplateChoice };
type LocalSend = { state: 'sending' | 'failed'; error?: string; body: SendBody };

const Column = styled.section`
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
  min-width: 0;
`;

const Header = styled.header`
  align-items: center;
  border-bottom: 1px solid ${() => themeCssVariables.border.color.light};
  display: flex;
  flex-wrap: wrap;
  gap: ${() => themeCssVariables.spacing[2]};
  justify-content: space-between;
  min-height: 56px;
  padding: ${() => themeCssVariables.spacing[2]} ${() => themeCssVariables.spacing[4]};
`;

// Reversed so the newest message stays at the bottom, and loading older ones above never moves what is on screen.
const Timeline = styled.div`
  display: flex;
  flex: 1;
  flex-direction: column-reverse;
  gap: ${() => themeCssVariables.spacing[1]};
  min-height: 0;
  overflow-y: auto;
  padding: ${() => themeCssVariables.spacing[3]} ${() => themeCssVariables.spacing[4]};
`;

const BubbleRow = styled.div<{ outbound: boolean }>`
  display: flex;
  justify-content: ${({ outbound }) => (outbound ? 'flex-end' : 'flex-start')};
`;

const Bubble = styled.div<{ outbound: boolean; failed: boolean }>`
  background: ${({ outbound }) => (outbound ? themeCssVariables.background.transparent.blue : themeCssVariables.background.tertiary)};
  border: 1px solid ${({ failed }) => (failed ? themeCssVariables.border.color.danger : 'transparent')};
  border-radius: ${() => themeCssVariables.border.radius.md};
  display: flex;
  flex-direction: column;
  gap: 2px;
  max-width: min(75%, 560px);
  padding: ${() => themeCssVariables.spacing[2]} ${() => themeCssVariables.spacing[3]};
`;

const Body = styled.div`
  line-height: 1.45;
  overflow-wrap: anywhere;
  white-space: pre-wrap;
`;

const Meta = styled.div`
  align-items: center;
  color: ${() => themeCssVariables.font.color.tertiary};
  display: flex;
  font-size: ${() => themeCssVariables.font.size.xs};
  gap: ${() => themeCssVariables.spacing[1]};
  justify-content: flex-end;
`;

const Attachment = styled.div`
  align-items: center;
  color: ${() => themeCssVariables.font.color.secondary};
  display: flex;
  gap: ${() => themeCssVariables.spacing[1]};
`;

const DaySeparator = styled.div`
  color: ${() => themeCssVariables.font.color.tertiary};
  font-size: ${() => themeCssVariables.font.size.sm};
  padding: ${() => themeCssVariables.spacing[2]} 0;
  text-align: center;
`;

const Composer = styled.form`
  border-top: 1px solid ${() => themeCssVariables.border.color.light};
  display: flex;
  flex-direction: column;
  gap: ${() => themeCssVariables.spacing[2]};
  padding: ${() => themeCssVariables.spacing[3]} ${() => themeCssVariables.spacing[4]};
`;

const AutoGrowArea = styled.textarea`
  background: ${() => themeCssVariables.background.primary};
  border: 1px solid ${() => themeCssVariables.border.color.medium};
  border-radius: ${() => themeCssVariables.border.radius.sm};
  box-sizing: border-box;
  color: ${() => themeCssVariables.font.color.primary};
  font-family: inherit;
  font-size: ${() => themeCssVariables.font.size.md};
  line-height: 1.45;
  max-height: 200px;
  min-height: 40px;
  overflow-y: auto;
  padding: ${() => themeCssVariables.spacing[2]};
  resize: none;
  width: 100%;

  &:focus-visible {
    border-color: ${() => themeCssVariables.color.blue};
    outline: none;
  }
`;

const Ticks = styled.span<{ tone: 'plain' | 'read' | 'failed' }>`
  color: ${({ tone }) => (tone === 'read' ? themeCssVariables.color.blue : tone === 'failed' ? themeCssVariables.color.red : 'inherit')};
  display: inline-flex;

  svg + svg {
    margin-left: -8px;
  }
`;

const TICK_LABELS: Record<TickState, string> = { sending: 'Sending', waiting: 'Waiting to send', sent: 'Sent', delivered: 'Delivered', read: 'Read', failed: 'Not sent' };

const StatusTicks = ({ state }: { state: TickState }) => (
  <Ticks tone={state === 'read' ? 'read' : state === 'failed' ? 'failed' : 'plain'} title={TICK_LABELS[state]} aria-label={TICK_LABELS[state]}>
    {state === 'sending' || state === 'waiting' ? <IconClock size={12} /> : state === 'failed' ? <IconAlertCircle size={12} /> : <IconCheck size={12} />}
    {(state === 'delivered' || state === 'read') && <IconCheck size={12} />}
  </Ticks>
);

const MEDIA_ICONS: Record<string, typeof IconPhoto> = { image: IconPhoto, sticker: IconPhoto, voice: IconMicrophone, audio: IconMicrophone };

const MessageBubble = memo(({ message, local, onRetry }: { message: MessageItem; local: LocalSend | undefined; onRetry: (id: string) => void }) => {
  const outbound = message.direction === 'OUTBOUND';
  const state = outbound ? tickState(message, local?.state ?? null) : null;
  const MediaIcon = message.mediaKind ? (MEDIA_ICONS[message.mediaKind] ?? IconFile) : null;
  const problem = local?.state === 'failed' ? local.error : message.status === 'FAILED' || state === 'waiting' ? message.error : null;
  return (
    <BubbleRow outbound={outbound}>
      <Bubble outbound={outbound} failed={state === 'failed'}>
        {message.messageType === 'TEMPLATE' && <Hint>Template: {message.templateName}</Hint>}
        {MediaIcon && (
          <Attachment>
            <MediaIcon size={14} />
            {message.mediaFilename || message.mediaKind}
          </Attachment>
        )}
        {message.text && <Body>{message.text}</Body>}
        {problem && (
          <Text size="xs" color="secondary">
            {problem}
          </Text>
        )}
        <Meta>
          {outbound && message.sentByName && <span>{message.sentByName} ·</span>}
          <span>{clockTime(message.occurredAt)}</span>
          {state && <StatusTicks state={state} />}
          {state === 'failed' && (local || message.messageType === 'TEXT') && (
            <QuietButton startIcon={<IconRefresh size={12} />} onClick={() => onRetry(message.id)}>
              Retry
            </QuietButton>
          )}
        </Meta>
      </Bubble>
    </BubbleRow>
  );
});

const ThreadSkeleton = () => (
  <Stack style={{ padding: 16 }}>
    <Skeleton layout="block" height={36} width="45%" />
    <Skeleton layout="block" height={52} width="60%" style={{ alignSelf: 'flex-end' }} />
    <Skeleton layout="block" height={36} width="35%" />
  </Stack>
);

const renderPreview = (body: string, values: Record<string, string>) => body.replace(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g, (match, name: string) => values[name] || match);

const parameterLabel = (name: string) => name.replace(/_/g, ' ').replace(/^./, (first) => first.toUpperCase());

const keyOf = (template: TemplateOption) => `${template.name}:${template.language}`;

// Picks an approved template and fills its named parameters; used in a conversation and to start one with a contact.
// Templates that cannot be sent yet are listed greyed out with their status.
export const TemplatePicker = ({ onSend, sendLabel = 'Send template' }: { onSend: (template: TemplateChoice) => Promise<void>; sendLabel?: string }) => {
  const [templates, setTemplates] = useState<TemplateOption[] | null>(null);
  const [problem, setProblem] = useState('');
  const [chosen, setChosen] = useState('');
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    loadTemplates()
      .then((loaded) => active && setTemplates(loaded))
      .catch((error: Error) => active && setProblem(error.message));
    return () => {
      active = false;
    };
  }, []);

  if (problem) return <Callout status="error" title="Templates could not be loaded" description={problem} />;
  if (!templates) return <Skeleton layout="block" height={32} />;
  if (!templates.some((entry) => entry.status === 'approved')) return <Callout status="info" title="No approved templates yet" description="Create a template in InventiveChat and wait for Meta to approve it." />;

  const template = templates.find((entry) => keyOf(entry) === chosen && entry.status === 'approved') ?? null;
  const submit = async () => {
    if (!template || busy) return;
    setBusy(true);
    try {
      await onSend({ name: template.name, languageCode: template.language, parameters: Object.fromEntries(template.parameters.map((name) => [name, values[name] ?? ''])) });
      setValues({});
    } finally {
      setBusy(false);
    }
  };

  return (
    <Stack>
      <Select
        aria-label="Template"
        value={chosen}
        onChange={(event) => {
          setChosen(event.target.value);
          setValues({});
        }}
      >
        <option value="">Choose a template…</option>
        {templates.map((entry) => (
          <option key={keyOf(entry)} value={keyOf(entry)} disabled={entry.status !== 'approved'}>
            {entry.name} ({entry.language}){entry.status !== 'approved' ? `: ${entry.status}` : ''}
          </option>
        ))}
      </Select>
      {template && (
        <>
          {template.body && <Hint>{renderPreview(template.body, values)}</Hint>}
          {template.quickReplies.length > 0 && <Hint>Buttons: {template.quickReplies.join(', ')}</Hint>}
          {template.parameters.map((name) => (
            <FieldLabel key={name}>
              <FieldTitle>{parameterLabel(name)}</FieldTitle>
              <Input value={values[name] ?? ''} maxLength={1024} onChange={(event) => setValues((current) => ({ ...current, [name]: event.target.value }))} />
            </FieldLabel>
          ))}
          <Row style={{ justifyContent: 'flex-end' }}>
            <PrimaryButton startIcon={<IconSend size={14} />} loading={busy} disabled={busy || template.parameters.some((name) => !values[name]?.trim())} onClick={submit}>
              {sendLabel}
            </PrimaryButton>
          </Row>
        </>
      )}
    </Stack>
  );
};

const HANDLING_TAGS = {
  AI: { label: 'AI replying', color: 'purple' },
  PERSON: { label: 'A person is replying', color: 'blue' },
  HANDOFF_REQUESTED: { label: 'Wants a person', color: 'orange' },
  AWAITING_APPROVAL: { label: 'Automation awaiting approval', color: 'gray' },
} as const;

const openRecord = (objectNameSingular: 'person' | 'company', objectRecordId: string) => navigate(AppPath.RecordShowPage, { objectNameSingular, objectRecordId });

const ThreadHeader = ({ conversation, me, onAction, onBack }: { conversation: ConversationItem; me: string | null; onAction: (action: string, extra?: Record<string, unknown>) => void; onBack?: () => void }) => {
  const left = windowLeft(conversation.windowExpiresAt);
  const handling = conversation.handling ? HANDLING_TAGS[conversation.handling] : null;
  const mine = Boolean(me) && conversation.assigneeId === me;
  return (
    <Header>
      <Stack style={{ gap: 2, minWidth: 0 }}>
        <Row>
          {onBack && (
            <QuietButton aria-label="Back to conversations" onClick={onBack}>
              <IconArrowLeft size={14} />
            </QuietButton>
          )}
          <Text weight="semibold">{conversationTitle(conversation)}</Text>
          {conversation.customerPhone && <Hint>{conversation.customerPhone}</Hint>}
        </Row>
        <Row>
          {handling && <Tag color={handling.color}>{handling.label}</Tag>}
          {conversation.customerWaiting && <Tag color="amber">Waiting for us</Tag>}
          {conversation.optedOut ? <Tag color="red">Opted out</Tag> : <Tag color={left ? 'green' : 'gray'}>{left ? `Replies open for ${left}` : 'Template only'}</Tag>}
          {conversation.person && (
            <QuietButton startIcon={<IconUser size={14} />} onClick={() => conversation.personId && openRecord('person', conversation.personId)}>
              {fullName(conversation.person.name) || 'Contact'}
            </QuietButton>
          )}
          {conversation.company && (
            <QuietButton startIcon={<IconBuildingSkyscraper size={14} />} onClick={() => conversation.companyId && openRecord('company', conversation.companyId)}>
              {conversation.company.name || 'Company'}
            </QuietButton>
          )}
        </Row>
      </Stack>
      <Row>
        {conversation.assignee && !mine && <Hint>Assigned to {fullName(conversation.assignee.name) || 'a teammate'}</Hint>}
        {mine ? (
          <SecondaryButton startIcon={<IconUsers size={14} />} onClick={() => onAction('assign', { memberId: null })}>
            Unassign
          </SecondaryButton>
        ) : (
          <SecondaryButton startIcon={<IconUsers size={14} />} onClick={() => onAction('assign')}>
            Assign to me
          </SecondaryButton>
        )}
        {conversation.status === 'CLOSED' ? (
          <SecondaryButton startIcon={<IconInbox size={14} />} onClick={() => onAction('reopen')}>
            Reopen
          </SecondaryButton>
        ) : (
          <SecondaryButton startIcon={<IconArchive size={14} />} onClick={() => onAction('close')}>
            Close
          </SecondaryButton>
        )}
      </Row>
    </Header>
  );
};

const EMPTY: ThreadState = { conversation: null, messages: [], hasMore: false, loaded: false };

export const Thread = ({ live, conversationId, me, onBack }: { live: LiveConnection | null; conversationId: string; me: string | null; onBack?: () => void }) => {
  const [state, setState] = useState<ThreadState>(EMPTY);
  const [problem, setProblem] = useState('');
  const [local, setLocal] = useState<Record<string, LocalSend>>({});
  const [draft, setDraft] = useState('');
  // App screens run in a worker, so Enter cannot be stopped in time: the browser's newline reaches the box after the
  // send. Each sent message gets a fresh box, and changes still arriving from a replaced box are ignored.
  const [composerKey, setComposerKey] = useState(0);
  const currentComposer = useRef(0);
  const [templateMode, setTemplateMode] = useState(false);
  const [loadingEarlier, setLoadingEarlier] = useState(false);
  const subscription = useRef<ReturnType<typeof subscribeToConversation> | null>(null);
  const markedUnread = useRef<number>(0);
  const textArea = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (composerKey > 0) textArea.current?.focus();
  }, [composerKey]);
  const localRef = useRef(local);
  localRef.current = local;

  const markRead = (next: ThreadState) => {
    const unread = next.conversation?.unreadCount ?? 0;
    if (unread > 0 && unread !== markedUnread.current) {
      markedUnread.current = unread;
      callWhatsApp({ action: 'markRead', conversationId }).catch(() => (markedUnread.current = 0));
    }
  };

  useEffect(() => {
    setState(EMPTY);
    setLocal({});
    setDraft('');
    setTemplateMode(false);
    markedUnread.current = 0;
    const subscribed = subscribeToConversation(live, conversationId, {
      onState: (next) => {
        setState(next);
        markRead(next);
      },
      onError: setProblem,
    });
    subscription.current = subscribed;
    return () => subscribed.close();
  }, [live, conversationId]);

  const send = async (body: SendBody, retryOf?: string) => {
    const id = retryOf ?? newMessageId();
    if (!retryOf)
      subscription.current?.upsertLocal({
        id,
        conversationId,
        direction: 'OUTBOUND',
        messageType: 'template' in body ? 'TEMPLATE' : 'TEXT',
        text: 'text' in body ? body.text : null,
        templateName: 'template' in body ? body.template.name : null,
        mediaKind: null,
        mediaFilename: null,
        status: null,
        error: null,
        sentByName: null,
        occurredAt: new Date().toISOString(),
        retryAt: null,
        updatedAt: null,
      });
    setLocal((current) => ({ ...current, [id]: { state: 'sending', body } }));
    try {
      await callWhatsApp({ action: 'send', conversationId, clientMessageId: id, ...body });
      setLocal(({ [id]: _sent, ...rest }) => rest);
    } catch (error) {
      setLocal((current) => ({ ...current, [id]: { state: 'failed', error: (error as Error).message, body } }));
    }
    subscription.current?.applyMessages([id]);
  };

  // Bubbles are memoised, so they get one stable retry handler that always sees the latest messages.
  const retry = useRef<(id: string) => void>(() => {});
  retry.current = (id: string) => {
    const message = state.messages.find((entry) => entry.id === id);
    const body = localRef.current[id]?.body ?? (message?.text ? { text: message.text } : null);
    if (body) send(body, id);
  };
  const onRetry = useRef((id: string) => retry.current(id)).current;

  const sendDraft = (event?: FormEvent) => {
    event?.preventDefault();
    const text = draft.trim();
    if (!text) return;
    setDraft('');
    currentComposer.current += 1;
    setComposerKey(currentComposer.current);
    send({ text });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent?.isComposing) {
      event.preventDefault();
      sendDraft();
    }
  };

  const runAction = async (action: string, extra: Record<string, unknown> = {}) => {
    try {
      await callWhatsApp({ action, conversationId, ...extra });
      await subscription.current?.refresh();
    } catch (error) {
      setProblem((error as Error).message);
    }
  };

  const loadEarlier = async () => {
    setLoadingEarlier(true);
    try {
      await subscription.current?.loadEarlier();
    } catch (error) {
      setProblem((error as Error).message);
    } finally {
      setLoadingEarlier(false);
    }
  };

  const { conversation, messages, loaded, hasMore } = state;
  const windowOpen = isWindowOpen(conversation?.windowExpiresAt);

  // Newest first in the reversed column, with a day label after each day's last message.
  const timeline: ReactElement[] = [];
  [...messages].reverse().forEach((message, index, reversed) => {
    timeline.push(<MessageBubble key={message.id} message={message} local={local[message.id]} onRetry={onRetry} />);
    const older = reversed[index + 1];
    if (!older || dayLabel(older.occurredAt) !== dayLabel(message.occurredAt)) timeline.push(<DaySeparator key={`day-${message.id}`}>{dayLabel(message.occurredAt)}</DaySeparator>);
  });

  return (
    <Column>
      {conversation ? <ThreadHeader conversation={conversation} me={me} onAction={runAction} onBack={onBack} /> : <Header>{loaded ? <Hint>This conversation is no longer available.</Hint> : <Skeleton layout="block" height={32} width={240} />}</Header>}
      {problem && (
        <div style={{ padding: '8px 16px' }}>
          <Callout status="error" title={problem} onDismiss={() => setProblem('')} closeLabel="Dismiss" />
        </div>
      )}
      {!loaded ? (
        <ThreadSkeleton />
      ) : (
        <Timeline aria-live="polite">
          {timeline}
          {hasMore && (
            <Row style={{ justifyContent: 'center' }}>
              <QuietButton loading={loadingEarlier} disabled={loadingEarlier} onClick={loadEarlier}>
                Load earlier messages
              </QuietButton>
            </Row>
          )}
          {messages.length === 0 && <Hint>No messages yet.</Hint>}
        </Timeline>
      )}
      {conversation && !conversation.optedOut && (
        <Composer onSubmit={sendDraft}>
          {windowOpen && !templateMode ? (
            <>
              <AutoGrowArea
                key={composerKey}
                ref={textArea}
                rows={1}
                value={draft}
                maxLength={4096}
                placeholder={`Message ${conversationTitle(conversation)}`}
                onChange={(event) => {
                  if (composerKey !== currentComposer.current) return;
                  setDraft(event.target.value);
                  event.target.style.height = 'auto';
                  event.target.style.height = `${event.target.scrollHeight}px`;
                }}
                onKeyDown={onKeyDown}
              />
              <Row style={{ justifyContent: 'space-between' }}>
                <QuietButton onClick={() => setTemplateMode(true)}>Use a template</QuietButton>
                <Row>
                  <Hint>Enter to send, Shift+Enter for a new line</Hint>
                  <PrimaryButton type="submit" startIcon={<IconSend size={14} />} disabled={!draft.trim()}>
                    Send
                  </PrimaryButton>
                </Row>
              </Row>
            </>
          ) : (
            <>
              {!windowOpen && <Hint>The customer has not written in the last 24 hours, so WhatsApp only allows an approved template.</Hint>}
              <TemplatePicker onSend={(template) => send({ template })} />
              {windowOpen && <QuietButton onClick={() => setTemplateMode(false)}>Write a message instead</QuietButton>}
            </>
          )}
        </Composer>
      )}
      {conversation?.optedOut && (
        <div style={{ padding: '8px 16px' }}>
          <Callout status="warning" title="This customer opted out of WhatsApp messages" description="They have to send START before you can message them again." />
        </div>
      )}
    </Column>
  );
};
