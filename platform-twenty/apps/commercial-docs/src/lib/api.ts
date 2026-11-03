// Thin GraphQL client over the token and URL the platform injects into logic functions.
// Raw queries keep the app independent of the generated typed client, which changes with each workspace schema.
const getEnvironment = () => {
  const url = process.env.TWENTY_API_URL;
  const token = process.env.TWENTY_APP_ACCESS_TOKEN ?? process.env.TWENTY_API_KEY;
  if (!url || !token) throw new Error('TWENTY_API_URL and an access token must be set');
  return { url, token };
};

const request = async <TData>(
  endpoint: 'graphql' | 'metadata',
  query: string,
  variables: Record<string, unknown> = {},
): Promise<TData> => {
  const { url, token } = getEnvironment();
  const response = await fetch(`${url}/${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ query, variables }),
  });
  const payload = (await response.json()) as { data?: TData; errors?: { message: string }[] };
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

export const uploadFile = async ({
  bytes,
  filename,
  fieldUniversalIdentifier,
}: {
  bytes: Uint8Array;
  filename: string;
  fieldUniversalIdentifier: string;
}): Promise<{ id: string }> => {
  const { createFileUpload } = await request<{
    createFileUpload: { fileId: string; uploadUrl: string; contentType: string };
  }>(
    'metadata',
    `mutation($filename: String!, $size: Float!, $field: String!) {
      createFileUpload(filename: $filename, size: $size, fileFolder: FilesField, fieldMetadataUniversalIdentifier: $field) { fileId uploadUrl contentType }
    }`,
    { filename, size: bytes.byteLength, field: fieldUniversalIdentifier },
  );

  const upload = await fetch(createFileUpload.uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': createFileUpload.contentType },
    body: Buffer.from(bytes),
  });
  if (!upload.ok) throw new Error(`File upload failed (${upload.status}): ${await upload.text()}`);

  const { completeFileUpload } = await request<{ completeFileUpload: { id: string } }>(
    'metadata',
    `mutation($fileId: String!) { completeFileUpload(fileId: $fileId) { id } }`,
    { fileId: createFileUpload.fileId },
  );
  return completeFileUpload;
};

export const metadata = <TData>(query: string, variables?: Record<string, unknown>) =>
  request<TData>('metadata', query, variables);

export const downloadFile = async (url: string) => {
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`Could not read the file (${response.status})`);
  return new Uint8Array(await response.arrayBuffer());
};
