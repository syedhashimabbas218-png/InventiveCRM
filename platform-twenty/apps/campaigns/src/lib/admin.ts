import { type CampaignChannel, TEMPLATE_CATEGORIES } from 'src/constants/enums';
import { STARTER_TEMPLATES } from 'src/constants/starter-templates';
import { gql, nodes } from 'src/lib/api';
import { type Brand, FONTS, parseDesign, renderEmail, unknownVariables } from 'src/lib/design';
import { campaignProblems, functionsBaseUrl, fromAddress, isEmail, STOPPED } from 'src/lib/engine';
import { connectionLabel, ensureWebhook, hasWebhook, listDomains, resendKey, sendOne } from 'src/lib/resend';
import {
  ALL_CONSENTED,
  consentedCount,
  createCampaign,
  getCampaign,
  getMailingList,
  listCampaigns,
  listMailingLists,
  loadBrand,
  PERSON_SEARCH_FIELDS,
  type Person,
  saveBrand,
  updateCampaign,
  updateCampaignIf,
  updateRecipientsIf,
} from 'src/lib/store';
import { webhookToken } from 'src/lib/tokens';

export class AdminError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

const text = (value: unknown, max = 300) => (typeof value === 'string' ? value.trim().slice(0, max) : '');
const id = (value: unknown) => {
  const candidate = text(value, 40);
  if (!/^[0-9a-f-]{36}$/.test(candidate)) throw new AdminError('A record id is missing or not valid.');
  return candidate;
};

const likeLiteral = (value: string) => `%${value.replace(/[\\%_]/g, (character) => `\\${character}`)}%`;

const webhookUrl = async () => `${await functionsBaseUrl()}/campaigns/webhook/${webhookToken()}`;

const overview = async () => {
  const key = await resendKey();
  const [domains, webhookReady, brand, campaigns, lists, saved, emailConsented, whatsappConsented, suppressions] = await Promise.all([
    key ? listDomains(key).catch(() => null) : Promise.resolve([]),
    key ? webhookUrl().then((url) => hasWebhook(key, url)).catch(() => false) : Promise.resolve(false),
    loadBrand(),
    listCampaigns(),
    listMailingLists(),
    gql<{ campaignTemplates: { edges: { node: { id: string; name: string; category: string; description: string | null } }[] } }>(`{ campaignTemplates(orderBy: [{ updatedAt: DescNullsLast }], first: 100) { edges { node { id name category description } } } }`),
    consentedCount('EMAIL'),
    consentedCount('WHATSAPP'),
    gql<{ campaignSuppressions: { totalCount: number } }>(`{ campaignSuppressions { totalCount } }`),
  ]);
  return {
    resend: { connected: Boolean(key), label: key ? await connectionLabel() : null, reachable: domains !== null, webhookReady, domains: domains ?? [] },
    whatsappEnabled: Boolean(process.env.WHATSAPP_GATEWAY_URL && process.env.WHATSAPP_GATEWAY_SECRET),
    brand,
    fonts: FONTS,
    campaigns,
    lists,
    templates: [
      ...STARTER_TEMPLATES.map((template) => ({ id: `starter:${template.key}`, name: template.name, category: template.category, description: template.description, starter: true })),
      ...nodes(saved.campaignTemplates).map((template) => ({ ...template, description: template.description ?? '', starter: false })),
    ],
    audience: { emailConsented, whatsappConsented, suppressions: suppressions.campaignSuppressions.totalCount },
  };
};

const templateDesign = async (templateId: string) => {
  if (templateId.startsWith('starter:')) return STARTER_TEMPLATES.find((template) => `starter:${template.key}` === templateId)?.design ?? STARTER_TEMPLATES[0].design;
  const template = (await gql<{ campaignTemplate: { design: unknown } | null }>(`query($id: UUID!) { campaignTemplate(filter: { id: { eq: $id } }) { design } }`, { id: id(templateId) })).campaignTemplate;
  return parseDesign(template?.design);
};

