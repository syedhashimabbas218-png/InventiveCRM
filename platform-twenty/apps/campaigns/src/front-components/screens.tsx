import styled from '@emotion/styled';
import { useEffect, useRef, useState } from 'react';
import { Callout } from 'twenty-ui/components/feedback';
import { IconArrowLeft, IconBrandWhatsapp, IconMail, IconPlus, IconTrash } from 'twenty-ui/icon';
import { Card } from 'twenty-ui/primitives/surfaces';
import { Text } from 'twenty-ui/primitives/typography';
import { themeCssVariables } from 'twenty-ui/theme';

import {
  callAdmin,
  ErrorState,
  FieldLabel,
  FieldTitle,
  Grid,
  Hint,
  Input,
  LoadingState,
  NarrowPage,
  Page,
  PageHeader,
  Panel,
  PrimaryButton,
  QuietButton,
  Row,
  SecondaryButton,
  Select,
  Stack,
  StatusTag,
  TextArea,
  when,
} from 'src/front-components/shared';
import { type Campaign, type Overview, percent } from 'src/front-components/types';

const Tiles = styled.div`
  display: grid;
  gap: ${() => themeCssVariables.spacing[4]};
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
`;

const TileValue = styled.div`
  font-size: 28px;
  font-weight: ${() => themeCssVariables.font.weight.semiBold};
  line-height: 1.1;
`;

export const Tile = ({ label, value, hint }: { label: string; value: string; hint?: string }) => (
  <Card.Root fullWidth>
    <Card.Content>
      <Stack>
        <Text size="sm" color="secondary">
          {label}
        </Text>
        <TileValue>{value}</TileValue>
        {hint && <Hint>{hint}</Hint>}
      </Stack>
    </Card.Content>
  </Card.Root>
);

export const TileRow = Tiles;

const tableGrid = () => `
  align-items: center;
  border-top: 1px solid ${themeCssVariables.border.color.light};
  display: grid;
  gap: ${themeCssVariables.spacing[3]};
  grid-template-columns: minmax(0, 2fr) 110px minmax(0, 1fr) repeat(3, 80px);
  padding: ${themeCssVariables.spacing[2]};

  @media (max-width: 800px) {
    grid-template-columns: minmax(0, 1fr) auto;
  }
`;

const RowButton = styled.button`
  ${tableGrid}
  background: transparent;
  border-left: 0;
  border-right: 0;
  border-bottom: 0;
  color: inherit;
  cursor: pointer;
  font: inherit;
  text-align: left;
  width: 100%;

  &:hover {
    background: ${() => themeCssVariables.background.transparent.light};
  }
`;

const HeaderRow = styled.div`
  ${tableGrid}
  color: ${() => themeCssVariables.font.color.tertiary};
  font-size: ${() => themeCssVariables.font.size.sm};

  @media (max-width: 800px) {
    display: none;
  }
`;

const Wide = styled.span`
  @media (max-width: 800px) {
    display: none;
  }
`;

export const CampaignTable = ({ campaigns, onOpen }: { campaigns: Overview['campaigns']; onOpen: (campaign: Overview['campaigns'][number]) => void }) => (
  <Stack>
    <HeaderRow>
      <span>Campaign</span>
      <span>Status</span>
      <Wide>Audience</Wide>
      <Wide>Delivered</Wide>
      <Wide>Opened</Wide>
      <Wide>Clicked</Wide>
    </HeaderRow>
    {campaigns.map((campaign) => (
      <RowButton key={campaign.id} onClick={() => onOpen(campaign)}>
        <Stack>
          <span>{campaign.name || 'Untitled'}</span>
          <Hint>
            {campaign.channel === 'WHATSAPP' ? 'WhatsApp' : 'Email'}
            {campaign.sentAt ? `, sent ${when(campaign.sentAt, { day: 'numeric', month: 'short', year: 'numeric' })}` : campaign.scheduledAt && campaign.status === 'SCHEDULED' ? `, sends ${when(campaign.scheduledAt)}` : ''}
          </Hint>
        </Stack>
        <span>
          <StatusTag kind="campaign" value={campaign.status} />
        </span>
        <Wide>{campaign.listName || '-'}</Wide>
        <Wide>{percent(campaign.deliveredCount, campaign.sentCount)}</Wide>
        <Wide>{percent(campaign.openedCount, campaign.deliveredCount)}</Wide>
        <Wide>{percent(campaign.clickedCount, campaign.deliveredCount)}</Wide>
      </RowButton>
    ))}
  </Stack>
);

