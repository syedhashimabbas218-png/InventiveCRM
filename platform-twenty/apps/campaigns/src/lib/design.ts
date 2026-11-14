export type Align = 'left' | 'center' | 'right';

export type ColumnContent = { imageUrl?: string; imageAlt?: string; heading?: string; text?: string; buttonLabel?: string; buttonUrl?: string };

export type Block =
  | { id: string; type: 'heading'; text: string; level?: 1 | 2; align?: Align }
  | { id: string; type: 'text'; text: string; align?: Align }
  | { id: string; type: 'image'; url: string; alt?: string; link?: string; width?: number }
  | { id: string; type: 'button'; label: string; url: string; align?: Align }
  | { id: string; type: 'divider' }
  | { id: string; type: 'spacer'; height?: number }
  | { id: string; type: 'columns'; left: ColumnContent; right: ColumnContent }
  | { id: string; type: 'social'; links: Partial<Record<SocialNetwork, string>> };

export type BlockType = Block['type'];

export type SocialNetwork = 'website' | 'facebook' | 'instagram' | 'linkedin' | 'x' | 'tiktok' | 'youtube';

export const SOCIAL_LABELS: Record<SocialNetwork, string> = {
  website: 'Website',
  facebook: 'Facebook',
  instagram: 'Instagram',
  linkedin: 'LinkedIn',
  x: 'X',
  tiktok: 'TikTok',
  youtube: 'YouTube',
};

export type Design = { version: 1; blocks: Block[] };

export type Brand = {
  name: string;
  logoUrl: string;
  primaryColor: string;
  backgroundColor: string;
  textColor: string;
  fontFamily: string;
  footerText: string;
  websiteUrl: string;
};

export type Contact = { firstName?: string; lastName?: string; email?: string; companyName?: string };

export type RenderOptions = {
  // The designer shows empty images and buttons as placeholders; real emails leave them out.
  placeholders?: boolean;
  subject: string;
  previewText?: string;
  unsubscribeUrl: string;
  contact: Contact;
};

export const MAX_BLOCKS = 60;
const MAX_TEXT = 5000;

export const FONTS = ['Arial, Helvetica, sans-serif', 'Helvetica, Arial, sans-serif', 'Georgia, serif', 'Verdana, Geneva, sans-serif', "'Trebuchet MS', Arial, sans-serif", "'Times New Roman', Times, serif"];

export const DEFAULT_BRAND: Brand = {
  name: '',
  logoUrl: '',
  primaryColor: '#3e63dd',
  backgroundColor: '#f1f1f1',
  textColor: '#333333',
  fontFamily: FONTS[0],
  footerText: '',
  websiteUrl: '',
};

export const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (character) => `&#${character.charCodeAt(0)};`);