const createDraft = async (body: Record<string, unknown>) => {
  const channel: CampaignChannel = body.channel === 'WHATSAPP' ? 'WHATSAPP' : 'EMAIL';
  const brand = await loadBrand();
  const design = channel === 'EMAIL' ? await templateDesign(text(body.templateId, 60) || 'starter:blank') : { version: 1, blocks: [] };
  const name = text(body.name, 200) || `New ${channel === 'EMAIL' ? 'email' : 'WhatsApp'} campaign`;
  const campaignId = await createCampaign({ name, channel, status: 'DRAFT', design, fromName: brand.name, fromLocalPart: 'hello', listId: '', listName: '' });
  return { id: campaignId };
};

const editable = async (campaignId: string) => {
  const campaign = await getCampaign(campaignId);
  if (!campaign) throw new AdminError('This campaign no longer exists.', 404);
  if (campaign.status !== 'DRAFT') throw new AdminError('Only drafts can be changed. Duplicate the campaign to make a new version.');
  return campaign;
};

const saveDraft = async (body: Record<string, unknown>) => {
  const campaign = await editable(id(body.id));
  const changes = (body.changes && typeof body.changes === 'object' ? body.changes : {}) as Record<string, unknown>;
  const data: Record<string, unknown> = {};
  for (const field of ['name', 'subject', 'previewText', 'fromName', 'fromLocalPart', 'fromDomain', 'replyTo', 'whatsappTemplate'] as const)
    if (field in changes) data[field] = text(changes[field], field === 'previewText' ? 200 : 250);
  if ('listId' in changes) {
    const listId = text(changes.listId, 40);
    if (listId === ALL_CONSENTED) Object.assign(data, { listId, listName: `Everyone who agreed (${campaign.channel === 'EMAIL' ? 'email' : 'WhatsApp'})` });
    else if (listId) {
      const list = await getMailingList(id(listId));
      if (!list) throw new AdminError('That mailing list no longer exists.');
      Object.assign(data, { listId: list.id, listName: list.name });
    } else Object.assign(data, { listId: '', listName: '' });
  }
  if ('design' in changes) data.design = parseDesign(changes.design);
  if ('whatsappVariables' in changes && changes.whatsappVariables && typeof changes.whatsappVariables === 'object')
    data.whatsappVariables = Object.fromEntries(Object.entries(changes.whatsappVariables as Record<string, unknown>).slice(0, 12).map(([name, value]) => [name.slice(0, 20), text(value, 500)]));
  if (Object.keys(data).length) await updateCampaign(campaign.id, data);
  return { saved: true };
};

const SAMPLE_CONTACT = { firstName: 'Alex', lastName: 'Morgan', email: 'alex@example.com', companyName: 'Example Ltd' };

const preview = async (body: Record<string, unknown>) => {
  const brand = await loadBrand();
  const design = parseDesign(body.design);
  const rendered = renderEmail(design, brand, { subject: text(body.subject, 250), previewText: text(body.previewText, 200), unsubscribeUrl: '#unsubscribe', contact: SAMPLE_CONTACT });
  return { html: rendered.html, text: rendered.text, unknownVariables: unknownVariables(design, text(body.subject, 250)) };
};

const testSend = async (body: Record<string, unknown>) => {
  const campaign = await getCampaign(id(body.id));
  if (!campaign) throw new AdminError('This campaign no longer exists.', 404);
  if (campaign.channel !== 'EMAIL') throw new AdminError('Test sends are for email campaigns.');
  const to = (Array.isArray(body.to) ? body.to : String(body.to ?? '').split(/[,\s]+/)).map((value) => text(value, 254).toLowerCase()).filter(Boolean);
  if (to.length === 0 || to.length > 5 || !to.every(isEmail)) throw new AdminError('Enter up to five valid email addresses.');
  const key = await resendKey();
  if (!key) throw new AdminError('Connect your Resend account under Settings, Accounts first.');
  if (!campaign.fromDomain || !campaign.fromLocalPart) throw new AdminError('Choose a sending address first.');
  const brand = await loadBrand();
  const unsubscribe = `${await functionsBaseUrl()}/campaigns/unsubscribe/test`;
  const rendered = renderEmail(campaign.design, brand, { subject: campaign.subject || campaign.name, previewText: campaign.previewText, unsubscribeUrl: unsubscribe, contact: SAMPLE_CONTACT });
  try {
    await sendOne(key, {
      from: fromAddress(campaign),
      to,
      subject: `[Test] ${rendered.subject}`.slice(0, 250),
      html: rendered.html,
      text: rendered.text,
      ...(campaign.replyTo ? { reply_to: campaign.replyTo } : {}),
      headers: {},
      tags: [{ name: 'campaign', value: 'test' }],
    });
  } catch (error) {
    throw new AdminError((error as Error).message);
  }
  return { sent: to.length };
};

