import { useEffect, useState } from 'react';
import { defineFrontComponent } from 'twenty-sdk/define';
import { enqueueSnackbar } from 'twenty-sdk/front-component';

import { IDS } from 'src/constants/ids';
import { Button, callAdmin, Card, Pill, type Theme, useTheme } from 'src/front-components/shared';

type TimeWindow = { start: string; end: string };
type Override = { id: string; name: string; startDate: string; endDate: string; kind: string; windows: TimeWindow[] | null };
type Data = {
  advisor: { id: string; name: string; dailyLimit: number | null; weeklyLimit: number | null };
  schedule: { id: string; name: string; timeZone: string; weeklyHours: Record<string, TimeWindow[]> };
  overrides: Override[];
};

const DAYS = [
  ['mon', 'Monday'],
  ['tue', 'Tuesday'],
  ['wed', 'Wednesday'],
  ['thu', 'Thursday'],
  ['fri', 'Friday'],
  ['sat', 'Saturday'],
  ['sun', 'Sunday'],
] as const;

const ZONES = ['Europe/London', 'Europe/Dublin', 'Europe/Paris', 'Europe/Berlin', 'America/New_York', 'America/Chicago', 'America/Los_Angeles', 'Asia/Dubai', 'Asia/Karachi', 'Asia/Kolkata', 'Asia/Singapore', 'Australia/Sydney', 'UTC'];

const inputStyle = (theme: Theme) => ({ font: 'inherit', fontSize: 13, padding: '5px 8px', borderRadius: 6, border: `1px solid ${theme.line}`, background: theme.card, color: theme.text }) as const;

const WindowsEditor = ({ theme, windows, onChange }: { theme: Theme; windows: TimeWindow[]; onChange: (windows: TimeWindow[]) => void }) => (
  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
    {windows.map((window, index) => (
      <span key={index} style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
        <input aria-label="From" type="time" style={inputStyle(theme)} value={window.start} onChange={(event) => onChange(windows.map((item, at) => (at === index ? { ...item, start: event.target.value } : item)))} />
        <span style={{ color: theme.muted }}>to</span>
        <input aria-label="To" type="time" style={inputStyle(theme)} value={window.end === '24:00' ? '23:59' : window.end} onChange={(event) => onChange(windows.map((item, at) => (at === index ? { ...item, end: event.target.value === '23:59' ? '24:00' : event.target.value } : item)))} />
        <Button theme={theme} onClick={() => onChange(windows.filter((_, at) => at !== index))}>Remove</Button>
      </span>
    ))}
    {windows.length < 8 && (
      <Button theme={theme} onClick={() => onChange([...windows, windows.length ? { start: '13:00', end: '17:00' } : { start: '09:00', end: '17:00' }])}>
        {windows.length ? 'Add hours' : 'Set hours'}
      </Button>
    )}
  </div>
);

const TimeOff = ({ theme, overrides, onChanged }: { theme: Theme; overrides: Override[]; onChanged: () => void }) => {
  const today = new Date().toISOString().slice(0, 10);
  const [form, setForm] = useState({ name: '', startDate: today, endDate: today, kind: 'UNAVAILABLE' });
  const [windows, setWindows] = useState<TimeWindow[]>([{ start: '10:00', end: '14:00' }]);
  const [busy, setBusy] = useState(false);
  const run = async (body: Record<string, unknown>, message: string) => {
    setBusy(true);
    try {
      await callAdmin(body);
      enqueueSnackbar({ message, variant: 'success' });
      onChanged();
    } catch (error) {
      enqueueSnackbar({ message: (error as Error).message, variant: 'error' });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card theme={theme} title="Time off and special hours">
      {overrides.length === 0 && <span style={{ color: theme.muted }}>Nothing planned. Add holidays, a day off, or different hours for a date.</span>}
      {overrides.map((override) => (
        <div key={override.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, borderTop: `1px solid ${theme.line}`, paddingTop: 8 }}>
          <span>
            <strong>{override.name}</strong> <span style={{ color: theme.muted }}>{override.startDate === override.endDate ? override.startDate : `${override.startDate} to ${override.endDate}`}</span>{' '}
            <Pill color={override.kind === 'UNAVAILABLE' ? theme.danger : theme.accent}>{override.kind === 'UNAVAILABLE' ? 'Unavailable' : (override.windows ?? []).map((window) => `${window.start} to ${window.end}`).join(', ')}</Pill>
          </span>
          <Button theme={theme} disabled={busy} onClick={() => run({ action: 'removeOverride', id: override.id }, 'Removed')}>Remove</Button>
        </div>
      ))}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', borderTop: `1px solid ${theme.line}`, paddingTop: 10 }}>
        <input style={inputStyle(theme)} placeholder="Reason (optional)" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
        <input aria-label="First day" type="date" style={inputStyle(theme)} value={form.startDate} onChange={(event) => setForm({ ...form, startDate: event.target.value, endDate: form.endDate < event.target.value ? event.target.value : form.endDate })} />
        <input aria-label="Last day" type="date" style={inputStyle(theme)} value={form.endDate} onChange={(event) => setForm({ ...form, endDate: event.target.value })} />
        <select aria-label="Kind" style={inputStyle(theme)} value={form.kind} onChange={(event) => setForm({ ...form, kind: event.target.value })}>
          <option value="UNAVAILABLE">Unavailable all day</option>
          <option value="CUSTOM_HOURS">Different hours</option>
        </select>
        {form.kind === 'CUSTOM_HOURS' && <WindowsEditor theme={theme} windows={windows} onChange={setWindows} />}
        <Button theme={theme} primary disabled={busy} onClick={() => run({ action: 'addOverride', ...form, windows: form.kind === 'CUSTOM_HOURS' ? windows : [] }, 'Added')}>
          Add
        </Button>
      </div>
    </Card>
  );
};

