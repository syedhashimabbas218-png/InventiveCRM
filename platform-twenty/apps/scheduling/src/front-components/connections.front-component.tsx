import { useEffect, useState } from 'react';
import { defineFrontComponent } from 'twenty-sdk/define';
import { AppPath, enqueueSnackbar, navigate } from 'twenty-sdk/front-component';
import { Callout } from 'twenty-ui/components/feedback';
import { IconCalendar, IconExternalLink, IconRefresh } from 'twenty-ui/icon';

import { IDS } from 'src/constants/ids';
import {
  GOOGLE_API_USER_DATA_POLICY_URL,
  GOOGLE_REVOKE_URL,
  MICROSOFT_PERSONAL_REVOKE_URL,
  MICROSOFT_WORK_REVOKE_URL,
  PRIVACY_POLICY_URL,
} from 'src/constants/legal';
import {
  callAdmin,
  CheckboxLabel,
  ColorTag,
  Divided,
  ErrorState,
  FieldLabel,
  FieldTitle,
  Hint,
  LoadingState,
  NarrowPage,
  PageHeader,
  Panel,
  PrimaryButton,
  Row,
  SecondaryButton,
  Select,
  Stack,
  StatusTag,
} from 'src/front-components/shared';

type Connection = {
  id: string;
  name: string;
  provider: 'GOOGLE' | 'MICROSOFT';
  status: string;
  availabilityCalendarIds: string[] | null;
  bookingCalendarId: string;
  conferencing: string;
  calendars: { id: string; name: string; primary: boolean; canWrite: boolean }[];
  error: string;
  missingPermissions: string[];
  authFailed: boolean;
};

type Data = { advisor: { id: string; name: string } | null; applicationId: string | null; connections: Connection[] };

const openAccounts = (applicationId: string | null) => applicationId && navigate(AppPath.SettingsCatchAll, { '*': `accounts/applications/${applicationId}` });

const ExternalLink = ({ href, children }: { href: string; children: string }) => (
  <a href={href} target="_blank" rel="noreferrer">
    {children}
  </a>
);

// Shown before anyone connects, as Google and Microsoft require: what is read, what is written, what is never done.
const DataUse = () => (
  <Panel title="How your calendar is used">
    <Hint>Busy times only: the start and end of events on the calendars you tick, so customers are never offered a time you are busy. Titles, descriptions and attendees of your own events are not read.</Hint>
    <Hint>Bookings: an event for each appointment is created, moved or removed on the one calendar you choose, which must be a calendar you own. Nothing else in your calendar is changed.</Hint>
    <Hint>Never: no access to email or contacts; calendar data is not shown to customers, sold, used for advertising or used to train AI models.</Hint>
    <Hint>
      Sign-in tokens are stored encrypted by the CRM. Disconnect any time under Settings, Accounts; the app then deletes the address and calendar choices it kept. You can also remove access at{' '}
      <ExternalLink href={GOOGLE_REVOKE_URL}>Google</ExternalLink>, <ExternalLink href={MICROSOFT_PERSONAL_REVOKE_URL}>Microsoft (personal)</ExternalLink> or{' '}
      <ExternalLink href={MICROSOFT_WORK_REVOKE_URL}>Microsoft (work or school)</ExternalLink>.
    </Hint>
    <Hint>
      Use of information received from Google APIs adheres to the <ExternalLink href={GOOGLE_API_USER_DATA_POLICY_URL}>Google API Services User Data Policy</ExternalLink>, including
      the Limited Use requirements. Read the <ExternalLink href={PRIVACY_POLICY_URL}>privacy policy</ExternalLink>.
    </Hint>
  </Panel>
);

