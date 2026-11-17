import { type CampaignChannel, type CampaignStatus, type RecipientStatus, type SuppressionReason } from 'src/constants/enums';
import { DEFAULT_BRAND, type Brand, type Contact, type Design, parseDesign } from 'src/lib/design';
import { gql, nodes } from 'src/lib/api';

export const ALL_CONSENTED = 'ALL';

export type Campaign = {
  id: string;
  name: string;
  channel: CampaignChannel;
  status: CampaignStatus;
  subject: string;
  previewText: string;
  fromName: string;
  fromLocalPart: string;
  fromDomain: string;
  replyTo: string;
  listId: string;
  listName: string;
  design: Design;
  scheduledAt: string | null;
  startedAt: string | null;
  sentAt: string | null;
  whatsappTemplate: string;
  whatsappVariables: Record<string, string>;
  lastError: string;
  prepareCursor: string;
  brandSnapshot: Brand | null;
  recentTestSends: string;
  counts: Record<CountField, number>;
};

export const COUNT_FIELDS = ['recipientCount', 'sentCount', 'deliveredCount', 'openedCount', 'clickedCount', 'bouncedCount', 'complainedCount', 'unsubscribedCount', 'failedCount', 'skippedCount'] as const;
export type CountField = (typeof COUNT_FIELDS)[number];

const CAMPAIGN_FIELDS = `id name channel status subject previewText fromName fromLocalPart fromDomain replyTo listId listName design scheduledAt startedAt sentAt whatsappTemplate whatsappVariables lastError prepareCursor brandSnapshot recentTestSends ${COUNT_FIELDS.join(' ')}`;
const CAMPAIGN_SUMMARY_FIELDS = `id name channel status subject listName scheduledAt startedAt sentAt lastError updatedAt ${COUNT_FIELDS.join(' ')}`;

type RawCampaign = Omit<Campaign, 'design' | 'counts' | 'whatsappVariables' | 'brandSnapshot'> & { design: unknown; whatsappVariables: unknown; brandSnapshot: unknown } & Record<CountField, number | null>;

export const toBrandSnapshot = (value: unknown): Brand | null => {
  if (!value || typeof value !== 'object') return null;
  const stored = value as Record<string, unknown>;
  return Object.fromEntries(Object.entries(DEFAULT_BRAND).map(([key, fallback]) => [key, typeof stored[key] === 'string' ? stored[key] : fallback])) as Brand;
};

const toCampaign = (raw: RawCampaign): Campaign => ({
  ...raw,
  name: raw.name ?? '',
  subject: raw.subject ?? '',
  previewText: raw.previewText ?? '',
  fromName: raw.fromName ?? '',
  fromLocalPart: raw.fromLocalPart ?? '',
  fromDomain: raw.fromDomain ?? '',
  replyTo: raw.replyTo ?? '',
  listId: raw.listId ?? '',
  listName: raw.listName ?? '',
  whatsappTemplate: raw.whatsappTemplate ?? '',
  lastError: raw.lastError ?? '',
  prepareCursor: raw.prepareCursor ?? '',
  recentTestSends: raw.recentTestSends ?? '',
  brandSnapshot: toBrandSnapshot(raw.brandSnapshot),
  design: parseDesign(raw.design),
  whatsappVariables: raw.whatsappVariables && typeof raw.whatsappVariables === 'object' ? (raw.whatsappVariables as Record<string, string>) : {},
  counts: Object.fromEntries(COUNT_FIELDS.map((field) => [field, raw[field] ?? 0])) as Record<CountField, number>,
});

export const getCampaign = async (id: string) => {
  const result = await gql<{ marketingCampaign: RawCampaign | null }>(`query($id: UUID!) { marketingCampaign(filter: { id: { eq: $id } }) { ${CAMPAIGN_FIELDS} } }`, { id });
  return result.marketingCampaign ? toCampaign(result.marketingCampaign) : null;
};

export const listCampaigns = async (limit = 60) =>
  nodes((await gql<{ marketingCampaigns: { edges: { node: Record<string, unknown> }[] } }>(`{ marketingCampaigns(orderBy: [{ updatedAt: DescNullsLast }], first: ${limit}) { edges { node { ${CAMPAIGN_SUMMARY_FIELDS} } } } }`)).marketingCampaigns);

