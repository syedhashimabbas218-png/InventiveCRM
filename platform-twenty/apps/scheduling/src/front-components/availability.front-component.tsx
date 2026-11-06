import styled from '@emotion/styled';
import { useEffect, useState } from 'react';
import { defineFrontComponent } from 'twenty-sdk/define';
import { enqueueSnackbar } from 'twenty-sdk/front-component';
import { IconPlus } from 'twenty-ui/icon';
import { themeCssVariables } from 'twenty-ui/theme';

import { IDS } from 'src/constants/ids';
import {
  callAdmin,
  Divided,
  ErrorState,
  FieldTitle,
  Grid,
  Hint,
  Input,
  LoadingState,
  Page,
  PageHeader,
  Panel,
  PrimaryButton,
  QuietButton,
  Row,
  SecondaryButton,
  Select,
  StatusTag,
} from 'src/front-components/shared';

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

const DayRow = styled.div`
  align-items: center;
  border-top: 1px solid ${() => themeCssVariables.border.color.light};
  display: grid;
  gap: ${() => themeCssVariables.spacing[3]};
  grid-template-columns: 120px 1fr auto;
  padding-top: ${() => themeCssVariables.spacing[2]};
`;

const NumberInput = styled(Input)`
  width: 64px;
`;

const WindowsEditor = ({ windows, onChange }: { windows: TimeWindow[]; onChange: (windows: TimeWindow[]) => void }) => (
  <Row>
    {windows.map((window, index) => (
      <Row key={index}>
        <Input aria-label="From" type="time" value={window.start} onChange={(event) => onChange(windows.map((item, at) => (at === index ? { ...item, start: event.target.value } : item)))} />
        <Hint>to</Hint>
        <Input
          aria-label="To"
          type="time"
          value={window.end === '24:00' ? '23:59' : window.end}
          onChange={(event) => onChange(windows.map((item, at) => (at === index ? { ...item, end: event.target.value === '23:59' ? '24:00' : event.target.value } : item)))}
        />
        <QuietButton onClick={() => onChange(windows.filter((_, at) => at !== index))}>Remove</QuietButton>
      </Row>
    ))}
    {windows.length < 8 && (
      <SecondaryButton startIcon={<IconPlus size={14} />} onClick={() => onChange([...windows, windows.length ? { start: '13:00', end: '17:00' } : { start: '09:00', end: '17:00' }])}>
        {windows.length ? 'Add hours' : 'Set hours'}
      </SecondaryButton>
    )}
  </Row>
);

const TimeOff = ({ overrides, onChanged }: { overrides: Override[]; onChanged: () => void }) => {
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
    <Panel title="Time off and special hours">
      {overrides.length === 0 && <Hint>Nothing planned. Add holidays, a day off, or different hours for a date.</Hint>}
      {overrides.map((override) => (
        <Divided key={override.id}>
          <Row>
            <strong>{override.name}</strong>
            <Hint>{override.startDate === override.endDate ? override.startDate : `${override.startDate} to ${override.endDate}`}</Hint>
            <StatusTag kind="override" value={override.kind} />
            {override.kind !== 'UNAVAILABLE' && <Hint>{(override.windows ?? []).map((window) => `${window.start} to ${window.end}`).join(', ')}</Hint>}
            <QuietButton disabled={busy} onClick={() => run({ action: 'removeOverride', id: override.id }, 'Removed')}>
              Remove
            </QuietButton>
          </Row>
        </Divided>
      ))}
      <Divided>
        <Row>
          <Input placeholder="Reason (optional)" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
          <Input aria-label="First day" type="date" value={form.startDate} onChange={(event) => setForm({ ...form, startDate: event.target.value, endDate: form.endDate < event.target.value ? event.target.value : form.endDate })} />
          <Input aria-label="Last day" type="date" value={form.endDate} onChange={(event) => setForm({ ...form, endDate: event.target.value })} />
          <Select aria-label="Kind" value={form.kind} onChange={(event) => setForm({ ...form, kind: event.target.value })}>
            <option value="UNAVAILABLE">Unavailable all day</option>
            <option value="CUSTOM_HOURS">Different hours</option>
          </Select>
          {form.kind === 'CUSTOM_HOURS' && <WindowsEditor windows={windows} onChange={setWindows} />}
          <PrimaryButton disabled={busy} onClick={() => run({ action: 'addOverride', ...form, windows: form.kind === 'CUSTOM_HOURS' ? windows : [] }, 'Added')}>
            Add
          </PrimaryButton>
        </Row>
      </Divided>
    </Panel>
  );
};

const Availability = () => {
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
  const zones = ZONES.includes(timeZone) ? ZONES : [timeZone, ...ZONES];

  return (
    <Page>
      <PageHeader
        title="My availability"
        description="Customers can book you inside these hours, minus anything in your connected calendars."
        actions={
          <PrimaryButton loading={saving} disabled={saving} onClick={save}>
            Save
          </PrimaryButton>
        }
      />

      <Panel title="Weekly hours">
        {DAYS.map(([day, name]) => {
          const windows = hours[day] ?? [];
          return (
            <DayRow key={day}>
              <FieldTitle>{name}</FieldTitle>
              <Row>
                {windows.length === 0 && <Hint>Unavailable</Hint>}
                <WindowsEditor windows={windows} onChange={(next) => setHours({ ...hours, [day]: next })} />
              </Row>
              {day === 'mon' && windows.length > 0 ? <QuietButton onClick={() => copyToWeekdays('mon')}>Copy to weekdays</QuietButton> : <span />}
            </DayRow>
          );
        })}
        <Hint>Hours past midnight, such as 22:00 to 02:00, carry into the next day.</Hint>
      </Panel>

      <Grid>
        <Panel title="Time zone">
          <Select aria-label="Time zone" value={timeZone} onChange={(event) => setTimeZone(event.target.value)}>
            {zones.map((zone) => (
              <option key={zone} value={zone}>
                {zone.replace(/_/g, ' ')}
              </option>
            ))}
          </Select>
          <Hint>Clock changes are handled automatically.</Hint>
        </Panel>
        <Panel title="Limits">
          <Row>
            <span>At most</span>
            <NumberInput aria-label="Daily limit" inputMode="numeric" placeholder="None" value={limits.dailyLimit} onChange={(event) => setLimits({ ...limits, dailyLimit: event.target.value.replace(/\D/g, '') })} />
            <span>a day and</span>
            <NumberInput aria-label="Weekly limit" inputMode="numeric" placeholder="None" value={limits.weeklyLimit} onChange={(event) => setLimits({ ...limits, weeklyLimit: event.target.value.replace(/\D/g, '') })} />
            <span>a week</span>
          </Row>
        </Panel>
      </Grid>

      <TimeOff overrides={data.overrides} onChanged={load} />
    </Page>
  );
};

export default defineFrontComponent({
  universalIdentifier: IDS.frontComponents.availability,
  name: 'scheduling-availability',
  description: 'Edit weekly hours, time zone, booking limits, time off and special hours.',
  component: Availability,
});
