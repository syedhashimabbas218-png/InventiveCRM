import { type Design } from 'src/lib/design';

export type StarterTemplate = { key: string; name: string; category: 'NEWSLETTER' | 'PROMOTION' | 'EVENT' | 'ANNOUNCEMENT' | 'OTHER'; description: string; design: Design };

export const STARTER_TEMPLATES: StarterTemplate[] = [
  {
    key: 'blank',
    name: 'Blank',
    category: 'OTHER',
    description: 'Start from an empty email.',
    design: { version: 1, blocks: [{ id: 'b1', type: 'text', text: 'Hi {{firstName|there}},\n\n' }] },
  },
  {
    key: 'letter',
    name: 'Simple letter',
    category: 'OTHER',
    description: 'A personal note: greeting, a few paragraphs and a sign-off.',
    design: {
      version: 1,
      blocks: [
        { id: 'b1', type: 'text', text: 'Hi {{firstName|there}},\n\nWrite your message here. Short paragraphs read best on a phone.\n\nThanks,\nThe team' },
      ],
    },
  },
  {
    key: 'newsletter',
    name: 'Monthly newsletter',
    category: 'NEWSLETTER',
    description: 'A headline story with an image, two short updates and a link to read more.',
    design: {
      version: 1,
      blocks: [
        { id: 'b1', type: 'heading', text: 'What is new this month', level: 1, align: 'left' },
        { id: 'b2', type: 'text', text: 'Hi {{firstName|there}},\n\nHere is a quick round-up of what we have been working on.' },
        { id: 'b3', type: 'image', url: '', alt: 'Feature image', width: 100 },
        { id: 'b4', type: 'heading', text: 'Main story', level: 2 },
        { id: 'b5', type: 'text', text: 'Tell the story in two or three sentences, then link to the full article.' },
        { id: 'b6', type: 'button', label: 'Read more', url: '', align: 'left' },
        { id: 'b7', type: 'divider' },
        {
          id: 'b8',
          type: 'columns',
          left: { heading: 'Update one', text: 'A sentence or two about it.' },
          right: { heading: 'Update two', text: 'A sentence or two about it.' },
        },
        { id: 'b9', type: 'social', links: {} },
      ],
    },
  },
  {
    key: 'offer',
    name: 'Special offer',
    category: 'PROMOTION',
    description: 'One clear offer with a big button and an end date.',
    design: {
      version: 1,
      blocks: [
        { id: 'b1', type: 'image', url: '', alt: 'Offer image', width: 100 },
        { id: 'b2', type: 'heading', text: '20% off for {{firstName|you}}', level: 1, align: 'center' },
        { id: 'b3', type: 'text', text: 'Say what the offer is and why it is good, in one or two lines.\n\n**Ends Sunday.**', align: 'center' },
        { id: 'b4', type: 'button', label: 'Claim the offer', url: '', align: 'center' },
        { id: 'b5', type: 'spacer', height: 16 },
      ],
    },
  },
  {
    key: 'event',
    name: 'Event invitation',
    category: 'EVENT',
    description: 'Date, place and a button to book a place.',
    design: {
      version: 1,
      blocks: [
        { id: 'b1', type: 'heading', text: 'You are invited', level: 1, align: 'center' },
        { id: 'b2', type: 'text', text: 'Hi {{firstName|there}}, we would love to see you.', align: 'center' },
        { id: 'b3', type: 'columns', left: { heading: 'When', text: 'Thursday 4 December\n6pm to 8pm' }, right: { heading: 'Where', text: 'Our office\n1 High Street' } },
        { id: 'b4', type: 'button', label: 'Book my place', url: '', align: 'center' },
        { id: 'b5', type: 'text', text: 'Places are limited, so book early.', align: 'center' },
      ],
    },
  },
  {
    key: 'announcement',
    name: 'Announcement',
    category: 'ANNOUNCEMENT',
    description: 'Share news: a new service, opening hours or a change.',
    design: {
      version: 1,
      blocks: [
        { id: 'b1', type: 'heading', text: 'Some news from us', level: 1 },
        { id: 'b2', type: 'text', text: 'Hi {{firstName|there}},\n\nSay what is changing and when.\n\nSay what it means for them, and what they need to do (if anything).' },
        { id: 'b3', type: 'button', label: 'Find out more', url: '', align: 'left' },
      ],
    },
  },
];
