import { useEffect, useState, type CSSProperties } from 'react';
import { RestApiClient, RestApiClientError } from 'twenty-client-sdk/rest';
import { type FormSchema } from '../shared/forms';

type Version = { id: string; name: string; version: number; publishedAt: string; purpose: string };
type Service = { id: string; name: string; formVersionId: string | null };
type Props = { formId: string; name: string; purpose: string; schema: FormSchema; disabled: boolean };
const control: CSSProperties = { padding: '9px 12px', border: '1px solid #d5d8dc', borderRadius: 7, background: '#fff', color: '#202428', font: 'inherit' };
const describeError = (error: unknown) => {
  if (error instanceof RestApiClientError && error.body && typeof error.body === 'object' && 'error' in error.body && typeof error.body.error === 'string') return error.body.error;
  if (error instanceof RestApiClientError && error.status === 403) return 'Your role does not allow this action.';
  return error instanceof Error ? error.message : 'The action could not complete.';
};

export function PublishingPanel({ formId, name, purpose, schema, disabled }: Props) {
  const [versions, setVersions] = useState<Version[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [versionId, setVersionId] = useState('');
  const [serviceId, setServiceId] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    let active = true;
    setVersions([]); setServices([]); setVersionId(''); setServiceId(''); setError('');
    if (!formId) return;
    const client = new RestApiClient();
    void Promise.all([
      client.get<{ data: { iwFormVersions: Version[] } }>('/rest/iwFormVersions', { query: { filter: `formId[eq]:${formId}`, order_by: 'version[DescNullsLast]', limit: 100 } }),
      client.get<{ data: { iwBookingServices: Service[] } }>('/rest/iwBookingServices', { query: { filter: `formId[eq]:${formId}`, limit: 100 } }),
    ]).then(([published, linked]) => {
      if (!active) return;
      if (!Array.isArray(published.data?.iwFormVersions) || !Array.isArray(linked.data?.iwBookingServices)) throw new Error('Unexpected publishing response. Check the app installation.');
      setVersions(published.data.iwFormVersions); setServices(linked.data.iwBookingServices);
      setVersionId(published.data.iwFormVersions[0]?.id ?? '');
    }).catch(error => { if (active) setError(describeError(error)); });
    return () => { active = false; };
  }, [formId, refresh]);

  const publish = async () => {
    setBusy(true); setError(''); setMessage('');
    try {
      const result = await new RestApiClient().post<{ published: Version; reused: boolean }>('/s/inventiveweb/forms/publish', {
        formId, expectedDraft: { name, purpose, schema },
      });
      if (!result.published?.id) throw new Error('Publication response missing. Reload before retrying.');
      setMessage(result.reused ? `This saved form is already published as v${result.published.version}.` : `Published v${result.published.version}. Existing service selections stay on their chosen version.`);
      setRefresh(value => value + 1);
    } catch (error) { setError(describeError(error)); }
    finally { setBusy(false); }
  };
  const selectVersion = async () => {
    setBusy(true); setError(''); setMessage('');
    try {
      await new RestApiClient().post('/s/inventiveweb/services/select-form', { serviceId, versionId });
      setMessage('Published form selected for this service. Live booking is not enabled yet.');
      setRefresh(value => value + 1);
    } catch (error) { setError(describeError(error)); }
    finally { setBusy(false); }
  };
  return <section aria-label="Published forms" style={{ marginTop: 24, padding: 24, border: '1px solid #e4e7eb', borderRadius: 12, background: '#fff' }}>
    <h2 style={{ marginTop: 0 }}>Published versions</h2>
    <p>Save and review the draft, then publish a fixed version. Editing a draft later keeps earlier versions intact.</p>
    <button disabled={disabled || busy || !formId} onClick={() => void publish()} style={control}>{busy ? 'Working…' : 'Publish saved draft'}</button>
    {!formId && <p>Save this form first.</p>}
    {message && <p role="status">{message}</p>}
    {error && <p role="alert" style={{ color: '#a72a21' }}>{error}</p>}
    {versions.length > 0 && <p>{versions.length} published version{versions.length === 1 ? '' : 's'} loaded.</p>}
    {purpose === 'APPOINTMENT' && <fieldset disabled={disabled || busy} style={{ border: 0, margin: '20px 0 0', padding: 0 }}>
      <legend style={{ fontWeight: 600, padding: 0 }}>Use a version for a booking service</legend>
      <p>Link a service to this form in Booking services, then select its published questions here.</p>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <label>Service <select value={serviceId} onChange={event => setServiceId(event.currentTarget.value)} style={control}><option value="">Choose service</option>{services.map(service => <option key={service.id} value={service.id}>{service.name}{service.formVersionId ? ' · version selected' : ''}</option>)}</select></label>
        <label>Version <select value={versionId} onChange={event => setVersionId(event.currentTarget.value)} style={control}><option value="">Choose version</option>{versions.filter(version => version.purpose === 'APPOINTMENT').map(version => <option key={version.id} value={version.id}>{version.name}</option>)}</select></label>
        <button disabled={!serviceId || !versionId} onClick={() => void selectVersion()} style={control}>Use selected version</button>
      </div>
    </fieldset>}
  </section>;
}
