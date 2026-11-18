import { AsyncLocalStorage } from 'node:async_hooks';

// Thin GraphQL client over the token and URL the platform injects into logic functions.
// Raw queries keep the app independent of the generated typed client, which changes with each workspace schema.
const applicationAccess = new AsyncLocalStorage<boolean>();

// Same as the SDK's runAs: 'application'. Background work must not depend on the role of whoever triggered it.
export const asApplication = <TResult>(work: () => Promise<TResult>) => applicationAccess.run(true, work);

export const accessToken = () =>
  (applicationAccess.getStore() ? process.env.TWENTY_APP_APPLICATION_ACCESS_TOKEN : undefined) ?? process.env.TWENTY_APP_ACCESS_TOKEN ?? process.env.TWENTY_API_KEY;

// Caches only for the current token: a warm function process can serve another run, or another workspace.
export const cachedForRun = <TValue>(load: () => Promise<TValue>) => {
  let cached: { token: string | undefined; value: Promise<TValue> } | null = null;
  return () => {
    const token = accessToken();
    if (!cached || cached.token !== token) {
      const value = load();
      value.catch(() => (cached = null));
      cached = { token, value };
    }
    return cached.value;
  };
};

const REQUEST_TIMEOUT_MS = 30_000;

// Twenty could not answer at all (timeout, restart, proxy error page), as opposed to refusing the query: worth retrying.
export class TwentyUnavailableError extends Error {}

// Twenty hands an API-key caller the app's own token, so a route acting for a person must refuse anyone who is not one.
export const isSignedInPerson = (event: { userWorkspaceId?: string | null }) => typeof event.userWorkspaceId === 'string' && event.userWorkspaceId.length > 0;

const getEnvironment = () => {
  const url = process.env.TWENTY_API_URL;
  const token = accessToken();
  if (!url || !token) throw new Error('TWENTY_API_URL and an access token must be set');
  return { url, token };
};

const request = async <TData>(
  endpoint: 'graphql' | 'metadata',
  query: string,
  variables: Record<string, unknown> = {},
): Promise<TData> => {
  const { url, token } = getEnvironment();
  let response: Response;
  try {
    response = await fetch(`${url}/${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    throw new TwentyUnavailableError(`Twenty did not answer: ${(error as Error).message}`);
  }
  const payload = (await response.json().catch(() => null)) as { data?: TData; errors?: { message: string }[] } | null;
  if (!payload) throw new TwentyUnavailableError(`Twenty answered ${response.status} without a GraphQL body`);
  if (payload.errors?.length) {
    throw new Error(`GraphQL error: ${payload.errors.map((error) => error.message).join('; ')}`);
  }
  if (!payload.data) throw new Error(`Empty GraphQL response (${response.status})`);
  return payload.data;
};

export const gql = <TData>(query: string, variables?: Record<string, unknown>) =>
  request<TData>('graphql', query, variables);

type Connection<TNode> = { edges: { node: TNode }[] };

export const nodes = <TNode>(connection: Connection<TNode> | null | undefined): TNode[] =>
  connection?.edges.map((edge) => edge.node) ?? [];


export const metadata = <TData>(query: string, variables?: Record<string, unknown>) =>
  request<TData>('metadata', query, variables);

