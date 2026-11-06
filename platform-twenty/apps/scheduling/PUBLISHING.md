# Publishing the calendar connections

What Google and Microsoft check before they let any customer connect a calendar, what the app already does about each
check, and what we still have to provide. Read it before creating the OAuth clients; the Google and Microsoft setup
sections of `README.md` give the console clicks.

## Permissions the app asks for

Each one is the narrowest the provider offers for the feature. The justification column is the text to paste into
Google's Data access form.

| Provider | Scope | Consent screen wording | Used for | Why nothing narrower works |
|---|---|---|---|---|
| Google | `openid`, `email` | Associate you with your personal info; See your primary email address | Showing which account is connected | Sign-in scopes, not sensitive |
| Google | `calendar.calendarlist.readonly` | See the list of Google calendars you're subscribed to | Letting the user pick which calendars block their time and which receives bookings | Read-only list; without it only the primary calendar is offered (the app handles this) |
| Google | `calendar.freebusy` | View your availability in your calendars | Reading busy periods so customers are never offered a clashing time. Only start and end times are read | The free/busy API returns no titles, descriptions or attendees; no narrower scope exists |
| Google | `calendar.events.owned` | See, create, change, and delete events on Google calendars you own | Creating, moving and removing the event for each booking, with a Meet link, on one calendar the user owns | `calendar.app.created` only covers calendars the app creates, but users want bookings in their existing calendar. `calendar.events` would also cover calendars shared with the user, which we do not need |
| Microsoft | `openid`, `email`, `User.Read` | Sign you in and read your profile | Showing which account is connected | Basic sign-in |
| Microsoft | `offline_access` | Maintain access to data you have given it access to | Keeping the connection working without signing in daily | Required for refresh tokens |
| Microsoft | `Calendars.ReadWrite` | Have full access to your calendars | Reading busy periods (start, end and show-as only) and creating, moving and removing booking events with Teams links | Graph has no write-only or own-calendar-only delegated calendar permission; reading needs `Calendars.ReadBasic` at least and writing needs this one |

Google classifies the three calendar scopes as sensitive, so the app needs Google's verification before more than 100
people can connect. None are restricted, so no paid security assessment (CASA) is needed.

## What the app already does

