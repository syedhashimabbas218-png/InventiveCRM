# Onboarding a client (staff-led)

The steps a staff member follows to set up a new client on InventiveCRM, from the first call to a working workspace,
and later to rotate keys or offboard them. This is option one of finding S1 in `launch-readiness.md`.

Why staff do it: clients stay on the **Member** role, because app code is not isolated between workspaces. Connecting
Stripe, Revolut, Resend or InventiveChat needs Twenty's **Applications** permission, which would also let a client
register apps of their own, so our staff paste each client's keys.

Written for Twenty 2.55. Twenty 2.59 changes how app connections start (S8), so check the connect steps after that
upgrade.

## 0. Before you start

Production must have:

- public HTTPS (B1): connect pages, provider webhooks and calendar sign-in need the public address;
- the QA'd app versions published and running in our own workspace (B4, after `duplicate-check.md`), since
  `app install` installs whatever version is published;
- InventiveChat live (B5), if the client takes WhatsApp;
- mail DNS (SPF, DKIM, PTR), or invitations land in spam.

On the server:

```bash
export PATH=/opt/node24/bin:$PATH
cd /opt/inventivecrm/platform-twenty
SERVER=https://crm.inventiveweb.studio
SUB=acme
```

`SUB` is the client's subdomain: 3 to 30 lowercase letters, digits or hyphens. The CLI is `npx twenty@2.54.3` and
needs Node 24.5 or later, hence the `PATH`.

### Check there is room for another workspace

Twenty 2.55 refuses to create a sixth workspace on a server without Twenty's paid organization key. The count is
server-wide and includes our own workspace and the canary, so at most three clients fit. Workspaces in Twenty's trash
do not count; half-created ones do. Count them (read-only, metadata only):

```bash
docker exec -e PGOPTIONS='-c default_transaction_read_only=on' inventivecrm-db-1 sh -c 'exec psql -X -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SELECT \"displayName\", subdomain, \"activationStatus\", \"createdAt\"::date AS created FROM core.workspace WHERE \"deletedAt\" IS NULL ORDER BY \"createdAt\""'
```

Five rows means the server is full. Stop and ask the owner. The choice is theirs:

- buy Twenty's organization key (`ENTERPRISE_KEY` in `deploy/.env`, applied with a restart in a maintenance window);
- free a slot: delete a departed client's workspace (section 12), or the canary, after putting another workspace's key
  in `SMOKE_KEYS_DIR` (`deploy/ops.env`), which the smoke test after upgrades and restores reads;
- start a second InventiveCRM server for the next clients, with its own backups, upgrades and monitoring.

Patching the limit out is not an option: Twenty's core stays untouched. The test server is full too (five
workspaces), which matters for section 9.

### Check the server variables

They are set once for the whole server, never per client. With an empty file the script changes nothing and prints
`kept` or `not set` for each variable of each app (ids from `UPDATES.md`, "Releasing an app"):

```bash
for app in 93ae1d55-5c54-4fac-922b-fd9fa4a69ab5 54c65493-4e80-4efa-824a-456671383c86 f69757a9-c451-4ac3-8042-79a99ad8e749 \
  992fae47-c2c3-4731-b8aa-ebdcdb466631 6c6eba62-6fc2-487e-a212-3b8b01bb4365 23e5cd3d-e631-461b-9e06-849c0a577688; do
  echo "== $app"
  node scripts/set-app-variables.mjs --server "$SERVER" --key-file /root/secrets/keys/owner.key --env-file /dev/null --app "$app"
done
```

An app not yet published on the server answers "No app registration". Each app's README lists its variables. In
particular `WHATSAPP_GATEWAY_URL` must be the path `/s/whatsapp/gateway`, and `STRIPE_API_URL`, `REVOLUT_API_URL`
and `RESEND_API_URL` must be empty: they point every workspace at a test double or at Revolut's sandbox.

## 1. Collect from the client

Ask for these before the onboarding call:

