#!/usr/bin/env node
// Reads `twenty app plan --json` on stdin and fails if the release would delete anything. On upgrade the server drops
// whatever the new version no longer declares, with its data, in every workspace that installs it.
// --allow <metadataName> lets a release remove items that hold no client data, such as navigation items. Objects and
// fields can never be allowed.
const allowed = process.argv.flatMap((value, index, all) => (all[index - 1] === '--allow' ? [value] : []));
if (allowed.some((name) => /^(object|field)/i.test(name))) {
  console.error('Objects and fields cannot be allowed: their deletion drops client data.');
  process.exit(2);
}
let input = '';
for await (const chunk of process.stdin) input += chunk;

const plan = JSON.parse(input);
if (!plan.ok) {
  console.error(`app plan failed: ${JSON.stringify(plan.error ?? plan)}`);
  process.exit(2);
}
const { summary, actions } = plan.data;
const allDeletions = actions.filter((action) => action.type === 'delete');
const deletions = allDeletions.filter((action) => !allowed.includes(action.metadataName));
console.log(`Plan: ${summary.create} to add, ${summary.update} to change, ${summary.delete} to destroy.`);
for (const action of allDeletions.filter((candidate) => allowed.includes(candidate.metadataName)))
  console.log(`Allowed: ${action.metadataName} ${action.flatEntity?.name ?? ''} (${action.universalIdentifier})`);
if (deletions.length > 0 || summary.delete > allDeletions.length - deletions.length) {
  console.error('Refusing: this release deletes metadata and the client data in it:');
  for (const action of deletions)
    console.error(`  - ${action.metadataName} ${action.flatEntity?.name ?? action.flatEntity?.label ?? ''} (${action.universalIdentifier})`);
  console.error('Keep the object or field in the app (stop using it instead), then plan again.');
  process.exit(1);
}
