import styled from '@emotion/styled';
import { useEffect, useState } from 'react';
import { defineFrontComponent } from 'twenty-sdk/define';
import { AppPath, copyToClipboard, enqueueSnackbar, navigate } from 'twenty-sdk/front-component';
import { Callout } from 'twenty-ui/components/feedback';
import { SegmentedControl } from 'twenty-ui/components/input';
import { IconCalendarEvent, IconCode, IconCopy, IconLink, IconMap, IconPlus } from 'twenty-ui/icon';
import { themeCssVariables } from 'twenty-ui/theme';

import { IDS } from 'src/constants/ids';
import {
  callAdmin,
  Code,
  Divided,
  ErrorState,
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
  Stack,
  StatusTag,
  label,
  when,
} from 'src/front-components/shared';

type AppointmentRow = {
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
  today: AppointmentRow[];
  mine: AppointmentRow[];
  team: AppointmentRow[];
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

const AppointmentButton = styled.button`
  align-items: center;
  background: transparent;
  border: 0;
  border-radius: ${() => themeCssVariables.border.radius.sm};
  border-top: 1px solid ${() => themeCssVariables.border.color.light};
  color: inherit;
  cursor: pointer;
  display: grid;
  font: inherit;
  gap: ${() => themeCssVariables.spacing[3]};
  grid-template-columns: 112px minmax(0, 1fr) auto;
  padding: ${() => themeCssVariables.spacing[2]};
  text-align: left;
  width: 100%;

  &:hover {
    background: ${() => themeCssVariables.background.transparent.light};
  }
`;

const Ellipsis = styled.span`
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const TypeDot = styled.span<{ dotColor: string }>`
  background: ${({ dotColor }) => dotColor};
  border-radius: 50%;
  display: inline-block;
  height: 8px;
  margin-right: ${() => themeCssVariables.spacing[2]};
  width: 8px;
`;

const RightColumn = styled.span`
  align-items: flex-end;
  display: flex;
  flex-direction: column;
  gap: ${() => themeCssVariables.spacing[1]};
`;

const FormGrid = styled.div`
  align-items: end;
  display: grid;
  gap: ${() => themeCssVariables.spacing[2]};
  grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
`;

const MapFrame = styled.iframe`
  border: 0;
  border-radius: ${() => themeCssVariables.border.radius.md};
  height: 460px;
  width: 100%;
`;

const NoWrap = styled.span`
  flex-shrink: 0;
  white-space: nowrap;
`;

const ActivityRow = styled.div`
  align-items: baseline;
  display: flex;
  gap: ${() => themeCssVariables.spacing[3]};
  justify-content: space-between;
`;

const SpaceBetween = styled.div`
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: ${() => themeCssVariables.spacing[2]};
  justify-content: space-between;
`;

const AppointmentList = ({ rows, empty }: { rows: AppointmentRow[]; empty: string }) =>
  rows.length === 0 ? (
    <Hint>{empty}</Hint>
  ) : (
    <Stack>
      {rows.slice(0, 12).map((row) => (
        <AppointmentButton key={row.id} onClick={() => openRecord(row.id)}>
          <Hint>{when(row.startsAt)}</Hint>
          <Stack>
            <Ellipsis>
              <TypeDot dotColor={row.appointmentType?.color || themeCssVariables.color.blue} />
              {row.customerName || row.title}
            </Ellipsis>
            <Ellipsis>
              <Hint>{[row.appointmentType?.name, row.advisor?.name, row.location].filter(Boolean).join(' · ')}</Hint>
            </Ellipsis>
          </Stack>
          <RightColumn>
            <StatusTag kind="appointment" value={row.status} />
            {row.calendarStatus !== 'NOT_CONNECTED' && <StatusTag kind="calendar" value={row.calendarStatus} />}
          </RightColumn>
        </AppointmentButton>
      ))}
    </Stack>
  );

const ManualBooking = ({ onDone }: { onDone: () => void }) => {
  const [types, setTypes] = useState<{ id: string; name: string }[]>([]);
  const [form, setForm] = useState({ appointmentTypeId: '', start: '', name: '', email: '', phone: '' });
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    callAdmin<{ types: { id: string; name: string }[] }>({ action: 'bookableTypes' })
      .then((result) => setTypes(result.types))
      .catch(() => setTypes([]));
  }, []);
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
    <FormGrid>
      <Select aria-label="Appointment type" value={form.appointmentTypeId} onChange={(event) => setForm({ ...form, appointmentTypeId: event.target.value })}>
        <option value="">Appointment type</option>
        {types.map((type) => (
          <option key={type.id} value={type.id}>
            {type.name}
          </option>
        ))}
      </Select>
      <Input aria-label="Start" type="datetime-local" value={form.start} onChange={(event) => setForm({ ...form, start: event.target.value })} />
      <Input placeholder="Customer name" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
      <Input placeholder="Customer email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} />
      <Input placeholder="Phone (optional)" value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} />
      <PrimaryButton loading={busy} disabled={busy || !form.appointmentTypeId || !form.start || !form.name || !form.email} onClick={submit}>
        Book
      </PrimaryButton>
    </FormGrid>
  );
};

const FORMATS = [
  ['VIRTUAL', 'Video call'],
  ['PHONE', 'Phone call'],
  ['IN_PERSON_OFFICE', 'At an office'],
  ['AT_CUSTOMER', "At the customer's address"],
] as const;

const QuickType = ({ onDone }: { onDone: () => void }) => {
  const [teams, setTeams] = useState<{ id: string; name: string }[]>([]);
  const [form, setForm] = useState({ name: '', durationMinutes: '30', meetingFormat: 'VIRTUAL', conferencing: 'GOOGLE_MEET', teamId: '', assignment: 'ROUND_ROBIN', locationMode: 'NEAREST' });
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    callAdmin<{ teams: { id: string; name: string }[] }>({ action: 'teams' })
      .then((result) => setTeams(result.teams))
      .catch(() => setTeams([]));
  }, []);
  const create = async () => {
    setBusy(true);
    try {
      const result = await callAdmin<{ id: string }>({ action: 'quickType', ...form, durationMinutes: Number(form.durationMinutes) });
      enqueueSnackbar({ message: 'Draft created. Review it and set the status to Active to publish the booking page.', variant: 'success' });
      onDone();
      navigate(AppPath.RecordShowPage, { objectNameSingular: 'appointmentType', objectRecordId: result.id });
    } catch (error) {
      enqueueSnackbar({ message: (error as Error).message, variant: 'error' });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Stack>
      <FormGrid>
        <Input placeholder="Name, e.g. Free consultation" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
        <Select aria-label="Duration" value={form.durationMinutes} onChange={(event) => setForm({ ...form, durationMinutes: event.target.value })}>
          {[15, 20, 30, 45, 60, 90, 120].map((minutes) => (
            <option key={minutes} value={minutes}>
              {minutes} minutes
            </option>
          ))}
        </Select>
        <Select aria-label="Where" value={form.meetingFormat} onChange={(event) => setForm({ ...form, meetingFormat: event.target.value })}>
          {FORMATS.map(([value, name]) => (
            <option key={value} value={value}>
              {name}
            </option>
          ))}
        </Select>
        <Select aria-label="Who" value={form.teamId} onChange={(event) => setForm({ ...form, teamId: event.target.value })}>
          <option value="">Just me</option>
          {teams.map((team) => (
            <option key={team.id} value={team.id}>
              Team: {team.name}
            </option>
          ))}
        </Select>
      </FormGrid>
      {more && (
        <FormGrid>
          {form.meetingFormat === 'VIRTUAL' && (
            <Select aria-label="Video link" value={form.conferencing} onChange={(event) => setForm({ ...form, conferencing: event.target.value })}>
              <option value="GOOGLE_MEET">Google Meet link</option>
              <option value="MICROSOFT_TEAMS">Microsoft Teams link</option>
              <option value="NONE">No link</option>
            </Select>
          )}
          {form.teamId && (
            <Select aria-label="Assignment" value={form.assignment} onChange={(event) => setForm({ ...form, assignment: event.target.value })}>
              <option value="ROUND_ROBIN">Round robin</option>
              <option value="FIRST_AVAILABLE">First available</option>
              <option value="CUSTOMER_CHOICE">Customer picks the advisor</option>
              <option value="COLLECTIVE">Everyone attends</option>
            </Select>
          )}
          {form.meetingFormat === 'AT_CUSTOMER' && (
            <Select aria-label="Advisor by location" value={form.locationMode} onChange={(event) => setForm({ ...form, locationMode: event.target.value })}>
              <option value="NEAREST">Nearest advisor</option>
              <option value="FASTEST">Shortest drive</option>
              <option value="WITHIN_RADIUS">Anyone covering the address</option>
              <option value="TERRITORY">By postcode territory</option>
              <option value="CUSTOMER_CHOICE">Customer picks on a map</option>
              <option value="GEOGRAPHIC_ROUND_ROBIN">Round robin among nearby advisors</option>
            </Select>
          )}
        </FormGrid>
      )}
      <Row>
        <PrimaryButton loading={busy} disabled={busy || !form.name.trim()} onClick={create}>
          Create draft
        </PrimaryButton>
        {!more && <QuietButton onClick={() => setMore(true)}>More options</QuietButton>}
      </Row>
    </Stack>
  );
};

const Dashboard = () => {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState('');
  const [scope, setScope] = useState<'mine' | 'team'>('mine');
  const [showManual, setShowManual] = useState(false);
  const [showQuickType, setShowQuickType] = useState(false);
  const [mapUrl, setMapUrl] = useState<string | null>(null);
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

  const toggleMap = async () => {
    if (mapUrl) return setMapUrl(null);
    try {
      setMapUrl((await callAdmin<{ url: string }>({ action: 'mapLink' })).url);
    } catch (mapError) {
      enqueueSnackbar({ message: (mapError as Error).message, variant: 'error' });
    }
  };

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

  const upcoming = (scope === 'mine' ? data.mine : data.team).filter((row) => Date.parse(row.endsAt) >= Date.now());
  const needsAttention = data.connections.filter((connection) => connection.status !== 'CONNECTED');

  return (
    <Page>
      <PageHeader
        title="Scheduling"
        description={`${data.today.length} today · ${data.team.length} in the next two weeks`}
        actions={
          <Row>
            {data.advisor?.personalUrl && (
              <SecondaryButton startIcon={<IconLink size={14} />} onClick={() => copy(data.advisor?.personalUrl ?? '', 'Your booking link')}>
                Copy my booking link
              </SecondaryButton>
            )}
            <SecondaryButton startIcon={<IconPlus size={14} />} onClick={() => setShowQuickType(!showQuickType)}>
              New appointment type
            </SecondaryButton>
            <SecondaryButton startIcon={<IconMap size={14} />} onClick={toggleMap}>
              {mapUrl ? 'Hide advisor map' : 'Advisor map'}
            </SecondaryButton>
            <PrimaryButton startIcon={<IconCalendarEvent size={14} />} onClick={() => setShowManual(!showManual)}>
              Schedule an appointment
            </PrimaryButton>
          </Row>
        }
      />

      {!data.advisor && (
        <Callout
          status="info"
          title="Take bookings yourself"
          description="You do not have an advisor profile yet. Create one with default working hours, then adjust them under Availability."
          action={<PrimaryButton onClick={setup}>Create my advisor profile</PrimaryButton>}
        />
      )}
      {(needsAttention.length > 0 || data.failingSyncs > 0) && (
        <Callout
          status="warning"
          title="Needs attention"
          description={[
            ...needsAttention.map((connection) => `${connection.name}: ${label(connection.status)}`),
            ...(data.failingSyncs > 0 ? [`${data.failingSyncs} appointment(s) could not be written to a calendar. See Calendar sync queue.`] : []),
          ].join(' · ')}
        />
      )}
      {showQuickType && (
        <Panel title="New appointment type">
          <QuickType onDone={() => setShowQuickType(false)} />
        </Panel>
      )}
      {mapUrl && (
        <Panel
          title="Advisors, offices and service areas"
          action={
            <a href={mapUrl} target="_blank" rel="noreferrer">
              Open full screen
            </a>
          }
        >
          <MapFrame src={mapUrl} />
        </Panel>
      )}
      {showManual && (
        <Panel title="Schedule an appointment">
          <ManualBooking
            onDone={() => {
              setShowManual(false);
              load();
            }}
          />
        </Panel>
      )}

      <Grid>
        <Panel title="Today">
          <AppointmentList rows={data.today} empty="Nothing booked today." />
        </Panel>
        <Panel
          title="Upcoming"
          action={
            <SegmentedControl
              aria-label="Whose appointments"
              size="sm"
              value={scope}
              onValueChange={(value) => setScope(value as 'mine' | 'team')}
              options={data.advisor ? [{ value: 'mine', label: 'Mine' }, { value: 'team', label: 'Team' }] : [{ value: 'team', label: 'Team' }]}
            />
          }
        >
          <AppointmentList rows={upcoming} empty="No upcoming appointments." />
        </Panel>
        <Panel title="Calendar connections" action={<QuietButton onClick={() => openList('calendarSettings')}>Manage</QuietButton>}>
          {data.connections.length === 0 ? (
            <Hint>No calendar connected: only bookings made here block your time. Connect Google or Microsoft under Scheduling, Calendar connections.</Hint>
          ) : (
            data.connections.map((connection) => (
              <SpaceBetween key={connection.id}>
                <span>{connection.name}</span>
                <StatusTag kind="connection" value={connection.status} />
              </SpaceBetween>
            ))
          )}
        </Panel>
        <Panel title="Recent bookings and changes">
          {data.recent.length === 0 ? (
            <Hint>No activity yet.</Hint>
          ) : (
            data.recent.map((event, index) => (
              <ActivityRow key={index}>
                <span>
                  <strong>{ACTIVITY[event.name] ?? event.name}</strong> {event.appointment ? `${event.appointment.customerName}, ${when(event.appointment.startsAt)}` : ''}
                </span>
                <NoWrap>
                  <Hint>{when(event.occurredAt, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</Hint>
                </NoWrap>
              </ActivityRow>
            ))
          )}
        </Panel>
      </Grid>

      <Panel title="Booking pages" action={<QuietButton onClick={() => openList('bookingLinks')}>Booking links</QuietButton>}>
        {data.bookingPages.length === 0 && <Hint>Create an appointment type and set it to Active to get a booking page.</Hint>}
        {data.bookingPages.map((page) => (
          <Divided key={page.url}>
            <Stack>
              <SpaceBetween>
                <span>
                  <strong>{page.name}</strong> <Hint>{page.detail}</Hint>
                </span>
                <Row>
                  <StatusTag kind="type" value={page.status} />
                  <SecondaryButton startIcon={<IconCopy size={14} />} onClick={() => copy(page.url, 'Booking link')}>
                    Copy link
                  </SecondaryButton>
                  <SecondaryButton startIcon={<IconCode size={14} />} onClick={() => setEmbedFor(embedFor === page.url ? null : page.url)}>
                    Embed
                  </SecondaryButton>
                </Row>
              </SpaceBetween>
              {embedFor === page.url &&
                (['inline', 'popup', 'floating'] as const).map((kind) => (
                  <Row key={kind}>
                    <Code>{page.embed[kind]}</Code>
                    <QuietButton onClick={() => copy(page.embed[kind], `${label(kind)} embed code`)}>Copy {kind}</QuietButton>
                  </Row>
                ))}
            </Stack>
          </Divided>
        ))}
      </Panel>
    </Page>
  );
};

export default defineFrontComponent({
  universalIdentifier: IDS.frontComponents.dashboard,
  name: 'scheduling-dashboard',
  description: 'Scheduling overview: today, upcoming appointments, connections, activity and booking pages.',
  component: Dashboard,
});
