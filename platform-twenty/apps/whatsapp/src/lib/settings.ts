import { listConnections } from 'twenty-sdk/logic-function';

import { gql, metadata, nodes } from 'src/lib/api';
import { openText } from 'src/lib/crypto';
import { InventiveChatError, type InventiveChatContext } from 'src/lib/inventivechat';

export const CONNECTION_NAME = 'inventivechat';

export type Settings = {
  id: string;
  tenantId: string | null;
  whatsappAccountId: string | null;
  phoneNumber: string | null;
  displayName: string | null;
  subscriptionId: string | null;
  webhookSecret: string | null;
  webhookUrl: string | null;
  webhookProblem: string | null;
  keyFingerprint: string | null;
  autoCreatePeople: boolean | null;
  gatewayTemplates: unknown;
  defaultLanguageCode: string | null;
};

const SETTINGS_FIELDS = 'id tenantId whatsappAccountId phoneNumber displayName subscriptionId webhookSecret webhookUrl webhookProblem keyFingerprint autoCreatePeople gatewayTemplates defaultLanguageCode';

// Extra rows created by hand are ignored: the oldest one is the workspace's settings.
export const loadSettings = async () =>
  nodes((await gql<{ whatsappSettingsRecords: { edges: { node: Settings }[] } }>(`{ whatsappSettingsRecords(orderBy: [{ createdAt: AscNullsLast }], first: 1) { edges { node { ${SETTINGS_FIELDS} } } } }`)).whatsappSettingsRecords)[0] ?? null;

export const saveSettings = async (data: Record<string, unknown>) => {
  const current = await loadSettings();
  if (current) return gql(`mutation($id: UUID!, $data: WhatsappSettingsUpdateInput!) { updateWhatsappSettings(id: $id, data: $data) { id } }`, { id: current.id, data });
  return gql(`mutation($data: WhatsappSettingsCreateInput!) { createWhatsappSettings(data: $data) { id } }`, { data: { name: 'WhatsApp settings', ...data } });
};

export const webhookSecretContext = (settings: Pick<Settings, 'tenantId' | 'subscriptionId'>) => `inventivechat-webhook:${settings.tenantId ?? ''}:${settings.subscriptionId ?? ''}`;

export const webhookSecretOf = (settings: Settings) => openText(settings.webhookSecret, webhookSecretContext(settings));

export const workingConnections = async () => (await listConnections({ providerName: CONNECTION_NAME, scope: 'WORKSPACE' }).catch(() => [])).filter((connection) => connection.accessToken && !connection.authFailedAt);

export const isKeyConnected = async (fingerprint: string) => (await workingConnections()).some((connection) => connection.externalAccountId === `inventivechat-${fingerprint}`);

// Twenty lists connections in no set order; sorting keeps every run on the same account.
export const connectedKey = async () => (await workingConnections()).sort((left, right) => left.id.localeCompare(right.id))[0]?.accessToken ?? null;

export const NOT_CONNECTED = 'WhatsApp is not connected yet. An admin can connect InventiveChat under Settings, Accounts.';

export const contextFor = async (settings: Settings | null): Promise<InventiveChatContext> => {
  const key = await connectedKey();
  if (!key || !settings?.tenantId) throw new InventiveChatError(NOT_CONNECTED, 0, 'not_connected');
  return { key, tenantId: settings.tenantId };
};

type WorkspaceUrls = { customUrl: string | null; subdomainUrl: string };

const workspaceUrls = async () => (await metadata<{ currentWorkspace: { workspaceUrls: WorkspaceUrls } }>(`{ currentWorkspace { workspaceUrls { customUrl subdomainUrl } } }`)).currentWorkspace.workspaceUrls;

export const functionsBaseUrl = async () => {
  if (process.env.TWENTY_FUNCTIONS_URL) return process.env.TWENTY_FUNCTIONS_URL.replace(/\/$/, '');
  const urls = await workspaceUrls();
  return `${(urls.customUrl || urls.subdomainUrl).replace(/\/$/, '')}/s`;
};

const originOf = (url: string | null | undefined) => {
  try {
    return url ? new URL(url).origin : null;
  } catch {
    return null;
  }
};

// The addresses this workspace answers on: its own subdomain, its custom domain, and the functions URL if one is set.
export const ownOrigins = async () => {
  const urls = await workspaceUrls().catch(() => null);
  return [originOf(urls?.subdomainUrl), originOf(urls?.customUrl), originOf(process.env.TWENTY_FUNCTIONS_URL)].filter((origin): origin is string => origin !== null);
};

// Status callbacks are only ever sent back to this workspace's own app routes, never to another host.
export const isOwnCallbackUrl = (url: unknown, origins: string[]): url is string => {
  if (typeof url !== 'string' || url.length > 500) return false;
  try {
    const parsed = new URL(url);
    return (parsed.protocol === 'https:' || parsed.protocol === 'http:') && !parsed.username && !parsed.password && origins.includes(parsed.origin) && parsed.pathname.startsWith('/s/');
  } catch {
    return false;
  }
};