const Gallery = styled.div`
  display: grid;
  gap: ${() => themeCssVariables.spacing[4]};
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
`;

const GalleryCard = styled.button<{ selected: boolean }>`
  background: ${() => themeCssVariables.background.primary};
  border: 1px solid ${({ selected }) => (selected ? themeCssVariables.color.blue : themeCssVariables.border.color.medium)};
  border-radius: ${() => themeCssVariables.border.radius.md};
  box-shadow: ${({ selected }) => (selected ? `0 0 0 1px ${themeCssVariables.color.blue}` : 'none')};
  color: inherit;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  font: inherit;
  gap: ${() => themeCssVariables.spacing[1]};
  min-height: 110px;
  padding: ${() => themeCssVariables.spacing[4]};
  text-align: left;
`;

export const NewCampaign = ({ overview, onBack, onCreated }: { overview: Overview; onBack: () => void; onCreated: (id: string) => void }) => {
  const [channel, setChannel] = useState<'EMAIL' | 'WHATSAPP'>('EMAIL');
  const [templateId, setTemplateId] = useState('starter:blank');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const create = async () => {
    setBusy(true);
    try {
      const { id } = await callAdmin<{ id: string }>({ action: 'createDraft', channel, templateId, name });
      onCreated(id);
    } catch (createError) {
      setError((createError as Error).message);
      setBusy(false);
    }
  };

  return (
    <Page>
      <PageHeader
        title="New campaign"
        actions={
          <QuietButton startIcon={<IconArrowLeft size={14} />} onClick={onBack}>
            All campaigns
          </QuietButton>
        }
      />
      {error && <Callout status="error" title="That did not work" description={error} />}
      <Panel title="Channel">
        <Row>
          <GalleryCard selected={channel === 'EMAIL'} onClick={() => setChannel('EMAIL')} style={{ minHeight: 0, flex: 1 }}>
            <Row>
              <IconMail size={16} />
              <strong>Email</strong>
            </Row>
            <Hint>Designed email sent through your Resend account.</Hint>
          </GalleryCard>
          <GalleryCard selected={channel === 'WHATSAPP'} onClick={() => setChannel('WHATSAPP')} style={{ minHeight: 0, flex: 1 }}>
            <Row>
              <IconBrandWhatsapp size={16} />
              <strong>WhatsApp</strong>
            </Row>
            <Hint>An approved template sent through InventiveChat.</Hint>
          </GalleryCard>
        </Row>
      </Panel>
      {channel === 'EMAIL' && (
        <Panel title="Start from">
          <Gallery>
            {overview.templates.map((template) => (
              <GalleryCard key={template.id} selected={templateId === template.id} onClick={() => setTemplateId(template.id)}>
                <strong>{template.name}</strong>
                <Hint>{template.description || (template.starter ? '' : 'Saved template')}</Hint>
              </GalleryCard>
            ))}
          </Gallery>
        </Panel>
      )}
      <Panel title="Name">
        <Input value={name} placeholder="e.g. December newsletter" onChange={(event) => setName(event.target.value)} />
        <Row>
          <PrimaryButton disabled={busy} onClick={create}>
            Create draft
          </PrimaryButton>
        </Row>
      </Panel>
    </Page>
  );
};

const REPORT_REFRESH_MS = 45_000;

type Report = { campaign: Omit<Campaign, 'design'>; problems: { id: string; name: string; address: string; status: string; error: string | null }[] };

