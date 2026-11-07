import { gql, nodes } from 'src/lib/api';
import { type SettingsRecord } from 'src/lib/records';

export type Customer = { name: string; email: string; phone: string | null };

const FREE_MAIL = new Set([
  'gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'hotmail.co.uk', 'live.com', 'live.co.uk', 'yahoo.com', 'yahoo.co.uk',
  'icloud.com', 'me.com', 'aol.com', 'btinternet.com', 'sky.com', 'virginmedia.com', 'protonmail.com', 'proton.me', 'gmx.com', 'mail.com',
]);

type PersonNode = { id: string; companyId: string | null };

// Customers type these values, so LIKE wildcards in them must match literally.
const likeLiteral = (value: string) => value.replace(/[\\%_]/g, (character) => `\\${character}`);

// Matching is exact on email (and optionally the full phone number). Names alone never merge two people.
export const findOrCreateContact = async (customer: Customer, settings: SettingsRecord): Promise<{ personId: string | null; companyId: string | null; matched: string }> => {
  const email = customer.email.trim().toLowerCase();
  const byEmail = await gql<{ people: { edges: { node: PersonNode }[] } }>(
    `query($email: String!, $quoted: String!) { people(filter: { or: [{ emails: { primaryEmail: { ilike: $email } } }, { emails: { additionalEmails: { like: $quoted } } }] }, first: 2) { edges { node { id companyId } } } }`,
    { email: likeLiteral(email), quoted: `%"${likeLiteral(email)}"%` },
  ).catch(() =>
    gql<{ people: { edges: { node: PersonNode }[] } }>(`query($email: String!) { people(filter: { emails: { primaryEmail: { ilike: $email } } }, first: 2) { edges { node { id companyId } } } }`, { email: likeLiteral(email) }),
  );
  let person = nodes(byEmail.people)[0] ?? null;
  let matched = person ? 'email' : 'none';

  const phoneDigits = (customer.phone ?? '').replace(/\D/g, '');
  if (!person && settings.contactMatching === 'EMAIL_THEN_PHONE' && phoneDigits.length >= 9) {
    const byPhone = await gql<{ people: { edges: { node: PersonNode }[] } }>(
      `query($phone: String!) { people(filter: { phones: { primaryPhoneNumber: { like: $phone } } }, first: 2) { edges { node { id companyId } } } }`,
      { phone: `%${phoneDigits.slice(-9)}` },
    );
    const matches = nodes(byPhone.people);
    // Only an unambiguous phone match counts.
    if (matches.length === 1) {
      person = matches[0];
      matched = 'phone';
    }
  }

  let companyId = person?.companyId ?? null;
  const domain = email.split('@')[1] ?? '';
  if (!companyId && settings.linkCompanyByEmailDomain && domain && !FREE_MAIL.has(domain)) {
    const companies = await gql<{ companies: { edges: { node: { id: string } }[] } }>(
      `query($patterns: [CompanyFilterInput!]) { companies(filter: { or: $patterns }, first: 2) { edges { node { id } } } }`,
      // The whole host or a subdomain of it, with or without a scheme and trailing slash; never a substring.
      { patterns: [`${likeLiteral(domain)}`, `%/${likeLiteral(domain)}`, `%/${likeLiteral(domain)}/`, `%.${likeLiteral(domain)}`, `%.${likeLiteral(domain)}/`].map((pattern) => ({ domainName: { primaryLinkUrl: { ilike: pattern } } })) },
    );
    const found = nodes(companies.companies);
    if (found.length === 1) companyId = found[0].id;
  }

  if (!person && settings.createContacts) {
    const [firstName, ...rest] = customer.name.trim().split(/\s+/);
    const { createPerson } = await gql<{ createPerson: PersonNode }>(`mutation($data: PersonCreateInput!) { createPerson(data: $data) { id companyId } }`, {
      data: {
        name: { firstName: firstName ?? '', lastName: rest.join(' ') },
        emails: { primaryEmail: email },
        ...(customer.phone ? { phones: { primaryPhoneNumber: customer.phone } } : {}),
        ...(companyId ? { companyId } : {}),
      },
    });
    person = createPerson;
    matched = 'created';
  }
  return { personId: person?.id ?? null, companyId: companyId ?? person?.companyId ?? null, matched };
};
