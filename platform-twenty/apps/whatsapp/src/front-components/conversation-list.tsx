import styled from '@emotion/styled';
import { memo } from 'react';
import { Avatar, Badge, Tag } from 'twenty-ui/primitives/data-display';
import { Skeleton } from 'twenty-ui/primitives/feedback';
import { themeCssVariables } from 'twenty-ui/theme';

import { Stack } from 'src/front-components/shared';
import { conversationTitle, type ConversationItem, relativeTime } from 'src/lib/thread';

const Item = styled.button<{ active: boolean }>`
  align-items: center;
  background: ${({ active }) => (active ? themeCssVariables.background.transparent.medium : 'transparent')};
  border: 0;
  border-radius: ${() => themeCssVariables.border.radius.sm};
  color: ${() => themeCssVariables.font.color.primary};
  cursor: pointer;
  display: grid;
  font: inherit;
  gap: ${() => themeCssVariables.spacing[2]};
  grid-template-columns: auto minmax(0, 1fr) auto;
  padding: ${() => themeCssVariables.spacing[2]};
  text-align: left;
  width: 100%;

  &:hover {
    background: ${() => themeCssVariables.background.transparent.light};
  }
`;

const Line = styled.span<{ strong?: boolean; muted?: boolean }>`
  color: ${({ muted }) => (muted ? themeCssVariables.font.color.tertiary : themeCssVariables.font.color.primary)};
  display: block;
  font-size: ${({ muted }) => (muted ? themeCssVariables.font.size.sm : themeCssVariables.font.size.md)};
  font-weight: ${({ strong }) => (strong ? themeCssVariables.font.weight.semiBold : themeCssVariables.font.weight.regular)};
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const Side = styled.span`
  align-items: flex-end;
  color: ${() => themeCssVariables.font.color.tertiary};
  display: flex;
  flex-direction: column;
  font-size: ${() => themeCssVariables.font.size.xs};
  gap: ${() => themeCssVariables.spacing[1]};
`;

export const ConversationRow = memo(({ conversation, active, now, onOpen }: { conversation: ConversationItem; active: boolean; now: number; onOpen: (id: string) => void }) => {
  const title = conversationTitle(conversation);
  const unread = active ? 0 : (conversation.unreadCount ?? 0);
  return (
    <Item active={active} aria-current={active ? 'page' : undefined} onClick={() => onOpen(conversation.id)}>
      <Avatar name={title} colorSeed={conversation.id} size="md" shape="circle" />
      <span style={{ minWidth: 0 }}>
        <Line strong={unread > 0}>{title}</Line>
        <Line muted>{conversation.lastMessagePreview || conversation.customerPhone || ''}</Line>
      </span>
      <Side>
        <span>{relativeTime(conversation.lastMessageAt, now)}</span>
        {unread > 0 ? (
          <Badge size="sm" color="accent" shape="pill" aria-label={`${unread} unread`}>
            {unread}
          </Badge>
        ) : conversation.handling === 'HANDOFF_REQUESTED' ? (
          <Tag color="orange">Wants a person</Tag>
        ) : conversation.customerWaiting ? (
          <Tag color="amber">Waiting</Tag>
        ) : null}
      </Side>
    </Item>
  );
});

export const ListSkeleton = () => (
  <Stack style={{ padding: 8 }}>
    {[0, 1, 2, 3].map((index) => (
      <Skeleton key={index} layout="block" height={44} />
    ))}
  </Stack>
);
