export const TEAM_ROLES = { MEMBER: 'Member', ADMIN: 'Team administrator' } as const;

export const OVERRIDE_KINDS = {
  UNAVAILABLE: { label: 'Time off', color: 'red' },
  CUSTOM_HOURS: { label: 'Special hours', color: 'blue' },
} as const;

export const TYPE_STATUSES = {
  ACTIVE: { label: 'Active', color: 'green' },
  DRAFT: { label: 'Draft', color: 'gray' },
  DISABLED: { label: 'Disabled', color: 'red' },
} as const;

export const MEETING_FORMATS = {
  VIRTUAL: { label: 'Video call', color: 'blue' },
  PHONE: { label: 'Phone call', color: 'sky' },
  IN_PERSON_OFFICE: { label: 'In person at an office', color: 'green' },
  AT_CUSTOMER: { label: 'In person at the customer', color: 'orange' },
} as const;
export type MeetingFormat = keyof typeof MEETING_FORMATS;

export const CONFERENCING = {
  NONE: 'None',
  GOOGLE_MEET: 'Google Meet',
  MICROSOFT_TEAMS: 'Microsoft Teams',
  FIXED_LINK: 'Fixed meeting link',
} as const;
export type Conferencing = keyof typeof CONFERENCING;

// Who takes the appointment. How the advisor is chosen among several is the round-robin strategy; where they must
// be is the location mode. The three combine freely.
export const ASSIGNMENTS = {
  ONE_TO_ONE: 'One named advisor',
  ROUND_ROBIN: 'Round robin across the team',
  FIRST_AVAILABLE: 'First available advisor',
  CUSTOMER_CHOICE: 'Customer chooses the advisor',
  COLLECTIVE: 'Collective (everyone in the team)',
} as const;
export type Assignment = keyof typeof ASSIGNMENTS;

export const ROUND_ROBIN_STRATEGIES = {
  EQUAL: 'Equal distribution',
  WEIGHTED: 'Weighted',
  LEAST_RECENT: 'Least recently assigned',
  LEAST_BOOKED: 'Lightest workload',
  PRIORITY: 'Priority order',
  FIRST_AVAILABLE: 'First available',
} as const;

export const LOCATION_MODES = {
  NONE: 'No location matching',
  NEAREST: 'Nearest advisor',
  FASTEST: 'Fastest travel time',
  WITHIN_RADIUS: 'Within service radius',
  TERRITORY: 'Territory',
  FIRST_AVAILABLE_NEARBY: 'First available nearby',
  CUSTOMER_CHOICE: 'Customer picks from nearby advisors',
  GEOGRAPHIC_ROUND_ROBIN: 'Round robin among nearby advisors',
} as const;

export const DISTANCE_BASES = { ROAD: 'Road (routing)', STRAIGHT_LINE: 'Straight line' } as const;

export const APPOINTMENT_STATUSES = {
  PENDING: { label: 'Pending', color: 'gray' },
  CONFIRMED: { label: 'Confirmed', color: 'green' },
  RESCHEDULED: { label: 'Rescheduled', color: 'purple' },
  CANCELLED: { label: 'Cancelled', color: 'red' },
  COMPLETED: { label: 'Completed', color: 'blue' },
  NO_SHOW: { label: 'No-show', color: 'orange' },
} as const;
export type AppointmentStatus = keyof typeof APPOINTMENT_STATUSES;

export const BOOKING_SOURCES = { PUBLIC_PAGE: 'Booking page', EMBED: 'Website embed', MANUAL: 'Added in the CRM', API: 'API or workflow' } as const;

export const PARTICIPANT_ROLES = { HOST: 'Host', REQUIRED: 'Required attendee' } as const;

export const PROVIDERS = {
  GOOGLE: { label: 'Google Calendar', color: 'blue' },
  MICROSOFT: { label: 'Microsoft Outlook', color: 'sky' },
} as const;
export type Provider = keyof typeof PROVIDERS;

export const CONNECTION_STATUSES = {
  CONNECTED: { label: 'Connected', color: 'green' },
  NEEDS_RECONNECT: { label: 'Needs reconnecting', color: 'red' },
  ERROR: { label: 'Error', color: 'orange' },
  DISCONNECTED: { label: 'Disconnected', color: 'gray' },
} as const;

export const CALENDAR_STATUSES = {
  NOT_CONNECTED: { label: 'No calendar', color: 'gray' },
  PENDING: { label: 'Syncing', color: 'blue' },
  SYNCED: { label: 'In calendar', color: 'green' },
  FAILED: { label: 'Sync failing', color: 'red' },
  CHANGED_EXTERNALLY: { label: 'Changed in calendar', color: 'orange' },
} as const;

export const SYNC_OPERATIONS = { UPSERT: 'Create or update', DELETE: 'Delete' } as const;

export const SYNC_STATUSES = {
  PENDING: { label: 'Pending', color: 'blue' },
  SYNCED: { label: 'Synced', color: 'green' },
  FAILED: { label: 'Retrying', color: 'orange' },
  GAVE_UP: { label: 'Needs attention', color: 'red' },
} as const;

export const CONTACT_MATCHING = { EMAIL: 'Email address only', EMAIL_THEN_PHONE: 'Email or phone number' } as const;

type OptionColor = 'blue' | 'sky' | 'green' | 'gray' | 'orange' | 'red' | 'purple';

export const selectOptions = (entries: Record<string, string | { label: string; color?: string }>) =>
  Object.entries(entries).map(([value, entry], position) => ({
    value,
    label: typeof entry === 'string' ? entry : entry.label,
    color: (typeof entry === 'string' ? 'gray' : (entry.color ?? 'gray')) as OptionColor,
    position,
  }));
