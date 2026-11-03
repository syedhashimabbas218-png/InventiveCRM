import type { BusinessEvent, EventBus } from '../interfaces/event-bus.ts';

export class InMemoryEventBus implements EventBus {
  readonly published: BusinessEvent[] = [];

  async publish(event: BusinessEvent): Promise<void> {
    this.published.push(event);
  }
}
