import { randomUUID } from 'node:crypto';
import type { CrmClient, CrmPerson } from '../interfaces/crm.ts';

export class InMemoryCrm implements CrmClient {
  private readonly people = new Map<string, CrmPerson & { tenantId: string }>();
  readonly notes: { tenantId: string; personId: string; note: string }[] = [];

  async findOrCreatePersonByPhone(tenantId: string, phone: string, profileName?: string): Promise<CrmPerson> {
    for (const person of this.people.values()) {
      if (person.tenantId === tenantId && person.phone === phone) return person;
    }
    const person = { id: `per_${randomUUID()}`, tenantId, phone, name: profileName };
    this.people.set(person.id, person);
    return person;
  }

  async getPerson(tenantId: string, personId: string): Promise<CrmPerson | undefined> {
    const person = this.people.get(personId);
    return person?.tenantId === tenantId ? person : undefined;
  }

  async addNote(tenantId: string, personId: string, note: string): Promise<{ noteId: string }> {
    if (!(await this.getPerson(tenantId, personId))) {
      throw new Error('person not found');
    }
    this.notes.push({ tenantId, personId, note });
    return { noteId: `note_${randomUUID()}` };
  }
}
