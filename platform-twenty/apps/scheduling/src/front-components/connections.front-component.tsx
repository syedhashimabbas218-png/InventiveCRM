import { useEffect, useState } from 'react';
import { defineFrontComponent } from 'twenty-sdk/define';
import { AppPath, enqueueSnackbar, navigate } from 'twenty-sdk/front-component';

import { IDS } from 'src/constants/ids';
import { Button, callAdmin, Card, label, Pill, STATUS_COLORS, useTheme } from 'src/front-components/shared';

type Connection = {
  id: string;
  name: string;
  provider: 'GOOGLE' | 'MICROSOFT';
  status: string;
  lastError?: string;
  availabilityCalendarIds: string[] | null;
  bookingCalendarId: string;
  conferencing: string;
  calendars: { id: string; name: string; primary: boolean; canWrite: boolean }[];
  error: string;
  authFailed: boolean;
};

type Data = { advisor: { id: string; name: string } | null; applicationId: string | null; connections: Connection[] };

const ConnectionCard = ({ connection, onSaved, applicationId }: { connection: Connection; onSaved: () => void; applicationId: string | null }) => {
  const theme = useTheme();
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
  const select = { font: 'inherit', fontSize: 13, padding: '5px 8px', borderRadius: 6, border: `1px solid ${theme.line}`, background: theme.card, color: theme.text } as const;
  return (
    <Card theme={theme} title={connection.name} action={<Pill color={STATUS_COLORS[connection.status] ?? theme.muted}>{label(connection.status)}</Pill>}>
      {(connection.authFailed || connection.status === 'NEEDS_RECONNECT') && (
        <div style={{ color: theme.danger }}>
          Sign-in expired or access was revoked. Bookings that need this calendar are paused until you reconnect.{' '}
          <Button theme={theme} onClick={() => applicationId && navigate(AppPath.SettingsCatchAll, { '*': `accounts/applications/${applicationId}` })}>Reconnect</Button>
        </div>
      )}
      {connection.error && <div style={{ color: theme.warn }}>{connection.error}</div>}
      {connection.calendars.length > 0 && (
        <>
          <div>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>Calendars that block my availability</div>
            {connection.calendars.map((calendar) => (
              <label key={calendar.id} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '3px 0' }}>
                <input
                  type="checkbox"
                  checked={blocking.includes(calendar.id)}
                  onChange={(event) => setBlocking(event.target.checked ? [...blocking, calendar.id] : blocking.filter((id) => id !== calendar.id))}
                />
                {calendar.name}
                {calendar.primary ? <span style={{ color: theme.muted }}>(primary)</span> : null}
              </label>
            ))}
          </div>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontWeight: 600 }}>New bookings go to</span>
            <select style={select} value={booking} onChange={(event) => setBooking(event.target.value)}>
              {connection.calendars
                .filter((calendar) => calendar.canWrite)
                .map((calendar) => (
                  <option key={calendar.id} value={calendar.id}>
                    {calendar.name}
                  </option>
                ))}
            </select>
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontWeight: 600 }}>Video meetings</span>
            <select style={select} value={conferencing} onChange={(event) => setConferencing(event.target.value)}>
              <option value="NONE">None</option>
              {connection.provider === 'GOOGLE' ? <option value="GOOGLE_MEET">Google Meet</option> : <option value="MICROSOFT_TEAMS">Microsoft Teams</option>}
            </select>
          </label>
          <div style={{ display: 'flex', gap: 8 }}>
            <Button theme={theme} primary disabled={saving} onClick={save}>
              {saving ? 'Saving…' : 'Save'}
            </Button>
            <Button theme={theme} onClick={test}>Test connection</Button>
          </div>
        </>
      )}
    </Card>
  );
};

const Connections = () => {
  const theme = useTheme();
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
  const connect = () => data?.applicationId && navigate(AppPath.SettingsCatchAll, { '*': `accounts/applications/${data.applicationId}` });
  const page = { fontFamily: 'Inter, sans-serif', color: theme.text, padding: 16, display: 'flex', flexDirection: 'column' as const, gap: 12, fontSize: 13, maxWidth: 760 };
  if (error) return <div style={page}><p style={{ color: theme.danger }}>{error}</p></div>;
  if (!data) return <div style={page}><p style={{ color: theme.muted }}>Loading…</p></div>;
  if (!data.advisor)
    return (
      <div style={page}>
        <p>Create your advisor profile on the Scheduling overview first; calendars are attached to it.</p>
      </div>
    );
  return (
    <div style={page}>
      <div>
        <h2 style={{ margin: 0, fontSize: 18 }}>Calendar connections</h2>
        <p style={{ color: theme.muted, margin: '4px 0 0' }}>
          Connect Google, Microsoft or both. Busy times from the calendars you tick block bookings; event details are never read or shown to
          customers. Without a connection, only bookings in the CRM block your time.
        </p>
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <Button theme={theme} primary onClick={connect}>Connect Google or Microsoft</Button>
        <Button theme={theme} onClick={load}>Refresh</Button>
      </div>
      {data.connections.length === 0 && <span style={{ color: theme.muted }}>No calendars connected yet.</span>}
      {data.connections.map((connection) => (
        <ConnectionCard key={connection.id} connection={connection} onSaved={load} applicationId={data.applicationId} />
      ))}
    </div>
  );
};

export default defineFrontComponent({
  universalIdentifier: IDS.frontComponents.connections,
  name: 'scheduling-calendar-connections',
  description: 'Connect Google and Microsoft calendars and choose which calendars block time and receive bookings.',
  component: Connections,
});
