import { MetadataApiClient } from 'twenty-client-sdk/metadata';
import { RestApiClient } from 'twenty-client-sdk/rest';
import { FormActionError, type FormRepository, type Draft, type PublishedForm, type BookingService } from '../domain/form-publishing.ts';

const FORM_OBJECT_ID = 'fa0682a5-6e6c-5318-b629-ce39ab908d36';
type ListResponse = { data: { iwFormVersions: PublishedForm[] } };

export function createFormRepository(): FormRepository {
  const asPerson = new RestApiClient();
  const metadataAsPerson = new MetadataApiClient();
  const asApplication = new RestApiClient({ runAs: 'application' });
  const versions = async (query: Record<string, string | number>) => {
    const result = await asApplication.get<ListResponse>('/rest/iwFormVersions', { query });
    if (!Array.isArray(result.data?.iwFormVersions)) throw new Error('Unexpected form version response.');
    return result.data.iwFormVersions;
  };
  return {
    async assertCanUpdateForm(id) {
      const metadata = await metadataAsPerson.query({ objects: {
        __args: { filter: { universalIdentifier: { eq: FORM_OBJECT_ID } }, paging: { first: 2 } },
        edges: { node: { id: true } },
      } });
      const objects = metadata.objects.edges;
      if (objects.length !== 1) throw new FormActionError('Form metadata is unavailable.', 403);
      const objectMetadataId = objects[0]!.node.id;
      const result = await metadataAsPerson.query({ recordPermissions: {
        __args: { targets: [{ objectMetadataId, recordId: id }] },
        objectMetadataId: true, recordId: true, permissions: { canRead: true, canUpdate: true },
      } });
      const permission = result.recordPermissions.find(target => target.recordId === id && target.objectMetadataId === objectMetadataId);
      if (!permission?.permissions.canRead || !permission.permissions.canUpdate) {
        throw new FormActionError('Your role cannot publish this form.', 403);
      }
    },
    async readDraft(id) {
      const result = await asPerson.get<{ data: { iwForm: Draft } }>(`/rest/iwForms/${id}`);
      if (!result.data?.iwForm || result.data.iwForm.id !== id) throw new FormActionError('Form not found.', 404);
      return result.data.iwForm;
    },
    async findSnapshot(key) {
      return (await versions({ filter: `snapshotKey[eq]:${key}`, limit: 1 }))[0] ?? null;
    },
    async latestVersion(formId) {
      return (await versions({ filter: `formId[eq]:${formId}`, order_by: 'version[DescNullsLast]', limit: 1 }))[0]?.version ?? 0;
    },
    async createSnapshot(snapshot) {
      const result = await asApplication.post<{ data: { createIwFormVersion: PublishedForm } }>('/rest/iwFormVersions', snapshot);
      if (!result.data?.createIwFormVersion?.id) throw new Error('Publication response missing record ID. Retry the same saved draft.');
      return result.data.createIwFormVersion;
    },
    async readService(id) {
      const result = await asPerson.get<{ data: { iwBookingService: BookingService } }>(`/rest/iwBookingServices/${id}`);
      if (!result.data?.iwBookingService || result.data.iwBookingService.id !== id) throw new FormActionError('Booking service not found.', 404);
      return result.data.iwBookingService;
    },
    async readPublished(id) {
      const result = await asPerson.get<{ data: { iwFormVersion: PublishedForm } }>(`/rest/iwFormVersions/${id}`);
      if (!result.data?.iwFormVersion || result.data.iwFormVersion.id !== id) throw new FormActionError('Published form not found.', 404);
      return result.data.iwFormVersion;
    },
    async setServiceVersion(serviceId, versionId, expectedFormId) {
      const result = await asPerson.patch<{ data: { updateIwBookingServices: BookingService[] } }>(
        '/rest/iwBookingServices', { formVersionId: versionId },
        { query: { filter: `and(id[eq]:${serviceId},formId[eq]:${expectedFormId})` } },
      );
      const updated = result.data?.updateIwBookingServices;
      if (!Array.isArray(updated) || updated.length !== 1 || updated[0]?.id !== serviceId) {
        throw new FormActionError('The service changed or is no longer writable. Reload and retry.', 409);
      }
    },
  };
}