| What | Used for |
|---|---|
| Legal and trading name, legal structure, company number, place of registration, registered office, business address | Business profile; required on UK invoices |
| VAT registered or not, VAT number, how VAT is rounded | Business profile; confirm rounding with their accountant |
| Bank details, payment terms, how payment should be described | Invoices |
| Their invoice, quote and credit note prefixes and the next number of each, if they already issue documents | So numbering carries on without gaps or clashes |
| Logo (an https link or the file), brand colours, website, postal address for email footers | Workspace logo, Campaign Studio brand kit |
| Subdomain they want | `<subdomain>.crm.inventiveweb.studio` |
| Names and email addresses of everyone who needs access | Invitations, all as Members |
| Which apps they take | Install list |
| Stripe or Revolut Business, if they want pay-now links (one per workspace) | Payments |
| Resend account with their sending domain verified, if they send campaigns | Email campaigns |
| WhatsApp Business number and Meta business details, if they take WhatsApp | InventiveChat tenant |
| Who uses Google or Microsoft calendars, and their sign-in addresses | Calendar sync |
| A description of the business: what they track, their stages, what should happen automatically | Setup spec |
| Signed terms and our DPA (Twenty's DPA does not cover our service) | Before any personal data goes in |

Send the client these instructions for the keys:

- **Stripe**: Dashboard, Developers, API keys, **Create restricted key**, named `InventiveCRM`. Write access to
  Payment Links, Prices and Products; Read access to Checkout Sessions; everything else None. A live key starts
  `rk_live_`. Nothing else is set up in Stripe: no webhook, because the app checks payments itself.
- **Revolut Business**: APIs, Merchant API, the **Production** secret key. The merchant account must be active. No
  webhook either. Never a Sandbox key: the sandbox address is one setting for every workspace on the server.
- **Resend**: Domains, add the sending domain and publish the DNS records Resend shows until it says Verified. Then API
  Keys, **Create API key**, permission **Full access** (Campaign Studio reads domains and sets up delivery tracking;
  Sending access is refused). It starts `re_`. Open and click tracking are switched on per domain in Resend and need a
  tracking subdomain.

They should create the keys during or just before the call, not weeks ahead.

### Receiving keys safely

Never by email, chat, SMS, a ticket, a CRM note or this repository, and never typed into a terminal command.

1. Ask for each key through a one-time share from our password manager (for example a Bitwarden Send or a
   1Password share link) set to expire after one view and within 24 hours. Give the share's password by phone.
2. On the call, open the share and paste the key straight into the connect page (section 5). Nothing is saved on the
   way.
3. Delete the share if it did not expire itself. We keep no copy: Twenty stores the key encrypted. The record
   (section 10) keeps only the label Twenty shows, such as "Stripe key ending 4242".

## 2. Create the workspace

```bash
INVENTIVECRM_ADMIN_EMAIL="$(cat /root/secrets/inventivecrm-admin-email)" \
INVENTIVECRM_ADMIN_PASSWORD="$(cat /root/secrets/inventivecrm-admin-password)" \
node scripts/provision-workspace.mjs --server "$SERVER" --name "Acme Plumbing Ltd" --subdomain "$SUB" --key-file "/root/secrets/keys/$SUB.key"
```

It creates the workspace with our admin account as its Admin, and an API key with the Admin role of that workspace
only, valid for 365 days, written to the key file with mode 600. Copy the JSON it prints into the record.

If it stops with an error:

- about the workspace limit: nothing was created; go back to section 0;
- about the subdomain: pick another one;
- after the workspace was created (it shows in the count): do not run it again, since every run makes a new
  workspace. Sign in to the new workspace with our admin account, complete any setup screen it shows, then create the
  key under Settings, Developers, API with the Admin role and save it to the same file with mode 600.

## 3. Install the apps

The CLI's default remote is `owner`, which is our own production workspace. Every command below names the client's
remote, so a slip cannot land in our workspace. Add the remote without `--use`:

```bash
REMOTE="client-$SUB"
tr -d '\n' < "/root/secrets/keys/$SUB.key" | npx twenty@2.54.3 auth login --with-token --url "$SERVER" --name "$REMOTE"
npx twenty@2.54.3 remote list
```

Check that the dot (the default) is still on `owner` and that the new remote shows the client's workspace name.

Install only the apps the client takes, in this order:

1. Quotes & Invoices: `npx twenty@2.54.3 app install --universal-identifier 93ae1d55-5c54-4fac-922b-fd9fa4a69ab5 --remote "$REMOTE"`
2. Scheduling: `npx twenty@2.54.3 app install --universal-identifier 54c65493-4e80-4efa-824a-456671383c86 --remote "$REMOTE"`
3. Feedback: `npx twenty@2.54.3 app install --universal-identifier f69757a9-c451-4ac3-8042-79a99ad8e749 --remote "$REMOTE"`
4. Campaign Studio: `npx twenty@2.54.3 app install --universal-identifier 992fae47-c2c3-4731-b8aa-ebdcdb466631 --remote "$REMOTE"`
5. Team chat: `npx twenty@2.54.3 app install --universal-identifier 6c6eba62-6fc2-487e-a212-3b8b01bb4365 --remote "$REMOTE"`
6. WhatsApp: `npx twenty@2.54.3 app install --universal-identifier 23e5cd3d-e631-461b-9e06-849c0a577688 --remote "$REMOTE"`

Running an install again is safe. A new, empty workspace needs no backup first. Then sign in at
`https://<subdomain>.crm.inventiveweb.studio` with our admin account and check Settings, Apps: every installed app
shows the same version as in our own workspace.

## 4. Business details and setup

Signed in to the client's workspace as our admin account:

1. **Settings, General**: workspace name and logo. On the **Security** tab, switch off invitations by link, so only
   people we invite by email can join.
2. **Quotes & Invoices, Business profile**: everything from section 1. If the client already issues documents, set
   the prefixes and **Next invoice number**, **Next quote number** and **Next credit note number** to carry on their
   sequence. Then **Send documents when issued**, **Send overdue reminders** and **Send emails from**. **Online
   payments** waits for section 5.
3. **Scheduling settings**: default time zone and email sender name. Advisors set up their own hours after they join.
4. **Feedback settings** (created, switched off, the first time the Feedback overview opens): business name, Google
   review link, alert emails and thresholds. Leave automatic asking off until the client has agreed the question and
   timing.
5. **Campaign Studio, brand kit**: logo link, colours, and the footer with business name and postal address. No
   campaign can be sent without the footer address.
6. The client's own objects, fields, views and workflows, from a setup spec written from their description (examples
   in `setup-specs/`; see the README, "Onboarding a client"). Keep the client's spec outside this repository, which
   is public. The script skips what exists and never deletes, so it can be re-run:

   ```bash
   node scripts/apply-setup-spec.mjs --mcp "https://$SUB.crm.inventiveweb.studio/mcp" --key-file "/root/secrets/keys/$SUB.key" --spec "/root/client-specs/$SUB.json"
   ```

