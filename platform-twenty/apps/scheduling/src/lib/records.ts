import { type Assignment, type Conferencing, type MeetingFormat } from 'src/constants/enums';
import { type AvailabilityOverride, type WeeklyRules } from 'src/engine/availability';
import { type LocationMode } from 'src/engine/geo';
import { gql, nodes } from 'src/lib/api';

type Edges<TNode> = { edges: { node: TNode }[] };

export type ScheduleRecord = {
  id: string;
  name: string;
  timeZone: string | null;
  weeklyHours: WeeklyRules | null;
  isDefault: boolean | null;
  overrides: Edges<AvailabilityOverride>;
};

export type OfficeRecord = { id: string; name: string; streetAddress: string; postcode: string; latitude: number | null; longitude: number | null; timeZone: string; isPublic: boolean };

export type AdvisorRecord = {
  id: string;
  name: string;
  workspaceMemberId: string | null;
  email: string;
  phone: string;
  timeZone: string;
  isActive: boolean;
  publicBio: string;
  bookingSlug: string;
  weight: number | null;
  priority: number | null;
  dailyLimit: number | null;
  weeklyLimit: number | null;
  inPerson: boolean;
  remote: boolean;
  travelsToCustomers: boolean;
  baseLatitude: number | null;
  baseLongitude: number | null;
  publicLocationLabel: string;
  serviceRadiusKm: number | null;
  maxTravelMinutes: number | null;
  travelBufferMinutes: number | null;
  postcodeTerritory: string;
  serviceArea: unknown;
  office: OfficeRecord | null;
  schedule: ScheduleRecord | null;
  schedules: Edges<{ id: string; isDefault: boolean | null }>;
};

export type IntakeQuestion = { id: string; label: string; type?: 'text' | 'textarea' | 'select' | 'phone' | 'email'; required?: boolean; options?: string[] };

export type AppointmentTypeRecord = {
  id: string;
  name: string;
  slug: string;
  description: string;
  status: string;
  color: string;
  icon: string;
  durationMinutes: number;
  meetingFormat: MeetingFormat;
  conferencing: Conferencing;
  meetingUrl: string;
  assignment: Assignment;
  roundRobinStrategy: string;
  locationMode: LocationMode;
  distanceBasis: 'ROAD' | 'STRAIGHT_LINE';
  capacity: number | null;
  minimumNoticeMinutes: number | null;
  horizonDays: number | null;
  bufferBeforeMinutes: number | null;
  bufferAfterMinutes: number | null;
  incrementMinutes: number | null;
  dailyLimit: number | null;
  weeklyLimit: number | null;
  timeZone: string;
  cancellationCutoffHours: number | null;
  rescheduleCutoffHours: number | null;
  intakeQuestions: IntakeQuestion[] | null;
  confirmationMessage: string;
  requiresApproval: boolean;
  reminderMinutes: string;
  allowedEmbedDomains: string;
  requireVerifiedTravel: boolean;
  ownerId: string | null;
  teamId: string | null;
  office: OfficeRecord | null;
  schedule: ScheduleRecord | null;
  team: { id: string; name: string; slug: string; fairnessWindowDays: number | null; memberships?: Edges<{ advisorId: string; weight: number | null; priority: number | null; isActive: boolean }> } | null;
};

export type BookingLinkRecord = {
  id: string;
  slug: string;
  isActive: boolean;
  title: string;
  description: string;
  presets: { name?: string; email?: string; answers?: Record<string, string>; hide?: string[] } | null;
  advisorId: string | null;
  appointmentType: AppointmentTypeRecord | null;
};

const OFFICE = 'id name streetAddress postcode latitude longitude timeZone isPublic';
const SCHEDULE = 'id name timeZone weeklyHours isDefault overrides(first: 200) { edges { node { startDate endDate kind windows } } }';
export const ADVISOR_FIELDS = `id name workspaceMemberId email phone timeZone isActive publicBio bookingSlug weight priority dailyLimit weeklyLimit inPerson remote
  travelsToCustomers baseLatitude baseLongitude publicLocationLabel serviceRadiusKm maxTravelMinutes travelBufferMinutes postcodeTerritory serviceArea
  office { ${OFFICE} } schedule { ${SCHEDULE} } schedules(first: 20) { edges { node { id isDefault } } }`;