| Requirement | Where |
|---|---|
| Ask only for the scopes above | `src/connection-providers/*.ts` |
| Explain what is read, written and never done, link the privacy policy and the Limited Use statement, and say how to disconnect, before anyone connects | Calendar connections page (`src/front-components/connections.front-component.tsx`) |
| Granular consent: a user who unticks a permission gets that feature switched off, no API call that would fail is made, and the page names the missing permission with a Reconnect button | `src/lib/calendar/permissions.ts`, `connections.ts` |
| Bookings only go to calendars the user owns | `src/lib/calendar/google.ts`, `saveConnection` in `src/lib/admin.ts` |
| Tokens are held by the CRM, encrypted with `ENCRYPTION_KEY`, and refreshed by it; the app never stores them | Twenty connection providers |
| Disconnecting revokes the Google token (Twenty calls Google's revoke endpoint) and the app deletes the account address and calendar ids it kept | `revokeEndpoint` in the Google provider; orphan clean-up in `connections.ts` |
| Rate limits are retried with backoff and `Retry-After` is honoured (Google 403 `rateLimitExceeded`, Graph 429) instead of asking the user to reconnect | `classifyProviderFailure` in `src/lib/calendar/types.ts`, `src/lib/sync.ts` |
| Busy times are never shown to customers or stored; only the app's own booking events are read back, to put back changes made outside the CRM | `src/lib/calendar/*.ts`, `src/lib/sync.ts` |
| Customers are not added as provider attendees, so Google and Microsoft do not email them | `src/lib/sync.ts` |
| PKCE on both providers; HTTPS redirect URI on the server domain | providers, `README.md` |

## What we still have to provide

Neither provider will verify the app until these exist.

1. **A public home page** at `https://inventiveweb.studio` (the domain has no A record today). It must load without
   signing in, say what InventiveCRM and its Scheduling feature do, and link the privacy policy and terms. The app name
   on the page must match the consent screen: InventiveCRM.
2. **A privacy policy** at `https://inventiveweb.studio/privacy` (same domain as the home page) with the clauses below.
3. **Terms of service** at `https://inventiveweb.studio/terms`.
4. **The live server** at `https://crm.inventiveweb.studio` with TLS, so the redirect URI
   `https://crm.inventiveweb.studio/auth/apps/callback` works. Local mode (`http://localhost:3000`) is for testing only.
5. **A support mailbox** that receives mail: `support@inventiveweb.studio` (Cloudflare Email Routing can forward it).
6. **Domain ownership**: verify `inventiveweb.studio` in Google Search Console, and add it as a DNS-verified custom
   domain in the Microsoft Entra tenant that owns the app registration. Both are TXT records in Cloudflare.
7. **Logos**: `branding/assets/icon.png` (512 x 512) scaled to 120 x 120 for Google; a square PNG under 100 KB for
   Microsoft.
8. **A Microsoft work tenant and a partner account** for publisher verification (see below). A Gmail address cannot be
   used: the partner account email must be on `inventiveweb.studio`.

### Privacy policy clauses

The policy must say, in plain words:

- Which data: for staff who connect a calendar, the account address, the list of their calendars, busy periods (start
  and end only), and the booking events the service creates. For customers who book: name, email, phone, answers to
  booking questions and, for visits, the address.
- Why: to offer only free times, put bookings in the staff member's calendar with a video link, and keep both in step.
- Storage and security: hosted in our own infrastructure (state the provider and region), access tokens encrypted at
  rest, access limited to the workspace.
- Sharing: none, other than the calendar provider itself and our hosting provider as processors. Not sold, not used
  for advertising, not used to train AI models.
- Retention and deletion: busy periods are not stored; disconnecting removes the stored account details and the
  provider revokes access; how to ask for deletion of everything else, and how long backups keep data (30 days).
- User controls: disconnect under Settings, Accounts, or remove access at https://myaccount.google.com/connections or
  https://account.live.com/consent/Manage (personal) or https://myapps.microsoft.com (work or school).
- Google's Limited Use statement, word for word:

  > InventiveCRM's use and transfer to any other app of information received from Google APIs will adhere to the
  > [Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy),
  > including the Limited Use requirements.

- Contact details for privacy questions.

## Google

1. Create two Google Cloud projects: `inventivecrm-test` and `inventivecrm-prod`. Google requires production clients
   to hold no test or localhost redirect URIs, so local mode and the test double never use the production project.
2. In both, enable the **Google Calendar API**.
3. Google Auth Platform, **Branding**: app name `InventiveCRM` (no "Google" in the name), user support email, logo,
   home page, privacy policy and terms links, authorized domain `inventiveweb.studio`, developer contact email.
4. **Audience**: External. Keep the test project in Testing with named test users (their refresh tokens expire after
   7 days). Publish the production project when submitting for verification.
5. **Data access**: add exactly the scopes in the table, with the justifications above.
6. **Clients**: create a Web application client. Production redirect URI:
   `https://crm.inventiveweb.studio/auth/apps/callback`. Test project: `http://localhost:3000/auth/apps/callback`.
7. Put the client id and secret in `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` with `scripts/set-app-variables.mjs`.
8. **Verification Center**: submit branding verification first (it must be published before data access can be
   reviewed), then data access with the demo video. Review takes up to about 10 working days.

### Demo video (YouTube, unlisted, English)

1. Show the home page and the privacy policy, including the Limited Use statement.
2. Sign in to InventiveCRM, open Scheduling, Calendar connections, and show the "How your calendar is used" panel.
3. Click Connect Google or Microsoft, then connect Google under Settings, Accounts, Applications, Scheduling.
4. On Google's consent screen, show the app name and the address bar with the client id, then allow.
5. `calendar.calendarlist.readonly`: back in the CRM, show the list of calendars and tick the ones that block time.
6. `calendar.freebusy`: add a busy event in Google Calendar, open the public booking page and show that time is gone.
7. `calendar.events.owned`: book a time, show the event with its Meet link in Google Calendar; reschedule and cancel in
   the CRM and show the event move and disappear.
8. Disconnect the account and show it removed from Google's third-party connections.

## Microsoft

1. Register the app in a Microsoft Entra **work or school** tenant. Apps registered with a personal Microsoft account
   cannot be publisher verified.
2. Supported account types: accounts in any organizational directory and personal Microsoft accounts.
3. Redirect URI, platform Web: `https://crm.inventiveweb.studio/auth/apps/callback`. Use a second registration for
   `http://localhost:3000/auth/apps/callback`.
4. **Branding & properties**: name InventiveCRM, logo, home page, terms and privacy URLs, publisher domain
   `inventiveweb.studio` (pick the DNS-verified domain).
5. **API permissions**, Microsoft Graph, Delegated: `openid`, `email`, `offline_access`, `User.Read`,
   `Calendars.ReadWrite`. Nothing else. Grant admin consent for our own tenant.
6. **Certificates & secrets**: create a client secret, note its expiry and diarise the renewal; an expired secret
   disconnects every Microsoft calendar.
7. Put the values in `MICROSOFT_CLIENT_ID` and `MICROSOFT_CLIENT_SECRET`.
8. **Publisher verification**: join the Microsoft AI Cloud Partner Program (free) with an `@inventiveweb.studio`
   address, then in Branding & properties choose Add Partner ID to verify publisher, signed in with multi-factor
   authentication as an Application Administrator who is also a Partner Admin. Until then, users in many organisations
   cannot consent themselves and need their admin to approve InventiveCRM.

Personal Outlook.com accounts get events without Teams links (Teams meetings need a work or school account). An account
with no Exchange Online mailbox is refused with a clear message.

## Before going live

Connect one real Google account and one real Microsoft account on the live server and check: consent screen wording
and logo, untick one permission and see the warning, calendar list, busy time removes slots, booking creates the event
with a Meet or Teams link, reschedule and cancel, disconnect and revoke, and that a refreshed token still works the next
day. Everything else has been tested against the provider double in `tests/scheduling`.