## 5. Connect payments and email

A workspace has one connection of each kind, made by our admin account, which has the Applications permission.
Every connect page checks the key with the provider before Twenty stores it encrypted.

| Provider | Screen | What the key needs | On the provider's side |
|---|---|---|---|
| Stripe | Settings, Accounts, Applications, Quotes & Invoices, **Stripe (payments)** | Restricted live key (section 1) | Nothing |
| Revolut Business | Settings, Accounts, Applications, Quotes & Invoices, **Revolut Business (payments)** | Production Merchant API secret key | Nothing |
| Resend | Settings, Accounts, Applications, Campaign Studio, **Resend (email campaigns)** | Full access key; a verified domain | The app registers its webhook at `https://<subdomain>.crm.inventiveweb.studio/s/campaigns/webhook/<token>` for delivered, bounced, complained, opened, clicked, failed and suppressed. Do not add it by hand: the address carries a per-workspace token and the app reads the signing secret itself |
| InventiveChat | Settings, Accounts, Applications, WhatsApp, **InventiveChat (WhatsApp)** | System key `wa_...` (section 6) | The app registers its webhook at `https://<subdomain>.crm.inventiveweb.studio/s/whatsapp/events` |

Payments:

1. Open the screen, choose the provider, paste the key from the share and press Connect. Wait for "Connected". "Not
   accepted" means a wrong key or a missing permission: compare with section 1 and ask for a new key.
2. **Business profile, Online payments**: choose Stripe or Revolut.
3. Use live keys only. A Stripe test key would put test-mode links on real invoices.
4. Do not issue a test invoice: it takes the next number in the client's legal sequence. The key check on the connect
   page is the test; the payment flow is covered by the suites on the test server.

Resend:

1. Connect as above.
2. Open Campaign Studio. If it offers **Turn on delivery tracking**, press it: the webhook could not be registered at
   connect time. Check that Resend, Webhooks, lists the CRM's address.
3. Send a test email from a draft campaign to the client's own address.

## 6. WhatsApp

On InventiveChat, which we run (whoever administers it):

1. Create the client's tenant.
2. Connect the client's WhatsApp Business number through Meta and wait for it to be approved. If the tenant has more
   than one active number, note the id (`wac_...`) of the one the CRM should use.
