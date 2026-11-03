import { defineObject } from 'twenty-sdk/define';

import { TEAM_ROLES } from 'src/constants/enums';
import { IDS } from 'src/constants/ids';
import { booleanField, numberField, selectField, textField } from 'src/objects/field-builders';

const field = IDS.teamMembership.fields;

export default defineObject({
  universalIdentifier: IDS.teamMembership.object,
  nameSingular: 'teamMembership',
  namePlural: 'teamMemberships',
  labelSingular: "Team membership",
  labelPlural: "Team memberships",
  description: "An advisor in a scheduling team, with their role, weight and priority in that team.",
  icon: 'IconUserPlus',
  labelIdentifierFieldMetadataUniversalIdentifier: field.name,
  fields: [
    textField({ universalIdentifier: field.name, name: 'name', label: "Name", icon: 'IconTag' }),
    selectField({ universalIdentifier: field.teamRole, name: 'teamRole', label: "Role", icon: 'IconShield' }, TEAM_ROLES, 'MEMBER'),
    numberField({ universalIdentifier: field.weight, name: 'weight', label: "Weight", icon: 'IconScale' }, { integer: true, defaultValue: 1 }),
    numberField({ universalIdentifier: field.priority, name: 'priority', label: "Priority", icon: 'IconSortDescending' }, { integer: true, defaultValue: 0 }),
    booleanField({ universalIdentifier: field.isActive, name: 'isActive', label: "Active", icon: 'IconCheck' }, true),
  ],
});