export const campaignsWithStatus = async (statuses: CampaignStatus[]) =>
  nodes(
    (
      await gql<{ marketingCampaigns: { edges: { node: RawCampaign }[] } }>(
        `query($statuses: [MarketingCampaignStatusEnum]) { marketingCampaigns(filter: { status: { in: $statuses } }, orderBy: [{ scheduledAt: AscNullsLast }], first: 50) { edges { node { ${CAMPAIGN_FIELDS} } } } }`,
        { statuses },
      )
    ).marketingCampaigns,
  ).map(toCampaign);

// Most recent first, so the campaigns still collecting events are recounted before time runs out.
export const recentlySent = async (sinceIso: string) =>
  nodes(
    (
      await gql<{ marketingCampaigns: { edges: { node: { id: string } & Record<CountField, number | null> }[] } }>(
        `query($since: DateTime) { marketingCampaigns(filter: { status: { eq: SENT }, sentAt: { gte: $since } }, orderBy: [{ sentAt: DescNullsLast }], first: 50) { edges { node { id ${COUNT_FIELDS.join(' ')} } } } }`,
        { since: sinceIso },
      )
    ).marketingCampaigns,
  ).map((raw) => ({ id: raw.id, counts: Object.fromEntries(COUNT_FIELDS.map((field) => [field, raw[field] ?? 0])) as Record<CountField, number> }));

export const createCampaign = async (data: Record<string, unknown>) =>
  (await gql<{ createMarketingCampaign: { id: string } }>(`mutation($data: MarketingCampaignCreateInput!) { createMarketingCampaign(data: $data) { id } }`, { data })).createMarketingCampaign.id;

export const updateCampaign = (id: string, data: Record<string, unknown>) =>
  gql(`mutation($id: UUID!, $data: MarketingCampaignUpdateInput!) { updateMarketingCampaign(id: $id, data: $data) { id } }`, { id, data });

// A single filtered UPDATE: of several runs or users acting at once, exactly one sees its change applied.
export const updateCampaignIf = async (id: string, statuses: CampaignStatus[], data: Record<string, unknown>) =>
  (
    await gql<{ updateMarketingCampaigns: { id: string }[] }>(`mutation($id: UUID, $statuses: [MarketingCampaignStatusEnum], $data: MarketingCampaignUpdateInput!) { updateMarketingCampaigns(filter: { id: { eq: $id }, status: { in: $statuses } }, data: $data) { id } }`, {
      id,
      statuses,
      data,
    })
  ).updateMarketingCampaigns.length === 1;

export const LEASE_MS = 105_000;

// Only one job run works on a campaign at a time; a lease left by a crashed run expires by itself.
export const acquireLease = async (id: string) =>
  (
    await gql<{ updateMarketingCampaigns: { id: string }[] }>(
      `mutation($id: UUID, $now: DateTime, $until: DateTime) { updateMarketingCampaigns(filter: { id: { eq: $id }, or: [{ lockedUntil: { is: NULL } }, { lockedUntil: { lt: $now } }] }, data: { lockedUntil: $until }) { id } }`,
      { id, now: new Date().toISOString(), until: new Date(Date.now() + LEASE_MS).toISOString() },
    )
  ).updateMarketingCampaigns.length === 1;

export const releaseLease = (id: string) => updateCampaign(id, { lockedUntil: null });

// Compare-and-set on the stored value, so two test sends at once cannot both take the last free slot.
export const replaceTestSends = async (id: string, previous: string, next: string) =>
  (
    previous
      ? await gql<{ updateMarketingCampaigns: { id: string }[] }>(
          `mutation($id: UUID, $previous: String, $data: MarketingCampaignUpdateInput!) { updateMarketingCampaigns(filter: { id: { eq: $id }, recentTestSends: { eq: $previous } }, data: $data) { id } }`,
          { id, previous, data: { recentTestSends: next } },
        )
      : await gql<{ updateMarketingCampaigns: { id: string }[] }>(
          `mutation($id: UUID, $data: MarketingCampaignUpdateInput!) { updateMarketingCampaigns(filter: { id: { eq: $id }, or: [{ recentTestSends: { is: NULL } }, { recentTestSends: { eq: "" } }] }, data: $data) { id } }`,
          { id, data: { recentTestSends: next } },
        )
  ).updateMarketingCampaigns.length === 1;

export const campaignStatus = async (id: string) =>
  (await gql<{ marketingCampaign: { status: CampaignStatus } | null }>(`query($id: UUID!) { marketingCampaign(filter: { id: { eq: $id } }) { status } }`, { id })).marketingCampaign?.status ?? null;