export const TYPE_FIELDS = `id name slug description status color icon durationMinutes meetingFormat conferencing meetingUrl assignment roundRobinStrategy locationMode
  distanceBasis capacity minimumNoticeMinutes horizonDays bufferBeforeMinutes bufferAfterMinutes incrementMinutes dailyLimit weeklyLimit timeZone
  cancellationCutoffHours rescheduleCutoffHours intakeQuestions confirmationMessage requiresApproval reminderMinutes allowedEmbedDomains requireVerifiedTravel
  ownerId teamId office { ${OFFICE} } schedule { ${SCHEDULE} }
  team { id name slug fairnessWindowDays }`;

// Twenty returns an empty list, without an error, for a one-to-many nested two levels down (type, team,
// memberships), so memberships are loaded separately.
const withMemberships = async <TType extends AppointmentTypeRecord | null>(type: TType): Promise<TType> => {
  if (!type?.team) return type;
  const data = await gql<{ teamMemberships: Edges<{ advisorId: string; weight: number | null; priority: number | null; isActive: boolean }> }>(
    `query($teamId: UUID!) { teamMemberships(filter: { teamId: { eq: $teamId } }, first: 500) { edges { node { advisorId weight priority isActive } } } }`,
    { teamId: type.team.id },
  );
  type.team.memberships = data.teamMemberships;
  return type;
};

export type SettingsRecord = {
  contactMatching: 'EMAIL' | 'EMAIL_THEN_PHONE';
  createContacts: boolean;
  linkCompanyByEmailDomain: boolean;
  defaultTimeZone: string;
  senderName: string;
  notifyAdvisors: boolean;
  bookingsPerHourPerClient: number | null;
  maxAppointmentTypes: number | null;
};

const DEFAULT_SETTINGS: SettingsRecord = {
  contactMatching: 'EMAIL',
  createContacts: true,
  linkCompanyByEmailDomain: true,
  defaultTimeZone: 'Europe/London',
  senderName: '',
  notifyAdvisors: true,
  bookingsPerHourPerClient: 10,
  maxAppointmentTypes: null,
};

let cachedSettings: { at: number; value: Promise<SettingsRecord> } | null = null;

export const loadSettings = (): Promise<SettingsRecord> => {
  if (!cachedSettings || Date.now() - cachedSettings.at > 30_000) {
    const value = fetchSettings();
    value.catch(() => (cachedSettings = null));
    cachedSettings = { at: Date.now(), value };
  }
  return cachedSettings.value;
};

const fetchSettings = async (): Promise<SettingsRecord> => {
  const data = await gql<{ schedulingSettingsRecords: Edges<SettingsRecord> }>(`{
    schedulingSettingsRecords(first: 1, orderBy: [{ createdAt: AscNullsFirst }]) { edges { node {
      contactMatching createContacts linkCompanyByEmailDomain defaultTimeZone senderName notifyAdvisors bookingsPerHourPerClient maxAppointmentTypes
    } } }
  }`);
  const found = nodes(data.schedulingSettingsRecords)[0];
  return found ? { ...DEFAULT_SETTINGS, ...Object.fromEntries(Object.entries(found).filter(([, value]) => value !== null && value !== '')) } : DEFAULT_SETTINGS;
};

// A public slug can name an appointment type, a booking link or an advisor's personal page.
export const resolveSlug = async (slug: string) => {
  const data = await gql<{ appointmentTypes: Edges<AppointmentTypeRecord>; bookingLinks: Edges<BookingLinkRecord>; advisors: Edges<{ id: string; name: string; publicBio: string; isActive: boolean }> }>(
    `query($slug: String!) {
      appointmentTypes(filter: { slug: { eq: $slug } }, first: 1) { edges { node { ${TYPE_FIELDS} } } }
      bookingLinks(filter: { slug: { eq: $slug } }, first: 1) { edges { node { id slug isActive title description presets advisorId appointmentType { ${TYPE_FIELDS} } } } }
      advisors(filter: { bookingSlug: { eq: $slug } }, first: 1) { edges { node { id name publicBio isActive } } }
    }`,
    { slug },
  );
  const link = nodes(data.bookingLinks)[0] ?? null;
  if (link) link.appointmentType = await withMemberships(link.appointmentType);
  return {
    type: await withMemberships(nodes(data.appointmentTypes)[0] ?? null),
    link,
    advisor: nodes(data.advisors)[0] ?? null,
  };
};

