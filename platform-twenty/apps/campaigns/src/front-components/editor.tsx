import { useState } from 'react';
import { SegmentedControl } from 'twenty-ui/components/input';
import { Callout } from 'twenty-ui/components/feedback';
import { IconArrowLeft } from 'twenty-ui/icon';
import { RadioGroup, Radio } from 'twenty-ui/primitives/input';
import { Text } from 'twenty-ui/primitives/typography';

import { type Design } from 'src/lib/design';
import { Designer } from 'src/front-components/designer';
import {
  callAdmin,
  CheckboxLabel,
  FieldLabel,
  FieldTitle,
  Hint,
  Input,
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
} from 'src/front-components/shared';
import { type Campaign, type Overview } from 'src/front-components/types';

type Step = 'setup' | 'audience' | 'design' | 'review';

const EMAIL_STEPS: { value: Step; label: string }[] = [
  { value: 'setup', label: '1. Setup' },
  { value: 'audience', label: '2. Audience' },
  { value: 'design', label: '3. Design' },
  { value: 'review', label: '4. Review and send' },
];

const WHATSAPP_STEPS: { value: Step; label: string }[] = [
  { value: 'setup', label: '1. Message' },
  { value: 'audience', label: '2. Audience' },
  { value: 'review', label: '3. Review and send' },
];

const localDateTime = (date: Date) => new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);

