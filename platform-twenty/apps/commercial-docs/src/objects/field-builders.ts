import { FieldType } from 'twenty-sdk/define';

import { selectOptions } from 'src/constants/enums';

type Base = { universalIdentifier: string; name: string; label: string; icon: string; description?: string };

export const textField = (base: Base) => ({ ...base, type: FieldType.TEXT as const });

export const numberField = (base: Base, { integer, defaultValue }: { integer?: boolean; defaultValue?: number } = {}) => ({
  ...base,
  type: FieldType.NUMBER as const,
  ...(defaultValue !== undefined ? { defaultValue } : {}),
  universalSettings: { dataType: integer ? ('int' as const) : ('float' as const), decimals: integer ? 0 : 2 },
});

export const booleanField = (base: Base, defaultValue: boolean) => ({ ...base, type: FieldType.BOOLEAN as const, defaultValue });

export const dateField = (base: Base) => ({ ...base, type: FieldType.DATE as const });

export const dateTimeField = (base: Base) => ({ ...base, type: FieldType.DATE_TIME as const });

export const moneyField = (base: Base) => ({ ...base, type: FieldType.CURRENCY as const });

export const addressField = (base: Base) => ({ ...base, type: FieldType.ADDRESS as const });

export const filesField = (base: Base) => ({
  ...base,
  type: FieldType.FILES as const,
  universalSettings: { maxNumberOfValues: 1 } as const,
});

export const selectField = (
  base: Base,
  entries: Record<string, string | { label: string; color?: string }>,
  defaultValue?: string,
) => ({
  ...base,
  type: FieldType.SELECT as const,
  options: selectOptions(entries),
  ...(defaultValue ? { defaultValue: `'${defaultValue}'` } : {}),
});