export const CampaignReport = ({ campaignId, onBack, onOpenCampaign, openRecipients }: { campaignId: string; onBack: () => void; onOpenCampaign: (id: string) => void; openRecipients: (id: string) => void }) => {
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState('');
  const fetchReport = () => callAdmin<Report>({ action: 'report', id: campaignId });
  const load = () =>
    fetchReport()
      .then(setReport)
      .catch((loadError: Error) => setError(loadError.message));
  useEffect(() => {
    load();
  }, [campaignId]);

  const inProgress = report?.campaign.status === 'PREPARING' || report?.campaign.status === 'SENDING';
  useEffect(() => {
    if (!inProgress) return;
    // A failed background refresh keeps the last report on screen; the next one tries again.
    const timer = setInterval(() => fetchReport().then(setReport).catch(() => {}), REPORT_REFRESH_MS);
    return () => clearInterval(timer);
  }, [inProgress, campaignId]);

  const act = async (action: 'cancel' | 'resume' | 'duplicate') => {
    try {
      const result = await callAdmin<{ id?: string }>({ action, id: campaignId });
      if (action === 'duplicate' && result.id) onOpenCampaign(result.id);
      else load();
    } catch (actionError) {
      setError((actionError as Error).message);
    }
  };

  if (error) return <NarrowPage><ErrorState message={error} onRetry={() => { setError(''); load(); }} /></NarrowPage>;
  if (!report) return <NarrowPage><LoadingState /></NarrowPage>;
  const { campaign } = report;
  const counts = campaign.counts;

  return (
    <Page>
      <PageHeader
        title={campaign.name}
        description={<StatusTag kind="campaign" value={campaign.status} />}
        actions={
          <Row>
            <QuietButton startIcon={<IconArrowLeft size={14} />} onClick={onBack}>
              All campaigns
            </QuietButton>
            {(campaign.status === 'SCHEDULED' || campaign.status === 'PREPARING' || campaign.status === 'SENDING') && <SecondaryButton onClick={() => act('cancel')}>{campaign.status === 'SCHEDULED' ? 'Unschedule' : 'Stop sending'}</SecondaryButton>}
            {(campaign.status === 'FAILED' || campaign.status === 'CANCELLED') && campaign.startedAt && <SecondaryButton onClick={() => act('resume')}>Resume</SecondaryButton>}
            <SecondaryButton onClick={() => act('duplicate')}>Duplicate</SecondaryButton>
            <SecondaryButton onClick={() => openRecipients(campaign.id)}>All recipients</SecondaryButton>
          </Row>
        }
      />
      {campaign.lastError && <Callout status={campaign.status === 'FAILED' ? 'error' : 'info'} title={campaign.status === 'FAILED' ? 'Sending stopped' : 'Sending paused'} description={campaign.lastError} />}
      {campaign.status === 'SCHEDULED' && campaign.scheduledAt && <Callout status="info" title={`Sends ${when(campaign.scheduledAt)}`} description="Unschedule it to make changes." />}
      {campaign.status === 'PREPARING' && <Callout status="info" title="Preparing the audience" description="Checking consent and addresses for everyone on the list. Sending starts as soon as that is done." />}
      {campaign.status === 'SENDING' && <Callout status="info" title={`Sending: ${counts.sentCount} of ${counts.recipientCount} sent`} description="Results update every couple of minutes." />}
      <TileRow>
        <Tile label="Recipients" value={String(counts.recipientCount)} hint={counts.skippedCount ? `${counts.skippedCount} skipped: no consent, no address, do-not-contact or stopped` : undefined} />
        <Tile label="Delivered" value={percent(counts.deliveredCount, counts.sentCount)} hint={`${counts.deliveredCount} of ${counts.sentCount} sent`} />
        <Tile label={campaign.channel === 'EMAIL' ? 'Opened' : 'Read'} value={percent(counts.openedCount, counts.deliveredCount)} hint={`${counts.openedCount} people`} />
        {campaign.channel === 'EMAIL' && <Tile label="Clicked" value={percent(counts.clickedCount, counts.deliveredCount)} hint={`${counts.clickedCount} people`} />}
        <Tile label="Unsubscribed" value={String(counts.unsubscribedCount)} />
        <Tile label="Bounced or failed" value={String((counts.bouncedCount ?? 0) + (counts.failedCount ?? 0))} hint={counts.complainedCount ? `${counts.complainedCount} marked it as spam` : undefined} />
      </TileRow>
      {campaign.channel === 'EMAIL' && <Hint>Opens are estimates: some mail apps load images automatically and some block them. Clicks are the more reliable signal.</Hint>}
      <Grid>
        <Panel title="Details">
          {campaign.channel === 'EMAIL' && <Text>Subject: {campaign.subject}</Text>}
          <Text>Audience: {campaign.listName || '-'}</Text>
          {campaign.channel === 'EMAIL' && <Text>From: {campaign.fromName} &lt;{campaign.fromLocalPart}@{campaign.fromDomain}&gt;</Text>}
          {campaign.startedAt && <Text>Started: {when(campaign.startedAt)}</Text>}
          {campaign.sentAt && <Text>Finished: {when(campaign.sentAt)}</Text>}
        </Panel>
        <Panel title="Problems">
          {report.problems.length === 0 ? (
            <Hint>No bounces, failures or spam reports.</Hint>
          ) : (
            report.problems.map((problem) => (
              <Stack key={problem.id}>
                <Row>
                  <StatusTag kind="recipient" value={problem.status} />
                  <span>{problem.address}</span>
                </Row>
                {problem.error && <Hint>{problem.error}</Hint>}
              </Stack>
            ))
          )}
        </Panel>
      </Grid>
    </Page>
  );
};

