import styled from '@emotion/styled';
import { useEffect, useState } from 'react';
import { defineFrontComponent } from 'twenty-sdk/define';
import { AppPath, navigate } from 'twenty-sdk/front-component';
import { Callout } from 'twenty-ui/components/feedback';
import { IconSettings } from 'twenty-ui/icon';
import { Card } from 'twenty-ui/primitives/surfaces';
import { Text } from 'twenty-ui/primitives/typography';
import { themeCssVariables } from 'twenty-ui/theme';

import { IDS } from 'src/constants/ids';
import { callAdmin, ColorTag, ErrorState, Grid, Hint, LoadingState, Page, PageHeader, Panel, SecondaryButton, Stack, when } from 'src/front-components/shared';

type Group = 'PROMOTER' | 'PASSIVE' | 'DETRACTOR';

type Overview = {
  settings: { id: string; enabled: boolean; channel: string; afterAppointments: boolean; afterPaidInvoices: boolean; hasReviewLink: boolean; hasAlertEmails: boolean };
  summary: { total: number; promoters: number; passives: number; detractors: number; nps: number | null };
  asked: number;
  responseRate: number | null;
  recent: { id: string; name: string; score: number; group: Group; comment: string; answeredAt: string }[];
};

// Theme variables only exist once the page renders, so colours are read lazily.
const GROUPS: Record<Group, { label: string; color: 'green' | 'gray' | 'red'; ink: () => string }> = {
  PROMOTER: { label: 'Promoters (9-10)', color: 'green', ink: () => themeCssVariables.color.green },
  PASSIVE: { label: 'Passives (7-8)', color: 'gray', ink: () => themeCssVariables.color.gray },
  DETRACTOR: { label: 'Detractors (0-6)', color: 'red', ink: () => themeCssVariables.color.red },
};

const Tiles = styled.div`
  display: grid;
  gap: ${() => themeCssVariables.spacing[4]};
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
`;

const TileValue = styled.div`
  font-size: 32px;
  font-weight: ${() => themeCssVariables.font.weight.semiBold};
  line-height: 1.1;
`;

const Tile = ({ label, value, hint }: { label: string; value: string; hint: string }) => (
  <Card.Root fullWidth>
    <Card.Content>
      <Stack>
        <Text size="sm" color="secondary">
          {label}
        </Text>
        <TileValue>{value}</TileValue>
        <Hint>{hint}</Hint>
      </Stack>
    </Card.Content>
  </Card.Root>
);

// One bar split into the three NPS groups; every segment is labelled, so colour never carries meaning alone.
const Bar = styled.div`
  border-radius: ${() => themeCssVariables.border.radius.sm};
  display: flex;
  gap: 2px;
  height: 12px;
  overflow: hidden;
`;

const Segment = styled.div<{ share: number; ink: string }>`
  background: ${({ ink }) => ink};
  flex: ${({ share }) => share} 0 0;
`;

const Legend = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: ${() => themeCssVariables.spacing[4]};
`;

const Swatch = styled.span<{ ink: string }>`
  background: ${({ ink }) => ink};
  border-radius: 2px;
  display: inline-block;
  height: 10px;
  margin-right: ${() => themeCssVariables.spacing[1]};
  width: 10px;
`;

const AnswerRow = styled.button`
  align-items: flex-start;
  background: transparent;
  border: 0;
  border-radius: ${() => themeCssVariables.border.radius.sm};
  border-top: 1px solid ${() => themeCssVariables.border.color.light};
  color: inherit;
  cursor: pointer;
  display: grid;
  font: inherit;
  gap: ${() => themeCssVariables.spacing[3]};
  grid-template-columns: 64px minmax(0, 1fr) auto;
  padding: ${() => themeCssVariables.spacing[2]};
  text-align: left;
  width: 100%;

  &:hover {
    background: ${() => themeCssVariables.background.transparent.light};
  }
