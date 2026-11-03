import library from './template-library.json' with { type: 'json' };

export type TemplateDefinition = {
  name: string;
  language: string;
  category: 'utility' | 'marketing';
  phase: 1 | 2 | 3;
  used_for: string;
  body: string;
  parameters: string[];
  quick_replies: string[];
  counts_toward_weekly_cap: boolean;
};

export const ACTIVE_PHASE = 1;

export const TEMPLATE_LIBRARY = library.templates as TemplateDefinition[];

export const findTemplate = (name: string, language: string): TemplateDefinition | undefined =>
  TEMPLATE_LIBRARY.find((template) => template.name === name && template.language === language);

// Meta limits for utility/marketing templates: body <= 1024 characters, named {{lower_snake}} parameters,
// quick-reply labels <= 25 alphanumeric characters, at most 10 buttons.
export const validateTemplateDefinition = (template: TemplateDefinition): string[] => {
  const errors: string[] = [];
  if (!/^[a-z0-9_]{1,512}$/.test(template.name)) errors.push('name must be lowercase letters, digits and underscores');
  if (template.body.length > 1024) errors.push('body is over 1024 characters');
  const placeholders = [...template.body.matchAll(/\{\{([^}]*)\}\}/g)].map((match) => match[1] ?? '');
  for (const placeholder of placeholders) {
    if (!/^[a-z_]+$/.test(placeholder)) errors.push(`parameter {{${placeholder}}} must be lowercase letters and underscores`);
  }
  if (new Set(placeholders).size !== placeholders.length) errors.push('parameter names must be unique');
  if (placeholders.join(',') !== template.parameters.join(',')) errors.push('parameters must list the body placeholders in order');
  if (template.quick_replies.length > 10) errors.push('at most 10 buttons');
  for (const label of template.quick_replies) {
    if (!/^[A-Za-z0-9 ]{1,25}$/.test(label)) errors.push(`quick reply "${label}" must be 1-25 alphanumeric characters`);
  }
  return errors;
};

export const renderTemplate = (template: TemplateDefinition, parameters: Record<string, string>): string =>
  template.body.replace(/\{\{([a-z_]+)\}\}/g, (_match, name: string) => parameters[name] ?? '');
