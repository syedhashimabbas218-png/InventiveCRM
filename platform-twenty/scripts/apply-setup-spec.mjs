#!/usr/bin/env node
// Applies a client setup spec (objects, fields, views, workflows) to one workspace through its MCP server.
// The spec is what an AI produces from the client's description; this script is the deterministic half:
// it validates names, skips what already exists and never deletes, so it is safe to re-run.
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

const { values: options } = parseArgs({
  options: {
    mcp: { type: 'string' },
    'key-file': { type: 'string' },
    spec: { type: 'string' },
  },
});
if (!options.mcp || !options['key-file'] || !options.spec) {
  console.error('Usage: apply-setup-spec.mjs --mcp https://acme.crm.example.com/mcp --key-file acme.key --spec plumbing.json');
  process.exit(2);
}

const apiKey = readFileSync(options['key-file'], 'utf8').trim();
const spec = JSON.parse(readFileSync(options.spec, 'utf8'));
const CAMEL_CASE = /^[a-z][a-zA-Z0-9]*$/;
const ALLOWED_FIELD_TYPES = new Set(['TEXT', 'NUMBER', 'BOOLEAN', 'DATE', 'DATE_TIME', 'SELECT', 'MULTI_SELECT', 'CURRENCY', 'EMAILS', 'PHONES', 'LINKS', 'ADDRESS', 'RATING', 'RELATION']);
const PROTECTED_OBJECTS = new Set(['invoice', 'invoiceLine', 'quote', 'quoteLine', 'businessProfile', 'product']);

const problems = [];
for (const object of spec.objects ?? []) {
  if (!CAMEL_CASE.test(object.nameSingular) || !CAMEL_CASE.test(object.namePlural)) problems.push(`object ${object.nameSingular}: names must be camelCase`);
  if (PROTECTED_OBJECTS.has(object.nameSingular)) problems.push(`object ${object.nameSingular} belongs to the Quotes & Invoices app`);
}
for (const field of [...(spec.objects ?? []).flatMap((object) => (object.fields ?? []).map((item) => ({ ...item, object: object.nameSingular }))), ...(spec.fields ?? [])]) {
  if (!CAMEL_CASE.test(field.name)) problems.push(`field ${field.object}.${field.name}: name must be camelCase`);
  if (!ALLOWED_FIELD_TYPES.has(field.type)) problems.push(`field ${field.object}.${field.name}: type ${field.type} is not allowed`);
  if (PROTECTED_OBJECTS.has(field.object)) problems.push(`field ${field.object}.${field.name}: the Quotes & Invoices objects are managed by the app`);
}
// Specs are written by an AI from a client's description, so they may only build workflows from data steps: no code,
// no outbound HTTP, no deletes and no public webhook triggers.
const ALLOWED_STEP_TYPES = new Set(['CREATE_RECORD', 'UPDATE_RECORD', 'FIND_RECORDS', 'SEND_EMAIL', 'FORM', 'FILTER', 'IF_ELSE', 'DELAY', 'ITERATOR', 'EMPTY']);
const ALLOWED_TRIGGER_TYPES = new Set(['DATABASE_EVENT', 'MANUAL', 'CRON']);
for (const workflow of spec.workflows ?? []) {
  if (!ALLOWED_TRIGGER_TYPES.has(workflow.trigger?.type)) problems.push(`workflow ${workflow.name}: trigger ${workflow.trigger?.type} is not allowed`);
  for (const step of workflow.steps ?? [])
    if (!ALLOWED_STEP_TYPES.has(step.type)) problems.push(`workflow ${workflow.name}: step type ${step.type} is not allowed`);
}
if (problems.length > 0) {
  console.error(`Spec rejected:\n- ${problems.join('\n- ')}`);
  process.exit(1);
}

let requestId = 0;
const rpc = async (method, params) => {
  const response = await fetch(options.mcp, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++requestId, method, params }),
  });
  const text = await response.text();
  const message = text.startsWith('{') ? JSON.parse(text) : JSON.parse(text.split('\n').filter((line) => line.startsWith('data:')).pop().slice(5));
  if (message.error) throw new Error(`${method}: ${message.error.message}`);
  return message.result;
};

const tool = async (toolName, args) => {
  const result = await rpc('tools/call', { name: 'execute_tool', arguments: { toolName, arguments: args } });
  const payload = JSON.parse(result.content[0].text);
  if (result.isError || payload.success === false) throw new Error(`${toolName}: ${payload.error ?? payload.message ?? result.content[0].text}`);
  return payload.result ?? payload;
};

await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'inventivecrm-setup', version: '1' } });

const findObject = async (name) => (await tool('get_object_metadata', { objectName: name, includeFields: true })).objects?.[0] ?? null;
const report = { objectsCreated: [], fieldsCreated: [], viewsCreated: [], workflowsCreated: [], skipped: [] };

for (const object of spec.objects ?? []) {
  if (await findObject(object.nameSingular)) {
    report.skipped.push(`object ${object.nameSingular} exists`);
    continue;
  }
  const { fields: _fields, ...definition } = object;
  await tool('create_object_metadata', definition);
  report.objectsCreated.push(object.nameSingular);
}

const fields = [
  ...(spec.objects ?? []).flatMap((object) => (object.fields ?? []).map((field) => ({ ...field, object: object.nameSingular }))),
  ...(spec.fields ?? []),
];
for (const { object: objectName, relation, ...field } of fields) {
  const object = await findObject(objectName);
  if (!object) throw new Error(`Object ${objectName} not found`);
  if (object.fields?.some((existing) => existing.name === field.name)) {
    report.skipped.push(`field ${objectName}.${field.name} exists`);
    continue;
  }
  const payload = { objectMetadataId: object.id, isNullable: true, ...field };
  if (field.type === 'RELATION') {
    const target = await findObject(relation.target);
    payload.relationCreationPayload = { type: relation.type ?? 'MANY_TO_ONE', targetObjectMetadataId: target.id, targetFieldLabel: relation.inverseLabel, targetFieldIcon: relation.inverseIcon ?? 'IconLink' };
  }
  await tool('create_field_metadata', payload);
  report.fieldsCreated.push(`${objectName}.${field.name}`);
}

const existingViews = async (objectName) => (await tool('get_views', { objectNameSingular: objectName })).views ?? [];
for (const view of spec.views ?? []) {
  if ((await existingViews(view.objectNameSingular)).some((existing) => existing.name === view.name)) {
    report.skipped.push(`view ${view.name} exists`);
    continue;
  }
  await tool('create_view', view);
  report.viewsCreated.push(view.name);
}

const existingWorkflows = (await tool('list_workflows', { limit: 50 })).workflows ?? [];
for (const workflow of spec.workflows ?? []) {
  if (existingWorkflows.some((existing) => existing.name === workflow.name)) {
    report.skipped.push(`workflow ${workflow.name} exists`);
    continue;
  }
  const created = await tool('create_complete_workflow', workflow);
  const versionId = created.workflowVersionId ?? created.coreWorkflowVersionId;
  const validation = await tool('validate_workflow', { coreWorkflowVersionId: versionId });
  if (validation.isValid === false) throw new Error(`Workflow ${workflow.name} is not valid: ${JSON.stringify(validation)}`);
  await tool('activate_workflow_version', { coreWorkflowVersionId: versionId });
  report.workflowsCreated.push(workflow.name);
}

console.log(JSON.stringify(report, null, 2));