const checks = async (body: Record<string, unknown>) => {
  const campaign = await getCampaign(id(body.id));
  if (!campaign) throw new AdminError('This campaign no longer exists.', 404);
  return { problems: await campaignProblems(campaign, await loadBrand()) };
};

const schedule = async (body: Record<string, unknown>) => {
  const campaign = await editable(id(body.id));
  const problems = await campaignProblems(campaign, await loadBrand());
  if (problems.length) throw new AdminError(problems.join(' '));
  const now = Date.now();
  const sendAt = body.sendAt ? Date.parse(String(body.sendAt)) : now;
  if (Number.isNaN(sendAt) || sendAt < now - 60_000 || sendAt > now + 366 * 86_400_000) throw new AdminError('Choose a send time between now and one year ahead.');
  if (!(await updateCampaignIf(campaign.id, ['DRAFT'], { status: 'SCHEDULED', scheduledAt: new Date(Math.max(sendAt, now)).toISOString(), lastError: '' }))) throw new AdminError('This campaign is no longer a draft.');
  return { scheduled: true };
};

const cancel = async (body: Record<string, unknown>) => {
  const campaign = await getCampaign(id(body.id));
  if (!campaign) throw new AdminError('This campaign no longer exists.', 404);
  if (campaign.status === 'SCHEDULED' && (await updateCampaignIf(campaign.id, ['SCHEDULED'], { status: 'DRAFT', scheduledAt: null }))) return { cancelled: true };
  if (await updateCampaignIf(campaign.id, ['PREPARING', 'SENDING'], { status: 'CANCELLED', lastError: 'Stopped by a user. Contacts not reached yet were not sent anything.' })) {
    // A batch already handed to the provider finishes; nothing after it is sent.
    await updateRecipientsIf({ campaignId: campaign.id, status: 'QUEUED' }, { status: 'SKIPPED', error: STOPPED });
    return { cancelled: true };
  }
  throw new AdminError('Only scheduled or sending campaigns can be stopped.');
};

// A failed or stopped campaign carries on with the contacts not reached yet; nobody gets it twice.
const resume = async (body: Record<string, unknown>) => {
  const campaign = await getCampaign(id(body.id));
  if (!campaign?.startedAt) throw new AdminError('Only a campaign that stopped part-way can be resumed.');
  if (!(await updateCampaignIf(campaign.id, ['FAILED', 'CANCELLED'], { status: campaign.prepareCursor === 'DONE' ? 'SENDING' : 'PREPARING', lastError: '' })))
    throw new AdminError('Only a campaign that stopped part-way can be resumed.');
  await updateRecipientsIf({ campaignId: campaign.id, status: 'SKIPPED', error: STOPPED }, { status: 'QUEUED', error: '' });
  return { resumed: true };
};

const duplicate = async (body: Record<string, unknown>) => {
  const campaign = await getCampaign(id(body.id));
  if (!campaign) throw new AdminError('This campaign no longer exists.', 404);
  const copyId = await createCampaign({
    name: `${campaign.name} (copy)`.slice(0, 200),
    channel: campaign.channel,
    status: 'DRAFT',
    subject: campaign.subject,
    previewText: campaign.previewText,
    fromName: campaign.fromName,
    fromLocalPart: campaign.fromLocalPart,
    fromDomain: campaign.fromDomain,
    replyTo: campaign.replyTo,
    listId: campaign.listId,
    listName: campaign.listName,
    design: campaign.design,
    whatsappTemplate: campaign.whatsappTemplate,
    whatsappVariables: campaign.whatsappVariables,
  });
  return { id: copyId };
};

const report = async (body: Record<string, unknown>) => {
  const campaign = await getCampaign(id(body.id));
  if (!campaign) throw new AdminError('This campaign no longer exists.', 404);
  const problems = nodes(
    (
      await gql<{ campaignRecipients: { edges: { node: { id: string; name: string; destination: string; status: string; error: string | null } }[] } }>(
        `query($id: UUID) { campaignRecipients(filter: { campaignId: { eq: $id }, status: { in: [BOUNCED, COMPLAINED, FAILED] } }, orderBy: [{ updatedAt: DescNullsLast }], first: 25) { edges { node { id name destination status error } } } }`,
        { id: campaign.id },
      )
    ).campaignRecipients,
  ).map(({ destination, ...problem }) => ({ ...problem, address: destination }));
  const { design: _design, ...summary } = campaign;
  return { campaign: summary, problems };
};

