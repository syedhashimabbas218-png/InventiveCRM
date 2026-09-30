import { createHash } from 'node:crypto';
import { parseFormSchema, type FormSchema } from '../shared/forms.ts';

export type FormPurpose = 'APPOINTMENT' | 'QUOTE' | 'INVOICE';
export type Draft = { id: string; name: string; purpose: string; schemaJson: unknown };
export type Snapshot = { name: string; purpose: FormPurpose; schema: FormSchema };
export type PublishedForm = {
  id: string; name: string; formId: string; version: number; snapshotKey: string;
  purpose: FormPurpose; schemaJson: FormSchema; publishedAt: string; publishedBy: string;
};
export type BookingService = { id: string; name: string; formId: string | null; formVersionId?: string | null };
export type Actor = { workspaceId: string; userWorkspaceId: string | null; workspaceMemberId: string | null };
export type FormRepository = {
  assertCanUpdateForm: (id: string) => Promise<void>;
  readDraft: (id: string) => Promise<Draft>;
  findSnapshot: (key: string) => Promise<PublishedForm | null>;
  latestVersion: (formId: string) => Promise<number>;
  createSnapshot: (snapshot: Omit<PublishedForm, 'id'>) => Promise<PublishedForm>;
  readService: (id: string) => Promise<BookingService>;
  readPublished: (id: string) => Promise<PublishedForm>;
  setServiceVersion: (serviceId: string, versionId: string, expectedFormId: string) => Promise<void>;
};
export class FormActionError extends Error {
  readonly status: number;
  constructor(message: string, status: number) { super(message); this.status = status; }
}
const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

export function recordId(input: unknown): string {
  if (typeof input !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input)) {
    throw new FormActionError('A valid record ID is required.', 400);
  }
  return input.toLowerCase();
}
export function requireHuman(actor: Actor): string {
  if (!actor.workspaceId || !actor.userWorkspaceId || !actor.workspaceMemberId) {
    throw new FormActionError('Sign in as a workspace member to perform this action.', 403);
  }
  return actor.workspaceMemberId;
}
export function normalizeSnapshot(input: unknown): Snapshot {
  if (!isRecord(input) || typeof input.name !== 'string' || !input.name.trim() || input.name.length > 160) {
    throw new FormActionError('Enter a form name of at most 160 characters.', 400);
  }
  if (!['APPOINTMENT', 'QUOTE', 'INVOICE'].includes(String(input.purpose))) {
    throw new FormActionError('Select an appointment, quote or invoice form.', 400);
  }
  try {
    const schema = parseFormSchema(input.schema);
    if (!schema.fields.length) throw new Error('Add at least one question before publishing.');
    return { name: input.name.trim(), purpose: input.purpose as FormPurpose, schema };
  } catch (error) {
    throw new FormActionError(error instanceof Error ? error.message : 'Invalid form.', 400);
  }
}

// The form ID prevents two distinct forms from sharing a publication. Database unique
// indexes arbitrate concurrent requests; process memory and KV are not used as locks.
export function snapshotKey(formId: string, snapshot: Snapshot): string {
  return createHash('sha256').update(JSON.stringify({ formId, ...snapshot })).digest('hex');
}

export async function publishForm(input: unknown, actor: Actor, repository: FormRepository,
  now: () => string = () => new Date().toISOString()) {
  const publishedBy = requireHuman(actor);
  if (!isRecord(input)) throw new FormActionError('Invalid publishing request.', 400);
  const formId = recordId(input.formId);
  // The expected snapshot is the exact content the editor reviewed. It never supplies
  // workspace, author, version number or the authoritative published content.
  const expected = normalizeSnapshot(input.expectedDraft);
  await repository.assertCanUpdateForm(formId);
  const draft = await repository.readDraft(formId);
  const snapshot = normalizeSnapshot({ name: draft.name, purpose: draft.purpose, schema: draft.schemaJson });
  if (JSON.stringify(expected) !== JSON.stringify(snapshot)) {
    throw new FormActionError('The saved draft changed. Reload it before publishing.', 409);
  }
  const key = snapshotKey(formId, snapshot);
  const existing = await repository.findSnapshot(key);
  if (existing) return { published: existing, reused: true };

  for (let attempt = 0; attempt < 5; attempt++) {
    const version = (await repository.latestVersion(formId)) + 1;
    if (!Number.isSafeInteger(version) || version < 1) throw new FormActionError('Invalid publication history.', 409);
    try {
      const published = await repository.createSnapshot({
        name: `${snapshot.name} · v${version}`, formId, version, snapshotKey: key,
        purpose: snapshot.purpose, schemaJson: snapshot.schema, publishedAt: now(), publishedBy,
      });
      return { published, reused: false };
    } catch (error) {
      // Also covers a response lost after the database committed the insert.
      const committed = await repository.findSnapshot(key);
      if (committed) return { published: committed, reused: true };
      // Only retry when another publication demonstrably took this version number.
      if ((await repository.latestVersion(formId)) < version) throw error;
    }
  }
  throw new FormActionError('Another publication is in progress. Reload and retry.', 409);
}

export async function selectServiceForm(input: unknown, actor: Actor, repository: FormRepository) {
  requireHuman(actor);
  if (!isRecord(input)) throw new FormActionError('Invalid form selection.', 400);
  const serviceId = recordId(input.serviceId);
  const versionId = recordId(input.versionId);
  const service = await repository.readService(serviceId);
  const version = await repository.readPublished(versionId);
  if (!service.formId || version.formId !== service.formId || version.purpose !== 'APPOINTMENT') {
    throw new FormActionError('Choose a published appointment form belonging to this service’s form.', 400);
  }
  if (!version.snapshotKey || !version.publishedAt || !Number.isSafeInteger(version.version) || version.version < 1) {
    throw new FormActionError('This form version is incomplete. Publish the draft again.', 409);
  }
  parseFormSchema(version.schemaJson);
  // This write uses the caller's native permissions, never elevated application access.
  await repository.setServiceVersion(serviceId, versionId, service.formId);
  return { serviceId, versionId };
}