export type Recipient = {
  id: string;
  createdAt: string;
  updatedAt: string;
  batchKey: string | null;
  name: string;
  address: string;
  status: RecipientStatus;
  nonce: string;
  providerMessageId: string | null;
  campaignId: string;
  personId: string | null;
  person: { name: { firstName: string; lastName: string } | null; company: { name: string } | null } | null;
  personalisation: Contact | null;
};

const RECIPIENT_FIELDS = 'id createdAt updatedAt name destination status batchKey nonce providerMessageId campaignId personId person { name { firstName lastName } company { name } } personalisation';

type RawRecipient = Omit<Recipient, 'address' | 'personalisation'> & { destination: string | null; personalisation: unknown };

const toPersonalisation = (value: unknown): Contact | null => {
  if (!value || typeof value !== 'object') return null;
  const stored = value as Record<string, unknown>;
  const text = (key: string) => (typeof stored[key] === 'string' ? stored[key] : '');
  return { firstName: text('firstName'), lastName: text('lastName'), companyName: text('companyName') };
};

const toRecipient = ({ destination, personalisation, ...raw }: RawRecipient): Recipient => ({ ...raw, address: destination ?? '', personalisation: toPersonalisation(personalisation) });

export const getRecipient = async (id: string) => {
  const raw = (await gql<{ campaignRecipient: RawRecipient | null }>(`query($id: UUID!) { campaignRecipient(filter: { id: { eq: $id } }) { ${RECIPIENT_FIELDS} } }`, { id })).campaignRecipient;
  return raw ? toRecipient(raw) : null;
};

export const recipientByMessageId = async (messageId: string) =>
  nodes((await gql<{ campaignRecipients: { edges: { node: RawRecipient }[] } }>(`query($id: String) { campaignRecipients(filter: { providerMessageId: { eq: $id } }, first: 1) { edges { node { ${RECIPIENT_FIELDS} } } } }`, { id: messageId })).campaignRecipients).map(toRecipient)[0] ?? null;

// Oldest first and by id: a batch retried after a crash is rebuilt in the same order, so its payload matches.
const byAge = (left: Recipient, right: Recipient) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id);

const RECIPIENT_VARIABLE_TYPES: Record<string, string> = { campaign: 'UUID', batch: 'String', ids: '[UUID]' };

const recipientsWhere = async (filter: string, variables: Record<string, unknown>, limit: number) =>
  nodes(
    (
      await gql<{ campaignRecipients: { edges: { node: RawRecipient }[] } }>(
        `query(${Object.keys(variables).map((name) => `$${name}: ${RECIPIENT_VARIABLE_TYPES[name]}`).join(', ')}) { campaignRecipients(filter: ${filter}, orderBy: [{ createdAt: AscNullsLast }, { id: AscNullsLast }], first: ${limit}) { edges { node { ${RECIPIENT_FIELDS} } } } }`,
        variables,
      )
    ).campaignRecipients,
  )
    .map(toRecipient)
    .sort(byAge);

export const queuedRecipients = (campaignId: string, limit: number) => recipientsWhere('{ campaignId: { eq: $campaign }, status: { eq: QUEUED } }', { campaign: campaignId }, limit);

export const inFlightRecipients = (campaignId: string) => recipientsWhere('{ campaignId: { eq: $campaign }, status: { eq: SENDING } }', { campaign: campaignId }, 500);

// Every row ever sent under the key, whatever webhooks did to it since: a retry must repeat the original request.
export const batchRecipients = (campaignId: string, batchKey: string) => recipientsWhere('{ campaignId: { eq: $campaign }, batchKey: { eq: $batch } }', { campaign: campaignId, batch: batchKey }, 200);

// Moves queued recipients to SENDING under one batch key; only rows still queued are taken, so two runs never
// send the same person.
export const claimBatch = async (campaignId: string, ids: string[], batchKey: string) => {
  await gql(`mutation($ids: [UUID], $data: CampaignRecipientUpdateInput!) { updateCampaignRecipients(filter: { id: { in: $ids }, status: { eq: QUEUED } }, data: $data) { id } }`, { ids, data: { status: 'SENDING', batchKey } });
  return batchRecipients(campaignId, batchKey);
};

// For a batch the provider refused outright: nothing in it was taken, so it can go out again under a new key.
export const releaseBatch = (campaignId: string, batchKey: string) => updateRecipientsIf({ campaignId, batchKey, status: 'SENDING' }, { status: 'QUEUED', batchKey: '' });

