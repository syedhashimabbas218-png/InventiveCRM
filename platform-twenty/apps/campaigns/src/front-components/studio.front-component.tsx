import { useEffect, useState } from 'react';
import { defineFrontComponent } from 'twenty-sdk/define';
import { AppPath, navigate } from 'twenty-sdk/front-component';
import { Callout } from 'twenty-ui/components/feedback';
import { IconColorSwatch, IconList, IconPlus } from 'twenty-ui/icon';

import { IDS } from 'src/constants/ids';
import { Editor } from 'src/front-components/editor';
import { BrandKit, CampaignReport, CampaignTable, Lists, NewCampaign, Tile, TileRow } from 'src/front-components/screens';
import { callAdmin, ErrorState, Grid, Hint, LoadingState, Page, PageHeader, Panel, PrimaryButton, QuietButton, Row, SecondaryButton } from 'src/front-components/shared';
import { type Campaign, type Overview, type Screen } from 'src/front-components/types';

const openView = (objectNamePlural: string) => navigate(AppPath.RecordIndexPage, { objectNamePlural });

const Setup = ({ overview, onTracking, onBrand }: { overview: Overview; onTracking: () => void; onBrand: () => void }) => {
  const { resend, brand } = overview;
  const verified = resend.domains.filter((domain) => domain.status === 'verified');
  const items = [
    !resend.connected && (
      <Callout key="resend" status="info" title="Connect your Resend account" description="Emails go out through your own Resend account. Go to Settings, Accounts, choose Resend (email campaigns) and paste a Full access API key." />
    ),
    resend.connected && !resend.reachable && <Callout key="reach" status="warning" title="Resend could not be reached" description="Check that the key is still active in Resend. Studio retries every time you open it." />,
    resend.connected && resend.reachable && verified.length === 0 && (
      <Callout key="domain" status="warning" title="Verify a sending domain" description="In Resend, open Domains, add your domain and add the DNS records it shows. Campaigns can be sent once it says Verified." />
    ),
    resend.connected && resend.reachable && !resend.webhookReady && (
      <Callout
        key="tracking"
        status="info"
        title="Turn on delivery tracking"
        description="Lets Resend report deliveries, opens, clicks, bounces and spam complaints back to the CRM. Bounces and complaints are added to the do-not-contact list automatically."
        action={<SecondaryButton onClick={onTracking}>Turn on</SecondaryButton>}
      />
    ),
    !brand.footerText.trim() && (
      <Callout key="footer" status="warning" title="Add your postal address to the brand kit" description="Marketing emails must say who sent them and where you are." action={<SecondaryButton onClick={onBrand}>Open brand kit</SecondaryButton>} />
    ),
  ].filter(Boolean);
  return items.length ? <>{items}</> : null;
};