const saveTemplate = async (body: Record<string, unknown>) => {
  const name = text(body.name, 200);
  if (!name) throw new AdminError('Give the template a name.');
  const category = text(body.category, 30);
  await gql(`mutation($data: CampaignTemplateCreateInput!) { createCampaignTemplate(data: $data) { id } }`, {
    data: { name, category: category in TEMPLATE_CATEGORIES ? category : 'OTHER', description: text(body.description, 500), design: parseDesign(body.design) },
  });
  return { saved: true };
};

const updateBrand = async (body: Record<string, unknown>) => {
  const changes = (body.changes && typeof body.changes === 'object' ? body.changes : {}) as Record<string, unknown>;
  const data: Partial<Brand> = {};
  for (const field of ['name', 'logoUrl', 'websiteUrl', 'footerText'] as const) if (field in changes) data[field] = text(changes[field], field === 'footerText' ? 1000 : 2000);
  for (const field of ['primaryColor', 'backgroundColor', 'textColor'] as const)
    if (field in changes) {
      const value = text(changes[field], 7);
      if (!/^#[0-9a-fA-F]{6}$/.test(value)) throw new AdminError('Colours must look like #3e63dd.');
      data[field] = value;
    }
  if ('fontFamily' in changes) data.fontFamily = FONTS.includes(text(changes.fontFamily, 100)) ? text(changes.fontFamily, 100) : FONTS[0];
  await saveBrand(data);
  return { saved: true };
};

const setupTracking = async () => {
  const key = await resendKey();
  if (!key) throw new AdminError('Connect your Resend account under Settings, Accounts first.');
  const url = await webhookUrl();
  if (!url.startsWith('https://')) throw new AdminError('Delivery tracking needs the CRM to be reachable on a public https address. It is turned on once the CRM is live.');
  try {
    return await ensureWebhook(key, url);
  } catch (error) {
    throw new AdminError((error as Error).message);
  }
};

type Member = { id: string; person: Pick<Person, 'id' | 'name' | 'emails' | 'emailMarketingConsent' | 'whatsappMarketingConsent'> | null };

const listMembers = async (body: Record<string, unknown>) => {
  const listId = id(body.listId);
  const result = await gql<{ mailingListMembers: { totalCount: number; edges: { node: Member }[] } }>(
    `query($list: UUID) { mailingListMembers(filter: { listId: { eq: $list } }, orderBy: [{ createdAt: DescNullsLast }], first: 200) { totalCount edges { node { id person { id name { firstName lastName } emails { primaryEmail } emailMarketingConsent whatsappMarketingConsent } } } } }`,
    { list: listId },
  );
  return { total: result.mailingListMembers.totalCount, members: nodes(result.mailingListMembers) };
};

const refreshListCount = async (listId: string) => {
  const total = (await gql<{ mailingListMembers: { totalCount: number } }>(`query($list: UUID) { mailingListMembers(filter: { listId: { eq: $list } }) { totalCount } }`, { list: listId })).mailingListMembers.totalCount;
  await gql(`mutation($id: UUID!, $data: MailingListUpdateInput!) { updateMailingList(id: $id, data: $data) { id } }`, { id: listId, data: { memberCount: total } });
  return total;
};

const createList = async (body: Record<string, unknown>) => {
  const name = text(body.name, 200);
  if (!name) throw new AdminError('Give the list a name.');
  const created = await gql<{ createMailingList: { id: string } }>(`mutation($data: MailingListCreateInput!) { createMailingList(data: $data) { id } }`, { data: { name, description: text(body.description, 500), memberCount: 0 } });
  return { id: created.createMailingList.id };
};

const searchPeople = async (body: Record<string, unknown>) => {
  const query = text(body.query, 100);
  if (query.length < 2) return { people: [] };
  const pattern = likeLiteral(query);
  const people = nodes(
    (
      await gql<{ people: { edges: { node: Person }[] } }>(
        `query($pattern: String) { people(filter: { or: [{ name: { firstName: { ilike: $pattern } } }, { name: { lastName: { ilike: $pattern } } }, { emails: { primaryEmail: { ilike: $pattern } } }] }, first: 20) { edges { node { ${PERSON_SEARCH_FIELDS} } } } }`,
        { pattern },
      )
    ).people,
  );
  return { people };
};

const addMembers = async (listId: string, personIds: string[]) => {
  if (personIds.length === 0) return 0;
  const existing = new Set<string>();
  for (let start = 0; start < personIds.length; start += 200) {
    const chunk = personIds.slice(start, start + 200);
    for (const member of nodes(
      (await gql<{ mailingListMembers: { edges: { node: { personId: string } }[] } }>(`query($list: UUID, $ids: [UUID]) { mailingListMembers(filter: { listId: { eq: $list }, personId: { in: $ids } }, first: 200) { edges { node { personId } } } }`, { list: listId, ids: chunk })).mailingListMembers,
    ))
      existing.add(member.personId);
  }
  const fresh = [...new Set(personIds)].filter((personId) => !existing.has(personId));
  for (let start = 0; start < fresh.length; start += 100)
    await gql(`mutation($data: [MailingListMemberCreateInput!]!) { createMailingListMembers(data: $data) { id } }`, { data: fresh.slice(start, start + 100).map((personId) => ({ name: 'Member', listId, personId })) });
  return fresh.length;
};

const addToList = async (body: Record<string, unknown>) => {
  const listId = id(body.listId);
  if (!(await getMailingList(listId))) throw new AdminError('That mailing list no longer exists.');
  const personIds = (Array.isArray(body.personIds) ? body.personIds : []).slice(0, 500).map(id);
  const added = await addMembers(listId, personIds);
  return { added, total: await refreshListCount(listId) };
};

// Fills a list with everyone who agreed on a channel, e.g. to start a "Newsletter" list.
const addConsentedToList = async (body: Record<string, unknown>) => {
  const listId = id(body.listId);
  if (!(await getMailingList(listId))) throw new AdminError('That mailing list no longer exists.');
  const channel: CampaignChannel = body.channel === 'WHATSAPP' ? 'WHATSAPP' : 'EMAIL';
  const ids: string[] = [];
  let after: string | null = null;
  do {
    const page: { edges: { node: { id: string } }[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } } = (
      await gql<{ people: { edges: { node: { id: string } }[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } } }>(
        `query($after: String) { people(filter: { ${channel === 'EMAIL' ? 'emailMarketingConsent' : 'whatsappMarketingConsent'}: { eq: true } }, first: 200, after: $after) { edges { node { id } } pageInfo { hasNextPage endCursor } } }`,
        { after },
      )
    ).people;
    ids.push(...nodes(page).map((person) => person.id));
    after = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
  } while (after && ids.length < 20_000);
  const added = await addMembers(listId, ids);
  return { added, total: await refreshListCount(listId) };
};

const removeFromList = async (body: Record<string, unknown>) => {
  const memberId = id(body.memberId);
  const member = (await gql<{ mailingListMember: { id: string; listId: string } | null }>(`query($id: UUID!) { mailingListMember(filter: { id: { eq: $id } }) { id listId } }`, { id: memberId })).mailingListMember;
  if (!member) return { removed: false };
  await gql(`mutation($id: UUID!) { deleteMailingListMember(id: $id) { id } }`, { id: memberId });
  return { removed: true, total: await refreshListCount(member.listId) };
};

const campaign = async (body: Record<string, unknown>) => {
  const found = await getCampaign(id(body.id));
  if (!found) throw new AdminError('This campaign no longer exists.', 404);
  return found;
};

const ACTIONS: Record<string, (body: Record<string, unknown>) => Promise<unknown>> = {
  overview,
  campaign,
  createDraft,
  saveDraft,
  preview,
  testSend,
  checks,
  schedule,
  cancel,
  resume,
  duplicate,
  report,
  saveTemplate,
  updateBrand,
  setupTracking,
  listMembers,
  createList,
  searchPeople,
  addToList,
  addConsentedToList,
  removeFromList,
};

export const handleAdmin = (body: Record<string, unknown>) => {
  const action = ACTIONS[String(body.action ?? '')];
  if (!action) throw new AdminError('Unknown action.');
  return action(body);
};