const ConnectionCard = ({ connection, onSaved, applicationId }: { connection: Connection; onSaved: () => void; applicationId: string | null }) => {
  const [blocking, setBlocking] = useState<string[]>(connection.availabilityCalendarIds ?? []);
  const [booking, setBooking] = useState(connection.bookingCalendarId);
  const [conferencing, setConferencing] = useState(connection.conferencing);
  const [saving, setSaving] = useState(false);
  const save = async () => {
    setSaving(true);
    try {
      await callAdmin({ action: 'saveConnection', settingId: connection.id, availabilityCalendarIds: blocking, bookingCalendarId: booking, conferencing });
      enqueueSnackbar({ message: 'Saved', variant: 'success' });
      onSaved();
    } catch (error) {
      enqueueSnackbar({ message: (error as Error).message, variant: 'error' });
    } finally {
      setSaving(false);
    }
  };
  const test = async () => {
    try {
      const result = await callAdmin<{ ok: boolean; message: string }>({ action: 'testConnection', settingId: connection.id });
      enqueueSnackbar({ message: result.message, variant: result.ok ? 'success' : 'error' });
    } catch (error) {
      enqueueSnackbar({ message: (error as Error).message, variant: 'error' });
    }
  };
  const reconnect = <SecondaryButton onClick={() => openAccounts(applicationId)}>Reconnect</SecondaryButton>;
  const owned = connection.calendars.filter((calendar) => calendar.canWrite);
  return (
    <Panel
      title={connection.name}
      action={
        <Row>
          <ColorTag color={connection.provider === 'GOOGLE' ? 'blue' : 'sky'}>{connection.provider === 'GOOGLE' ? 'Google Calendar' : 'Microsoft Outlook'}</ColorTag>
          <StatusTag kind="connection" value={connection.status} />
        </Row>
      }
    >
      {connection.missingPermissions.length > 0 ? (
        <Callout status="warning" title="Some permissions were not granted" description={connection.error} action={reconnect} />
      ) : (
        (connection.authFailed || connection.status === 'NEEDS_RECONNECT') && (
          <Callout status="error" title="Sign-in expired or access was revoked" description="Bookings that need this calendar are paused until you reconnect." action={reconnect} />
        )
      )}
      {connection.error && connection.missingPermissions.length === 0 && <Callout status="warning" title="The calendar did not answer" description={connection.error} />}
      {connection.calendars.length > 0 && (
        <>
          <Stack>
            <FieldTitle>Calendars that block my availability</FieldTitle>
            {connection.calendars.map((calendar) => (
              <CheckboxLabel key={calendar.id}>
                <input
                  type="checkbox"
                  checked={blocking.includes(calendar.id)}
                  onChange={(event) => setBlocking(event.target.checked ? [...blocking, calendar.id] : blocking.filter((id) => id !== calendar.id))}
                />
                {calendar.name}
                {calendar.primary && <Hint>(primary)</Hint>}
              </CheckboxLabel>
            ))}
          </Stack>
          <Divided>
            <Row>
              <FieldLabel>
                <FieldTitle>New bookings go to</FieldTitle>
                <Select value={booking} onChange={(event) => setBooking(event.target.value)}>
                  {owned.map((calendar) => (
                    <option key={calendar.id} value={calendar.id}>
                      {calendar.name}
                    </option>
                  ))}
                </Select>
              </FieldLabel>
              <FieldLabel>
                <FieldTitle>Video meetings</FieldTitle>
                <Select value={conferencing} onChange={(event) => setConferencing(event.target.value)}>
                  <option value="NONE">None</option>
                  {connection.provider === 'GOOGLE' ? <option value="GOOGLE_MEET">Google Meet</option> : <option value="MICROSOFT_TEAMS">Microsoft Teams</option>}
                </Select>
              </FieldLabel>
            </Row>
            {owned.length < connection.calendars.length && <Hint>Only calendars you own can receive bookings. Shared calendars can still block your time.</Hint>}
          </Divided>
          <Row>
            <PrimaryButton loading={saving} disabled={saving} onClick={save}>
              Save
            </PrimaryButton>
            <SecondaryButton onClick={test}>Test connection</SecondaryButton>
          </Row>
        </>
      )}
    </Panel>
  );
};

const Connections = () => {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState('');
  const load = () =>
    callAdmin<Data>({ action: 'connections' })
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
      <NarrowPage>
        <ErrorState message={error} onRetry={load} />
      </NarrowPage>
    );
  if (!data)
    return (
      <NarrowPage>
        <LoadingState />
      </NarrowPage>
    );
  return (
    <NarrowPage>
      <PageHeader
        title="Calendar connections"
        description="Connect Google, Microsoft or both. Without a connection, only bookings in the CRM block your time."
        actions={
          <Row>
            <SecondaryButton startIcon={<IconRefresh size={14} />} onClick={load}>
              Refresh
            </SecondaryButton>
            {data.advisor && (
              <PrimaryButton startIcon={<IconCalendar size={14} />} onClick={() => openAccounts(data.applicationId)}>
                Connect Google or Microsoft
              </PrimaryButton>
            )}
          </Row>
        }
      />
      {!data.advisor ? (
        <Callout status="info" title="Create your advisor profile first" description="Calendars are attached to your advisor profile. Create it on the Scheduling overview." />
      ) : (
        <>
          {data.connections.length === 0 && <Hint>No calendars connected yet.</Hint>}
          {data.connections.map((connection) => (
            <ConnectionCard key={connection.id} connection={connection} onSaved={load} applicationId={data.applicationId} />
          ))}
        </>
      )}
      <DataUse />
      <Hint>
        <IconExternalLink size={12} /> Connecting opens your account settings, where Google or Microsoft asks you to allow access.
      </Hint>
    </NarrowPage>
  );
};

export default defineFrontComponent({
  universalIdentifier: IDS.frontComponents.connections,
  name: 'scheduling-calendar-connections',
  description: 'Connect Google and Microsoft calendars and choose which calendars block time and receive bookings.',
  component: Connections,
});