const Studio = () => {
  const [screen, setScreen] = useState<Screen>({ name: 'home' });
  const [overview, setOverview] = useState<Overview | null>(null);
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState<{ status: 'success' | 'error'; text: string } | null>(null);

  const load = () =>
    callAdmin<Overview>({ action: 'overview' })
      .then((result) => {
        setOverview(result);
        setError('');
      })
      .catch((loadError: Error) => setError(loadError.message));
  useEffect(() => {
    load();
  }, []);

  const openEditor = async (id: string) => {
    setCampaign(null);
    setScreen({ name: 'editor', id });
    try {
      setCampaign(await callAdmin<Campaign>({ action: 'campaign', id }));
    } catch (openError) {
      setError((openError as Error).message);
    }
  };

  const home = () => {
    setScreen({ name: 'home' });
    load();
  };

  const turnOnTracking = async () => {
    try {
      await callAdmin({ action: 'setupTracking' });
      setNotice({ status: 'success', text: 'Delivery tracking is on. For opens and clicks, also switch on open and click tracking for your domain in Resend.' });
      load();
    } catch (trackingError) {
      setNotice({ status: 'error', text: (trackingError as Error).message });
    }
  };

  if (error)
    return (
      <Page>
        <ErrorState message={error} onRetry={home} />
      </Page>
    );
  if (!overview)
    return (
      <Page>
        <LoadingState />
      </Page>
    );

  switch (screen.name) {
    case 'new':
      return <NewCampaign overview={overview} onBack={home} onCreated={(id) => { load(); openEditor(id); }} />;
    case 'editor':
      return campaign ? (
        <Editor initial={campaign} overview={overview} onBack={home} onSaved={() => { load(); setScreen({ name: 'report', id: campaign.id }); }} />
      ) : (
        <Page>
          <LoadingState />
        </Page>
      );
    case 'report':
      return <CampaignReport campaignId={screen.id} onBack={home} onOpenCampaign={openEditor} openRecipients={() => openView('campaignRecipients')} />;
    case 'lists':
      return <Lists overview={overview} initialListId={screen.listId} onBack={home} onChanged={load} />;
    case 'brand':
      return <BrandKit overview={overview} onBack={home} onSaved={load} />;
  }

  const sent = overview.campaigns.filter((item) => item.status === 'SENT');
  const delivered = sent.reduce((total, item) => total + (item.deliveredCount ?? 0), 0);
  const opened = sent.reduce((total, item) => total + (item.openedCount ?? 0), 0);
  const clicked = sent.reduce((total, item) => total + (item.clickedCount ?? 0), 0);

  return (
    <Page>
      <PageHeader
        title="Campaign Studio"
        description="Email and WhatsApp campaigns to contacts who agreed to hear from you."
        actions={
          <Row>
            <SecondaryButton startIcon={<IconList size={14} />} onClick={() => setScreen({ name: 'lists' })}>
              Lists
            </SecondaryButton>
            <SecondaryButton startIcon={<IconColorSwatch size={14} />} onClick={() => setScreen({ name: 'brand' })}>
              Brand kit
            </SecondaryButton>
            <PrimaryButton startIcon={<IconPlus size={14} />} onClick={() => setScreen({ name: 'new' })}>
              New campaign
            </PrimaryButton>
          </Row>
        }
      />
      {notice && <Callout status={notice.status} title={notice.status === 'error' ? 'That did not work' : 'Done'} description={notice.text} />}
      <Setup overview={overview} onTracking={turnOnTracking} onBrand={() => setScreen({ name: 'brand' })} />
      <TileRow>
        <Tile label="Agreed to emails" value={String(overview.audience.emailConsented)} hint="Contacts you can email" />
        <Tile label="Agreed to WhatsApp" value={String(overview.audience.whatsappConsented)} hint="Contacts you can message" />
        <Tile label="Open rate" value={delivered ? `${Math.round((opened / delivered) * 100)}%` : '-'} hint="Across sent campaigns" />
        <Tile label="Click rate" value={delivered ? `${Math.round((clicked / delivered) * 100)}%` : '-'} hint="Across sent campaigns" />
      </TileRow>
      <Panel title="Campaigns" action={<QuietButton onClick={() => openView('marketingCampaigns')}>Open as table</QuietButton>}>
        {overview.campaigns.length === 0 ? (
          <Hint>No campaigns yet. Start with New campaign.</Hint>
        ) : (
          <CampaignTable campaigns={overview.campaigns} onOpen={(item) => (item.status === 'DRAFT' ? openEditor(item.id) : setScreen({ name: 'report', id: item.id }))} />
        )}
      </Panel>
      <Grid>
        <Panel title="Mailing lists" action={<QuietButton onClick={() => setScreen({ name: 'lists' })}>Manage</QuietButton>}>
          {overview.lists.length === 0 ? (
            <Hint>No lists yet. You can also send to everyone who agreed.</Hint>
          ) : (
            overview.lists.slice(0, 8).map((list) => (
              <Row key={list.id}>
                <QuietButton onClick={() => setScreen({ name: 'lists', listId: list.id })}>{list.name}</QuietButton>
                <Hint>{list.memberCount ?? 0} contacts</Hint>
              </Row>
            ))
          )}
        </Panel>
        <Panel title="Consent and do-not-contact" action={<QuietButton onClick={() => openView('campaignSuppressions')}>Open list</QuietButton>}>
          <Hint>Campaigns only go to contacts with "Agreed to marketing emails" or "Agreed to marketing on WhatsApp" ticked on their record. Tick it only when the person actively agreed.</Hint>
          <Hint>{overview.audience.suppressions} addresses are on the do-not-contact list. Unsubscribes, hard bounces and spam complaints are added automatically and their consent is removed.</Hint>
          <Hint>{overview.resend.connected ? `Sending through ${overview.resend.label ?? 'your Resend account'}.` : 'No Resend account connected yet.'}</Hint>
        </Panel>
      </Grid>
    </Page>
  );
};

export default defineFrontComponent({
  universalIdentifier: IDS.frontComponents.studio,
  name: 'campaign-studio',
  description: 'Design, send and measure email and WhatsApp campaigns.',
  component: Studio,
});