type Member = { id: string; person: { id: string; name: { firstName: string; lastName: string } | null; emails: { primaryEmail: string | null } | null; emailMarketingConsent: boolean | null; whatsappMarketingConsent: boolean | null } | null };
type FoundPerson = Member['person'] & { company: { name: string } | null };

const SEARCH_DELAY_MS = 300;

const consentLabel = (person: NonNullable<Member['person']>) => [person.emailMarketingConsent ? 'email' : '', person.whatsappMarketingConsent ? 'WhatsApp' : ''].filter(Boolean).join(' and ') || 'no consent yet';

const personName = (person: NonNullable<Member['person']>) => [person.name?.firstName, person.name?.lastName].filter(Boolean).join(' ') || person.emails?.primaryEmail || 'Unnamed contact';

export const Lists = ({ overview, initialListId, onBack, onChanged }: { overview: Overview; initialListId?: string; onBack: () => void; onChanged: () => void }) => {
  const [listId, setListId] = useState(initialListId ?? overview.lists[0]?.id ?? '');
  const [members, setMembers] = useState<{ total: number; members: Member[] } | null>(null);
  const [newName, setNewName] = useState('');
  const [query, setQuery] = useState('');
  const [found, setFound] = useState<FoundPerson[]>([]);
  const [message, setMessage] = useState<{ status: 'success' | 'error'; text: string } | null>(null);

  const loadMembers = (id: string) => {
    setMembers(null);
    if (!id) return;
    callAdmin<{ total: number; members: Member[] }>({ action: 'listMembers', listId: id })
      .then(setMembers)
      .catch((error: Error) => setMessage({ status: 'error', text: error.message }));
  };
  useEffect(() => loadMembers(listId), [listId]);

  const run = async (body: Record<string, unknown>, success: (result: { added?: number; total?: number; id?: string }) => string) => {
    try {
      const result = await callAdmin<{ added?: number; total?: number; id?: string }>(body);
      setMessage({ status: 'success', text: success(result) });
      onChanged();
      return result;
    } catch (error) {
      setMessage({ status: 'error', text: (error as Error).message });
      return null;
    }
  };

  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestSearch = useRef(0);
  // Waits for a pause in typing, and drops answers to searches the person has already typed past.
  const search = (value: string) => {
    setQuery(value);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    const searchNumber = ++latestSearch.current;
    if (value.trim().length < 2) return setFound([]);
    searchTimer.current = setTimeout(() => {
      callAdmin<{ people: FoundPerson[] }>({ action: 'searchPeople', query: value })
        .catch(() => ({ people: [] }))
        .then((result) => {
          if (searchNumber === latestSearch.current) setFound(result.people);
        });
    }, SEARCH_DELAY_MS);
  };

  return (
    <NarrowPage>
      <PageHeader
        title="Mailing lists"
        description="Group contacts to send campaigns to. Campaigns only reach people on a list who agreed to marketing."
        actions={
          <QuietButton startIcon={<IconArrowLeft size={14} />} onClick={onBack}>
            Campaign Studio
          </QuietButton>
        }
      />
      {message && <Callout status={message.status} title={message.status === 'error' ? 'That did not work' : 'Done'} description={message.text} />}
      <Panel title="New list">
        <Row>
          <Input value={newName} placeholder="e.g. Newsletter" style={{ flex: 1 }} onChange={(event) => setNewName(event.target.value)} />
          <PrimaryButton
            startIcon={<IconPlus size={14} />}
            disabled={!newName.trim()}
            onClick={async () => {
              const result = await run({ action: 'createList', name: newName }, () => `Created "${newName}".`);
              if (result?.id) {
                setNewName('');
                setListId(result.id);
              }
            }}
          >
            Create list
          </PrimaryButton>
        </Row>
      </Panel>
      {overview.lists.length > 0 && (
        <Panel
          title="Contacts on a list"
          action={
            <Select value={listId} onChange={(event) => setListId(event.target.value)}>
              {overview.lists.map((list) => (
                <option key={list.id} value={list.id}>
                  {list.name}
                </option>
              ))}
            </Select>
          }
        >
          <FieldLabel>
            <FieldTitle>Add a contact</FieldTitle>
            <Input value={query} placeholder="Search by name or email" onChange={(event) => search(event.target.value)} />
          </FieldLabel>
          {found.map((person) =>
            person ? (
              <Row key={person.id}>
                <span style={{ flex: 1 }}>
                  {personName(person)} <Hint>{person.emails?.primaryEmail ?? ''} ({consentLabel(person)})</Hint>
                </span>
                <SecondaryButton onClick={async () => (await run({ action: 'addToList', listId, personIds: [person.id] }, (result) => (result.added ? `Added ${personName(person)}.` : `${personName(person)} is already on the list.`))) && loadMembers(listId)}>
                  Add
                </SecondaryButton>
              </Row>
            ) : null,
          )}
          <Row>
            <SecondaryButton onClick={async () => (await run({ action: 'addConsentedToList', listId, channel: 'EMAIL' }, (result) => `Added ${result.added ?? 0} contacts.`)) && loadMembers(listId)}>
              Add everyone who agreed to emails
            </SecondaryButton>
            <SecondaryButton onClick={async () => (await run({ action: 'addConsentedToList', listId, channel: 'WHATSAPP' }, (result) => `Added ${result.added ?? 0} contacts.`)) && loadMembers(listId)}>
              Add everyone who agreed to WhatsApp
            </SecondaryButton>
          </Row>
          {!members ? (
            <Hint>Loading…</Hint>
          ) : members.members.length === 0 ? (
            <Hint>No contacts on this list yet.</Hint>
          ) : (
            <>
              <Hint>
                {members.total} contact{members.total === 1 ? '' : 's'}
                {members.total > members.members.length ? `, showing the latest ${members.members.length}` : ''}
              </Hint>
              {members.members.map((member) =>
                member.person ? (
                  <Row key={member.id}>
                    <span style={{ flex: 1 }}>
                      {personName(member.person)} <Hint>{member.person.emails?.primaryEmail ?? ''} ({consentLabel(member.person)})</Hint>
                    </span>
                    <QuietButton aria-label={`Remove ${personName(member.person)}`} onClick={async () => (await run({ action: 'removeFromList', memberId: member.id }, () => 'Removed.')) && loadMembers(listId)}>
                      <IconTrash size={14} />
                    </QuietButton>
                  </Row>
                ) : null,
              )}
            </>
          )}
        </Panel>
      )}
    </NarrowPage>
  );
};

