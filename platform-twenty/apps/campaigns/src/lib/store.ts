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
  counts: Record<CountField, number>;
};

export const COUNT_FIELDS = ['recipientCount', 'sentCount', 'deliveredCount', 'openedCount', 'clickedCount', 'bouncedCount', 'complainedCount', 'unsubscribedCount', 'failedCount', 'skippedCount'] as const;
export type CountField = (typeof COUNT_FIELDS)[number];

const CAMPAIGN_FIELDS = `id name channel status subject previewText fromName fromLocalPart fromDomain replyTo listId listName design scheduledAt startedAt sentAt whatsappTemplate whatsappVariables lastError ${COUNT_FIELDS.join(' ')}`;
const CAMPAIGN_SUMMARY_FIELDS = `id name channel status subject listName scheduledAt startedAt sentAt lastError updatedAt ${COUNT_FIELDS.join(' ')}`;

type RawCampaign = Omit<Campaign, 'design' | 'counts' | 'whatsappVariables'> & { design: unknown; whatsappVariables: unknown } & Record<CountField, number | null>;

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

export const recentlySent = async (sinceIso: string) =>
  nodes(
    (await gql<{ marketingCampaigns: { edges: { node: { id: string } }[] } }>(`query($since: DateTime) { marketingCampaigns(filter: { status: { eq: SENT }, sentAt: { gte: $since } }, first: 50) { edges { node { id } } } }`, { since: sinceIso }))
      .marketingCampaigns,
  );

export const createCampaign = async (data: Record<string, unknown>) =>
  (await gql<{ createMarketingCampaign: { id: string } }>(`mutation($data: MarketingCampaignCreateInput!) { createMarketingCampaign(data: $data) { id } }`, { data })).createMarketingCampaign.id;

export const updateCampaign = (id: string, data: Record<string, unknown>) =>
  gql(`mutation($id: UUID!, $data: MarketingCampaignUpdateInput!) { updateMarketingCampaign(id: $id, data: $data) { id } }`, { id, data });

export type Recipient = {
  id: string;
  name: string;
  address: string;
  status: RecipientStatus;
  nonce: string;
  providerMessageId: string | null;
  campaignId: string;
  personId: string | null;
  person: { name: { firstName: string; lastName: string } | null; company: { name: string } | null } | null;
};

const RECIPIENT_FIELDS = 'id name destination status nonce providerMessageId campaignId personId person { name { firstName lastName } company { name } }';

type RawRecipient = Omit<Recipient, 'address'> & { destination: string | null };

const toRecipient = ({ destination, ...raw }: RawRecipient): Recipient => ({ ...raw, address: destination ?? '' });

export const getRecipient = async (id: string) => {
  const raw = (await gql<{ campaignRecipient: RawRecipient | null }>(`query($id: UUID!) { campaignRecipient(filter: { id: { eq: $id } }) { ${RECIPIENT_FIELDS} } }`, { id })).campaignRecipient;
  return raw ? toRecipient(raw) : null;
};

export const recipientByMessageId = async (messageId: string) =>
  nodes((await gql<{ campaignRecipients: { edges: { node: RawRecipient }[] } }>(`query($id: String) { campaignRecipients(filter: { providerMessageId: { eq: $id } }, first: 1) { edges { node { ${RECIPIENT_FIELDS} } } } }`, { id: messageId })).campaignRecipients).map(toRecipient)[0] ?? null;

// Oldest first and by id, so a retried run picks the same batch and its idempotency key matches.
export const queuedRecipients = async (campaignId: string, limit: number) =>
  nodes(
    (
      await gql<{ campaignRecipients: { edges: { node: RawRecipient }[] } }>(
        `query($id: UUID) { campaignRecipients(filter: { campaignId: { eq: $id }, status: { eq: QUEUED } }, orderBy: [{ createdAt: AscNullsLast }, { id: AscNullsLast }], first: ${limit}) { edges { node { ${RECIPIENT_FIELDS} } } } }`,
        { id: campaignId },
      )
    ).campaignRecipients,
  ).map(toRecipient);