// Status changes that must not overwrite what a webhook already recorded (delivered, bounced and so on).
export const updateRecipientsIf = async (filter: { ids?: string[]; batchKey?: string; campaignId?: string; status: RecipientStatus | RecipientStatus[]; error?: string }, data: Record<string, unknown>) => {
  const parts = [Array.isArray(filter.status) ? `status: { in: [${filter.status.join(', ')}] }` : `status: { eq: ${filter.status} }`];
  const variables: Record<string, unknown> = { data };
  const declarations = ['$data: CampaignRecipientUpdateInput!'];
  if (filter.ids) (parts.push('id: { in: $ids }'), declarations.push('$ids: [UUID]'), (variables.ids = filter.ids));
  if (filter.batchKey) (parts.push('batchKey: { eq: $batch }'), declarations.push('$batch: String'), (variables.batch = filter.batchKey));
  if (filter.campaignId) (parts.push('campaignId: { eq: $campaign }'), declarations.push('$campaign: UUID'), (variables.campaign = filter.campaignId));
  if (filter.error !== undefined) (parts.push('error: { eq: $error }'), declarations.push('$error: String'), (variables.error = filter.error));
  if (parts.length === 1) throw new Error('updateRecipientsIf needs a scope');
  return (await gql<{ updateCampaignRecipients: { id: string }[] }>(`mutation(${declarations.join(', ')}) { updateCampaignRecipients(filter: { ${parts.join(', ')} }, data: $data) { id } }`, variables)).updateCampaignRecipients.length;
};

// Twenty refuses an empty "in" list and GraphQL an unused variable, so each list is only added when it has values.
export const existingRecipients = async (campaignId: string, personIds: string[], destinations: string[]) => {
  const lists = [
    { name: 'people', type: '[UUID]', condition: '{ personId: { in: $people } }', values: personIds },
    { name: 'destinations', type: '[String]', condition: '{ destination: { in: $destinations } }', values: destinations },
  ].filter((list) => list.values.length > 0);
  if (lists.length === 0) return [];
  return nodes(
    (
      await gql<{ campaignRecipients: { edges: { node: { personId: string | null; destination: string | null } }[] } }>(
        `query($campaign: UUID, ${lists.map((list) => `$${list.name}: ${list.type}`).join(', ')}) { campaignRecipients(filter: { campaignId: { eq: $campaign }, or: [${lists.map((list) => list.condition).join(', ')}] }, first: 1000) { edges { node { personId destination } } } }`,
        { campaign: campaignId, ...Object.fromEntries(lists.map((list) => [list.name, list.values])) },
      )
    ).campaignRecipients,
  );
};

export const createRecipients = async (rows: Record<string, unknown>[]) => {
  for (let start = 0; start < rows.length; start += 100)
    await gql(`mutation($data: [CampaignRecipientCreateInput!]!) { createCampaignRecipients(data: $data) { id } }`, { data: rows.slice(start, start + 100) });
};

export const updateRecipient = (id: string, data: Record<string, unknown>) =>
  gql(`mutation($id: UUID!, $data: CampaignRecipientUpdateInput!) { updateCampaignRecipient(id: $id, data: $data) { id } }`, { id, data });

// Event counts come from Twenty's aggregates in one query; it answers null rather than 0 for a campaign with no rows.
const EVENT_COUNTS = {
  deliveredCount: 'countNotEmptyDeliveredAt',
  openedCount: 'countNotEmptyOpenedAt',
  clickedCount: 'countNotEmptyClickedAt',
  bouncedCount: 'countNotEmptyBouncedAt',
  complainedCount: 'countNotEmptyComplainedAt',
  unsubscribedCount: 'countNotEmptyUnsubscribedAt',
} as const;

// Skips the write when nothing changed, so finished campaigns are not rewritten every run.
export const recountCampaign = async (campaignId: string, previous?: Record<CountField, number>) => {
  const count = async (filter: string) =>
    (await gql<{ campaignRecipients: { totalCount: number } }>(`query($id: UUID) { campaignRecipients(filter: { campaignId: { eq: $id }, ${filter} }) { totalCount } }`, { id: campaignId })).campaignRecipients.totalCount;
  const [all, sentCount, failedCount, skippedCount] = await Promise.all([
    gql<{ campaignRecipients: { totalCount: number } & Record<string, number | null> }>(`query($id: UUID) { campaignRecipients(filter: { campaignId: { eq: $id } }) { totalCount ${Object.values(EVENT_COUNTS).join(' ')} } }`, { id: campaignId }).then(
      (result) => result.campaignRecipients,
    ),
    count('status: { in: [SENT, DELIVERED, BOUNCED, COMPLAINED, UNSUBSCRIBED] }'),
    count('status: { eq: FAILED }'),
    count('status: { eq: SKIPPED }'),
  ]);
  const counts = {
    recipientCount: all.totalCount - skippedCount,
    sentCount,
    ...(Object.fromEntries(Object.entries(EVENT_COUNTS).map(([field, aggregate]) => [field, all[aggregate] ?? 0])) as Record<keyof typeof EVENT_COUNTS, number>),
    failedCount,
    skippedCount,
  };
  if (!previous || COUNT_FIELDS.some((field) => previous[field] !== counts[field])) await updateCampaign(campaignId, counts);
  return counts;
};

