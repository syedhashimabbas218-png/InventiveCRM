

type FixtureOptions = {
  wabaId: string;
  phoneNumberId: string;
  timestamp: Date;
};

const metadata = (phoneNumberId: string) => ({
  display_phone_number: '447700900000',
  phone_number_id: phoneNumberId,
});

const seconds = (date: Date) => String(Math.floor(date.getTime() / 1000));

const wrap = (options: FixtureOptions, field: string, value: Record<string, unknown>) => ({
  object: 'whatsapp_business_account',
  entry: [
    {
      id: options.wabaId,
      changes: [{ value: { messaging_product: 'whatsapp', metadata: metadata(options.phoneNumberId), ...value }, field }],
    },
  ],
});

// Shapes follow Meta's webhook reference examples (messages, statuses, smb_message_echoes, interactive, audio).
export const textMessage = (options: FixtureOptions & { from: string; id: string; text: string; name?: string }) =>
  wrap(options, 'messages', {
    contacts: [{ profile: { name: options.name ?? 'Sheena Nelson' }, wa_id: options.from }],
    messages: [{ from: options.from, id: options.id, timestamp: seconds(options.timestamp), type: 'text', text: { body: options.text } }],
  });

export const buttonReply = (options: FixtureOptions & { from: string; id: string; replyId: string; title: string }) =>
  wrap(options, 'messages', {
    contacts: [{ profile: { name: 'Sheena Nelson' }, wa_id: options.from }],
    messages: [
      {
        from: options.from,
        id: options.id,
        timestamp: seconds(options.timestamp),
        type: 'interactive',
        interactive: { type: 'button_reply', button_reply: { id: options.replyId, title: options.title } },
      },
    ],
  });

export const voiceNote = (options: FixtureOptions & { from: string; id: string }) =>
  wrap(options, 'messages', {
    contacts: [{ profile: { name: 'Sheena Nelson' }, wa_id: options.from }],
    messages: [
      {
        from: options.from,
        id: options.id,
        timestamp: seconds(options.timestamp),
        type: 'audio',
        audio: {
          mime_type: 'audio/ogg; codecs=opus',
          sha256: 'wvqXMe6n7n1W0zphvLPoLj+s/NtKqmr3zZ7YzTP7xFI=',
          id: '1908647269898587',
          voice: true,
        },
      },
    ],
  });

export const statusUpdate = (options: FixtureOptions & { id: string; status: string; recipient: string }) =>
  wrap(options, 'messages', {
    statuses: [
      {
        id: options.id,
        status: options.status,
        timestamp: seconds(options.timestamp),
        recipient_id: options.recipient,
        pricing: { billable: true, pricing_model: 'CBP', category: 'service' },
      },
    ],
  });

export const messageEcho = (options: FixtureOptions & { from: string; to: string; id: string; text: string }) =>
  wrap(options, 'smb_message_echoes', {
    message_echoes: [
      { from: options.from, to: options.to, id: options.id, timestamp: seconds(options.timestamp), type: 'text', text: { body: options.text } },
    ],
  });
