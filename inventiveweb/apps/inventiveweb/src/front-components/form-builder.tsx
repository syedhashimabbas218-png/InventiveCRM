import { PublishingPanel } from '../components/PublishingPanel';
import { useEffect, useState, type CSSProperties } from 'react';
import { defineFrontComponent } from 'twenty-sdk/define';
import { RestApiClient, RestApiClientError } from 'twenty-client-sdk/rest';
import { FORM_BUILDER_ID } from '../constants/ids';
import { FIELD_TYPES, EMPTY_FORM, parseFormSchema, validateAnswers, visibleFields, type FormField, type FormSchema } from '../shared/forms';

type SavedForm = { id: string; name: string; purpose: string; schemaJson: unknown };
const control: CSSProperties = { width: '100%', boxSizing: 'border-box', padding: '9px 11px', border: '1px solid #d5d8dc', borderRadius: 7, background: '#fff', color: '#202428', font: 'inherit' };
const button: CSSProperties = { padding: '9px 13px', border: '1px solid #d5d8dc', borderRadius: 7, background: '#fff', cursor: 'pointer', color: '#202428', font: 'inherit' };
const small: CSSProperties = { fontSize: 12, color: '#67717c' };
const errorMessage = (error: unknown) => error instanceof RestApiClientError && error.status === 403
  ? 'Your role does not allow this action. Ask your business manager for access.'
  : error instanceof Error ? error.message : 'The request failed. Please retry.';

