export type OutboundButton = { id: string; title: string };

export type TemplateParameter = { type: 'text'; text: string };

export type TemplateMessage = {
  name: string;
  languageCode: string;
  bodyParameters: TemplateParameter[];
  quickReplyPayloads?: string[];
};

export type OutboundMessage =
  | { kind: 'text'; text: string }
  | { kind: 'buttons'; text: string; buttons: OutboundButton[] }
  | { kind: 'template'; template: TemplateMessage };

export type GraphSendRequest = {
  phoneNumberId: string;
  accessToken: string;
  to: string;
  message: OutboundMessage;
};

// definite: Meta answered with an error, so nothing was sent. Otherwise the outcome is unknown.
export class GraphSendError extends Error {
  constructor(
    message: string,
    readonly definite: boolean,
    readonly status?: number,
  ) {
    super(message);
  }
}

export type GraphClient = {
  sendMessage: (request: GraphSendRequest) => Promise<{ providerMessageId: string }>;
};

const toRequestBody = (to: string, message: OutboundMessage): Record<string, unknown> => {
  const base = { messaging_product: 'whatsapp', recipient_type: 'individual', to };
  switch (message.kind) {
    case 'text':
      return { ...base, type: 'text', text: { preview_url: false, body: message.text } };
    case 'buttons':
      return {
        ...base,
        type: 'interactive',
        interactive: {
          type: 'button',
          body: { text: message.text },
          action: { buttons: message.buttons.map((button) => ({ type: 'reply', reply: button })) },
        },
      };
    case 'template': {
      const components: Record<string, unknown>[] = [];
      if (message.template.bodyParameters.length > 0) {
        components.push({ type: 'body', parameters: message.template.bodyParameters });
      }
      (message.template.quickReplyPayloads ?? []).forEach((payload, index) =>
        components.push({
          type: 'button',
          sub_type: 'quick_reply',
          index: String(index),
          parameters: [{ type: 'payload', payload }],
        }),
      );
      return {
        ...base,
        type: 'template',
        template: { name: message.template.name, language: { code: message.template.languageCode }, components },
      };
    }
  }
};

export const createGraphClient = (options: { baseUrl: string; version: string; timeoutMs: number }): GraphClient => ({
  sendMessage: async ({ phoneNumberId, accessToken, to, message }) => {
    let response: Response;
    try {
      response = await fetch(`${options.baseUrl}/${options.version}/${encodeURIComponent(phoneNumberId)}/messages`, {
        method: 'POST',
        headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
        body: JSON.stringify(toRequestBody(to, message)),
        signal: AbortSignal.timeout(options.timeoutMs),
      });
    } catch (error) {
      throw new GraphSendError(`provider call failed: ${(error as Error).name}`, false);
    }

    const text = await response.text().catch(() => '');
    if (response.status >= 400 && response.status < 500) {
      throw new GraphSendError(`provider rejected the message (${response.status})`, true, response.status);
    }
    if (!response.ok) {
      throw new GraphSendError(`provider error (${response.status})`, false, response.status);
    }
    try {
      const body = JSON.parse(text) as { messages?: { id?: string }[] };
      const providerMessageId = body.messages?.[0]?.id;
      if (!providerMessageId) throw new Error('missing message id');
      return { providerMessageId };
    } catch {
      throw new GraphSendError('provider response unreadable', false, response.status);
    }
  },
});
