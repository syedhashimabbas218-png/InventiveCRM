import { readFileSync } from 'node:fs';

import PizZip from 'pizzip';
import { describe, expect, it } from 'vitest';

import { verifyWhatsAppSignature } from 'src/lib/delivery';
import { stripExternalReferences, templateSizeProblem } from 'src/lib/template-files';

const sample = () => new Uint8Array(readFileSync(new URL('../../templates/sample-uk-vat-invoice.docx', import.meta.url)));

const docxWith = (files: Record<string, string>) => {
  const zip = new PizZip(sample());
  for (const [name, content] of Object.entries(files)) zip.file(name, content);
  return zip.generate({ type: 'uint8array', compression: 'DEFLATE' }) as Uint8Array;
};

describe('template size limits', () => {
  it('accepts the sample template', () => {
    expect(templateSizeProblem(sample(), 'DOCX')).toBeNull();
  });

  it('refuses a Word file that unpacks to more than 50 MB (zip bomb)', () => {
    const bomb = docxWith({ 'word/padding.xml': ' '.repeat(60 * 1024 * 1024) });
    expect(bomb.length).toBeLessThan(1024 * 1024);
    expect(templateSizeProblem(bomb, 'DOCX')).toMatch(/50 MB/);
  });

  it('refuses files over 10 MB', () => {
    expect(templateSizeProblem(new Uint8Array(11 * 1024 * 1024), 'PDF')).toMatch(/10 MB/);
  });
});

describe('external references before conversion', () => {
  const rels = `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId9" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="http://169.254.169.254/latest" TargetMode="External"/>
<Relationship Id="rId10" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://example.com" TargetMode="External"/>
<Relationship Id="rId11" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/logo.png"/>
</Relationships>`;
  const body = '<w:document><w:body><w:r><w:instrText xml:space="preserve"> INCLUDEPICTURE "file:///etc/passwd" </w:instrText></w:r><w:fldSimple w:instr=" INCLUDETEXT http://internal/ "/></w:body></w:document>';

  it('removes fetching relationships and INCLUDE fields, keeps hyperlinks and local images', () => {
    const cleaned = new PizZip(stripExternalReferences(docxWith({ 'word/_rels/document.xml.rels': rels, 'word/footer9.xml': body })));
    const cleanedRels = cleaned.file('word/_rels/document.xml.rels')?.asText() ?? '';
    const cleanedBody = cleaned.file('word/footer9.xml')?.asText() ?? '';
    expect(cleanedRels).not.toContain('169.254.169.254');
    expect(cleanedRels).toContain('https://example.com');
    expect(cleanedRels).toContain('media/logo.png');
    expect(cleanedBody).not.toMatch(/INCLUDE|passwd|internal/);
  });

  it('leaves an ordinary template unchanged', () => {
    const original = new PizZip(sample());
    const cleaned = new PizZip(stripExternalReferences(sample()));
    for (const name of Object.keys(original.files)) expect(cleaned.file(name)?.asText()).toBe(original.file(name)?.asText());
  });
});

describe('WhatsApp signatures', () => {
  it('refuses a non-numeric timestamp, which would otherwise never expire', () => {
    process.env.WHATSAPP_GATEWAY_SECRET = 'x'.repeat(40);
    expect(verifyWhatsAppSignature('{}', 'abc', 'sha256=00')).toBe(false);
  });
});