export function FormBuilder() {
  const [forms, setForms] = useState<SavedForm[]>([]);
  const [id, setId] = useState('');
  const [name, setName] = useState('');
  const [purpose, setPurpose] = useState('APPOINTMENT');
  const [schema, setSchema] = useState<FormSchema>(EMPTY_FORM);
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [previewErrors, setPreviewErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const result = await new RestApiClient().get<{ data: { iwForms: SavedForm[] } }>('/rest/iwForms', { query: { limit: 100 } });
    if (!Array.isArray(result.data?.iwForms)) throw new Error('Unexpected Forms API response. Verify the native app installation.');
    setForms(result.data.iwForms);
  };
  useEffect(() => { void load().catch(e => setError(errorMessage(e))); }, []);

  const selectForm = (selected: string) => {
    setError(''); setMessage(''); setAnswers({}); setPreviewErrors({});
    if (!selected) { setId(''); setName(''); setPurpose('APPOINTMENT'); setSchema({ schemaVersion: 1, fields: [] }); return; }
    const form = forms.find(f => f.id === selected);
    if (!form) return;
    try { const next = parseFormSchema(form.schemaJson); setId(form.id); setName(form.name); setPurpose(form.purpose); setSchema(next); }
    catch (e) { setError(errorMessage(e)); }
  };
  const updateField = (index: number, patch: Partial<FormField>) => {
    setSchema(s => ({ ...s, fields: s.fields.map((f, i) => i === index ? { ...f, ...patch } : f) }));
    setMessage('');
  };
  const addField = () => {
    let n = schema.fields.length + 1;
    while (schema.fields.some(f => f.key === `field${n}`)) n++;
    setSchema(s => ({ ...s, fields: [...s.fields, { key: `field${n}`, label: 'New field', type: 'text', required: false, visibility: 'customer' }] }));
  };
  const moveField = (index: number, delta: number) => {
    const fields = [...schema.fields];
    const next = index + delta;
    if (next < 0 || next >= fields.length) return;
    [fields[index], fields[next]] = [fields[next]!, fields[index]!];
    setSchema({ ...schema, fields });
  };
  const save = async () => {
    setBusy(true); setError(''); setMessage('');
    try {
      if (!name.trim() || name.length > 160) throw new Error('Enter a form name of at most 160 characters.');
      const valid = parseFormSchema(schema);
      const client = new RestApiClient();
      // Validate on the server as well. The runtime retains the signed-in user's permissions.
      await client.post('/s/inventiveweb/forms/validate', { schema: valid, answers: {} });
      const payload = { name: name.trim(), purpose, schemaJson: valid };
      if (id) await client.patch(`/rest/iwForms/${encodeURIComponent(id)}`, payload);
      else {
        const result = await client.post<{ data: { createIwForm: SavedForm } }>('/rest/iwForms', payload);
        const createdId = result.data?.createIwForm?.id;
        if (!createdId) throw new Error('Save response did not include a record ID. Refresh Forms before retrying to avoid a duplicate.');
        setId(createdId);
      }
      setSchema(valid);
      setMessage('Draft saved. Existing published versions are unchanged.');
      await load();
    } catch (e) { setError(errorMessage(e)); }
    finally { setBusy(false); }
  };
  const checkPreview = () => {
    try {
      const result = validateAnswers(parseFormSchema(schema), answers, 'customer');
      setPreviewErrors(result.errors);
      setMessage(result.valid ? 'Preview validation passed. No booking or document was submitted.' : 'Check the highlighted preview fields.');
      setError('');
    } catch (e) { setError(errorMessage(e)); }
  };

  return <main style={{ padding: '28px 32px', fontFamily: 'Inter, system-ui, sans-serif', color: '#202428', background: '#fafbfc', minHeight: '100%', boxSizing: 'border-box' }}>
    <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, flexWrap: 'wrap', marginBottom: 24 }}>
      <div><div style={{ ...small, letterSpacing: 2, fontWeight: 700 }}>INVENTIVEWEB</div><h1 style={{ fontSize: 27, margin: '6px 0' }}>Forms for your business</h1><p style={{ color: '#67717c', margin: 0 }}>Build the questions your customers need to answer.</p></div>
      <button disabled={busy} onClick={() => void save()} style={{ ...button, background: '#202428', color: '#fff' }}>{busy ? 'Saving…' : 'Save draft'}</button>
    </header>
    {error && <div role="alert" style={{ background: '#fff0ee', color: '#a72a21', padding: 12, borderRadius: 8, marginBottom: 16 }}>{error}</div>}
    {message && <div role="status" style={{ background: '#edf5f0', color: '#24563a', padding: 12, borderRadius: 8, marginBottom: 16 }}>{message}</div>}
    <fieldset disabled={busy} aria-label="Form draft and preview" style={{ display: 'flex', alignItems: 'flex-start', gap: 24, flexWrap: 'wrap', border: 0, margin: 0, padding: 0, minWidth: 0 }}>
      <section style={{ flex: '2 1 400px', minWidth: 0 }} aria-label="Form editor">
        <div style={{ background: '#fff', padding: 20, border: '1px solid #e4e7eb', borderRadius: 12, marginBottom: 16 }}>
          <label style={{ display: 'block', marginBottom: 14 }}>Open a form<select value={id} disabled={busy} onChange={e => selectForm(e.currentTarget.value)} style={{ ...control, marginTop: 6 }}><option value="">Create a new form</option>{forms.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}</select></label>
          <label style={{ display: 'block', marginBottom: 14 }}>Form name<input value={name} maxLength={160} onChange={e => setName(e.currentTarget.value)} placeholder="e.g. Home renovation consultation" style={{ ...control, marginTop: 6 }} /></label>
          <label>Used for<select value={purpose} onChange={e => setPurpose(e.currentTarget.value)} style={{ ...control, marginTop: 6 }}><option value="APPOINTMENT">Appointments</option><option value="QUOTE">Quotes</option><option value="INVOICE">Invoices</option></select></label>
        </div>
        {schema.fields.map((field, index) => <article key={field.key} style={{ background: '#fff', border: '1px solid #e4e7eb', padding: 18, borderRadius: 12, marginBottom: 12 }}>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}><strong>Question {index + 1}</strong><div style={{ display: 'flex', gap: 6 }}><button aria-label="Move field up" disabled={index === 0} onClick={() => moveField(index, -1)} style={button}>↑</button><button aria-label="Move field down" disabled={index === schema.fields.length - 1} onClick={() => moveField(index, 1)} style={button}>↓</button><button onClick={() => setSchema({ ...schema, fields: schema.fields.filter((_, i) => i !== index) })} style={button}>Remove</button></div></div>
          <label>Question<input value={field.label} onChange={e => updateField(index, { label: e.currentTarget.value })} style={{ ...control, margin: '6px 0 12px' }} /></label>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}><label style={{ flex: 1 }}>Answer type<select value={field.type} onChange={e => updateField(index, { type: e.currentTarget.value as FormField['type'], options: e.currentTarget.value === 'select' ? ['Option 1', 'Option 2'] : undefined })} style={{ ...control, marginTop: 6 }}>{FIELD_TYPES.map(t => <option key={t} value={t}>{t[0]!.toUpperCase() + t.slice(1)}</option>)}</select></label><label style={{ flex: 1 }}>Visible to<select value={field.visibility} onChange={e => updateField(index, { visibility: e.currentTarget.value as FormField['visibility'] })} style={{ ...control, marginTop: 6 }}><option value="customer">Customers and staff</option><option value="staff">Staff only</option></select></label></div>
          {field.type === 'select' && <label style={{ display: 'block', marginTop: 12 }}>Choices, one per line<textarea value={(field.options ?? []).join('\n')} onChange={e => updateField(index, { options: e.currentTarget.value.split('\n') })} style={{ ...control, marginTop: 6 }} rows={3} /></label>}
          <label style={{ display: 'block', marginTop: 12 }}><input type="checkbox" checked={field.required} onChange={e => updateField(index, { required: e.currentTarget.checked })} /> Required</label>
          <label style={{ display: 'block', marginTop: 12 }}>Show when<select value={field.condition?.field ?? ''} onChange={e => { const parent = schema.fields.find(f => f.key === e.currentTarget.value); updateField(index, { condition: parent ? { field: parent.key, equals: parent.type === 'checkbox' ? true : parent.type === 'number' ? 0 : parent.options?.[0] ?? '' } : undefined }); }} style={{ ...control, marginTop: 6 }}><option value="">Always visible</option>{schema.fields.slice(0, index).filter(f => !f.condition && (field.visibility === 'staff' || f.visibility === 'customer')).map(f => <option key={f.key} value={f.key}>{f.label} equals…</option>)}</select></label>
          {field.condition && <input aria-label="Condition value" value={String(field.condition.equals)} onChange={e => { const parent = schema.fields.find(f => f.key === field.condition!.field); const raw = e.currentTarget.value; updateField(index, { condition: { field: field.condition!.field, equals: parent?.type === 'checkbox' ? raw === 'true' : parent?.type === 'number' ? Number(raw) : raw } }); }} style={{ ...control, marginTop: 8 }} />}
        </article>)}
        <button onClick={addField} disabled={schema.fields.length >= 60} style={{ ...button, width: '100%', borderStyle: 'dashed' }}>+ Add question</button>
      </section>
      <aside style={{ flex: '1 1 280px', background: '#fff', border: '1px solid #e4e7eb', borderRadius: 12, padding: 24, minWidth: 0 }} aria-label="Customer preview">
        <div style={small}>CUSTOMER PREVIEW</div><h2 style={{ fontSize: 21 }}>{name || 'Your form'}</h2>
        {visibleFields(schema, answers, 'customer').map(field => <div key={field.key} style={{ marginBottom: 16 }}><label htmlFor={`preview-${field.key}`} style={{ display: 'block', marginBottom: 6 }}>{field.label}{field.required ? ' *' : ''}</label>
          {field.type === 'select' ? <select id={`preview-${field.key}`} value={String(answers[field.key] ?? '')} onChange={e => setAnswers({ ...answers, [field.key]: e.currentTarget.value })} style={control}><option value="">Select an option</option>{field.options?.map((o, i) => <option key={i} value={o}>{o}</option>)}</select>
          : field.type === 'textarea' ? <textarea id={`preview-${field.key}`} rows={3} value={String(answers[field.key] ?? '')} onChange={e => setAnswers({ ...answers, [field.key]: e.currentTarget.value })} style={control} />
          : field.type === 'checkbox' ? <input id={`preview-${field.key}`} type="checkbox" checked={answers[field.key] === true} onChange={e => setAnswers({ ...answers, [field.key]: e.currentTarget.checked })} />
          : <input id={`preview-${field.key}`} type={field.type === 'phone' ? 'tel' : field.type} value={String(answers[field.key] ?? '')} onChange={e => setAnswers({ ...answers, [field.key]: field.type === 'number' && e.currentTarget.value !== '' ? Number(e.currentTarget.value) : e.currentTarget.value })} style={control} />}
          {previewErrors[field.key] && <div style={{ color: '#a72a21', fontSize: 12, marginTop: 5 }}>{previewErrors[field.key]}</div>}
        </div>)}
        {!schema.fields.length && <p style={small}>Add questions to see your customer form here.</p>}
        <button onClick={checkPreview} style={{ ...button, width: '100%', marginTop: 8 }}>Test answers</button>
        <p style={{ ...small, textAlign: 'center', marginTop: 24 }}>Powered by <strong>InventiveWeb</strong></p>
      </aside>
    </fieldset>
    <PublishingPanel key={id} formId={id} name={name} purpose={purpose} schema={schema} disabled={busy} />
  </main>;
}
export default defineFrontComponent({ universalIdentifier: FORM_BUILDER_ID, name: 'Form builder', description: 'Create and preview configurable forms for your business.', component: FormBuilder });