type RawBrand = Partial<Record<keyof Brand, string | null>> & { id: string };

export const loadBrand = async (): Promise<Brand & { id: string | null }> => {
  const raw = nodes(
    (await gql<{ campaignBrands: { edges: { node: RawBrand }[] } }>(`{ campaignBrands(orderBy: [{ createdAt: AscNullsLast }], first: 1) { edges { node { id name logoUrl primaryColor backgroundColor textColor fontFamily footerText websiteUrl } } } }`)).campaignBrands,
  )[0];
  if (!raw) return { ...DEFAULT_BRAND, id: null };
  return Object.fromEntries(Object.entries({ ...DEFAULT_BRAND, ...raw }).map(([key, value]) => [key, value ?? (DEFAULT_BRAND as Record<string, string>)[key] ?? ''])) as Brand & { id: string };
};

export const saveBrand = async (data: Partial<Brand> & { trackingKey?: string }) => {
  const brand = await loadBrand();
  if (brand.id) await gql(`mutation($id: UUID!, $data: CampaignBrandUpdateInput!) { updateCampaignBrand(id: $id, data: $data) { id } }`, { id: brand.id, data });
  else await gql(`mutation($data: CampaignBrandCreateInput!) { createCampaignBrand(data: $data) { id } }`, { data: { ...DEFAULT_BRAND, name: 'Brand kit', ...data } });
};

export type Person = {
  id: string;
  name: { firstName: string; lastName: string } | null;
  emails: { primaryEmail: string | null } | null;
  phones: { primaryPhoneNumber: string | null; primaryPhoneCallingCode: string | null } | null;
  company: { name: string } | null;
  emailMarketingConsent: boolean | null;
  whatsappMarketingConsent: boolean | null;
};

const PERSON_FIELDS = 'id name { firstName lastName } emails { primaryEmail } phones { primaryPhoneNumber primaryPhoneCallingCode } company { name } emailMarketingConsent whatsappMarketingConsent';

export const contactOf = (person: Pick<Person, 'name' | 'emails' | 'company'> | null): Contact => ({
  firstName: person?.name?.firstName ?? '',
  lastName: person?.name?.lastName ?? '',
  email: person?.emails?.primaryEmail ?? '',
  companyName: person?.company?.name ?? '',
});

type Page<TNode> = { edges: { node: TNode }[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } };

// One page of the audience: everyone on the list, or everyone who agreed for ALL. Consent is checked by the caller.
export const audiencePage = async (listId: string, channel: CampaignChannel, after: string | null) => {
  const consentField = channel === 'EMAIL' ? 'emailMarketingConsent' : 'whatsappMarketingConsent';
  if (listId === ALL_CONSENTED) {
    const page: Page<Person> = (
      await gql<{ people: Page<Person> }>(`query($after: String) { people(filter: { ${consentField}: { eq: true } }, orderBy: [{ id: AscNullsLast }], first: 200, after: $after) { edges { node { ${PERSON_FIELDS} } } pageInfo { hasNextPage endCursor } } }`, { after })
    ).people;
    return { people: nodes(page), next: page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null };
  }
  const page: Page<{ person: Person | null }> = (
    await gql<{ mailingListMembers: Page<{ person: Person | null }> }>(
      `query($list: UUID, $after: String) { mailingListMembers(filter: { listId: { eq: $list } }, orderBy: [{ id: AscNullsLast }], first: 200, after: $after) { edges { node { person { ${PERSON_FIELDS} } } } pageInfo { hasNextPage endCursor } } }`,
      { list: listId, after },
    )
  ).mailingListMembers;
  return { people: nodes(page).flatMap((member) => (member.person ? [member.person] : [])), next: page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null };
};

export type ContactState = Pick<Person, 'id' | 'emails' | 'phones' | 'emailMarketingConsent' | 'whatsappMarketingConsent'>;

