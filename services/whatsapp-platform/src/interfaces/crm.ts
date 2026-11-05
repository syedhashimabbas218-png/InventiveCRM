export type CrmPerson = {
  id: string;
  name?: string;
  phone: string;
  summary?: string;
};

export type CrmClient = {
  findOrCreatePersonByPhone: (tenantId: string, phone: string, profileName?: string) => Promise<CrmPerson>;
  getPerson: (tenantId: string, personId: string) => Promise<CrmPerson | undefined>;
  addNote: (tenantId: string, personId: string, note: string) => Promise<{ noteId: string }>;
};