`;

const openSettings = (id: string) => navigate(AppPath.RecordShowPage, { objectNameSingular: 'feedbackSettings', objectRecordId: id });

const Overview = () => {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState('');
  const load = () =>
    callAdmin<Overview>({ action: 'overview' })
      .then((result) => {
        setData(result);
        setError('');
      })
      .catch((loadError: Error) => setError(loadError.message));
  useEffect(() => {
    load();
  }, []);

  if (error)
    return (
      <Page>
        <ErrorState message={error} onRetry={load} />
      </Page>
    );
  if (!data)
    return (
      <Page>
        <LoadingState />
      </Page>
    );

  const { summary } = data;
  const counts: Record<Group, number> = { PROMOTER: summary.promoters, PASSIVE: summary.passives, DETRACTOR: summary.detractors };

  return (
    <Page>
      <PageHeader
        title="Feedback"
        description="Customer scores from the last 90 days."
        actions={
          <SecondaryButton startIcon={<IconSettings size={14} />} onClick={() => openSettings(data.settings.id)}>
            Settings
          </SecondaryButton>
        }
      />

      {!data.settings.enabled && (
        <Callout
          status="info"
          title="Automatic feedback is off"
          description="Choose when to ask (after appointments, paid invoices or both), how to send it and who gets alerts, then switch it on in the settings."
          action={<SecondaryButton onClick={() => openSettings(data.settings.id)}>Open settings</SecondaryButton>}
        />
      )}
      {data.settings.enabled && !data.settings.hasAlertEmails && (
        <Callout status="warning" title="Nobody is alerted about unhappy customers" description="Add alert emails in the settings. A follow-up task is still created for every low score." />
      )}

      <Tiles>
        <Tile label="Net Promoter Score" value={summary.nps === null ? '-' : `${summary.nps > 0 ? '+' : ''}${summary.nps}`} hint="From -100 to +100: % promoters minus % detractors." />
        <Tile label="Answers" value={String(summary.total)} hint={`${data.asked} customers asked`} />
        <Tile label="Response rate" value={data.responseRate === null ? '-' : `${data.responseRate}%`} hint="Answers out of surveys sent." />
      </Tiles>

      <Panel title="How customers feel">
        {summary.total === 0 ? (
          <Hint>No answers yet.</Hint>
        ) : (
          <Stack>
            <Bar role="img" aria-label={`${summary.promoters} promoters, ${summary.passives} passives, ${summary.detractors} detractors`}>
              {(Object.keys(GROUPS) as Group[])
                .filter((group) => counts[group] > 0)
                .map((group) => (
                  <Segment key={group} share={counts[group]} ink={GROUPS[group].ink()} title={`${GROUPS[group].label}: ${counts[group]}`} />
                ))}
            </Bar>
            <Legend>
              {(Object.keys(GROUPS) as Group[]).map((group) => (
                <Text key={group} size="sm" color="secondary">
                  <Swatch ink={GROUPS[group].ink()} />
                  {GROUPS[group].label}: {counts[group]} ({Math.round((counts[group] / summary.total) * 100)}%)
                </Text>
              ))}
            </Legend>
          </Stack>
        )}
      </Panel>

      <Grid>
        <Panel title="Latest answers">
          {data.recent.length === 0 ? (
            <Hint>Answers appear here as customers reply.</Hint>
          ) : (
            data.recent.map((answer) => (
              <AnswerRow key={answer.id} onClick={() => navigate(AppPath.RecordShowPage, { objectNameSingular: 'feedbackRequest', objectRecordId: answer.id })}>
                <ColorTag color={GROUPS[answer.group].color}>{answer.score} / 10</ColorTag>
                <Stack>
                  <span>{answer.name}</span>
                  <Hint>{answer.comment || 'No comment'}</Hint>
                </Stack>
                <Hint>{when(answer.answeredAt, { day: 'numeric', month: 'short' })}</Hint>
              </AnswerRow>
            ))
          )}
        </Panel>
        <Panel title="How it works">
          <Hint>
            {data.settings.afterAppointments || data.settings.afterPaidInvoices
              ? `Customers are asked ${[data.settings.afterAppointments ? 'after a completed appointment' : '', data.settings.afterPaidInvoices ? 'after paying an invoice' : ''].filter(Boolean).join(' and ')}, at most once in the cool-down period.`
              : 'No trigger is chosen yet, so only customers you ask by hand get a survey.'}
          </Hint>
          <Hint>Low scores create a follow-up task on the customer and email the alert list.</Hint>
          <Hint>{data.settings.hasReviewLink ? 'Happy customers are invited to leave a Google review.' : 'Add your Google review link so happy customers are invited to leave a review.'}</Hint>
        </Panel>
      </Grid>
    </Page>
  );
};

export default defineFrontComponent({
  universalIdentifier: IDS.frontComponents.overview,
  name: 'feedback-overview',
  description: 'Net Promoter Score, answers and latest comments.',
  component: Overview,
});