export const BrandKit = ({ overview, onBack, onSaved }: { overview: Overview; onBack: () => void; onSaved: () => void }) => {
  const [brand, setBrand] = useState(overview.brand);
  const [message, setMessage] = useState<{ status: 'success' | 'error'; text: string } | null>(null);
  const field = (key: 'name' | 'logoUrl' | 'websiteUrl', title: string, placeholder = '') => (
    <FieldLabel>
      <FieldTitle>{title}</FieldTitle>
      <Input value={brand[key]} placeholder={placeholder} onChange={(event) => setBrand({ ...brand, [key]: event.target.value })} />
    </FieldLabel>
  );
  const colour = (key: 'primaryColor' | 'backgroundColor' | 'textColor', title: string) => (
    <FieldLabel>
      <FieldTitle>{title}</FieldTitle>
      <Row>
        <Input type="color" value={brand[key]} style={{ width: 48, padding: 2 }} onChange={(event) => setBrand({ ...brand, [key]: event.target.value })} />
        <Input value={brand[key]} style={{ width: 100 }} onChange={(event) => setBrand({ ...brand, [key]: event.target.value })} />
      </Row>
    </FieldLabel>
  );

  return (
    <NarrowPage>
      <PageHeader
        title="Brand kit"
        description="Every campaign email uses these: your logo at the top, your colours and the footer."
        actions={
          <QuietButton startIcon={<IconArrowLeft size={14} />} onClick={onBack}>
            Campaign Studio
          </QuietButton>
        }
      />
      {message && <Callout status={message.status} title={message.status === 'error' ? 'That did not work' : 'Done'} description={message.text} />}
      <Panel title="Identity">
        {field('name', 'Business name', 'Your business')}
        {field('logoUrl', 'Logo image link (https, about 200 by 80 pixels)', 'https://')}
        {field('websiteUrl', 'Website', 'https://')}
      </Panel>
      <Panel title="Look">
        <Row>
          {colour('primaryColor', 'Buttons and links')}
          {colour('backgroundColor', 'Background')}
          {colour('textColor', 'Text')}
        </Row>
        <FieldLabel>
          <FieldTitle>Font</FieldTitle>
          <Select value={brand.fontFamily} onChange={(event) => setBrand({ ...brand, fontFamily: event.target.value })}>
            {overview.fonts.map((font) => (
              <option key={font} value={font}>
                {(font.split(',')[0] ?? font).replace(/'/g, '')}
              </option>
            ))}
          </Select>
        </FieldLabel>
      </Panel>
      <Panel title="Footer">
        <FieldLabel>
          <FieldTitle>Business name and postal address (required by law in marketing emails)</FieldTitle>
          <TextArea value={brand.footerText} placeholder={'Your Business Ltd\n1 High Street, London, AB1 2CD'} onChange={(event) => setBrand({ ...brand, footerText: event.target.value })} />
        </FieldLabel>
        <Hint>An unsubscribe link is always added below the footer.</Hint>
        <Row>
          <PrimaryButton
            onClick={async () => {
              try {
                const { name, logoUrl, websiteUrl, primaryColor, backgroundColor, textColor, fontFamily, footerText } = brand;
                await callAdmin({ action: 'updateBrand', changes: { name, logoUrl, websiteUrl, primaryColor, backgroundColor, textColor, fontFamily, footerText } });
                setMessage({ status: 'success', text: 'Brand kit saved.' });
                onSaved();
              } catch (error) {
                setMessage({ status: 'error', text: (error as Error).message });
              }
            }}
          >
            Save brand kit
          </PrimaryButton>
        </Row>
      </Panel>
    </NarrowPage>
  );
};