export const currentContacts = async (personIds: string[]) =>
  personIds.length === 0
    ? []
    : nodes(
        (
          await gql<{ people: { edges: { node: ContactState }[] } }>(
            `query($ids: [UUID]) { people(filter: { id: { in: $ids } }, first: 200) { edges { node { id emails { primaryEmail } phones { primaryPhoneNumber primaryPhoneCallingCode } emailMarketingConsent whatsappMarketingConsent } } } }`,
            { ids: personIds },
          )
        ).people,
      );

export const suppressedAmong = async (addresses: string[], channel: CampaignChannel) =>
  addresses.length === 0
    ? new Set<string>()
    : new Set(
    nodes(
      (
        await gql<{ campaignSuppressions: { edges: { node: { destination: string | null } }[] } }>(
          `query($channel: CampaignSuppressionChannelEnum, $addresses: [String]) { campaignSuppressions(filter: { channel: { eq: $channel }, destination: { in: $addresses } }, first: 500) { edges { node { destination } } } }`,
          { channel, addresses },
        )
      ).campaignSuppressions,
    ).flatMap((entry) => (entry.destination ? [entry.destination] : [])),
  );

export const suppressedAddresses = async (channel: CampaignChannel) => {
  const addresses = new Set<string>();
  let after: string | null = null;
  do {
    const page: Page<{ destination: string | null }> = (
      await gql<{ campaignSuppressions: Page<{ destination: string | null }> }>(
        `query($channel: CampaignSuppressionChannelEnum, $after: String) { campaignSuppressions(filter: { channel: { eq: $channel } }, first: 500, after: $after) { edges { node { destination } } pageInfo { hasNextPage endCursor } } }`,
        { channel, after },
      )
    ).campaignSuppressions;
    for (const entry of nodes(page)) if (entry.destination) addresses.add(normaliseAddress(entry.destination, channel));
    after = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
  } while (after);
  return addresses;
};

export const normaliseAddress = (address: string, channel: CampaignChannel) => (channel === 'EMAIL' ? address.trim().toLowerCase() : address.replace(/[^0-9+]/g, ''));

export const isSuppressed = async (address: string, channel: CampaignChannel) =>
  nodes(
    (await gql<{ campaignSuppressions: { edges: { node: { id: string } }[] } }>(`query($address: String, $channel: CampaignSuppressionChannelEnum) { campaignSuppressions(filter: { destination: { eq: $address }, channel: { eq: $channel } }, first: 1) { edges { node { id } } } }`, { address: normaliseAddress(address, channel), channel }))
      .campaignSuppressions,
  ).length > 0;

export const addSuppression = async (address: string, channel: CampaignChannel, reason: SuppressionReason, campaignId: string | null, note = '') => {
  const normalised = normaliseAddress(address, channel);
  if (!normalised || (await isSuppressed(normalised, channel))) return false;
  await gql(`mutation($data: CampaignSuppressionCreateInput!) { createCampaignSuppression(data: $data) { id } }`, {
    data: { name: normalised, destination: normalised, channel, reason, campaignId: campaignId ?? '', note: note.slice(0, 500) },
  });
  return true;
};

export const withdrawConsent = (personId: string, channel: CampaignChannel) =>
  gql(`mutation($id: UUID!, $data: PersonUpdateInput!) { updatePerson(id: $id, data: $data) { id } }`, {
    id: personId,
    data: channel === 'EMAIL' ? { emailMarketingConsent: false } : { whatsappMarketingConsent: false },
  });

export const listMailingLists = async () =>
  nodes((await gql<{ mailingLists: { edges: { node: { id: string; name: string; description: string | null; memberCount: number | null } }[] } }>(`{ mailingLists(orderBy: [{ name: AscNullsLast }], first: 200) { edges { node { id name description memberCount } } } }`)).mailingLists);

export const getMailingList = async (id: string) =>
  (await gql<{ mailingList: { id: string; name: string } | null }>(`query($id: UUID!) { mailingList(filter: { id: { eq: $id } }) { id name } }`, { id })).mailingList;

export const consentedCount = async (channel: CampaignChannel) =>
  (await gql<{ people: { totalCount: number } }>(`{ people(filter: { ${channel === 'EMAIL' ? 'emailMarketingConsent' : 'whatsappMarketingConsent'}: { eq: true } }) { totalCount } }`)).people.totalCount;

export const PERSON_SEARCH_FIELDS = PERSON_FIELDS;