export const Editor = ({ initial, overview, onBack, onSaved }: { initial: Campaign; overview: Overview; onBack: () => void; onSaved: () => void }) => {
  const [campaign, setCampaign] = useState(initial);
  const [dirty, setDirty] = useState<Partial<Campaign>>({});
  const [step, setStep] = useState<Step>('setup');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ status: 'success' | 'error' | 'info'; text: string } | null>(null);
  const [problems, setProblems] = useState<string[] | null>(null);
  const [testTo, setTestTo] = useState('');
  const [later, setLater] = useState(false);
  const [sendAt, setSendAt] = useState(localDateTime(new Date(Date.now() + 3_600_000)));
  const email = campaign.channel === 'EMAIL';
  const verifiedDomains = overview.resend.domains.filter((domain) => domain.status === 'verified');

  const change = (changes: Partial<Campaign>) => {
    setCampaign((current) => ({ ...current, ...changes }));
    setDirty((current) => ({ ...current, ...changes }));
  };

  const save = async () => {
    if (Object.keys(dirty).length === 0) return true;
    setBusy(true);
    try {
      await callAdmin({ action: 'saveDraft', id: campaign.id, changes: dirty });
      setDirty({});
      return true;
    } catch (error) {
      setMessage({ status: 'error', text: (error as Error).message });
      return false;
    } finally {
      setBusy(false);
    }
  };

  const goTo = async (next: Step) => {
    if (!(await save())) return;
    setMessage(null);
    setStep(next);
    if (next === 'review') {
      setProblems(null);
      callAdmin<{ problems: string[] }>({ action: 'checks', id: campaign.id })
        .then((result) => setProblems(result.problems))
        .catch((error: Error) => setProblems([error.message]));
    }
  };

  const testSend = async () => {
    if (!(await save())) return;
    setBusy(true);
    try {
      const result = await callAdmin<{ sent: number }>({ action: 'testSend', id: campaign.id, to: testTo });
      setMessage({ status: 'success', text: `Test sent to ${result.sent} address${result.sent === 1 ? '' : 'es'}. Check the inbox (and the spam folder).` });
    } catch (error) {
      setMessage({ status: 'error', text: (error as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const schedule = async () => {
    if (!(await save())) return;
    setBusy(true);
    try {
      await callAdmin({ action: 'schedule', id: campaign.id, sendAt: later ? new Date(sendAt).toISOString() : null });
      onSaved();
    } catch (error) {
      setMessage({ status: 'error', text: (error as Error).message });
      setBusy(false);
    }
  };

  const audienceSize = (listId: string) => {
    if (listId === 'ALL') return email ? overview.audience.emailConsented : overview.audience.whatsappConsented;
    return overview.lists.find((list) => list.id === listId)?.memberCount ?? 0;
  };

  const steps = email ? EMAIL_STEPS : WHATSAPP_STEPS;
  const PageShell = step === 'design' ? Page : NarrowPage;

  return (
    <PageShell>
      <PageHeader
        title={campaign.name || 'Untitled campaign'}
        description={<StatusTag kind="channel" value={campaign.channel} />}
        actions={
          <Row>
            <QuietButton startIcon={<IconArrowLeft size={14} />} onClick={async () => (await save()) && onBack()}>
              All campaigns
            </QuietButton>
            <SecondaryButton disabled={busy || Object.keys(dirty).length === 0} onClick={save}>
              {Object.keys(dirty).length ? 'Save draft' : 'Saved'}
            </SecondaryButton>
          </Row>
        }
      />
      <SegmentedControl aria-label="Steps" size="sm" value={step} onValueChange={(value) => goTo(value as Step)} options={steps} />
      {message && <Callout status={message.status} title={message.status === 'error' ? 'That did not work' : 'Done'} description={message.text} />}

      {step === 'setup' && email && (
        <Panel title="Setup">
          <FieldLabel>
            <FieldTitle>Campaign name (only your team sees this)</FieldTitle>
            <Input value={campaign.name} onChange={(event) => change({ name: event.target.value })} />
          </FieldLabel>
          <FieldLabel>
            <FieldTitle>Subject line</FieldTitle>
            <Input value={campaign.subject} maxLength={250} placeholder="What will make people open it?" onChange={(event) => change({ subject: event.target.value })} />
            <Hint>{campaign.subject.length} characters. Under 50 reads best on phones. You can use {'{{firstName|there}}'}.</Hint>
          </FieldLabel>
          <FieldLabel>
            <FieldTitle>Preview text</FieldTitle>
            <Input value={campaign.previewText} maxLength={200} placeholder="The line shown after the subject in the inbox" onChange={(event) => change({ previewText: event.target.value })} />
          </FieldLabel>
          <FieldLabel>
            <FieldTitle>From name</FieldTitle>
            <Input value={campaign.fromName} placeholder={overview.brand.name || 'Your business'} onChange={(event) => change({ fromName: event.target.value })} />
          </FieldLabel>
          <FieldTitle>From address</FieldTitle>
          {verifiedDomains.length === 0 ? (
            <Callout status="warning" title="No verified sending domain" description={overview.resend.connected ? 'Add and verify your domain in Resend (Domains), then come back.' : 'Connect your Resend account under Settings, Accounts first.'} />
          ) : (
            <Row>
              <Input value={campaign.fromLocalPart} style={{ width: 160 }} onChange={(event) => change({ fromLocalPart: event.target.value.replace(/[^a-zA-Z0-9._+-]/g, '') })} />
              <Text>@</Text>
              <Select value={campaign.fromDomain} onChange={(event) => change({ fromDomain: event.target.value })}>
                <option value="">Choose a domain</option>
                {verifiedDomains.map((domain) => (
                  <option key={domain.id} value={domain.name}>
                    {domain.name}
                  </option>
                ))}
              </Select>
            </Row>
          )}
          <FieldLabel>
            <FieldTitle>Replies go to (optional)</FieldTitle>
            <Input type="email" value={campaign.replyTo} placeholder="you@yourbusiness.com" onChange={(event) => change({ replyTo: event.target.value })} />
          </FieldLabel>
          <Row>
            <PrimaryButton onClick={() => goTo('audience')}>Next: audience</PrimaryButton>
          </Row>
        </Panel>
      )}

      {step === 'setup' && !email && (
        <Panel title="WhatsApp message">
          {!overview.whatsappEnabled && <Callout status="warning" title="WhatsApp sending is not set up yet" description="It works once InventiveChat is connected to this CRM. You can prepare the campaign now." />}
          <FieldLabel>
            <FieldTitle>Campaign name (only your team sees this)</FieldTitle>
            <Input value={campaign.name} onChange={(event) => change({ name: event.target.value })} />
          </FieldLabel>
          <FieldLabel>
            <FieldTitle>Approved template name</FieldTitle>
            <Input value={campaign.whatsappTemplate} placeholder="spring_offer" onChange={(event) => change({ whatsappTemplate: event.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '') })} />
            <Hint>WhatsApp only allows marketing messages from templates Meta has approved. Create them in InventiveChat.</Hint>
          </FieldLabel>
          <FieldLabel>
            <FieldTitle>Template language</FieldTitle>
            <Input value={campaign.whatsappVariables.language ?? 'en'} style={{ width: 120 }} onChange={(event) => change({ whatsappVariables: { ...campaign.whatsappVariables, language: event.target.value } })} />
          </FieldLabel>
          {['1', '2', '3'].map((position) => (
            <FieldLabel key={position}>
              <FieldTitle>{`Value for {{${position}}}`}</FieldTitle>
              <Input value={campaign.whatsappVariables[position] ?? ''} placeholder={position === '1' ? '{{firstName}}' : ''} onChange={(event) => change({ whatsappVariables: { ...campaign.whatsappVariables, [position]: event.target.value } })} />
            </FieldLabel>
          ))}
          <Hint>Use {'{{firstName}}'} or {'{{lastName}}'} to personalise a value.</Hint>
          <Row>
            <PrimaryButton onClick={() => goTo('audience')}>Next: audience</PrimaryButton>
          </Row>
        </Panel>
      )}

      {step === 'audience' && (
        <Panel title="Who gets it">
          <RadioGroup value={campaign.listId} onValueChange={(value) => change({ listId: String(value) })}>
            <CheckboxLabel>
              <Radio value="ALL" />
              Everyone who agreed to {email ? 'marketing emails' : 'WhatsApp marketing'} ({audienceSize('ALL')})
            </CheckboxLabel>
            {overview.lists.map((list) => (
              <CheckboxLabel key={list.id}>
                <Radio value={list.id} />
                {list.name} ({list.memberCount ?? 0} contacts)
              </CheckboxLabel>
            ))}
          </RadioGroup>
          <Hint>
            Only contacts who ticked "{email ? 'Agreed to marketing emails' : 'Agreed to marketing on WhatsApp'}" on their record get it. People on the do-not-contact list and duplicate addresses are skipped
            automatically.
          </Hint>
          <Row>
            <PrimaryButton disabled={!campaign.listId} onClick={() => goTo(email ? 'design' : 'review')}>
              Next: {email ? 'design' : 'review'}
            </PrimaryButton>
          </Row>
        </Panel>
      )}

      {step === 'design' && email && (
        <Stack>
          <Designer design={campaign.design} brand={overview.brand} subject={campaign.subject} previewText={campaign.previewText} onChange={(design: Design) => change({ design })} />
          <Row>
            <SecondaryButton
              disabled={busy}
              onClick={async () => {
                const name = campaign.name ? `${campaign.name} template` : 'My template';
                try {
                  await callAdmin({ action: 'saveTemplate', name, category: 'OTHER', design: campaign.design });
                  setMessage({ status: 'success', text: `Saved as the template "${name}". Rename it under Campaigns, Templates.` });
                } catch (error) {
                  setMessage({ status: 'error', text: (error as Error).message });
                }
              }}
            >
              Save as template
            </SecondaryButton>
            <PrimaryButton onClick={() => goTo('review')}>Next: review</PrimaryButton>
          </Row>
        </Stack>
      )}

      {step === 'review' && (
        <>
          <Panel title="Checklist">
            {problems === null ? (
              <Hint>Checking…</Hint>
            ) : problems.length === 0 ? (
              <Callout status="success" title="Ready to send" description={`Goes to ${campaign.listName || 'the chosen audience'}, only to contacts who agreed.`} />
            ) : (
              <Callout
                status="warning"
                title={`${problems.length} thing${problems.length === 1 ? '' : 's'} to fix before sending`}
                description={
                  <Stack>
                    {problems.map((problem) => (
                      <span key={problem}>{problem}</span>
                    ))}
                  </Stack>
                }
              />
            )}
          </Panel>
          {email && (
            <Panel title="Send a test">
              <FieldLabel>
                <FieldTitle>Send a test to (up to five addresses, comma separated)</FieldTitle>
                <Input value={testTo} placeholder="you@yourbusiness.com" onChange={(event) => setTestTo(event.target.value)} />
              </FieldLabel>
              <Row>
                <SecondaryButton disabled={busy || !testTo.trim()} onClick={testSend}>
                  Send test
                </SecondaryButton>
              </Row>
            </Panel>
          )}
          <Panel title="When">
            <RadioGroup value={later ? 'later' : 'now'} onValueChange={(value) => setLater(value === 'later')}>
              <CheckboxLabel>
                <Radio value="now" />
                Send now
              </CheckboxLabel>
              <CheckboxLabel>
                <Radio value="later" />
                Schedule for later
              </CheckboxLabel>
            </RadioGroup>
            {later && <Input type="datetime-local" value={sendAt} min={localDateTime(new Date())} onChange={(event) => setSendAt(event.target.value)} />}
            <Row>
              <PrimaryButton disabled={busy || !problems || problems.length > 0} onClick={schedule}>
                {later ? 'Schedule campaign' : 'Send campaign'}
              </PrimaryButton>
            </Row>
            <Hint>Sending starts within two minutes and goes out in batches. You can stop it from the report while it is sending.</Hint>
          </Panel>
        </>
      )}
    </PageShell>
  );
};