export const loadTypesForAdvisor = async (advisorId: string) => {
  const data = await gql<{ appointmentTypes: Edges<AppointmentTypeRecord> }>(
    `query($advisorId: UUID!) { appointmentTypes(filter: { ownerId: { eq: $advisorId }, status: { eq: ACTIVE } }, first: 50) { edges { node { ${TYPE_FIELDS} } } } }`,
    { advisorId },
  );
  return nodes(data.appointmentTypes);
};

export const loadType = async (id: string) => {
  const data = await gql<{ appointmentTypes: Edges<AppointmentTypeRecord> }>(
    `query($id: UUID!) { appointmentTypes(filter: { id: { eq: $id } }) { edges { node { ${TYPE_FIELDS} } } } }`,
    { id },
  );
  return withMemberships(nodes(data.appointmentTypes)[0] ?? null);
};

// Twenty rejects one-to-many lists nested in one-to-many lists, so an advisor without a chosen schedule gets their
// default one (with its time off) in a second query.
export const loadAdvisors = async (ids: string[]) => {
  if (ids.length === 0) return [];
  const data = await gql<{ advisors: Edges<AdvisorRecord> }>(
    `query($ids: [UUID!]) { advisors(filter: { id: { in: $ids } }, first: 200) { edges { node { ${ADVISOR_FIELDS} } } } }`,
    { ids },
  );
  const advisors = nodes(data.advisors);
  const fallbackIds = advisors
    .filter((advisor) => !advisor.schedule)
    .map((advisor) => (nodes(advisor.schedules).find((schedule) => schedule.isDefault) ?? nodes(advisor.schedules)[0])?.id)
    .filter((id): id is string => Boolean(id));
  if (fallbackIds.length > 0) {
    const schedules = await gql<{ availabilitySchedules: Edges<ScheduleRecord & { ownerId: string }> }>(
      `query($ids: [UUID!]) { availabilitySchedules(filter: { id: { in: $ids } }) { edges { node { ${SCHEDULE} ownerId } } } }`,
      { ids: fallbackIds },
    );
    for (const schedule of nodes(schedules.availabilitySchedules)) {
      const owner = advisors.find((advisor) => advisor.id === schedule.ownerId && !advisor.schedule);
      if (owner) owner.schedule = schedule;
    }
  }
  return advisors;
};

// Advisors who may take this type: its owner, or the team's active members.
export const candidateAdvisorIds = (type: AppointmentTypeRecord, fixedAdvisorId?: string | null) => {
  if (fixedAdvisorId) return [fixedAdvisorId];
  if (type.assignment === 'ONE_TO_ONE' || !type.team) return type.ownerId ? [type.ownerId] : [];
  return nodes(type.team.memberships)
    .filter((membership) => membership.isActive && membership.advisorId)
    .map((membership) => membership.advisorId);
};

export const membershipOf = (type: AppointmentTypeRecord, advisorId: string) =>
  nodes(type.team?.memberships).find((membership) => membership.advisorId === advisorId) ?? null;

export const advisorSchedule = (advisor: AdvisorRecord, type: AppointmentTypeRecord) => type.schedule ?? advisor.schedule ?? null;

export const advisorPoint = (advisor: AdvisorRecord) =>
  advisor.baseLatitude !== null && advisor.baseLongitude !== null
    ? { lat: advisor.baseLatitude, lng: advisor.baseLongitude }
    : advisor.office?.latitude !== null && advisor.office?.latitude !== undefined && advisor.office.longitude !== null
      ? { lat: advisor.office.latitude, lng: advisor.office.longitude }
      : null;