3. Create the notification templates named in `apps/whatsapp/README.md` ("Notification templates"), with exactly those
   names and named parameters, and submit them to Meta: `invoice_ready`, `credit_note_ready`, `quote_ready`,
   `invoice_overdue`, `invoice_payment_link`, `feedback_request`. Make them in the language set in WhatsApp settings
   (`en_GB` unless changed). Templates the client already has can be mapped instead (the same README section). Campaign
   templates are Marketing templates.
4. If the client wants workflows to reply with free text, set the allowed topics. There are none by default, and
   InventiveChat asks a person to approve automation per conversation.
5. Settings, API keys: create a system key for InventiveCRM (`wa_...`). It never leaves our hands, so no share is
   needed.

In the CRM:

1. Connect the key on the InventiveChat (WhatsApp) screen (section 5).
2. Open **WhatsApp settings**: **Connection problem** is empty, **Webhook address** is the address in section 5 and
   **WhatsApp number** is right. Fill **WhatsApp number id** if the tenant has several numbers, and set **Add unknown
   numbers as people** as the client prefers.
3. Open the WhatsApp inbox: the templates list shows the approved ones (greyed out until Meta approves them).
4. Documents go by WhatsApp only to contacts with a mobile number and **Agreed to WhatsApp messages** ticked, as their
   **Send documents by** field says. The client records that consent; we do not tick it for them.

## 7. Invite the client's people

1. **Settings, Members, Roles**: the default role is Member, and the Member role has none of the Workflows,
   Applications or Roles permissions.
2. **Settings, Members, Invite**: invite each person by email with the **Member** role. Never Admin, and never a role
   with those three permissions. If the client needs an API key for an integration, give it the Member role.
3. Recommended hardening (each app keeps working, since it uses its own role): in the Member role, remove edit rights
   on WhatsApp settings, conversations and messages, and on Campaign, Campaign recipient and Do-not-contact, and remove
   access to the three Chat objects. Before removing anything else, check that people can still reach Settings,
   Accounts to connect their calendar.
4. Our admin account stays Admin. Later member changes, keys and app settings go through us.

## 8. Calendars

Calendars belong to each person, so staff cannot connect them. Each advisor signs in and connects Google or Microsoft
under Settings, Accounts, Applications, Scheduling (the **Calendar connections** page links there), then sets up their
advisor profile from the Scheduling Overview. The OAuth apps are server-wide (`apps/scheduling/README.md`), with the
redirect address `https://crm.inventiveweb.studio/auth/apps/callback`; nothing is registered per client.

- Google: until Google verifies our app, add each advisor's Google address as a test user (Google Cloud Console, OAuth
  consent screen). Their connection then expires after 7 days and needs Reconnect.
- Microsoft: if the client's Microsoft 365 tenant blocks user consent, their tenant admin must approve the app once.

## 9. Smoke checks

`tests/qa/workspace-smoke.mjs` runs against the test server only: it refuses production by design
(`tests/guard.cjs`). Use it to rehearse a new kind of setup first. The test server is full, so rehearse in the QA
workspace (`qafresh1803`, remote `test-qa`) or ask the owner to free a test slot. Install the same apps there, apply
the same setup spec, then pass the workspace's key and a second workspace's key:

```bash
SERVER_URL=http://localhost:3001 node tests/qa/workspace-smoke.mjs qafresh1803 /root/test-keys/qafresh.key /root/test-keys/acme.key
```

It ends with `SUMMARY all passed`.

On production, after onboarding, run the same read-only checks by hand, with the canary's key (or any other
workspace's) as the second key:

```bash
deploy/ops/smoke-test.sh
KEY_FILE=/root/secrets/keys/$SUB.key
OTHER_KEY_FILE=/etc/inventivecrm/smoke-keys/canary.key
auth() { printf 'Authorization: Bearer %s\n' "$(tr -d '\n' < "$1")"; }
curl -sS "$SERVER/graphql" -H 'Content-Type: application/json' -H @<(auth "$KEY_FILE") \
  -d '{"query":"{ invoices { totalCount } appointments { totalCount } feedbackRequests { totalCount } marketingCampaigns { totalCount } chatChannels { totalCount } whatsappConversations { totalCount } }"}'; echo
for route in scheduling/admin:overview campaigns/admin:overview feedback/admin:overview chat/api:bootstrap whatsapp/api:templates; do
  for key_file in "$KEY_FILE" "$OTHER_KEY_FILE"; do
    code=$(curl -sS -o /dev/null -w '%{http_code}' -X POST "https://$SUB.crm.inventiveweb.studio/s/${route%%:*}" \
      -H 'Content-Type: application/json' -H @<(auth "$key_file") -d "{\"action\":\"${route##*:}\"}")
    echo "/s/${route%%:*} with $(basename "$key_file"): $code"
  done
done
```

