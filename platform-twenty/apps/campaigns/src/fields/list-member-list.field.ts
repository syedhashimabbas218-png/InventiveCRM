import { defineField, FieldType, OnDeleteAction, RelationType } from 'twenty-sdk/define';

import { IDS } from 'src/constants/ids';

export default defineField({
  universalIdentifier: IDS.listMember.fields.list,
  objectUniversalIdentifier: IDS.listMember.object,
  type: FieldType.RELATION,
  name: 'list',
  label: 'List',
  icon: 'IconList',
  isNullable: true,
  relationTargetObjectMetadataUniversalIdentifier: IDS.list.object,
  relationTargetFieldMetadataUniversalIdentifier: IDS.list.fields.members,
  universalSettings: {
    relationType: RelationType.MANY_TO_ONE,
    onDelete: OnDeleteAction.CASCADE,
    joinColumnName: 'listId',
  },
});