const color = (value: string | undefined, fallback: string) => (value && /^#[0-9a-fA-F]{6}$/.test(value) ? value.toLowerCase() : fallback);

const font = (value: string | undefined) => (value && FONTS.includes(value) ? value : FONTS[0]);

// Links may only open web pages, email or phone; images must be served over https so mail clients load them.
export const safeLink = (value: string | undefined) => {
  const trimmed = (value ?? '').trim();
  if (/^mailto:[^\s"'<>]+$/i.test(trimmed) || /^tel:\+?[0-9 ()-]{3,30}$/i.test(trimmed)) return trimmed;
  try {
    const url = new URL(trimmed);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : '';
  } catch {
    return '';
  }
};

export const safeImage = (value: string | undefined) => {
  try {
    const url = new URL((value ?? '').trim());
    return url.protocol === 'https:' ? url.toString() : '';
  } catch {
    return '';
  }
};

const VARIABLES: Record<string, (contact: Contact) => string | undefined> = {
  firstName: (contact) => contact.firstName,
  lastName: (contact) => contact.lastName,
  fullName: (contact) => [contact.firstName, contact.lastName].filter(Boolean).join(' '),
  email: (contact) => contact.email,
  companyName: (contact) => contact.companyName,
};

export const VARIABLE_NAMES = Object.keys(VARIABLES);

// {{firstName}} or {{firstName|there}}: the text after the bar is used when the contact has no value.
export const fillVariables = (text: string, contact: Contact) =>
  text.replace(/\{\{\s*([a-zA-Z]+)\s*(?:\|([^}]*))?\}\}/g, (match, name: string, fallback?: string) => {
    const read = VARIABLES[name];
    if (!read) return match;
    return read(contact)?.trim() || (fallback ?? '').trim();
  });

export const unknownVariables = (design: Design, subject: string) => {
  const texts = [subject, ...design.blocks.flatMap(blockTexts)];
  const found = new Set<string>();
  for (const text of texts) for (const match of text.matchAll(/\{\{\s*([a-zA-Z]+)/g)) if (!VARIABLES[match[1]]) found.add(match[1]);
  return [...found];
};

const blockTexts = (block: Block): string[] => {
  switch (block.type) {
    case 'heading':
    case 'text':
      return [block.text];
    case 'button':
      return [block.label];
    case 'columns':
      return [block.left, block.right].flatMap((column) => [column.heading ?? '', column.text ?? '', column.buttonLabel ?? '']);
    default:
      return [];
  }
};

// Light markup for text blocks: blank line = new paragraph, **bold**, *italic*, [label](https://link).
const inlineHtml = (text: string, linkColor: string) =>
  escapeHtml(text)
    .replace(/\[([^\]]{1,200})\]\(([^)\s]{1,2000})\)/g, (match, label: string, href: string) => {
      const link = safeLink(href.replace(/&#38;/g, '&'));
      return link ? `<a href="${escapeHtml(link)}" style="color:${linkColor};text-decoration:underline">${label}</a>` : label;
    })
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/\n/g, '<br>');

const inlineText = (text: string) => text.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (match, label: string, href: string) => `${label} (${safeLink(href) || href})`).replace(/\*\*?([^*]+)\*\*?/g, '$1');

const paragraphs = (text: string) =>
  text
    .slice(0, MAX_TEXT)
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);

type Theme = { primary: string; text: string; background: string; font: string; muted: string };

const buttonHtml = (label: string, url: string, align: Align, theme: Theme, placeholders = false) => {
  const href = safeLink(url) || (placeholders && label.trim() ? '#' : '');
  if (!href || !label.trim()) return '';
  return `<table role="presentation" border="0" cellpadding="0" cellspacing="0" align="${align}" style="margin:0 ${align === 'center' ? 'auto' : '0'}"><tr><td style="border-radius:6px;background:${theme.primary}"><a href="${escapeHtml(href)}" target="_blank" style="display:inline-block;padding:12px 24px;font-family:${theme.font};font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:6px">${escapeHtml(label)}</a></td></tr></table>`;
};

const columnHtml = (column: ColumnContent, theme: Theme, contact: Contact) => {
  const parts: string[] = [];
  const image = safeImage(column.imageUrl);
  if (image) parts.push(`<img src="${escapeHtml(image)}" alt="${escapeHtml(column.imageAlt ?? '')}" width="260" style="display:block;width:100%;max-width:260px;height:auto;border:0;border-radius:4px;margin:0 0 12px">`);
  if (column.heading) parts.push(`<h3 style="margin:0 0 8px;font-family:${theme.font};font-size:17px;line-height:1.3;color:${theme.text}">${escapeHtml(fillVariables(column.heading, contact))}</h3>`);
  for (const paragraph of paragraphs(fillVariables(column.text ?? '', contact)))
    parts.push(`<p style="margin:0 0 12px;font-family:${theme.font};font-size:15px;line-height:1.55;color:${theme.text}">${inlineHtml(paragraph, theme.primary)}</p>`);
  if (column.buttonLabel && column.buttonUrl) parts.push(buttonHtml(fillVariables(column.buttonLabel, contact), column.buttonUrl, 'left', theme));
  return parts.join('');
};

const PLACEHOLDER = (text: string, font: string) =>
  `<div style="border:2px dashed #c4c4c4;border-radius:4px;padding:36px 12px;text-align:center;font-family:${font};font-size:14px;color:#8a8a8a">${escapeHtml(text)}</div>`;

const blockHtml = (block: Block, theme: Theme, contact: Contact, placeholders = false): string => {
  const cell = (inner: string, padding = '12px 32px') => (inner ? `<tr><td style="padding:${padding}">${inner}</td></tr>` : '');
  switch (block.type) {
    case 'heading': {
      const size = block.level === 2 ? 20 : 26;
      return cell(`<h${block.level === 2 ? 2 : 1} style="margin:0;font-family:${theme.font};font-size:${size}px;line-height:1.25;font-weight:700;color:${theme.text};text-align:${block.align ?? 'left'}">${escapeHtml(fillVariables(block.text, contact))}</h${block.level === 2 ? 2 : 1}>`);
    }
    case 'text':
      return cell(
        paragraphs(fillVariables(block.text, contact))
          .map((paragraph) => `<p style="margin:0 0 14px;font-family:${theme.font};font-size:16px;line-height:1.6;color:${theme.text};text-align:${block.align ?? 'left'}">${inlineHtml(paragraph, theme.primary)}</p>`)
          .join(''),
        '8px 32px 0',
      );
    case 'image': {
      const src = safeImage(block.url);
      if (!src) return placeholders ? cell(PLACEHOLDER('Image: add a link starting with https://', theme.font)) : '';
      const width = Math.min(100, Math.max(20, Math.round(block.width ?? 100)));
      const pixels = Math.round(536 * (width / 100));
      const image = `<img src="${escapeHtml(src)}" alt="${escapeHtml(block.alt ?? '')}" width="${pixels}" style="display:block;margin:0 auto;width:100%;max-width:${pixels}px;height:auto;border:0;border-radius:4px">`;
      const link = safeLink(block.link);
      return cell(link ? `<a href="${escapeHtml(link)}" target="_blank">${image}</a>` : image);
    }
    case 'button':
      return cell(buttonHtml(fillVariables(block.label, contact), block.url, block.align ?? 'center', theme, placeholders), '16px 32px');
    case 'divider':
      return cell(`<div style="border-top:1px solid #e3e3e3;font-size:0;line-height:0">&nbsp;</div>`, '16px 32px');
    case 'spacer': {
      const height = Math.min(120, Math.max(8, Math.round(block.height ?? 24)));
      return `<tr><td style="height:${height}px;font-size:0;line-height:0">&nbsp;</td></tr>`;
    }
    case 'columns':
      return cell(
        `<table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0"><tr><td class="column" width="50%" valign="top" style="padding-right:12px">${columnHtml(block.left, theme, contact)}</td><td class="column" width="50%" valign="top" style="padding-left:12px">${columnHtml(block.right, theme, contact)}</td></tr></table>`,
      );
    case 'social': {
      const links = (Object.keys(SOCIAL_LABELS) as SocialNetwork[])
        .map((network) => ({ network, href: safeLink(block.links[network]) }))
        .filter((entry) => entry.href)
        .map((entry) => `<a href="${escapeHtml(entry.href)}" target="_blank" style="color:${theme.primary};text-decoration:none;font-weight:600">${SOCIAL_LABELS[entry.network]}</a>`);
      if (!links.length && placeholders) return cell(PLACEHOLDER('Social links: add your pages', theme.font), '16px 32px');
      return links.length ? cell(`<p style="margin:0;text-align:center;font-family:${theme.font};font-size:14px">${links.join('&nbsp;&nbsp;&middot;&nbsp;&nbsp;')}</p>`, '16px 32px') : '';
    }
  }
};

const blockText = (block: Block, contact: Contact): string => {
  switch (block.type) {
    case 'heading':
      return fillVariables(block.text, contact).toUpperCase();
    case 'text':
      return paragraphs(fillVariables(block.text, contact)).map(inlineText).join('\n\n');
    case 'image':
      return block.alt && safeImage(block.url) ? `[${block.alt}]` : '';
    case 'button':
      return safeLink(block.url) ? `${fillVariables(block.label, contact)}: ${safeLink(block.url)}` : '';
    case 'divider':
      return '----------';
    case 'spacer':
      return '';
    case 'columns':
      return [block.left, block.right]
        .map((column) =>
          [column.heading ? fillVariables(column.heading, contact) : '', inlineText(fillVariables(column.text ?? '', contact)), column.buttonLabel && safeLink(column.buttonUrl) ? `${column.buttonLabel}: ${safeLink(column.buttonUrl)}` : '']
            .filter(Boolean)
            .join('\n'),
        )
        .filter(Boolean)
        .join('\n\n');
    case 'social':
      return (Object.keys(SOCIAL_LABELS) as SocialNetwork[])
        .filter((network) => safeLink(block.links[network]))
        .map((network) => `${SOCIAL_LABELS[network]}: ${safeLink(block.links[network])}`)
        .join('\n');
  }
};

export const brandTheme = (brand: Brand): Theme => ({
  primary: color(brand.primaryColor, DEFAULT_BRAND.primaryColor),
  text: color(brand.textColor, DEFAULT_BRAND.textColor),
  background: color(brand.backgroundColor, DEFAULT_BRAND.backgroundColor),
  font: font(brand.fontFamily),
  muted: '#8a8a8a',
});

export const renderEmail = (design: Design, brand: Brand, options: RenderOptions) => {
  const theme = brandTheme(brand);
  const blocks = design.blocks.slice(0, MAX_BLOCKS);
  const logo = safeImage(brand.logoUrl);
  const website = safeLink(brand.websiteUrl);
  const logoImage = logo ? `<img src="${escapeHtml(logo)}" alt="${escapeHtml(brand.name)}" height="40" style="display:block;margin:0 auto;height:40px;width:auto;border:0">` : '';
  const header = logoImage ? `<tr><td style="padding:28px 32px 8px;text-align:center">${website ? `<a href="${escapeHtml(website)}" target="_blank">${logoImage}</a>` : logoImage}</td></tr>` : '';
  const footerLines = brand.footerText.split('\n').map((line) => line.trim()).filter(Boolean);
  const unsubscribe = escapeHtml(options.unsubscribeUrl);
  const footer = `<tr><td style="padding:24px 32px 32px;text-align:center;font-family:${theme.font};font-size:12px;line-height:1.6;color:${theme.muted}">${footerLines.map(escapeHtml).join('<br>')}${footerLines.length ? '<br><br>' : ''}You are getting this email because you agreed to hear from ${escapeHtml(brand.name || 'us')}.<br><a href="${unsubscribe}" target="_blank" style="color:${theme.muted};text-decoration:underline">Unsubscribe</a></td></tr>`;
  const preview = options.previewText ? fillVariables(options.previewText, options.contact) : '';
  const subject = fillVariables(options.subject, options.contact);

  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="x-apple-disable-message-reformatting"><meta name="color-scheme" content="light"><title>${escapeHtml(subject)}</title><style>@media (max-width:620px){.container{width:100%!important}.column{display:block!important;width:100%!important;padding:0 0 16px!important}}</style></head><body style="margin:0;padding:0;background:${theme.background}">${preview ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${escapeHtml(preview)}${'&#847;&zwnj;&nbsp;'.repeat(40)}</div>` : ''}<table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" style="background:${theme.background}"><tr><td align="center" style="padding:24px 12px"><table role="presentation" class="container" width="600" border="0" cellpadding="0" cellspacing="0" style="width:600px;max-width:600px;background:#ffffff;border-radius:8px">${header}<tr><td style="height:12px;font-size:0;line-height:0">&nbsp;</td></tr>${blocks.map((block) => blockHtml(block, theme, options.contact, options.placeholders)).join('')}${footer}</table></td></tr></table></body></html>`;

  const text = [
    ...blocks.map((block) => blockText(block, options.contact)).filter(Boolean),
    '',
    ...footerLines,
    `Unsubscribe: ${options.unsubscribeUrl}`,
  ].join('\n\n').replace(/\n{3,}/g, '\n\n').trim();

  return { subject, html, text };
};

const asString = (value: unknown, max = MAX_TEXT) => (typeof value === 'string' ? value.slice(0, max) : '');
const asAlign = (value: unknown): Align | undefined => (value === 'left' || value === 'center' || value === 'right' ? value : undefined);
const asColumn = (value: unknown): ColumnContent => {
  const column = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  return {
    imageUrl: asString(column.imageUrl, 2000),
    imageAlt: asString(column.imageAlt, 200),
    heading: asString(column.heading, 300),
    text: asString(column.text),
    buttonLabel: asString(column.buttonLabel, 100),
    buttonUrl: asString(column.buttonUrl, 2000),
  };
};

// Designs come from the browser, so anything unexpected is dropped rather than trusted.
export const parseDesign = (value: unknown): Design => {
  const raw = (value && typeof value === 'object' ? (value as { blocks?: unknown }).blocks : null) ?? [];
  if (!Array.isArray(raw)) return { version: 1, blocks: [] };
  const blocks: Block[] = [];
  for (const [index, item] of raw.slice(0, MAX_BLOCKS).entries()) {
    if (!item || typeof item !== 'object') continue;
    const entry = item as Record<string, unknown>;
    const id = asString(entry.id, 40) || `block-${index}`;
    switch (entry.type) {
      case 'heading':
        blocks.push({ id, type: 'heading', text: asString(entry.text, 300), level: entry.level === 2 ? 2 : 1, align: asAlign(entry.align) });
        break;
      case 'text':
        blocks.push({ id, type: 'text', text: asString(entry.text), align: asAlign(entry.align) });
        break;
      case 'image':
        blocks.push({ id, type: 'image', url: asString(entry.url, 2000), alt: asString(entry.alt, 200), link: asString(entry.link, 2000), width: typeof entry.width === 'number' ? entry.width : 100 });
        break;
      case 'button':
        blocks.push({ id, type: 'button', label: asString(entry.label, 100), url: asString(entry.url, 2000), align: asAlign(entry.align) });
        break;
      case 'divider':
        blocks.push({ id, type: 'divider' });
        break;
      case 'spacer':
        blocks.push({ id, type: 'spacer', height: typeof entry.height === 'number' ? entry.height : 24 });
        break;
      case 'columns':
        blocks.push({ id, type: 'columns', left: asColumn(entry.left), right: asColumn(entry.right) });
        break;
      case 'social': {
        const links = (entry.links && typeof entry.links === 'object' ? entry.links : {}) as Record<string, unknown>;
        blocks.push({ id, type: 'social', links: Object.fromEntries((Object.keys(SOCIAL_LABELS) as SocialNetwork[]).map((network) => [network, asString(links[network], 2000)]).filter(([, href]) => href)) });
        break;
      }
    }
  }
  return { version: 1, blocks };
};

// Problems that must be fixed before a campaign can be sent; the designer shows them as a checklist.
export const designProblems = (design: Design, brand: Brand) => {
  const problems: string[] = [];
  if (design.blocks.length === 0) problems.push('The email has no content yet.');
  if (!brand.footerText.trim()) problems.push('Add your business name and postal address to the brand kit footer. The law requires it in marketing emails.');
  for (const block of design.blocks) {
    if (block.type === 'button' && (!block.label.trim() || !safeLink(block.url))) problems.push('A button is missing its text or a valid link.');
    if (block.type === 'image' && !safeImage(block.url)) problems.push('An image needs a link starting with https://.');
  }
  return [...new Set(problems)];
};