export const createRecipients = async (rows: Record<string, unknown>[]) => {
  for (let start = 0; start < rows.length; start += 100)
    await gql(`mutation($data: [CampaignRecipientCreateInput!]!) { createCampaignRecipients(data: $data) { id } }`, { data: rows.slice(start, start + 100) });
};

// Twenty allows each resolver once per request, so updates go one by one, a few at a time.
export const updateRecipients = async (updates: { id: string; data: Record<string, unknown> }[]) => {
  for (let start = 0; start < updates.length; start += 10)
    await Promise.all(
      updates.slice(start, start + 10).map((update) => gql(`mutation($id: UUID!, $data: CampaignRecipientUpdateInput!) { updateCampaignRecipient(id: $id, data: $data) { id } }`, { id: update.id, data: update.data })),
    );
};

export const updateRecipient = (id: string, data: Record<string, unknown>) => updateRecipients([{ id, data }]);

const COUNT_FILTERS: Record<CountField, string> = {
  recipientCount: '',
  sentCount: 'status: { in: [SENT, DELIVERED, BOUNCED, COMPLAINED, UNSUBSCRIBED] }',
  deliveredCount: 'deliveredAt: { is: NOT_NULL }',
  openedCount: 'openedAt: { is: NOT_NULL }',
  clickedCount: 'clickedAt: { is: NOT_NULL }',
  bouncedCount: 'bouncedAt: { is: NOT_NULL }',
  complainedCount: 'complainedAt: { is: NOT_NULL }',
  unsubscribedCount: 'unsubscribedAt: { is: NOT_NULL }',
  failedCount: 'status: { eq: FAILED }',
  skippedCount: '',
};

export const recountCampaign = async (campaignId: string) => {
  const fields = COUNT_FIELDS.filter((field) => field !== 'skippedCount');
  const totals = await Promise.all(
    fields.map(
      async (field) =>
        (await gql<{ campaignRecipients: { totalCount: number } }>(`query($id: UUID) { campaignRecipients(filter: { campaignId: { eq: $id } ${COUNT_FILTERS[field] ? `, ${COUNT_FILTERS[field]}` : ''} }) { totalCount } }`, { id: campaignId })).campaignRecipients.totalCount,
    ),
  );
  const counts = Object.fromEntries(fields.map((field, index) => [field, totals[index]]));
  await updateCampaign(campaignId, counts);
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

export const saveBrand = async (data: Partial<Brand>) => {
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

const MAX_AUDIENCE = 50_000;

// Everyone on the list (or every contact who agreed, for ALL); consent is checked by the caller.
export const audiencePeople = async (listId: string, channel: CampaignChannel) => {
  const people: Person[] = [];
  let after: string | null = null;
  const consentField = channel === 'EMAIL' ? 'emailMarketingConsent' : 'whatsappMarketingConsent';
  do {
    if (listId === ALL_CONSENTED) {
      const page: Page<Person> = (
        await gql<{ people: Page<Person> }>(`query($after: String) { people(filter: { ${consentField}: { eq: true } }, orderBy: [{ id: AscNullsLast }], first: 200, after: $after) { edges { node { ${PERSON_FIELDS} } } pageInfo { hasNextPage endCursor } } }`, { after })
      ).people;
      people.push(...nodes(page));
      after = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
    } else {
      const page: Page<{ person: Person | null }> = (
        await gql<{ mailingListMembers: Page<{ person: Person | null }> }>(
          `query($list: UUID, $after: String) { mailingListMembers(filter: { listId: { eq: $list } }, orderBy: [{ id: AscNullsLast }], first: 200, after: $after) { edges { node { person { ${PERSON_FIELDS} } } } pageInfo { hasNextPage endCursor } } }`,
          { list: listId, after },
        )
      ).mailingListMembers;
      people.push(...nodes(page).flatMap((member) => (member.person ? [member.person] : [])));
      after = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
    }
  } while (after && people.length < MAX_AUDIENCE);
  return people;
};

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
