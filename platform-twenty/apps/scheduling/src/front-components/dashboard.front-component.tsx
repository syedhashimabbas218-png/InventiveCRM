import { useEffect, useState } from 'react';
import { defineFrontComponent } from 'twenty-sdk/define';
import { AppPath, copyToClipboard, enqueueSnackbar, navigate } from 'twenty-sdk/front-component';

import { IDS } from 'src/constants/ids';
import { Button, callAdmin, Card, label, Pill, STATUS_COLORS, type Theme, useTheme, when } from 'src/front-components/shared';

type Row = {
  id: string;
  title: string;
  status: string;
  startsAt: string;
  endsAt: string;
  customerName: string;
  meetingFormat: string;
  location: string;
  calendarStatus: string;
  advisor: { id: string; name: string } | null;
  appointmentType: { name: string; color: string } | null;
};

type Overview = {
  member: { name: string; email: string };
  advisor: { id: string; name: string; personalUrl: string | null } | null;
  today: Row[];
  mine: Row[];
  team: Row[];
  recent: { name: string; occurredAt: string; actor: string; appointment: { title: string; customerName: string; startsAt: string } | null }[];
  connections: { id: string; name: string; provider: string; status: string }[];
  failingSyncs: number;
  bookingPages: { kind: string; name: string; status: string; detail: string; url: string; embed: { inline: string; popup: string; floating: string }; mine: boolean }[];
};

const ACTIVITY: Record<string, string> = {
  'appointment.created': 'Booked',
  'appointment.cancelled': 'Cancelled',
  'appointment.rescheduled': 'Rescheduled',
  'advisor.assigned': 'Assigned',
};

const openRecord = (id: string) => navigate(AppPath.RecordShowPage, { objectNameSingular: 'appointment', objectRecordId: id });
const openList = (objectNamePlural: string) => navigate(AppPath.RecordIndexPage, { objectNamePlural });

const copy = (text: string, what: string) => {
  copyToClipboard(text);
  enqueueSnackbar({ message: `${what} copied`, variant: 'success' });
};

const AppointmentList = ({ theme, rows, empty }: { theme: Theme; rows: Row[]; empty: string }) =>
  rows.length === 0 ? (
    <p style={{ margin: 0, color: theme.muted, fontSize: 13 }}>{empty}</p>
  ) : (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {rows.slice(0, 12).map((row) => (
        <button
          key={row.id}
          onClick={() => openRecord(row.id)}
          style={{ all: 'unset', cursor: 'pointer', display: 'grid', gridTemplateColumns: '120px 1fr auto', gap: 10, alignItems: 'center', padding: '8px 0', borderTop: `1px solid ${theme.line}`, fontSize: 13, color: theme.text }}
        >
          <span style={{ color: theme.muted }}>{when(row.startsAt)}</span>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 4, background: row.appointmentType?.color || theme.accent, marginRight: 8 }} />
            {row.customerName || row.title} · {row.appointmentType?.name ?? ''}
            <span style={{ color: theme.muted }}>{row.advisor ? ` · ${row.advisor.name}` : ''}{row.location ? ` · ${row.location}` : ''}</span>
          </span>
          <span style={{ display: 'flex', gap: 6 }}>
            <Pill color={STATUS_COLORS[row.status] ?? theme.muted}>{label(row.status)}</Pill>
            {row.calendarStatus !== 'NOT_CONNECTED' && <Pill color={STATUS_COLORS[row.calendarStatus] ?? theme.muted}>{row.calendarStatus === 'SYNCED' ? 'In calendar' : label(row.calendarStatus)}</Pill>}
          </span>
        </button>
      ))}
    </div>
  );

