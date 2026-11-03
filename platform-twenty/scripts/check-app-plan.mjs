#!/usr/bin/env node
// Reads `twenty app plan --json` on stdin and fails if the release would delete anything. On upgrade the server drops
// whatever the new version no longer declares, with its data, in every workspace that installs it.
let input = '';
for await (const chunk of process.stdin) input += chunk;

const plan = JSON.parse(input);
if (!plan.ok) {
  console.error(`app plan failed: ${JSON.stringify(plan.error ?? plan)}`);
  process.exit(2);
}
const { summary, actions } = plan.data;
const deletions = actions.filter((action) => action.type === 'delete');
console.log(`Plan: ${summary.create} to add, ${summary.update} to change, ${summary.delete} to destroy.`);
if (deletions.length > 0 || summary.delete > 0) {
  console.error('Refusing: this release deletes metadata and the client data in it:');
  for (const action of deletions)
    console.error(`  - ${action.metadataName} ${action.flatEntity?.name ?? action.flatEntity?.label ?? ''} (${action.universalIdentifier})`);
  console.error('Keep the object or field in the app (stop using it instead), then plan again.');
  process.exit(1);
}
