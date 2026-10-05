import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

// Inspect the official SDK output, not a second hand-maintained manifest.
const manifest = JSON.parse(readFileSync(new URL('../.twenty/output/manifest.json', import.meta.url), 'utf8'));
const objects = new Map(manifest.objects.map(object => [object.universalIdentifier, object]));
const writableNames = new Set(['iwForm', 'iwBookingService']);
for (const object of objects.values()) {
  if (!writableNames.has(object.nameSingular)) assert.equal(object.writability, 'APPLICATION');
}
for (const role of manifest.roles) {
  for (const flag of ['canReadAllObjectRecords', 'canUpdateAllObjectRecords', 'canSoftDeleteAllObjectRecords',
    'canDestroyAllObjectRecords', 'canUpdateAllSettings', 'canBeAssignedToAgents', 'canBeAssignedToApiKeys']) {
    assert.equal(role[flag], false, `${role.label}: unexpected global grant ${flag}`);
  }
  assert.equal(role.permissionFlagUniversalIdentifiers.length, 0, `${role.label}: unexpected settings permission`);
  for (const permission of role.objectPermissions) {
    const object = objects.get(permission.objectUniversalIdentifier);
    assert(object, 'Role grants access to an object outside the app');
    assert.equal(permission.canDestroyObjectRecords, false);
    assert.equal(permission.canSoftDeleteObjectRecords, false);
    if (permission.canUpdateObjectRecords) {
      const publishingGrant = role.universalIdentifier === manifest.application.defaultRoleUniversalIdentifier && object.nameSingular === 'iwFormVersion';
      assert(writableNames.has(object.nameSingular) || publishingGrant, 'Unexpected business-action write grant');
    }
  }
}
const runtimeRole = manifest.roles.find(role => role.universalIdentifier === manifest.application.defaultRoleUniversalIdentifier);
assert(runtimeRole, 'Application role not registered');
assert.equal(runtimeRole.canBeAssignedToUsers, false);
const fields = new Map();
const objectUidsByField = new Map();
for (const field of manifest.fields) fields.set(field.universalIdentifier, field);
for (const object of manifest.objects) {
  for (const field of object.fields) {
    fields.set(field.universalIdentifier, field);
    objectUidsByField.set(field.universalIdentifier, object.universalIdentifier);
  }
}
for (const field of fields.values()) {
  if (field.type !== 'RELATION') continue;
  const inverse = fields.get(field.relationTargetFieldMetadataUniversalIdentifier);
  assert(inverse, `Missing inverse for ${field.name}`);
  assert.equal(inverse.relationTargetFieldMetadataUniversalIdentifier, field.universalIdentifier);
  const fieldObjectUid = field.objectUniversalIdentifier ?? objectUidsByField.get(field.universalIdentifier);
  const inverseObjectUid = inverse.objectUniversalIdentifier ?? objectUidsByField.get(inverse.universalIdentifier);
  assert.equal(inverse.relationTargetObjectMetadataUniversalIdentifier, fieldObjectUid);
  assert.equal(inverseObjectUid, field.relationTargetObjectMetadataUniversalIdentifier);
}
for (const fn of manifest.logicFunctions) {
  if (fn.httpRouteTriggerSettings) assert.equal(fn.httpRouteTriggerSettings.isAuthRequired, true);
}
const formVersion = [...objects.values()].find(object => object.nameSingular === 'iwFormVersion');
const versionFields = new Map([...formVersion.fields, ...manifest.fields.filter(field => field.objectUniversalIdentifier === formVersion.universalIdentifier)].map(field => [field.universalIdentifier, field.name]));
const uniqueIndexes = manifest.indexes.filter(index => index.objectUniversalIdentifier === formVersion.universalIdentifier && index.isUnique);
const indexColumns = uniqueIndexes.map(index => index.fields.map(field => versionFields.get(field.fieldUniversalIdentifier)).join(','));
assert(indexColumns.includes('snapshotKey'), 'Missing snapshot idempotency constraint');
assert(indexColumns.includes('form,version'), 'Missing publication ordinal constraint');
console.log(`Verified permission boundaries and inverse relations: ${objects.size} objects, ${fields.size} fields, ${manifest.roles.length} roles.`);
