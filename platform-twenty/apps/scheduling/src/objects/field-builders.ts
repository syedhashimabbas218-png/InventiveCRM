import { FieldType } from 'twenty-sdk/define';

import { selectOptions } from 'src/constants/enums';

type Base = { universalIdentifier: string; name: string; label: string; icon: string; description?: string; isUnique?: boolean };

export const textField = (base: Base, defaultValue?: string) => ({
  ...base,
  type: FieldType.TEXT as const,
  ...(defaultValue !== undefined ? { defaultValue: `'${defaultValue}'` } : {}),
});

export const numberField = (base: Base, { integer, decimals, defaultValue }: { integer?: boolean; decimals?: number; defaultValue?: number } = {}) => ({
  ...base,
  type: FieldType.NUMBER as const,
  ...(defaultValue !== undefined ? { defaultValue } : {}),
  universalSettings: { dataType: integer ? ('int' as const) : ('float' as const), decimals: integer ? 0 : (decimals ?? 2) },
});

export const booleanField = (base: Base, defaultValue: boolean) => ({ ...base, type: FieldType.BOOLEAN as const, defaultValue });

export const dateField = (base: Base) => ({ ...base, type: FieldType.DATE as const });

export const dateTimeField = (base: Base) => ({ ...base, type: FieldType.DATE_TIME as const });

export const jsonField = (base: Base) => ({ ...base, type: FieldType.RAW_JSON as const });

export const selectField = (base: Base, entries: Record<string, string | { label: string; color?: string }>, defaultValue?: string) => ({
  ...base,
  type: FieldType.SELECT as const,
  options: selectOptions(entries),
  ...(defaultValue ? { defaultValue: `'${defaultValue}'` } : {}),
});
