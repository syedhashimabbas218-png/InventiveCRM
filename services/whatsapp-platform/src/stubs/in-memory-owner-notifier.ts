import type { OwnerAlert, OwnerNotifier } from '../interfaces/owner-notifier.ts';

export class InMemoryOwnerNotifier implements OwnerNotifier {
  readonly alerts: OwnerAlert[] = [];

  async alert(alert: OwnerAlert): Promise<void> {
    this.alerts.push(alert);
  }
}
