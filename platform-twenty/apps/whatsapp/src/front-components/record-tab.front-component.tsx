import styled from '@emotion/styled';
import { useEffect, useState } from 'react';
import { defineFrontComponent } from 'twenty-sdk/define';
import { useSelectedObjectMetadata, useSelectedRecordIds, useUserId } from 'twenty-sdk/front-component';
import { Callout } from 'twenty-ui/components/feedback';
import { IconBrandWhatsapp, IconX } from 'twenty-ui/icon';
import { Text } from 'twenty-ui/primitives/typography';
import { themeCssVariables } from 'twenty-ui/theme';

import { IDS } from 'src/constants/ids';
import { ConversationRow, ListSkeleton } from 'src/front-components/conversation-list';
import { callWhatsApp, fetchMe, type LiveConnection, type ListQuery, newMessageId, openLiveConnection, subscribeToConversationList } from 'src/front-components/live';
import { Hint, PrimaryButton, QuietButton, Row, Stack } from 'src/front-components/shared';
import { type TemplateChoice, TemplatePicker, Thread } from 'src/front-components/thread';
import { isWindowOpen } from 'src/lib/rules';
import { type ConversationItem } from 'src/lib/thread';

const Frame = styled.div`
  box-sizing: border-box;
  color: ${() => themeCssVariables.font.color.primary};
  display: flex;
  flex-direction: column;
  font-family: ${() => themeCssVariables.font.family};
  font-size: ${() => themeCssVariables.font.size.md};
  height: 100%;
  min-height: 420px;
`;

const Top = styled.div`
  border-bottom: 1px solid ${() => themeCssVariables.border.color.light};
  display: flex;
  flex-direction: column;
  gap: ${() => themeCssVariables.spacing[2]};
  padding: ${() => themeCssVariables.spacing[3]} ${() => themeCssVariables.spacing[4]};
`;

type RecordKind = 'person' | 'company';

const queryFor = (kind: RecordKind, recordId: string): ListQuery =>
  kind === 'person' ? { filter: { personId: { eq: recordId } }, matches: (row) => row.personId === recordId } : { filter: { companyId: { eq: recordId } }, matches: (row) => row.companyId === recordId };

const RecordConversations = ({ kind, recordId }: { kind: RecordKind; recordId: string }) => {
  const userId = useUserId();
  const [live, setLive] = useState<LiveConnection | null>(null);
  const [me, setMe] = useState<string | null>(null);
  const [rows, setRows] = useState<ConversationItem[] | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [composing, setComposing] = useState(false);
  const [problem, setProblem] = useState('');

  useEffect(() => {
    const opened = openLiveConnection();
    setLive(opened);
    return () => opened.close();
  }, []);

  useEffect(() => {
    fetchMe(userId)
      .then(setMe)
      .catch(() => setMe(null));
  }, [userId]);

  useEffect(() => {
    if (!live) return;
    setRows(null);
    const subscribed = subscribeToConversationList(live, queryFor(kind, recordId), { onRows: setRows, onError: setProblem });
    return () => subscribed.close();
  }, [live, kind, recordId]);

  // Starting a conversation is business-initiated, so WhatsApp only allows an approved template.
  const messageContact = async (template: TemplateChoice) => {
    try {
      const result = await callWhatsApp<{ message: { conversationId: string | null } }>({ action: 'send', personId: recordId, template, clientMessageId: newMessageId() });
      setComposing(false);
      setProblem('');
      if (result.message.conversationId) setActiveId(result.message.conversationId);
    } catch (error) {
      setProblem((error as Error).message);
    }
  };

  if (activeId) return <Thread live={live} conversationId={activeId} me={me} onBack={() => setActiveId(null)} />;

  const replyable = rows?.find((row) => !row.optedOut && isWindowOpen(row.windowExpiresAt));
  return (
    <>
      <Top>
        <Row style={{ justifyContent: 'space-between' }}>
          <Row>
            <IconBrandWhatsapp size={16} />
            <Text weight="semibold">WhatsApp</Text>
          </Row>
          {kind === 'person' &&
            (composing ? (
              <QuietButton startIcon={<IconX size={14} />} onClick={() => setComposing(false)}>
                Cancel
              </QuietButton>
            ) : (
              <PrimaryButton onClick={() => setComposing(true)}>Message this contact</PrimaryButton>
            ))}
        </Row>
        {problem && <Callout status="error" title={problem} onDismiss={() => setProblem('')} closeLabel="Dismiss" />}
        {composing && (
          <Stack>
            {replyable ? (
              <Hint>
                They wrote in the last 24 hours, so you can also{' '}
                <QuietButton onClick={() => setActiveId(replyable.id)}>reply in that conversation</QuietButton>.
              </Hint>
            ) : (
              <Hint>The first message to a contact is an approved template.</Hint>
            )}
            <TemplatePicker onSend={messageContact} />
          </Stack>
        )}
      </Top>
      <Stack style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: 8, gap: 2 }}>
        {rows === null ? (
          <ListSkeleton />
        ) : rows.length === 0 ? (
          <Hint>{kind === 'person' ? 'No WhatsApp conversations with this contact yet.' : 'No WhatsApp conversations with people at this company yet.'}</Hint>
        ) : (
          rows.map((conversation) => <ConversationRow key={conversation.id} conversation={conversation} active={false} now={Date.now()} onOpen={setActiveId} />)
        )}
      </Stack>
    </>
  );
};

const RecordTab = () => {
  const selected = useSelectedRecordIds();
  const objectName = useSelectedObjectMetadata()?.nameSingular;
  const recordId = selected.length === 1 ? selected[0] : undefined;
  const kind: RecordKind | null = objectName === 'person' ? 'person' : objectName === 'company' ? 'company' : null;
  return <Frame>{kind && recordId ? <RecordConversations kind={kind} recordId={recordId} /> : <Hint>Open a contact or company to see its WhatsApp conversations.</Hint>}</Frame>;
};

export default defineFrontComponent({
  universalIdentifier: IDS.frontComponents.recordTab,
  name: 'whatsapp-record-tab',
  description: 'WhatsApp conversations of a contact or company, with a button to message the contact.',
  component: RecordTab,
});