const Availability = () => {
  const theme = useTheme();
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState('');
  const [hours, setHours] = useState<Record<string, TimeWindow[]>>({});
  const [timeZone, setTimeZone] = useState('Europe/London');
  const [limits, setLimits] = useState({ dailyLimit: '', weeklyLimit: '' });
  const [saving, setSaving] = useState(false);

  const load = () =>
    callAdmin<Data>({ action: 'availability' })
      .then((result) => {
        setData(result);
        setHours(result.schedule.weeklyHours);
        setTimeZone(result.schedule.timeZone || 'Europe/London');
        setLimits({ dailyLimit: result.advisor.dailyLimit ? String(result.advisor.dailyLimit) : '', weeklyLimit: result.advisor.weeklyLimit ? String(result.advisor.weeklyLimit) : '' });
        setError('');
      })
      .catch((loadError: Error) => setError(loadError.message));
  useEffect(() => {
    load();
  }, []);

  const save = async () => {
    setSaving(true);
    try {
      await callAdmin({ action: 'saveAvailability', timeZone, weeklyHours: hours, ...limits });
      enqueueSnackbar({ message: 'Availability saved', variant: 'success' });
    } catch (saveError) {
      enqueueSnackbar({ message: (saveError as Error).message, variant: 'error' });
    } finally {
      setSaving(false);
    }
  };
  const copyToWeekdays = (from: string) => setHours({ ...hours, ...Object.fromEntries(['mon', 'tue', 'wed', 'thu', 'fri'].map((day) => [day, (hours[from] ?? []).map((window) => ({ ...window }))])) });

  const page = { fontFamily: 'Inter, sans-serif', color: theme.text, padding: 16, display: 'flex', flexDirection: 'column' as const, gap: 12, fontSize: 13 };
  if (error) return <div style={page}><p style={{ color: theme.danger }}>{error}</p><Button theme={theme} onClick={load}>Try again</Button></div>;
  if (!data) return <div style={page}><p style={{ color: theme.muted }}>Loading…</p></div>;
  const zones = ZONES.includes(timeZone) ? ZONES : [timeZone, ...ZONES];

  return (
    <div style={page}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 18 }}>My availability</h2>
          <span style={{ color: theme.muted }}>Customers can book you inside these hours, minus anything in your connected calendars.</span>
        </div>
        <Button theme={theme} primary disabled={saving} onClick={save}>{saving ? 'Saving…' : 'Save'}</Button>
      </div>

      <Card theme={theme} title="Weekly hours">
        {DAYS.map(([day, name]) => {
          const windows = hours[day] ?? [];
          return (
            <div key={day} style={{ display: 'grid', gridTemplateColumns: '110px 1fr auto', gap: 10, alignItems: 'center', borderTop: `1px solid ${theme.line}`, paddingTop: 8 }}>
              <strong>{name}</strong>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                {windows.length === 0 && <span style={{ color: theme.muted }}>Unavailable</span>}
                <WindowsEditor theme={theme} windows={windows} onChange={(next) => setHours({ ...hours, [day]: next })} />
              </div>
              {day === 'mon' && windows.length > 0 ? <Button theme={theme} onClick={() => copyToWeekdays('mon')}>Copy to weekdays</Button> : <span />}
            </div>
          );
        })}
        <span style={{ color: theme.muted }}>Hours past midnight, such as 22:00 to 02:00, carry into the next day.</span>
      </Card>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 12 }}>
        <Card theme={theme} title="Time zone">
          <select aria-label="Time zone" style={inputStyle(theme)} value={timeZone} onChange={(event) => setTimeZone(event.target.value)}>
            {zones.map((zone) => (
              <option key={zone} value={zone}>{zone.replace(/_/g, ' ')}</option>
            ))}
          </select>
          <span style={{ color: theme.muted }}>Clock changes are handled automatically.</span>
        </Card>
        <Card theme={theme} title="Limits">
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <span>At most</span>
            <input aria-label="Daily limit" style={{ ...inputStyle(theme), width: 60 }} inputMode="numeric" placeholder="None" value={limits.dailyLimit} onChange={(event) => setLimits({ ...limits, dailyLimit: event.target.value.replace(/\D/g, '') })} />
            <span>a day and</span>
            <input aria-label="Weekly limit" style={{ ...inputStyle(theme), width: 60 }} inputMode="numeric" placeholder="None" value={limits.weeklyLimit} onChange={(event) => setLimits({ ...limits, weeklyLimit: event.target.value.replace(/\D/g, '') })} />
            <span>a week</span>
          </div>
        </Card>
      </div>

      <TimeOff theme={theme} overrides={data.overrides} onChanged={load} />
    </div>
  );
};

export default defineFrontComponent({
  universalIdentifier: IDS.frontComponents.availability,
  name: 'scheduling-availability',
  description: 'Edit weekly hours, time zone, booking limits, time off and special hours.',
  component: Availability,
});
