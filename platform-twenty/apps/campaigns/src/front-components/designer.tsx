import styled from '@emotion/styled';
import { useDeferredValue, useMemo, useState } from 'react';
import { SegmentedControl } from 'twenty-ui/components/input';
import { IconArrowDown, IconArrowUp, IconCopy, IconTrash } from 'twenty-ui/icon';
import { Card } from 'twenty-ui/primitives/surfaces';
import { Text } from 'twenty-ui/primitives/typography';
import { themeCssVariables } from 'twenty-ui/theme';

import { type Align, type Block, type BlockType, type Brand, type ColumnContent, type Design, MAX_BLOCKS, renderEmail, SOCIAL_LABELS, type SocialNetwork, VARIABLE_NAMES } from 'src/lib/design';
import { FieldLabel, FieldTitle, Hint, Input, QuietButton, Row, Select, SecondaryButton, Stack, TextArea } from 'src/front-components/shared';

const BLOCK_LABELS: Record<BlockType, string> = {
  heading: 'Heading',
  text: 'Text',
  image: 'Image',
  button: 'Button',
  columns: 'Two columns',
  divider: 'Divider',
  spacer: 'Space',
  social: 'Social links',
};

const newBlock = (type: BlockType): Block => {
  const id = `b${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  switch (type) {
    case 'heading':
      return { id, type, text: 'A clear headline', level: 1, align: 'left' };
    case 'text':
      return { id, type, text: 'Write something worth reading.' };
    case 'image':
      return { id, type, url: '', alt: '', width: 100 };
    case 'button':
      return { id, type, label: 'Find out more', url: '', align: 'center' };
    case 'columns':
      return { id, type, left: { heading: 'Left', text: 'A short paragraph.' }, right: { heading: 'Right', text: 'A short paragraph.' } };
    case 'divider':
      return { id, type };
    case 'spacer':
      return { id, type, height: 24 };
    case 'social':
      return { id, type, links: {} };
  }
};

const Layout = styled.div`
  align-items: start;
  display: grid;
  gap: ${() => themeCssVariables.spacing[4]};
  grid-template-columns: minmax(320px, 440px) minmax(0, 1fr);

  @media (max-width: 960px) {
    grid-template-columns: minmax(0, 1fr);
  }
`;

const PreviewFrame = styled.div<{ mobile: boolean }>`
  background: ${() => themeCssVariables.background.tertiary};
  border: 1px solid ${() => themeCssVariables.border.color.light};
  border-radius: ${() => themeCssVariables.border.radius.md};
  display: flex;
  justify-content: center;
  padding: ${() => themeCssVariables.spacing[4]};

  iframe {
    background: #ffffff;
    border: 0;
    border-radius: ${() => themeCssVariables.border.radius.sm};
    height: 720px;
    max-width: 100%;
    width: ${({ mobile }) => (mobile ? '375px' : '660px')};
  }
`;

const BlockHeader = styled.div`
  align-items: center;
  display: flex;
  gap: ${() => themeCssVariables.spacing[1]};
  justify-content: space-between;
`;

const AlignSelect = ({ value, onChange }: { value: Align | undefined; onChange: (value: Align) => void }) => (
  <FieldLabel>
    <FieldTitle>Alignment</FieldTitle>
    <Select value={value ?? 'left'} onChange={(event) => onChange(event.target.value as Align)}>
      <option value="left">Left</option>
      <option value="center">Centre</option>
      <option value="right">Right</option>
    </Select>
  </FieldLabel>
);

const TextInput = ({ label, value, onChange, placeholder, hint }: { label: string; value: string | undefined; onChange: (value: string) => void; placeholder?: string; hint?: string }) => (
  <FieldLabel>
    <FieldTitle>{label}</FieldTitle>
    <Input value={value ?? ''} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} />
    {hint && <Hint>{hint}</Hint>}
  </FieldLabel>
);

const LongText = ({ label, value, onChange }: { label: string; value: string | undefined; onChange: (value: string) => void }) => (
  <FieldLabel>
    <FieldTitle>{label}</FieldTitle>
    <TextArea value={value ?? ''} onChange={(event) => onChange(event.target.value)} />
  </FieldLabel>
);

const ColumnFields = ({ title, column, onChange }: { title: string; column: ColumnContent; onChange: (column: ColumnContent) => void }) => (
  <Stack>
    <Text size="sm" weight="medium">
      {title}
    </Text>
    <TextInput label="Image link (https)" value={column.imageUrl} onChange={(imageUrl) => onChange({ ...column, imageUrl })} placeholder="https://" />
    <TextInput label="Heading" value={column.heading} onChange={(heading) => onChange({ ...column, heading })} />
    <LongText label="Text" value={column.text} onChange={(text) => onChange({ ...column, text })} />
    <TextInput label="Button text" value={column.buttonLabel} onChange={(buttonLabel) => onChange({ ...column, buttonLabel })} />
    <TextInput label="Button link" value={column.buttonUrl} onChange={(buttonUrl) => onChange({ ...column, buttonUrl })} placeholder="https://" />
  </Stack>
);

const BlockFields = ({ block, onChange }: { block: Block; onChange: (block: Block) => void }) => {
  switch (block.type) {
    case 'heading':
      return (
        <Stack>
          <TextInput label="Text" value={block.text} onChange={(text) => onChange({ ...block, text })} />
          <Row>
            <FieldLabel>
              <FieldTitle>Size</FieldTitle>
              <Select value={String(block.level ?? 1)} onChange={(event) => onChange({ ...block, level: event.target.value === '2' ? 2 : 1 })}>
                <option value="1">Large</option>
                <option value="2">Medium</option>
              </Select>
            </FieldLabel>
            <AlignSelect value={block.align} onChange={(align) => onChange({ ...block, align })} />
          </Row>
        </Stack>
      );
    case 'text':
      return (
        <Stack>
          <LongText label="Text" value={block.text} onChange={(text) => onChange({ ...block, text })} />
          <Hint>Blank line for a new paragraph, **bold**, *italic*, [link text](https://...).</Hint>
          <AlignSelect value={block.align} onChange={(align) => onChange({ ...block, align })} />
        </Stack>
      );
    case 'image':
      return (
        <Stack>
          <TextInput label="Image link (https)" value={block.url} onChange={(url) => onChange({ ...block, url })} placeholder="https://" hint="Use an image hosted on your website or in your file storage." />
          <TextInput label="Description for screen readers" value={block.alt} onChange={(alt) => onChange({ ...block, alt })} />
          <TextInput label="Opens this link when clicked (optional)" value={block.link} onChange={(link) => onChange({ ...block, link })} placeholder="https://" />
          <FieldLabel>
            <FieldTitle>Width</FieldTitle>
            <Select value={String(block.width ?? 100)} onChange={(event) => onChange({ ...block, width: Number(event.target.value) })}>
              {[100, 75, 50, 33].map((width) => (
                <option key={width} value={width}>
                  {width}%
                </option>
              ))}
            </Select>
          </FieldLabel>
        </Stack>
      );
    case 'button':
      return (
        <Stack>
          <TextInput label="Button text" value={block.label} onChange={(label) => onChange({ ...block, label })} />
          <TextInput label="Link" value={block.url} onChange={(url) => onChange({ ...block, url })} placeholder="https://" />
          <AlignSelect value={block.align} onChange={(align) => onChange({ ...block, align })} />
        </Stack>
      );
    case 'columns':
      return (
        <Stack>
          <ColumnFields title="Left column" column={block.left} onChange={(left) => onChange({ ...block, left })} />
          <ColumnFields title="Right column" column={block.right} onChange={(right) => onChange({ ...block, right })} />
        </Stack>
      );
    case 'spacer':
      return (
        <FieldLabel>
          <FieldTitle>Height</FieldTitle>
          <Select value={String(block.height ?? 24)} onChange={(event) => onChange({ ...block, height: Number(event.target.value) })}>
            {[8, 16, 24, 40, 64].map((height) => (
              <option key={height} value={height}>
                {height}px
              </option>
            ))}
          </Select>
        </FieldLabel>
      );
    case 'social':
      return (
        <Stack>
          {(Object.keys(SOCIAL_LABELS) as SocialNetwork[]).map((network) => (
            <TextInput key={network} label={SOCIAL_LABELS[network]} value={block.links[network]} placeholder="https://" onChange={(href) => onChange({ ...block, links: { ...block.links, [network]: href } })} />
          ))}
        </Stack>
      );
    case 'divider':
      return <Hint>A thin line between sections.</Hint>;
  }
};

const SAMPLE = { firstName: 'Alex', lastName: 'Morgan', email: 'alex@example.com', companyName: 'Example Ltd' };

export const Designer = ({ design, brand, subject, previewText, onChange }: { design: Design; brand: Brand; subject: string; previewText: string; onChange: (design: Design) => void }) => {
  const [device, setDevice] = useState<'desktop' | 'mobile'>('desktop');
  const [open, setOpen] = useState<string | null>(design.blocks[0]?.id ?? null);
  // The preview reloads its frame on every change; deferring it keeps typing in the fields responsive.
  const previewDesign = useDeferredValue(design);
  const previewSubject = useDeferredValue(subject);
  const html = useMemo(
    () => renderEmail(previewDesign, brand, { subject: previewSubject, previewText, unsubscribeUrl: '#unsubscribe', contact: SAMPLE, placeholders: true }).html,
    [previewDesign, brand, previewSubject, previewText],
  );

  const update = (blocks: Block[]) => onChange({ ...design, blocks });
  const replace = (index: number, block: Block) => update(design.blocks.map((existing, position) => (position === index ? block : existing)));
  const move = (index: number, offset: number) => {
    const target = index + offset;
    if (target < 0 || target >= design.blocks.length) return;
    const blocks = [...design.blocks];
    const moved = blocks[index];
    const displaced = blocks[target];
    if (!moved || !displaced) return;
    blocks[index] = displaced;
    blocks[target] = moved;
    update(blocks);
  };
  const add = (type: BlockType) => {
    if (design.blocks.length >= MAX_BLOCKS) return;
    const block = newBlock(type);
    update([...design.blocks, block]);
    setOpen(block.id);
  };

  return (
    <Layout>
      <Stack>
        {design.blocks.map((block, index) => (
          <Card.Root key={block.id} fullWidth>
            <Card.Content>
              <Stack>
                <BlockHeader>
                  <QuietButton onClick={() => setOpen(open === block.id ? null : block.id)} aria-expanded={open === block.id}>
                    {index + 1}. {BLOCK_LABELS[block.type]}
                  </QuietButton>
                  <Row>
                    <QuietButton aria-label="Move up" disabled={index === 0} onClick={() => move(index, -1)}>
                      <IconArrowUp size={14} />
                    </QuietButton>
                    <QuietButton aria-label="Move down" disabled={index === design.blocks.length - 1} onClick={() => move(index, 1)}>
                      <IconArrowDown size={14} />
                    </QuietButton>
                    <QuietButton aria-label="Duplicate" onClick={() => update([...design.blocks.slice(0, index + 1), { ...block, id: newBlock(block.type).id }, ...design.blocks.slice(index + 1)])}>
                      <IconCopy size={14} />
                    </QuietButton>
                    <QuietButton aria-label="Remove" onClick={() => update(design.blocks.filter((_, position) => position !== index))}>
                      <IconTrash size={14} />
                    </QuietButton>
                  </Row>
                </BlockHeader>
                {open === block.id && <BlockFields block={block} onChange={(changed) => replace(index, changed)} />}
              </Stack>
            </Card.Content>
          </Card.Root>
        ))}
        <Card.Root fullWidth>
          <Card.Content>
            <Stack>
              <Text size="sm" color="secondary">
                Add a block
              </Text>
              <Row>
                {(Object.keys(BLOCK_LABELS) as BlockType[]).map((type) => (
                  <SecondaryButton key={type} onClick={() => add(type)}>
                    {BLOCK_LABELS[type]}
                  </SecondaryButton>
                ))}
              </Row>
              <Hint>
                Personalise with {VARIABLE_NAMES.map((name) => `{{${name}}}`).join(', ')}. Add a fallback after a bar: {'{{firstName|there}}'}.
              </Hint>
              <Hint>Your logo, footer address and unsubscribe link are added from the brand kit.</Hint>
            </Stack>
          </Card.Content>
        </Card.Root>
      </Stack>
      <Stack>
        <Row>
          <SegmentedControl
            aria-label="Preview size"
            size="sm"
            value={device}
            onValueChange={(value) => setDevice(value as 'desktop' | 'mobile')}
            options={[
              { value: 'desktop', label: 'Desktop' },
              { value: 'mobile', label: 'Phone' },
            ]}
          />
          <Hint>Preview with a sample contact, Alex Morgan.</Hint>
        </Row>
        <PreviewFrame mobile={device === 'mobile'}>
          <iframe title="Email preview" sandbox="" srcDoc={html} />
        </PreviewFrame>
      </Stack>
    </Layout>
  );
};
