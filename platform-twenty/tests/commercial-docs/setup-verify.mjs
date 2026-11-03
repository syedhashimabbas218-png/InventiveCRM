import { assert, client, summary, waitFor } from './inv-lib.mjs';
const acme = client(`${process.env.KEYS_DIR ?? 'keys'}/acme.key`).gql;
const glow = client(`${process.env.KEYS_DIR ?? 'keys'}/glow.key`).gql;
const run = Date.now().toString(36);

const { createServiceJob } = await acme(`mutation($data: ServiceJobCreateInput!) { createServiceJob(data: $data) { id name jobType jobStatus boilerMake } }`, { data: {
  name: `Boiler service, 14 Albert Road ${run}`, jobType: 'BOILER_SERVICE', boilerMake: 'Worcester Bosch', boilerModel: 'Greenstar 30i', gasSafeCertificateNumber: 'GS-554433',
  propertyAddress: { addressStreet1: '14 Albert Road', addressCity: 'Manchester', addressPostcode: 'M19 2AB', addressCountry: 'United Kingdom' } } });
assert('Acme: a job saves with the prompted fields and default stage', createServiceJob.jobStatus === 'ENQUIRY' && createServiceJob.boilerMake === 'Worcester Bosch', JSON.stringify(createServiceJob));
const acmeTask = await waitFor('acme workflow task', async () => {
  const { tasks } = await acme(`query($title: String!) { tasks(filter: { title: { like: $title } }) { edges { node { title status } } } }`, { title: `%${run}%` });
  return tasks.edges[0]?.node;
}, 60000).catch(() => null);
assert('Acme: the "new job" workflow created a booking task', Boolean(acmeTask), acmeTask?.title ?? 'no task');

const { createPerson } = await glow(`mutation($data: PersonCreateInput!) { createPerson(data: $data) { id allergies referralSource } }`, { data: {
  name: { firstName: 'Sophie', lastName: `Turner${run}` }, emails: { primaryEmail: `sophie.${run}@example.test` }, allergies: 'PPD (hair dye)', referralSource: 'INSTAGRAM', lastPatchTestDate: '2026-10-28' } });
const { createSalonAppointment } = await glow(`mutation($data: SalonAppointmentCreateInput!) { createSalonAppointment(data: $data) { id treatment appointmentStatus depositPaid } }`, { data: {
  name: 'Full head colour', treatment: 'COLOUR', stylist: 'Jade', startsAt: '2026-11-10T10:00:00Z', durationMinutes: 120, price: { amountMicros: 85_000_000, currencyCode: 'GBP' }, depositPaid: true, clientId: createPerson.id } });
assert('Glow: client allergy and appointment with treatment, deposit and status save', createPerson.allergies === 'PPD (hair dye)' && createSalonAppointment.appointmentStatus === 'BOOKED' && createSalonAppointment.depositPaid === true, JSON.stringify(createSalonAppointment));
const glowTask = await waitFor('glow workflow task', async () => {
  const { tasks } = await glow(`query($title: String!) { tasks(filter: { title: { like: $title } }) { edges { node { title } } } }`, { title: `%Turner${run}%` });
  return tasks.edges[0]?.node;
}, 60000).catch(() => null);
assert('Glow: the "new client" workflow created a patch test reminder', Boolean(glowTask), glowTask?.title ?? 'no task');

const glowSeesJobs = await glow(`{ serviceJobs(first: 1) { edges { node { id } } } }`).then(() => true).catch((error) => error.message.slice(0, 80));
const acmeSeesAppointments = await acme(`{ salonAppointments(first: 1) { edges { node { id } } } }`).then(() => true).catch((error) => error.message.slice(0, 80));
// Standard objects tolerate unknown fields in queries, so ask each workspace's MCP for its real field list.
const { execSync } = await import('node:child_process');
const companyFields = (keyFile) => {
  const output = execSync(`node ${new URL('./mcp.mjs', import.meta.url).pathname} ${keyFile} tools/call '{"name":"execute_tool","arguments":{"toolName":"get_field_metadata","arguments":{"objectName":"company","limit":100}}}'`, { env: { ...process.env, NO_PROXY: '*' } }).toString();
  return JSON.parse(JSON.parse(output).result.content[0].text).result.fields.map((field) => field.name);
};
const glowHasLandlord = companyFields(`${process.env.KEYS_DIR ?? 'keys'}/glow.key`).includes('isLandlord');
const acmeHasLandlord = companyFields(`${process.env.KEYS_DIR ?? 'keys'}/acme.key`).includes('isLandlord');
assert('Each workspace only has its own custom objects and fields', glowSeesJobs !== true && acmeSeesAppointments !== true && !glowHasLandlord && acmeHasLandlord, `glow→jobs: ${glowSeesJobs}; acme→appointments: ${acmeSeesAppointments}; company.isLandlord in acme=${acmeHasLandlord}, glow=${glowHasLandlord}`);
summary();
