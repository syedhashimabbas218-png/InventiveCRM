import styled from '@emotion/styled';
import { useEffect, useRef, useState } from 'react';
import { defineFrontComponent } from 'twenty-sdk/define';
import { useUserId } from 'twenty-sdk/front-component';
import { Callout } from 'twenty-ui/components/feedback';
import { SegmentedControl } from 'twenty-ui/components/input';
import { Text } from 'twenty-ui/primitives/typography';
import { themeCssVariables } from 'twenty-ui/theme';

import { IDS } from 'src/constants/ids';
import { ConversationRow, ListSkeleton } from 'src/front-components/conversation-list';
import { type ConnectionState, fetchConnectionState, fetchMe, inboxQuery, type LiveConnection, type LiveStatus, openLiveConnection, subscribeToConversationList } from 'src/front-components/live';
import { Hint, Page, Row, Stack } from 'src/front-components/shared';
import { Thread } from 'src/front-components/thread';
import { type ConversationItem, type InboxFilter } from 'src/lib/thread';

const Shell = styled.div`
  box-sizing: border-box;
  color: ${() => themeCssVariables.font.color.primary};
  display: grid;
  font-family: ${() => themeCssVariables.font.family};
  font-size: ${() => themeCssVariables.font.size.md};
  grid-template-columns: 320px minmax(0, 1fr);
  height: 100%;
  min-height: 560px;

  @media (max-width: 760px) {
    grid-template-columns: minmax(0, 1fr);
  }
`;

const Sidebar = styled.nav<{ hiddenOnPhone: boolean }>`
  background: ${() => themeCssVariables.background.secondary};
  border-right: 1px solid ${() => themeCssVariables.border.color.light};
  display: flex;
  flex-direction: column;
  gap: ${() => themeCssVariables.spacing[2]};
  min-height: 0;
  padding: ${() => themeCssVariables.spacing[3]};

  @media (max-width: 760px) {
    display: ${({ hiddenOnPhone }) => (hiddenOnPhone ? 'none' : 'flex')};
  }
`;

const List = styled.div`
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 2px;
  min-height: 0;
  overflow-y: auto;
`;

const Main = styled.div<{ hiddenOnPhone: boolean }>`
  display: flex;
  min-height: 0;
  min-width: 0;

  @media (max-width: 760px) {
    display: ${({ hiddenOnPhone }) => (hiddenOnPhone ? 'none' : 'flex')};
  }
`;

const Dot = styled.span<{ on: boolean }>`
  background: ${({ on }) => (on ? themeCssVariables.color.green : themeCssVariables.color.gray)};
  border-radius: 50%;
  display: inline-block;
  height: 6px;
  width: 6px;
`;

const FILTERS: { value: InboxFilter; label: string }[] = [
  { value: 'mine', label: 'Mine' },
  { value: 'unassigned', label: 'Unassigned' },
  { value: 'all', label: 'All' },
  { value: 'closed', label: 'Closed' },
];

const STATUS_TEXT: Record<LiveStatus, string> = { connecting: 'Connecting…', live: 'Live', reconnecting: 'Reconnecting…', off: 'Live updates are off' };

const EMPTY_TEXT: Record<InboxFilter, string> = {
  mine: 'Nothing assigned to you. Pick a conversation from Unassigned or All.',
  unassigned: 'Every open conversation has someone on it.',
  all: 'No open conversations. New WhatsApp messages appear here as they arrive.',
  closed: 'No closed conversations yet.',
};

// Relative times ("5 min") are refreshed once a minute; this is a local clock, not a request.
const useMinuteClock = () => {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);
  return now;
};

const Inbox = () => {
  const userId = useUserId();
  const now = useMinuteClock();
  const [live, setLive] = useState<LiveConnection | null>(null);
  const [status, setStatus] = useState<LiveStatus>('connecting');
  const [me, setMe] = useState<string | null | undefined>(undefined);
  const [connection, setConnection] = useState<ConnectionState | null>(null);
  const [filter, setFilter] = useState<InboxFilter>('all');
  const [rows, setRows] = useState<ConversationItem[] | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [problem, setProblem] = useState('');
  const list = useRef<ReturnType<typeof subscribeToConversationList> | null>(null);

  useEffect(() => {
    const opened = openLiveConnection(setStatus);
    setLive(opened);
    return () => opened.close();
  }, []);

  useEffect(() => {
    fetchMe(userId)
      .then(setMe)
      .catch(() => setMe(null));
    fetchConnectionState()
      .then(setConnection)
      .catch((error: Error) => setProblem(error.message));
  }, [userId]);

  useEffect(() => {
    if (!live || me === undefined) return;
    const subscribed = subscribeToConversationList(live, inboxQuery(filter, me), { onRows: setRows, onError: setProblem });
    list.current = subscribed;
    return () => subscribed.close();
  }, [live, me]);

  const chooseFilter = (next: InboxFilter) => {
    setFilter(next);
    setRows(null);
    list.current?.setQuery(inboxQuery(next, me ?? null));
  };

  return (
    <Shell>
      <Sidebar hiddenOnPhone={activeId !== null}>
        <Row style={{ justifyContent: 'space-between' }}>
          <Text weight="semibold">WhatsApp</Text>
          <Row style={{ gap: 6 }}>
            <Dot on={status === 'live'} />
            <Hint>{STATUS_TEXT[status]}</Hint>
          </Row>
        </Row>
        <SegmentedControl<InboxFilter> aria-label="Show" size="sm" fullWidth itemWidth="content" value={filter} onValueChange={(value) => chooseFilter(value)} options={FILTERS} />
        {connection && !connection.connected && <Callout status="info" title="WhatsApp is not connected yet" description="An admin can connect InventiveChat under Settings, Accounts, Applications, WhatsApp." />}
        {connection?.problem && <Callout status="warning" title="Check the WhatsApp connection" description={connection.problem} />}
        {problem && <Callout status="error" title={problem} onDismiss={() => setProblem('')} closeLabel="Dismiss" />}
        <List role="list">
          {rows === null ? (
            <ListSkeleton />
          ) : rows.length === 0 ? (
            <Hint>{EMPTY_TEXT[filter]}</Hint>
          ) : (
            rows.map((conversation) => <ConversationRow key={conversation.id} conversation={conversation} active={conversation.id === activeId} now={now} onOpen={setActiveId} />)
          )}
        </List>
      </Sidebar>
      <Main hiddenOnPhone={activeId === null}>
        {activeId ? (
          <Thread live={live} conversationId={activeId} me={me ?? null} onBack={() => setActiveId(null)} />
        ) : (
          <Page>
            <Stack style={{ alignItems: 'center', marginTop: 96, textAlign: 'center' }}>
              <Text weight="medium">Choose a conversation</Text>
              <Hint>Replies are free text while the customer wrote in the last 24 hours, and an approved template otherwise.</Hint>
            </Stack>
          </Page>
        )}
      </Main>
    </Shell>
  );
};

export default defineFrontComponent({
  universalIdentifier: IDS.frontComponents.inbox,
  name: 'whatsapp-inbox',
  description: 'Shared WhatsApp inbox: conversations, replies, templates, assignment and statuses.',
  component: Inbox,
});