const ManualBooking = ({ theme, onDone }: { theme: Theme; onDone: () => void }) => {
  const [types, setTypes] = useState<{ id: string; name: string }[]>([]);
  const [form, setForm] = useState({ appointmentTypeId: '', start: '', name: '', email: '', phone: '' });
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    fetch(`${process.env.TWENTY_API_URL}/graphql`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.TWENTY_APP_ACCESS_TOKEN ?? ''}` },
      body: JSON.stringify({ query: '{ appointmentTypes(filter: { status: { neq: DISABLED } }, first: 100) { edges { node { id name } } } }' }),
    })
      .then((response) => response.json())
      .then((payload) => setTypes((payload.data?.appointmentTypes?.edges ?? []).map((edge: { node: { id: string; name: string } }) => edge.node)))
      .catch(() => setTypes([]));
  }, []);
  const input = { font: 'inherit', fontSize: 13, padding: '6px 8px', borderRadius: 6, border: `1px solid ${theme.line}`, background: theme.card, color: theme.text } as const;
  const submit = async () => {
    setBusy(true);
    try {
      const result = await callAdmin<{ advisorName: string; start: string }>({
        action: 'manualBook',
        appointmentTypeId: form.appointmentTypeId,
        start: new Date(form.start).toISOString(),
        customer: { name: form.name, email: form.email, phone: form.phone },
      });
      enqueueSnackbar({ message: `Booked with ${result.advisorName} on ${when(result.start)}`, variant: 'success' });
      onDone();
    } catch (error) {
      enqueueSnackbar({ message: (error as Error).message, variant: 'error' });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 8, alignItems: 'end' }}>
      <select style={input} value={form.appointmentTypeId} onChange={(event) => setForm({ ...form, appointmentTypeId: event.target.value })}>
        <option value="">Appointment type</option>
        {types.map((type) => (
          <option key={type.id} value={type.id}>
            {type.name}
          </option>
        ))}
      </select>
      <input style={input} type="datetime-local" value={form.start} onChange={(event) => setForm({ ...form, start: event.target.value })} />
      <input style={input} placeholder="Customer name" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
      <input style={input} placeholder="Customer email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} />
      <input style={input} placeholder="Phone (optional)" value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} />
      <Button theme={theme} primary disabled={busy || !form.appointmentTypeId || !form.start || !form.name || !form.email} onClick={submit}>
        {busy ? 'Booking…' : 'Book'}
      </Button>
    </div>
  );
};

const Dashboard = () => {
  const theme = useTheme();
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState('');
  const [scope, setScope] = useState<'mine' | 'team'>('mine');
  const [showManual, setShowManual] = useState(false);
  const [embedFor, setEmbedFor] = useState<string | null>(null);

  const load = () =>
    callAdmin<Overview>({ action: 'overview' })
      .then((result) => {
        setData(result);
        setError('');
        if (!result.advisor) setScope('team');
      })
      .catch((loadError: Error) => setError(loadError.message));
  useEffect(() => {
    load();
  }, []);

  const setup = async () => {
    try {
      await callAdmin({ action: 'setupAdvisor' });
      enqueueSnackbar({ message: 'Your advisor profile and Mon to Fri, 9 to 5 working hours are set up', variant: 'success' });
      load();
    } catch (setupError) {
      enqueueSnackbar({ message: (setupError as Error).message, variant: 'error' });
    }
  };

  const page = { fontFamily: 'Inter, sans-serif', color: theme.text, padding: 16, display: 'flex', flexDirection: 'column' as const, gap: 12, fontSize: 13 };
  if (error) return <div style={page}><p style={{ color: theme.danger }}>Could not load scheduling: {error}</p><Button theme={theme} onClick={load}>Try again</Button></div>;
  if (!data) return <div style={page}><p style={{ color: theme.muted }}>Loading…</p></div>;

  const upcoming = (scope === 'mine' ? data.mine : data.team).filter((row) => Date.parse(row.endsAt) >= Date.now());
  const needsAttention = data.connections.filter((connection) => connection.status !== 'CONNECTED');

  return (
    <div style={page}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 18 }}>Scheduling</h2>
          <span style={{ color: theme.muted }}>
            {data.today.length} today · {data.team.length} in the next two weeks
          </span>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {data.advisor?.personalUrl && <Button theme={theme} onClick={() => copy(data.advisor?.personalUrl ?? '', 'Your booking link')}>Copy my booking link</Button>}
          <Button theme={theme} onClick={() => openList('appointmentTypes')}>Appointment types</Button>
          <Button theme={theme} primary onClick={() => setShowManual(!showManual)}>Schedule an appointment</Button>
        </div>
      </div>

      {!data.advisor && (
        <Card theme={theme} title="Take bookings yourself">
          <span style={{ color: theme.muted }}>You do not have an advisor profile yet. Create one with default working hours, then adjust them under Availability.</span>
          <div>
            <Button theme={theme} primary onClick={setup}>Create my advisor profile</Button>
          </div>
        </Card>
      )}
      {(needsAttention.length > 0 || data.failingSyncs > 0) && (
        <Card theme={theme} title="Needs attention" style={{ borderColor: theme.danger }}>
          {needsAttention.map((connection) => (
            <span key={connection.id}>
              {connection.name}: <Pill color={STATUS_COLORS[connection.status] ?? theme.muted}>{label(connection.status)}</Pill>
            </span>
          ))}
          {data.failingSyncs > 0 && <span>{data.failingSyncs} appointment(s) could not be written to a calendar. See Calendar sync queue.</span>}
        </Card>
      )}
      {showManual && (
        <Card theme={theme} title="Schedule an appointment">
          <ManualBooking
            theme={theme}
            onDone={() => {
              setShowManual(false);
              load();
            }}
          />
        </Card>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 12 }}>
        <Card theme={theme} title="Today">
          <AppointmentList theme={theme} rows={data.today} empty="Nothing booked today." />
        </Card>
        <Card
          theme={theme}
          title="Upcoming"
          action={
            <div style={{ display: 'flex', gap: 4 }}>
              {data.advisor && <Button theme={theme} primary={scope === 'mine'} onClick={() => setScope('mine')}>Mine</Button>}
              <Button theme={theme} primary={scope === 'team'} onClick={() => setScope('team')}>Team</Button>
            </div>
          }
        >
          <AppointmentList theme={theme} rows={upcoming} empty="No upcoming appointments." />
        </Card>
        <Card theme={theme} title="Calendar connections" action={<Button theme={theme} onClick={() => navigate(AppPath.RecordIndexPage, { objectNamePlural: 'calendarSettings' })}>Manage</Button>}>
          {data.connections.length === 0 ? (
            <span style={{ color: theme.muted }}>No calendar connected: only Twenty bookings block your time. Connect Google or Microsoft under Scheduling, Calendar connections.</span>
          ) : (
            data.connections.map((connection) => (
              <div key={connection.id} style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>{connection.name}</span>
                <Pill color={STATUS_COLORS[connection.status] ?? theme.muted}>{label(connection.status)}</Pill>
              </div>
            ))
          )}
        </Card>
        <Card theme={theme} title="Recent bookings and changes">
          {data.recent.length === 0 ? (
            <span style={{ color: theme.muted }}>No activity yet.</span>
          ) : (
            data.recent.map((event, index) => (
              <div key={index} style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                <span>
                  <strong>{ACTIVITY[event.name] ?? event.name}</strong> {event.appointment ? `${event.appointment.customerName}, ${when(event.appointment.startsAt)}` : ''}
                </span>
                <span style={{ color: theme.muted }}>{when(event.occurredAt, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
              </div>
            ))
          )}
        </Card>
      </div>

      <Card theme={theme} title="Booking pages" action={<Button theme={theme} onClick={() => openList('bookingLinks')}>Booking links</Button>}>
        {data.bookingPages.length === 0 && <span style={{ color: theme.muted }}>Create an appointment type and set it to Active to get a booking page.</span>}
        {data.bookingPages.map((page) => (
          <div key={page.url} style={{ borderTop: `1px solid ${theme.line}`, paddingTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span>
                <strong>{page.name}</strong> <span style={{ color: theme.muted }}>{page.detail}</span>
              </span>
              <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <Pill color={STATUS_COLORS[page.status] ?? theme.muted}>{label(page.status)}</Pill>
                <Button theme={theme} onClick={() => copy(page.url, 'Booking link')}>Copy link</Button>
                <Button theme={theme} onClick={() => setEmbedFor(embedFor === page.url ? null : page.url)}>Embed</Button>
              </span>
            </div>
            {embedFor === page.url && (
              <div style={{ display: 'grid', gap: 6 }}>
                {(['inline', 'popup', 'floating'] as const).map((kind) => (
                  <div key={kind} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                    <pre style={{ flex: 1, margin: 0, padding: 8, background: theme.soft, borderRadius: 6, fontSize: 11, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{page.embed[kind]}</pre>
                    <Button theme={theme} onClick={() => copy(page.embed[kind], `${label(kind)} embed code`)}>Copy {kind}</Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </Card>
    </div>
  );
};

export default defineFrontComponent({
  universalIdentifier: IDS.frontComponents.dashboard,
  name: 'scheduling-dashboard',
  description: 'Scheduling overview: today, upcoming appointments, connections, activity and booking pages.',
  component: Dashboard,
});