Expect a number for each object, with no `errors` (leave out the objects of apps the client does not take), then 403
for every route with the client's key (an API key would act with the app's full role) and 401 or 403 with the
canary's key.

Then in the browser: open each app once as our admin account, and ask one client person to sign in and confirm they
see the apps, no Apps or Developers in Settings, and no Roles tab under Members.

## 10. Record what was done

Keep one record per client in their entry in our password manager, never in this repository:

```
Client:              <legal name>
Workspace:           <subdomain>.crm.inventiveweb.studio, id <workspaceId>, created <date>
Count before:        <n> of 5
Onboarded by:        <staff>, <date>
Admin API key:       /root/secrets/keys/<subdomain>.key, expires <date>; CLI remote client-<subdomain>
Apps and versions:   <app> <version>, ...
Payments:            Stripe or Revolut, "<label Twenty shows>", connected <date>
Resend:              "<label>", connected <date>, webhook listed in Resend: yes/no
WhatsApp:            tenant <id>, number <phone> (<wac_ id>), templates approved <names>, connected <date>
Members:             <names>, all Member
Calendars:           <who connected what>
Smoke checks:        <date>, <result>
Key rotations:       <date>, <which key>, <by whom>
Offboarding:         <date>, <what was disconnected, revoked and deleted>
```

## 11. Key rotation

Rotate on a schedule agreed with the client, whenever someone who handled a key leaves, and at once if a key may have
leaked.

- **Stripe, Revolut, Resend**: the client creates a new key with the same permissions and sends it the safe way. Connect
  it on the same screen, check it shows Connected, and disconnect the old connection under Settings, Accounts straight
  away: payments use the newest connection, but Resend picks between two arbitrarily. Then the client deletes the old
  key at the provider. If a provider can only replace its key in place, the old one stops at once: do it on a call and
  connect the new key straight away. Move to a different Stripe or Revolut account, rather than a new key, only when
  no invoice has an open pay-now link: links made on the old account cannot be checked with the new key.
- **InventiveChat**: create a new system key, connect it (the app disables our old webhook and registers a new one),
  disconnect the old connection straight away (with two, which one is used is arbitrary), then revoke the old key in
  InventiveChat.
- **Our admin API key** (expires after 365 days; the date is in the record): Settings, Developers, API, create a key
  with the Admin role and save it to `/root/secrets/keys/<subdomain>.key` with mode 600. Re-save the remote with
  `tr -d '\n' < "/root/secrets/keys/$SUB.key" | npx twenty@2.54.3 auth login --with-token --remote "client-$SUB"`, then
  delete the old key in Settings.
- If a key may have leaked, revoke it at the provider first and connect the new one after; the short gap is the price.

Server variables such as `BOOKING_LINK_SECRET` belong to every workspace, not one client. Changing them breaks links
already sent for everyone (see each app's README).

## 12. Offboarding

1. Agree the end date and give the client their data as their contract says (each view exports to CSV; issued
   documents are PDFs on the records).
2. Disconnect every connection under Settings, Accounts, Applications: Stripe or Revolut, Resend and InventiveChat.
   Disconnecting InventiveChat also disables the CRM's webhook there. Ask each person to disconnect their calendar,
   and to remove the app's access in their Google or Microsoft account.
3. The client deletes their keys at Stripe, Revolut and Resend, and the CRM's webhook under Resend, Webhooks (the app
   cannot delete it).
4. On InventiveChat: revoke our system key, then close the tenant or hand the number over as agreed.
5. Delete our admin API key (Settings, Developers, API), then on the server:

   ```bash
   shred -u "/root/secrets/keys/$SUB.key"
   npx twenty@2.54.3 remote remove "client-$SUB"
   ```

6. **Settings, General, Delete workspace**, as our admin account. The workspace goes to Twenty's trash and stops
   counting towards the limit at once. Its data stays in the database until Twenty's cleanup job destroys it (7 days
   later with default settings) and in backups until they expire (30 days for nightly ones).
7. Complete the record.

## Later

A page where clients paste their own keys without the Applications permission (S1, option two) would take the key
hand-over out of this runbook; it needs a redesign.
