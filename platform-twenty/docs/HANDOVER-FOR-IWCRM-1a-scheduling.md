# Handover for Iwcrm, part 1a: Scheduling

Behaviour of the Scheduling app as built on Twenty (app version 0.4.2, repository state of 19 November 2026), written for a rebuild in Rust and Postgres. Where the README and the code disagree, this document follows the code and tests. Part 1b covers Feedback.

Conventions: instants are UTC; "local" means the advisor's schedule time zone. "The platform" means something Twenty did for us that Iwcrm must do itself. **Open** marks known gaps, not behaviour to copy.

## 1. Purpose

Calendly-style booking inside the CRM: staff define appointment types, availability, teams, offices and service areas; customers book through public pages or website embeds; the right advisor is chosen by rules, fairness and geography. Bookings are ordinary CRM records linked to the person and company, are written to the advisor's Google or Microsoft calendar, and drive confirmation, change and reminder emails.

## 2. Features and business rules

### 2.1 Booking page and public API

- `<workspace>/s/book/<slug>` resolves the slug as a type, then a booking link, then an advisor's personal slug (which lists the Active types they own, up to 50).
- A page books only if the type is Active and any booking link is active; otherwise 404.
- The page shows name and description (a link's title and description override them), duration, format, conferencing, team, group capacity, colour and display time zone. An office shows its address only if marked public.
- Booking link presets prefill name, email and answers; questions listed in `hide` are not shown. A link with an advisor books only that advisor.
- Customer-choice types without location matching or a link advisor list the eligible advisors: name, bio, location label, approximate point.
- The customer's time zone comes from the browser and can be changed on the page. A booking stores it if it is a valid IANA zone, else the type's zone, else the workspace default.
- A slot request covers 1 to 35 days from an ISO date (default 7).
- A booking needs a name (1 to 120 characters), a valid email (at most 200), an optional phone matching `^[+\d][\d\s()-]{6,24}$`, a phone for Phone types, and an answer to each required intake question. Answers are at most 2,000 characters; a select answer must be one of its options; at most 30 answers are kept, keys cut to 64 characters.
- Every booking recomputes availability live before claiming time, so a stale slot list cannot cause a double booking.
- A booking returns status (Confirmed, or Pending with approval), start, end, advisor name, manage URL and confirmation message.
- Error answers: 409 SLOT_TAKEN (time gone), 400 INVALID, LOCATION_REQUIRED, TOO_LATE, NOT_BOOKABLE, 403 EMBED_NOT_ALLOWED, 404 NOT_FOUND, 429 RATE_LIMITED (with `retry-after: 60`), 500 SERVER_ERROR (also recorded as a `system.error` audit event).
- Address search needs at least 3 characters and returns up to 5 places.
- "Advisors near you" looks 14 days ahead: public profile, distance in whole km (minimum 1), travel time to 5 minutes (minimum 5), routed or not, earliest free time, number excluded.
- Shareable read answers are marked for the edge cache: page data 60 s, slots and nearby advisors 30 s, address search 1 h, page shell 5 min, embed script 5 min. Manage, cancel, reschedule and book answers are `no-store`.

**Embeds**

- Three snippets per page: inline (`<div data-crm-booking="slug">`), popup link (`data-crm-booking-popup`) and floating button (`data-floating`, optional `data-label`, `data-color`), all loading `<workspace>/s/booking/embed.js`.
- The widget is an iframe of the booking page with `embed=1&parent=<site origin>`. It resizes itself between 400 and 2,400 px and announces a finished booking; the host script accepts messages only from the booking origin.
- Bookings made in a widget are recorded with source "Website embed".
- If a type lists allowed domains, the widget refuses to render on any other site (a host matches a listed domain or a subdomain of it). The server refuses an embed booking whose parent origin is not allowed. An empty list allows every site.

### 2.2 Availability

- Weekly hours are windows `HH:MM`, several per day (gaps are breaks). An end at or before the start, or `24:00`, runs past midnight into the next day.
- The schedule used is the type's schedule override, else the advisor's chosen schedule, else their default schedule (or their first). An advisor with no schedule is never offered.
- The schedule's time zone is used, else the advisor's, else the workspace default.
- Time off with no hours removes whole days; time off with hours removes only those hours; special hours replace that date's weekly hours. Override dates are inclusive local dates.
- Daylight saving: wall times convert through the IANA database. A time skipped in spring moves forward by the gap (01:30 London becomes 02:30); a repeated autumn time takes its first occurrence; a 09:00 window stays 09:00 local on both sides of a change.
- Busy time is the union of: time held by CRM bookings (reservations, buffers included), busy blocks from every calendar the advisor selected in each connected account, and whole local days at a booking limit.
- If any selected calendar cannot be read, or an account needs reconnecting, that advisor gets no times at all until it is fixed (fail closed).
- An advisor with no linked, sealed CRM user (or no connected account) is offered from working hours and CRM bookings only.
- Advisor daily and weekly limits count all their non-cancelled bookings; type limits count that advisor's bookings of that type. Days are local dates; weeks are ISO weeks of the local date.
- Start times step by the type's increment (default 30, never under 5; empty means the duration) and align to the local clock (for 30: :00 and :30).
- A meeting must fit inside one working window; meeting plus buffers must not overlap busy time. Buffers may fall outside working hours.
- A start must be at least the minimum notice after now and at most the horizon (days) after now.

### 2.3 Appointment types

- Status Draft (default), Active or Disabled. Only Active types take public bookings. The staff booking form (Schedule an appointment) offers Draft and Active types, ignores minimum notice, has no location step (so location types cannot be booked there) and records source "Added in the CRM".
- Defaults: duration 30, increment 30, minimum notice 240 minutes, horizon 60 days, buffers 0, capacity 1, cancel and reschedule cut-offs 24 hours, reminders `1440,60`, format Video, conferencing None, assignment One named advisor, strategy Equal, location matching None, distance by road, approval off, travel-checked slots off.
- Advisor eligibility by format: Video and Phone need "meets remotely", In person at an office needs "meets in person", At the customer needs "travels to customers".
- The appointment's "Where" text: Phone `Phone: <number>`; office `<office>, <street> <postcode>`; at the customer the address label; Video the fixed link, if any.
- Conferencing: Google Meet is created only when the event goes to a Google calendar and Teams only on a Microsoft calendar; any other combination silently has no link. A fixed link is copied to the appointment.
- Approval: with "needs advisor approval" a booking is Pending, holds its time, the customer gets "request received" (no invitation file) and advisors are asked to approve. Setting it to Confirmed sends the customer the confirmation with the invitation file.
- Intake questions are JSON `[{"id","label","type":"text|textarea|select|phone|email","required","options"}]`.
- Quick create (Overview) makes a Draft: name required (at most 120), slug `<name>-<4 hex>`, duration rounded to 5 within 5 to 480, increment the smaller of duration and 30, owned by the creator as one-to-one, or round robin when a team is chosen; At the customer defaults to Nearest. Quick create refuses when the workspace has reached its maximum number of types.

### 2.4 Advisors, teams and assignment

- Eligible advisors: for One named advisor (or a type without a team) the type's owner; otherwise the team's active members. Inactive advisors are excluded.
- A requested advisor (customer choice, or a link's advisor) is used only if eligible; naming anyone else gives no times. Customer-choice types refuse a booking without a chosen advisor.
- Several free advisors are ranked by the type's strategy over non-cancelled bookings created in the team's fairness window (default 30 days), counted per team (per type without a team). Equal: fewest bookings, then least recent. Weighted: fewest per weight (weight 0 never wins; 3:1 weights give 3:1 bookings). Least recent, then fewest. Lightest workload: fewest upcoming minutes. Priority: highest, then fewest, then least recent. First available: earliest free time, then fewest, then least recent. Ties end on advisor id. Weight and priority come from the membership, else the advisor. First-available assignment always uses the first-available strategy.
- Nearest, Fastest and First available nearby rank by location instead (2.5).
- If the winner's time is taken at the moment of booking, the next in line is tried ("next in line after a clash").
- Cancelled bookings do not count for fairness, so a cancelled assignment returns to the pool; completed and no-show bookings count.
- Every booking stores why its advisor was chosen (`assignmentReason`, e.g. "EQUAL: Alice, fewest bookings in the fairness window (2); 3 eligible").
- Collective: a time is offered only when every eligible member is free and every member's calendars could be read. The booking holds all of them, the type owner is host if among them (else the first), and every member's calendar gets the event.
- Staff can reassign by changing the advisor on the appointment: the new advisor's time is claimed; if they are busy the change is reverted and audited. **Open**: the previous advisor's calendar event is not removed and they are not emailed (see 4).
- An advisor profile can be created by the user from the Overview (Monday to Friday 09:00 to 17:00 in their time zone, a personal slug) or by someone else. A user's connected calendars are used only for a profile they created or confirmed ("Is this you?").

### 2.5 Locations and travel

- A location is needed when location matching is not None or the format is At the customer; otherwise LOCATION_REQUIRED.
- The customer gives an address (geocoded) or drops a map pin (reverse-geocoded for postcode and label when missing).
- An advisor's base is their base coordinates, else their office's. Coordinates are entered, not geocoded from the base address.
- Distance and travel time from each base come from one routing table call. If routing fails, straight-line distance is used and travel time is estimated as straight km x 1.4 at 30 km/h (rounded up), marked unverified. "Distance by straight line" ignores road distance.
- Public requests judge coverage and distance from the customer point snapped to a 0.01 degree grid (about 1 km); the travel check uses the exact point.
- Eligibility, in order: Territory mode needs the point inside the advisor's GeoJSON area or the postcode inside their territory. Other modes need a base; a set service radius is compared with straight-line km; a set maximum travel time with travel minutes; Within radius needs a radius or a territory; if a territory is configured the customer must be inside it, except for Nearest and Fastest.
- Postcode territories: `LS` matches every LS district; `LS6` matches only LS6 (not LS60). Case and spaces are ignored.
- Ranking: Nearest by road km (else straight); Fastest by travel minutes then distance; First available nearby by earliest time then distance. Within radius, Territory, Customer picks and Geographic round robin use the round-robin strategy among eligible advisors.
- For At the customer types, each time is checked against the advisor's stops either side in the same working window: they must reach the customer from the previous stop (or from base when the window opens) and the next booking afterwards, each plus their travel buffer.
- Without routing, a type that only offers travel-checked slots gives no times; otherwise the appointment stores travel minutes and "Estimated: routing was unavailable" (or "Checked with road routing").

### 2.6 Double booking and group sessions

- Two bookings can never hold the same advisor for overlapping time, even when requested at the same moment: each booking inserts one reservation per advisor per 5-minute tick it holds (buffers included, rounded outward) in a single insert, and the tick key is unique.
- A clashing insert tries the next candidate advisor or seat, else 409. Back-to-back bookings share no tick.
- Group sessions (capacity over 1): the first booking for an advisor, type and start creates the session (key `<type id>|<advisor id>|<start ISO>`), holds the host's ticks and seat 1. Later bookings claim only a free seat key; seats are 1 to capacity, so a session can never exceed its capacity.
- A session with free seats stays bookable although the host's time is held. Slots show seats left.
- Every seat is tried, the ones above the booked count first, so a seat freed by a cancellation can be taken again.
- Cancelling or deleting a member frees only their seat. The host's time passes to the oldest remaining member and is released when the last member leaves.
- Group members cannot reschedule online.
- A repeated submit with the same idempotency key returns the existing booking, only to the same email and type; anyone else gets 409.
- A booking that fails after claiming time removes its record and frees its time; unlinked time older than 15 minutes is freed daily.

### 2.7 Rescheduling and cancellation

- The manage page `<workspace>/s/booking/manage/<token>` shows status, time in the customer's zone, type, advisor, place and meeting link (only an https link).
- Online cancel needs: not Cancelled, Completed or No-show, not started, and at least the cancel cut-off hours ahead. Reschedule: the same with its own cut-off, never for group sessions. The server enforces both.
- A cancellation records when, by whom and why (at most 500 characters).
- Rescheduling offers the same advisor's (or all collective participants') times, ignoring the appointment's own held time and its own calendar event, so it can move to a time overlapping the old one.
- The new time is claimed before the old one is released, so a failed reschedule leaves the booking unchanged. A rescheduled booking becomes Rescheduled (a Pending one stays Pending) and its reminders start again.
- Staff can cancel, move or reassign by editing the record. A move onto busy time is reverted (audit `appointment.move-rejected`).
- An appointment created by hand in the CRM claims its time when created; if it overlaps it is set to Pending with a note, audited as a conflict, holds no time, and its advisor is emailed.
- Appointments still Confirmed or Rescheduled a day after they end become Completed (daily job). Staff can set No-show. Pending ones are never completed automatically.

### 2.8 Reminders

- Reminder intervals are minutes before the start, comma separated per type (default `1440,60`); invalid or non-positive entries are ignored.
- Only Confirmed and Rescheduled appointments get reminders.
- Each interval is sent at most once; an interval is due once the time to start is at or below it. Several due together (after downtime, or a booking made inside an interval) go as one email, and all are recorded.
- A reminder counts as sent only after the email went out. A failed send is tried again on the next run and audited as `notification.failed`.
- Two overlapping runs never send the same reminder (conditional claim).
- Moving an appointment clears its sent reminders.
- The job runs every 15 minutes and looks ahead as far as the longest interval of any type.

### 2.9 Calendar sync

- Twenty is the source of truth; calendars get copies.
- A user can connect several Google and Microsoft accounts, choosing per account the calendars that block time and one booking calendar (initially the primary calendar for both).
- The booking calendar must be owned by the user (Google `owner`, Microsoft `canEdit`); a shared calendar may only block time.
- Events go to the first connected account with a booking calendar, one per participant advisor. A group session is one event per advisor, titled `<type> (<n> booked)`, listing every member.
- Customers are never provider attendees (no second invitation). The description lists customer name, email and phone, intake answers (one-to-one only), place, and "Managed by InventiveCRM Scheduling: change or cancel it there, not in this calendar."
- The host's Meet or Teams link is saved on the appointment.
- Every write goes through an outbox row per appointment (or session) and advisor. Retries come after 1, 5, 15, 60, then 240 minutes (or the provider's Retry-After if longer); after 8 attempts, or at once on a permanent error, the row needs attention and the advisor is emailed once.
- A retried create never makes a second event (ids in section 6).
- Appointment calendar status: Sync failing if any row gave up, else Syncing if any retries, else In calendar if any succeeded, else No calendar; Changed in calendar after an external delete.
- A calendar failure never blocks the booking or its emails (audited `calendar.sync-failed`).
- Every 10 minutes, due rows are retried oldest first (100 per run, leased 10 minutes so overlapping runs skip them); then up to 50 synced events in the next 14 days are checked, least recently checked first. A moved event is put back (audit `calendar.external-change-reverted`); a deleted one is flagged and not recreated.
- Rows that can never be written (appointment, advisor or calendar gone) back off, then give up.
- Granular consent: without permission to read busy time or write events the account is paused (Needs reconnecting), the missing permission is named in the provider's wording and no failing call is made. Without Google's list permission only the primary calendar is offered.
- A refused token or missing permission withdraws the advisor's times until a provider call succeeds. Rate limits are retried and never ask for a reconnect.
- An account missing from the connection list is Disconnected; after 7 days its stored address and calendar ids are erased (the row stays). Disconnecting revokes the Google token.

### 2.10 Emails

Customers (sender name: workspace sender name, else advisor name, else "Bookings"; reply-to the advisor's email; times in the customer's zone, e.g. "Tuesday, 24 November 2026, 09:00 to 09:30 (America/New_York)"):

| Trigger | Subject | Invitation file | Manage link |
|---|---|---|---|
| Booking confirmed (or CRM record created) | `Booked: <type> on <when>` plus the type's confirmation message | REQUEST | yes |
| Booking needs approval | `Request received: <type>` | none | yes |
| Pending set to Confirmed | `Confirmed: <type> on <when>` | REQUEST | yes |
| Start moved (only when the start differs from the last one the customer was told) | `Moved: <type> now on <when>` | REQUEST | yes |
| Cancelled | `Cancelled: <type> on <when>` | CANCEL | no |
| Reminder | `Reminder: <type> on <when>` | none | yes |

Body: greeting, intro, When, With (advisor), Join link or Where, link. Invitation file `appointment.ics`: UID `<appointment id>@inventivecrm`, SEQUENCE the current Unix seconds, organizer sender name and the sender address, the customer as attendee, LOCATION the meeting link or place.

Advisors (sender "InventiveCRM Scheduling", only when "Email advisors about bookings" is on, to every participant, times in the host advisor's zone): "New booking" (or "waiting for your approval"), "Appointment cancelled", "Appointment moved", "Appointment assigned to you", "Appointment overlaps another booking". The sync give-up email "Action needed: a booking could not be added to your calendar" is always sent.

Deleting an appointment sends no email.

### 2.11 Delete, restore and housekeeping

- Deleting an appointment frees its time (group: only its seat, as in 2.6), removes its calendar events (a group event is rewritten from a remaining member), sends no email and is audited `appointment.deleted`.
- Freed reservations are hard-deleted: a soft-deleted row would still hold its unique key.
- **Open**: restoring a deleted appointment does not reclaim its time or recreate its calendar events (estimated half a day to fix).
- Daily at 03:23: rate-limit rows older than 2 days are purged; ended appointments are completed (500 per run); reservations of cancelled appointments and unlinked reservations older than 15 minutes are destroyed.

### 2.12 Admin (staff pages)

- Overview: create my advisor profile, "Is <name> you?", today, next 14 days (mine and team), connection health, sync rows needing attention, last 30 changes, every booking page with URL and embed snippets, Schedule an appointment, New appointment type, Advisor map.
- Calendar connections: the user's own accounts, their calendars, blocking and booking choices, a test (busy periods in the next 7 days), reconnect. Opening it re-checks each account. It explains what is read and written and how to revoke access, and links the privacy policy and Google's Limited Use statement.
- Availability: weekly hours (at most 8 windows a day, `HH:MM` or `24:00`, start not equal to end), time zone (must be valid IANA), daily and weekly limits (whole numbers, empty for none), add and remove time off and special hours on the user's own schedule (dates `YYYY-MM-DD`, end not before start, special hours need a window). Only overrides ending today or later are listed.
- Advisor map: advisors, offices, radii, service areas and territories on a map, opened with a 10-minute signed ticket.
- Every change is written as an audit event.

### 2.13 Permissions, security and rate limits

| Route | Access |
|---|---|
| `GET /s/book/:slug`, `POST /s/booking/api`, `GET /s/booking/manage/:token`, `GET /s/booking/embed.js` | public |
| `GET /s/scheduling/map?ticket=` | public with a valid 10-minute ticket |
| `POST /s/scheduling/admin`, `/s/scheduling/sync-now`, `/s/scheduling/reminders-now` | signed-in users only; API keys get 403 |

- Staff actions run as the signed-in user, limited to what both their role and the app's role allow.
- Follow-up work after a record change and all scheduled jobs run as the app, so a member who cannot permanently delete still frees time when cancelling.
- The app's own role reads, updates and soft-deletes everything, and permanently deletes only reservations and rate-limit rows. It cannot be given to users or API keys.
- Users only see and change their own calendar accounts, although the app can read all.
- A map ticket is issued only to users whose role can read advisors and offices.
- Manage links are signed over a random per-appointment nonce (format in 6); a guessed or altered link gets 404; changing the nonce revokes it.
- Every link, ticket and seal is signed with a key derived per workspace, so one from another workspace is refused.
- Booking forms carry a signed ticket: a submit under 3 seconds or over 24 hours after the page loaded is refused, as is a filled hidden honeypot field (`website`).
- Per-client limits (client = keyed hash of the first X-Forwarded-For address, never stored raw): page 120/min, slots 60/min, address search 30/min, nearby advisors 30/min, manage, cancel and reschedule together 30/min, bookings per hour from settings (default 10). At most the limit pass even when requests arrive at once. The proxy also limits `POST /s/booking/api` to 120 per minute per address.
- A customer only ever sees their own appointment.
- Exact advisor bases are never sent to customers: a public office's point is shown as is, otherwise the base rounded to 0.01 degree, distances and travel times rounded.
- Map pages load Leaflet 1.9.4 with Subresource Integrity.
- Logs redact manage tokens and tickets.

### 2.14 Contacts

- A booking is matched to an existing person by email (primary or additional, case-insensitive, exact).
- With "email or phone number", an unmatched booking matches by phone when the last 9 digits match exactly one person (at least 9 digits needed).
- Otherwise, if "create contacts" is on, a person is created (first word as first name, rest as last name, email, phone).
- The person's company is used; else, if enabled and the email domain is not free mail, the company whose domain is that host or a subdomain of it, only when exactly one matches. Free-mail list: gmail.com, googlemail.com, outlook.com, hotmail.com, hotmail.co.uk, live.com, live.co.uk, yahoo.com, yahoo.co.uk, icloud.com, me.com, aol.com, btinternet.com, sky.com, virginmedia.com, protonmail.com, proton.me, gmx.com, mail.com.
- Names alone never merge two people.

## 3. Data model

Every object also has `id` (uuid), `createdAt`, `updatedAt`, `deletedAt` (soft delete), `createdBy`, `position`. No field is required in the database; code enforces what section 2 says.

**Advisor**: a person who takes appointments.

| Field | Type | Default | Meaning |
|---|---|---|---|
| name, publicBio | text | | |
| workspaceMemberId | text | | CRM user this advisor is |
| memberSeal | text | | HMAC proving that user created or confirmed the link; editing it unlinks calendars |
| email, phone | text | | advisor emails go here |
| timeZone | text | | IANA |
| isActive | bool | true | |
| bookingSlug | text, unique | | personal page |
| weight, priority | int | 1, 0 | round robin |
| dailyLimit, weeklyLimit | int | | all bookings |
| inPerson, remote, travelsToCustomers | bool | true, true, false | formats offered |
| baseAddress, baseLatitude, baseLongitude | text, decimal(6) | | private; not geocoded |
| publicLocationLabel | text | | shown instead of the base |
| serviceRadiusKm, maxTravelMinutes | decimal, int | | radius is straight line |
| travelBufferMinutes | int | 10 | between visits |
| postcodeTerritory | text | | comma list, e.g. `LS, BD1` |
| serviceArea | json | | GeoJSON Polygon, MultiPolygon or Feature |

Relations: office (Office, set null), schedule (chosen AvailabilitySchedule, set null); inverse lists of owned schedules, owned types, appointments, booking links, calendar settings, calendar syncs, team memberships, participations, reservations.

**SchedulingTeam**: name; slug (text, unique); description; isActive (bool, true); fairnessWindowDays (int, 30). Lists memberships, appointment types, appointments.

**TeamMembership**: name; teamRole (Member, Team administrator; default Member); weight (int, 1); priority (int, 0); isActive (bool, true). Relations advisor and team (both cascade).

**Office**: name; streetAddress; postcode; latitude, longitude (decimal(6)); timeZone; phone; isPublic (bool, true: show address to customers). Lists advisors, types, appointments.

**AvailabilitySchedule**: name; timeZone; weeklyHours (json `{"mon":[{"start":"09:00","end":"12:30"}]}`); isDefault (bool, true). Relation owner (Advisor, cascade). Lists overrides, advisors using it, types using it.

**AvailabilityOverride**: name (reason); startDate, endDate (date, inclusive); kind (UNAVAILABLE "Time off" default, CUSTOM_HOURS "Special hours"); windows (json list of `{start,end}`). Relation schedule (cascade).

**AppointmentType**

| Field | Type | Default | Meaning |
|---|---|---|---|
| name, description, color, icon | text | | |
| slug | text, unique | | public page |
| status | ACTIVE, DRAFT, DISABLED | DRAFT | |
| durationMinutes | int | 30 | |
| meetingFormat | VIRTUAL, PHONE, IN_PERSON_OFFICE, AT_CUSTOMER | VIRTUAL | |
| conferencing | NONE, GOOGLE_MEET, MICROSOFT_TEAMS, FIXED_LINK | NONE | |
| meetingUrl | text | | fixed link |
| assignment | ONE_TO_ONE, ROUND_ROBIN, FIRST_AVAILABLE, CUSTOMER_CHOICE, COLLECTIVE | ONE_TO_ONE | |
| roundRobinStrategy | EQUAL, WEIGHTED, LEAST_RECENT, LEAST_BOOKED, PRIORITY, FIRST_AVAILABLE | EQUAL | |
| locationMode | NONE, NEAREST, FASTEST, WITHIN_RADIUS, TERRITORY, FIRST_AVAILABLE_NEARBY, CUSTOMER_CHOICE, GEOGRAPHIC_ROUND_ROBIN | NONE | |
| distanceBasis | ROAD, STRAIGHT_LINE | ROAD | |
| capacity | int | 1 | over 1 is a group session |
| minimumNoticeMinutes, horizonDays | int | 240, 60 | |
| bufferBeforeMinutes, bufferAfterMinutes | int | 0 | |
| incrementMinutes | int | 30 | |
| dailyLimit, weeklyLimit | int | | per advisor, this type |
| timeZone | text | | display zone |
| cancellationCutoffHours, rescheduleCutoffHours | int | 24 | |
| intakeQuestions (json), confirmationMessage (text) | | | |
| requiresApproval | bool | false | |
| reminderMinutes | text | `1440,60` | |
| allowedEmbedDomains | text | | comma list |
| requireVerifiedTravel | bool | false | |

Relations: owner (Advisor), team, office, schedule (override); all set null. Lists appointments and booking links.

**BookingLink**: name; slug (text, unique); isActive (bool, true); title; description; presets (json `{"name","email","answers":{},"hide":[]}`). Relations appointmentType (cascade), advisor (set null). Lists appointments.

**Appointment**

| Field | Type | Default | Meaning |
|---|---|---|---|
| title | text | | `<type>: <customer>` |
| status | PENDING, CONFIRMED, RESCHEDULED, CANCELLED, COMPLETED, NO_SHOW | CONFIRMED | |
| startsAt, endsAt | timestamptz | | end filled from duration if missing |
| customerTimeZone, customerName, customerEmail (lower case), customerPhone | text | | |
| meetingFormat | as type | | |
| location | text | | "Where" text |
| customerLatitude, customerLongitude, customerPostcode | decimal(6), text | | exact point |
| meetingUrl | text | | fixed or provider link |
| intakeAnswers (json), notes (text) | | | |
| source | PUBLIC_PAGE, EMBED, MANUAL, API | MANUAL | |
| sessionKey, seat | text, int | | group session |
| assignmentReason, travelMinutes, travelCheck | text, int, text | | why, travel, routed or estimated |
| manageNonce | text | | revoke by changing |
| idempotencyKey | text, unique | | one booking per submit |
| cancelledAt, cancelReason, cancelledBy | timestamptz, text | | |
| notifiedStartsAt | timestamptz | | start the customer was last told |
| remindersSent | text | | intervals sent, e.g. `1440,60` |
| calendarStatus | NOT_CONNECTED, PENDING, SYNCED, FAILED, CHANGED_EXTERNALLY | NOT_CONNECTED | |

Relations (all set null on delete of the target): person, company, advisor (host), appointmentType, team, office, bookingLink. Lists participants, reservations, calendar syncs, audit events. Person and Company each get an `appointments` list.

**AppointmentParticipant**: name; participantRole (HOST default, REQUIRED). Relations appointment and advisor (both cascade).

**SlotReservation**: key (text, unique: `<advisor id>|<tick ISO>` or `<session key>|seat-<n>`); startsAt (tick). Relations advisor and appointment (both cascade; appointment empty until the booking links it).

**CalendarSetting**: name; connectionId (text, unique); provider (GOOGLE, MICROSOFT); accountEmail; availabilityCalendarIds (json list); bookingCalendarId; conferencing (default NONE; stored but not used when writing events); status (CONNECTED default, NEEDS_RECONNECT, ERROR, DISCONNECTED); lastError; lastCheckedAt. Relation advisor (cascade).

**CalendarSync** (outbox): name (`appointment:<id>:<advisor id>` or `session:<session key>:<advisor id>`); provider; connectionId; calendarId; externalEventId; operation (UPSERT default, DELETE); status (PENDING default, SYNCED, FAILED "Retrying", GAVE_UP "Needs attention"); attempts (int, 0); nextAttemptAt; lastError; syncedAt (also "last checked"); externalUpdatedAt. Relations appointment (cascade), advisor (set null).

**SchedulingAuditEvent**: name (action), actor, details (json), occurredAt. Relation appointment (cascade). Names: `appointment.created|cancelled|rescheduled|deleted|conflict|move-rejected|reminder-sent|<status>`, `advisor.assigned|reassignment-rejected`, `notification.failed`, `calendar.sync-failed|external-change-reverted`, `system.error`.

**PublicRequestCounter**: key (text, unique, random per request); bucket (`<bucket>|<client hash>`); count (int, 0); windowStart.

**SchedulingSettings**: see section 7.

Indexes: Appointment (sessionKey); Appointment (status, startsAt); CalendarSync (name); CalendarSync (status, nextAttemptAt); PublicRequestCounter (bucket, windowStart).

What each uniqueness rule prevents:

| Unique | Prevents |
|---|---|
| SlotReservation.key | two bookings holding one advisor's tick; a group session over capacity |
| Appointment.idempotencyKey | a double submit or retry creating two bookings |
| CalendarSetting.connectionId | two settings for one connected account |
| slugs (type, link, team, advisor) | two pages on one address within one object type (not across types) |
| PublicRequestCounter.key | none functionally; the count after insert gives race safety |

## 4. Edge cases and bugs found

Each line: problem → what goes wrong → rule that prevents it. Versions are when it was fixed.

- Deleted appointments still blocking time (0.4.0) → soft delete left reservations and events, so the slot stayed taken → delete frees time and removes events; a daily sweep frees time of cancelled appointments.
- Soft-deleted reservations → still hold their unique key → freed reservations are permanently deleted.
- Restored appointment does not reclaim its time (**open**) → no reservations or event, and the time may be booked by someone else → restore must claim the time atomically (refuse or set Pending on a clash) and re-sync calendars.
- Reminders past the first 500 never sent, failures recorded as sent (0.4.0) → only 500 unordered appointments were read, and failed emails were marked sent → read all pages in start order up to the longest interval; claim conditionally; undo the claim and audit on failure.
- Several reminders due at once (0.4.0) → only the nearest was sent, the other went later → one email covers all due intervals and records them all.
- Reconcile checking the same 50 rows forever (0.4.0) → an unordered query returned the same rows each run → least recently checked first, each row stamped, 14-day window.
- Unwritable calendar rows (0.4.0) → came due on every run forever → untouched claimed rows back off and give up; rows without an appointment give up at once.
- API keys acting with the app's full role on signed-in routes (0.4.0) → the platform runs an API-key call with the app's token, so a read-only key could use admin or run jobs → person routes require a signed-in user (403 otherwise); scheduled runs have no request and pass.
- Follow-up work running as the triggering user (0.1.x) → a member without permanent delete left cancelled time blocked → follow-up work and jobs act as the app.
- Race-prone rate limit (0.4.0) → read-then-increment let parallel requests all pass → one row per request, counted before (reject without writing) and after insert.
- Group seats (0.4.0) → cancelling the first member freed the host's whole time, and a freed seat was never offered again → per-seat release, host time handed to the next member, every seat tried.
- Calendar sync errors blocking emails (0.4.0) → a calendar exception stopped the handler before confirmations → calendar writes and emails isolated and audited.
- Idempotency key replay (0.3.1) → a repeated key returned the booking and its manage link to anyone → only to the same email and type.
- Create unanswered by the API (0.4.0) → the record may exist although the call failed → found by key and this attempt's nonce before deleting, so a twin's booking is never removed.
- One secret for all workspaces (0.3.1) → a manage link or map ticket worked in another client → keys derived per workspace.
- Naming an advisor the type does not offer (0.3.1) → customers could book anyone by id → eligible advisors only.
- `javascript:` meeting links (0.3.1) → script on the manage page → https links only.
- Acting on a cancelled appointment (0.3.1) → cut-offs and status checked only in the page → enforced on the server.
- LIKE wildcards in emails (0.3.1) → `%@domain` matched another contact → escaped; company domains matched exactly.
- Advisor base bisected from public answers (0.3.1, 0.4.0) → probing points revealed a home → grid-snapped point, rounded distances and times.
- Another user's advisor pointed at your login (0.3.4) → it used your calendars → seal set only by you.
- Account dropping out during a failing token refresh (0.3.4) → settings lost → kept 7 days as Disconnected.
- Google rate limits sent as 403 (0.2.2) → treated as "reconnect" → classified by reason, retried with Retry-After.
- Partial consent (0.2.2) → confusing failures → account paused, missing permission named.
- Microsoft account without a mailbox → endless retries → permanent error with an explanation.
- Rescheduling into overlapping time → own reservations and own provider event counted as busy → both ignored when searching.
- Warm process reused for another workspace (0.1.x) → cached settings could leak → caches keyed to the caller's token.
- No timeouts (0.4.0) → hanging API or mail server held functions; a proxy error page looked permanent → 30 s API timeout, "unavailable" kept apart from "refused", SMTP 10/10/20 s.
- Platform API limit shared by all workspaces (500 a minute by default) → slot searches throttled → 6 advisors at a time, settings loaded once, limit raised.
- A booking made after a reminder point → the reminder follows the confirmation on the next run. Accepted.
- Found while writing, untested (**open**): reassignment leaves the previous advisor's calendar event and does not email them (the README says both sides are emailed).
- Found while writing (**open**): moving a group-session member in the CRM moves neither its seat nor the host's held time.
- Found while writing (**open**): an account the platform stops listing (as during a failing refresh) is no longer read for busy time, so the advisor is offered without it (fail open).
- Found while writing (**open**): the calendar setting's "default conferencing" is never used; a Meet type on a Microsoft calendar gets no link.
- Found while writing (**open**): slugs are unique per object only; a type slug wins over an equal link or advisor slug.
- Found while writing (**open**): the server checks the embed allowlist only when the widget sends its parent origin; the platform drops custom headers, so there is no frame-ancestors policy.
- Found while writing (**open**): the type cap applies to quick create only.
- Documentation drift: the README says reconcile every 5 minutes and reminders every 10; since 0.4.2 they run every 10 and 15.

## 5. Test checklist

Unit tests (vitest, no double unless stated).

engine.test.ts
- [ ] converts London wall time in winter and summer: offsets for London, New York and Kolkata come from the time zone database.
- [ ] moves a time skipped in spring forward and takes the first of a repeated autumn time: 01:30 on 29 March is 02:30 local; 01:30 on 25 October is 00:30 UTC.
- [ ] round-trips and walks dates: local to UTC and back, year rollover, ISO weeks (2027-01-01 is 2026-W53).
- [ ] builds working time with breaks and windows that cross midnight.
- [ ] applies holidays, custom hours and part-day time off.
- [ ] keeps local hours across the clock change.
- [ ] merges, subtracts and intersects intervals.
- [ ] fills working time at the increment, minus busy time and buffers.
- [ ] respects notice, horizon and daily limits.
- [ ] gives overlapping bookings shared reservation keys whatever their start times: back-to-back holds share none; one hour is 12 keys.
- [ ] distributes equally and stays fair over many bookings: 30 bookings over 3 advisors gives 10 each.
- [ ] follows weights over time: weights 3 and 1 give 30 and 10 of 40.
- [ ] ranks by recency, workload, priority and earliest availability.
- [ ] measures distance and service areas: polygon, `LS6` not `LS60`, `LS` matches `ls1`, not `L1`.
- [ ] decides eligibility by radius, travel time and territory.
- [ ] ranks nearest, fastest and first available nearby.
- [ ] rejects slots the advisor cannot reach in time and accepts ones they can.
- [ ] starts the day at base and marks estimates as unverified.

rate-limit.test.ts (double: in-memory counter store with random delays)
- [ ] never lets more than the limit through when requests arrive at the same moment (25 at once, limit 10, 20 rounds).
- [ ] lets simultaneous requests within the limit through.
- [ ] allows the limit in sequence and refuses the next ones.
- [ ] counts each client and each bucket separately.
- [ ] turns a client already over the limit away without writing another row.
- [ ] works out the window and the wait until it ends.

scheduling-rules.test.ts
- [ ] tries every seat, the free-looking ones first.
- [ ] still offers a seat freed by a cancellation when the count says the session is full.
- [ ] tells seat rows apart from the host time.
- [ ] rounds a customer point to 0.01 degree.
- [ ] answers the same for every point in a grid cell, and stays within about a kilometre.
- [ ] reads the interval list leniently.
- [ ] scans only as far ahead as the longest interval of any type.
- [ ] sends each interval once, and only once it is due.
- [ ] records several due intervals together, largest first.
- [ ] backs off and then gives up (1, then 60 after 4, 240 after 7, none after 8).
- [ ] keeps at most the given number of advisors in flight and keeps their order.
- [ ] reads every page instead of stopping at the first.
- [ ] refuses a route call that is not made by a signed-in person.
- [ ] lets signed-in people and cron runs through.

calendar-compliance.test.ts
- [ ] accepts a full Google grant.
- [ ] switches off writing when the user unticks the events permission (named in Google's wording).
- [ ] keeps working with only the primary calendar when the list permission is withheld.
- [ ] reads Microsoft short scope names.
- [ ] assumes the requested scopes when the provider reports none.
- [ ] retries Google rate limits sent as 403, with Retry-After.
- [ ] asks for a reconnect when a Google scope is missing.
- [ ] does not ask for a reconnect when a calendar is simply not writable.
- [ ] explains a Microsoft account without a mailbox.
- [ ] treats Graph access denied as a missing permission and 429 as retryable.
- [ ] leaves 404 and 5xx to the caller.
- [ ] parses Retry-After as seconds or a date.

advisor-seal.test.ts
- [ ] uses a member's calendars only for an advisor that member sealed: wrong member, other advisor, no seal or another workspace all fail.

End-to-end (`tests/scheduling/e2e.mjs` on a real server; doubles: `mock-calendar-providers.mjs` for Google, Graph and their OAuth, Mailpit, local OSRM and Nominatim)
- [ ] Alice has Google connected, with her calendars listed.
- [ ] a busy event in Google removes the clashing times.
- [ ] a customer books Alice without an account.
- [ ] the booking is a record linked to a new contact, and is in Google with a Meet link.
- [ ] the contact was created from the booking details.
- [ ] a repeated submit returns the same booking instead of a second one.
- [ ] the customer gets a confirmation with a calendar invitation and a manage link.
- [ ] Alice is told about the new booking.
- [ ] Bob, on Microsoft, receives a booking in Outlook with a Teams link.
- [ ] no customer is added as an Outlook attendee, so Microsoft sends no second invitation.
- [ ] round robin rotates evenly between the advisors who offer phone calls.
- [ ] the reason for each assignment is recorded.
- [ ] two simultaneous bookings for one advisor and slot: one wins, the other is told it is taken.
- [ ] two simultaneous round-robin bookings for one slot go to two different advisors.
- [ ] collective times exclude anyone busy.
- [ ] a collective meeting holds both advisors and is in both calendars.
- [ ] a group session takes three people and refuses the fourth.
- [ ] the group session is one calendar event for all of them.
- [ ] an office appointment is booked with the office address.
- [ ] the map selector finds advisors covering Headingley, nearest first, by road (skipped by design without a routing server, `ROAD_ROUTING=off`).
- [ ] advisor bases are not exposed exactly.
- [ ] the nearest available advisor gets the home visit, with travel checked by road routing (skipped by design without a routing server).
- [ ] territory matching sends a York customer only to the advisor covering YO.
- [ ] travel-aware: Carol is not offered 11:00 in Cookridge straight after her 10:00 Headingley visit, but is offered 12:00.
- [ ] the customer can move 30 minutes later, overlapping the old time.
- [ ] the Google event moved with it, and the customer was told.
- [ ] a guessed manage link is refused.
- [ ] an advisor cancelling in the CRM removes the Outlook event, frees the slot and emails the customer.
- [ ] when Bob revokes access, his times are withdrawn rather than offered blind, and the connection is flagged.
- [ ] the connection stays flagged until Bob reconnects, then his times come back.
- [ ] a Google outage during a move is retried and recovers without a duplicate event.
- [ ] an event moved directly in Google is moved back to the booked time and logged.
- [ ] a Google rate limit (403 rateLimitExceeded) is retried without asking Alice to reconnect.
- [ ] a shared (writer) Google calendar can block availability but is refused as the booking calendar.
- [ ] a partial Google grant pauses the account with the missing permission named, and a full grant restores it.
- [ ] a customer in New York gets times in their own zone.
- [ ] reminders go out at the first due interval, once.
- [ ] booking is limited per client, and instant or honeypot submissions are refused.
- [ ] another workspace cannot see these appointments or book these pages (only with a second workspace key).
- [ ] no unexpected server errors were recorded.

Security (`security.mjs`; provider double)
- [ ] a map ticket works in its own workspace and is refused in another.
- [ ] naming another advisor in a slots request is ignored for a type that does not offer them.
- [ ] a normal booking returns its manage link.
- [ ] replaying someone's idempotency key does not return their manage link.
- [ ] a manage link is refused in another workspace.
- [ ] a `javascript:` meeting link is not passed to the manage page.
- [ ] a cancelled appointment cannot be cancelled again or moved.
- [ ] a wildcard email is not matched to an existing contact.

Restricted role (`restricted-role.mjs`)
- [ ] a member with a role that cannot permanently delete can book in the CRM.
- [ ] when that member cancels, the held time is freed and no app error is recorded.

Browser (`browser.cjs`, Playwright on Chromium; a local "customer website" for embeds; Nominatim and map tiles)
- [ ] a customer books through the page in a browser and is given a manage link.
- [ ] the manage page offers reschedule and cancel.
- [ ] the booking page fits a phone screen without sideways scrolling (390 px).
- [ ] the map selector geocodes the address, draws the map and lists nearby advisors.
- [ ] choosing an advisor on the map shows their bookable times.
- [ ] the inline widget loads on another website and sizes itself to its content.
- [ ] a booking made inside the widget is recorded as coming from the website embed.
- [ ] the floating button opens the booking popup.
- [ ] the widget refuses to work on a website outside the allowlist.
- [ ] the Scheduling overview renders inside the CRM with live data.
- [ ] the Calendar connections page lists the Google account and its calendars.
- [ ] the appointment calendar view opens from the Scheduling menu.
- [ ] time off added on the availability page is saved to the schedule.
- [ ] time off can be removed again.
- [ ] weekly hours edited on the page are saved, and can be put back.
- [ ] the advisor map shows advisors, offices and service areas inside the CRM.
- [ ] a new appointment type is created as a draft from the overview and opens on its record page.
- [ ] no page or email a client or customer sees names the upstream product.

Last full run (18 to 19 November): e2e 38 passed, 2 skipped (no routing server); security 8; restricted role 2. Untested: real Google and Microsoft consent, token refresh and Meet or Teams links; restore.

## 6. Integrations and exact contracts

**Google** (all calls `Authorization: Bearer`, JSON, 20 s timeout; base `https://www.googleapis.com/calendar/v3`)

- OAuth: authorize `https://accounts.google.com/o/oauth2/v2/auth`, token `https://oauth2.googleapis.com/token` (form-encoded), revoke `https://oauth2.googleapis.com/revoke`. PKCE. Extra parameters `access_type=offline`, `prompt=consent`, `include_granted_scopes=true`. Redirect `<server URL>/auth/apps/callback`.
- Scopes: `openid`, `email`, `.../auth/calendar.calendarlist.readonly`, `.../auth/calendar.freebusy`, `.../auth/calendar.events.owned`. Granted scopes are read from the token response.
- Calendar list: `GET /users/me/calendarList?minAccessRole=freeBusyReader` (id, summary, primary, accessRole; writable only if `owner`).
- Busy: `POST /freeBusy` `{timeMin, timeMax, items:[{id}]}` over the search window plus a day each side; a per-calendar `errors` entry fails the read (retryable).
- Create: `POST /calendars/{cal}/events?conferenceDataVersion=1&sendUpdates=none` with `id`, `summary`, `description`, `location`, `start/end {dateTime, timeZone}` (advisor's zone), `attendees: []`, `reminders {useDefault:true}`, and for Meet `conferenceData.createRequest {requestId: first 64 chars of the sync key, conferenceSolutionKey {type: hangoutsMeet}}`. A 409 means an earlier attempt created it: PATCH that id instead.
- Event id: SHA-256 of the sync key, first 40 hex digits as an integer written in base 32 (`0-9a-v`), padded to at least 5. Sync key `appointment:<appointment id>:<advisor id>` or `session:<session key>:<advisor id>`.
- Update: `PATCH /calendars/{cal}/events/{id}?conferenceDataVersion=1&sendUpdates=none`, same body plus `status: confirmed` (undeletes). Delete: `DELETE ...?sendUpdates=none`; 404 and 410 count as done. Read: `GET .../events/{id}`; 404 or 410 or `status: cancelled` means deleted.
- Meeting link: `hangoutLink`, else the `video` entry point. Version: `updated`, else `etag`.

**Microsoft Graph** (base `https://graph.microsoft.com/v1.0`, header `Prefer: outlook.timezone="UTC"`)

- OAuth: `https://login.microsoftonline.com/common/oauth2/v2.0/authorize` and `/token`, PKCE, `prompt=select_account`. Scopes `openid`, `email`, `offline_access`, `https://graph.microsoft.com/User.Read`, `https://graph.microsoft.com/Calendars.ReadWrite`.
- Calendar list: `GET /me/calendars?$select=id,name,isDefaultCalendar,canEdit`.
- Busy: per calendar `GET /me/calendars/{id}/calendarView?startDateTime&endDateTime&$select=start,end,showAs,isCancelled&$top=200`, following `@odata.nextLink`; cancelled and `showAs: free` are ignored.
- Create: `POST /me/calendars/{id}/events` with `subject`, `body {contentType: text}`, `start/end {dateTime (UTC, no Z), timeZone: UTC}`, `location {displayName}`, `attendees: []`, `transactionId` = sync key, and for Teams `isOnlineMeeting: true, onlineMeetingProvider: teamsForBusiness`.
- Update `PATCH /me/events/{id}` (no transactionId); delete `DELETE /me/events/{id}` (404 is done); read `GET /me/events/{id}?$select=start,end,isCancelled,lastModifiedDateTime`.
- Meeting link `onlineMeeting.joinUrl`; version `lastModifiedDateTime`. Personal Outlook.com accounts get events without Teams links (unverified against a real account).

**Failure handling for both**

| Answer | Treated as |
|---|---|
| Graph `MailboxNotEnabledForRESTAPI` and similar | permanent, "no Exchange Online mailbox" |
| 429, or Google reason `rateLimitExceeded`, `userRateLimitExceeded`, `quotaExceeded`, `dailyLimitExceeded` | retryable, honour Retry-After (seconds or HTTP date) |
| Google `insufficientPermissions`, `ACCESS_TOKEN_SCOPE_INSUFFICIENT`; Graph `ErrorAccessDenied`, `Authorization_RequestDenied`, `AccessDenied` | missing permission: reconnect |
| 401 | reconnect; reported to the connection store |
| other 403 | permanent |
| other 4xx | permanent; 5xx retryable |

Token refresh, encrypted token storage, PKCE and the revoke call were done by the platform. Iwcrm must store refresh tokens encrypted, refresh before expiry, mark a connection failed when refresh is refused, and re-read granted scopes on every reconnect. Google apps in Testing status lose refresh tokens after 7 days. `PUBLISHING.md` (in the app folder) lists Google verification and Microsoft publisher verification steps.

**OSRM** (`ROUTER_URL`, 10 s timeout)

- `GET /table/v1/driving/{lng,lat;...}?sources=0;1;..&destinations=n;..&annotations=duration,distance` (coordinates to 6 decimals). Requires `code: Ok`. Durations in seconds become whole minutes rounded up; distances in metres become km with one decimal.
- Per search: one call from all advisor bases to the customer; per travelling advisor two more (stops to customer, customer to stops).

**Nominatim** (`GEOCODER_URL`, `User-Agent: InventiveCRM-Scheduling/1.0`, 10 s timeout)

- Search `GET /search?q=<at most 200 chars>&format=jsonv2&addressdetails=1&limit=5[&countrycodes=<GEOCODER_COUNTRY_CODES>]`; reverse `GET /reverse?lat&lon&format=jsonv2&addressdetails=1`. Uses `display_name`, `lat`, `lon`, `address.postcode`.
- Map tiles: `MAP_TILE_URL` raster template; Leaflet 1.9.4. The public OpenStreetMap tile server is for testing only.

**SMTP**: port default 587; `SMTP_SECURITY` TLS (implicit TLS), STARTTLS (required), NONE (no TLS, private network only); login only when a username is set; timeouts 10 s connect, 10 s greeting, 20 s socket. Invitations go as a `text/calendar` part with its METHOD, file name `appointment.ics`.

**Signed tokens** (HMAC-SHA256; workspace key = HMAC(`BOOKING_LINK_SECRET`, `workspace:<workspace id>`); MAC = base64url, first 32 characters)

| Token | Format | Valid |
|---|---|---|
| Manage link | `<appointment id>.<MAC("manage:<id>:<nonce>")>`, nonce 12 random bytes | while the nonce is unchanged |
| Form ticket | `<issued ms>.<MAC("form:<slug>:<issued>")>` | 3 s to 24 h |
| Map ticket | `<member id>.<issued ms>.<MAC("map:<member>:<issued>")>` | 10 min |
| Advisor seal | `MAC("advisor-member:<advisor id>:<member id>")` | until edited |
| Client fingerprint | HMAC(secret, `client:<ip>`), first 24 hex | rate limits only |

All comparisons are constant-time.

**Where credentials and settings go**

- Server-wide app variables: `BOOKING_LINK_SECRET` (secret, at least 32 characters; changing it invalidates every emailed manage link), `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` (secret), `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET` (secret; diarise its expiry), `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURITY`, `SMTP_USERNAME`, `SMTP_PASSWORD` (secret), `SMTP_FROM_ADDRESS`, `GEOCODER_URL`, `GEOCODER_COUNTRY_CODES`, `ROUTER_URL`, `MAP_TILE_URL`, `MAP_ATTRIBUTION`, and for tests only `GOOGLE_CALENDAR_API_URL`, `MICROSOFT_GRAPH_API_URL`.
- Build-time variables for the OAuth endpoints: `SCHEDULING_GOOGLE_AUTHORIZE_URL`, `SCHEDULING_GOOGLE_TOKEN_URL`, `SCHEDULING_MICROSOFT_LOGIN_URL`. Test doubles only, never production (the Microsoft one could also serve a sovereign cloud).
- Platform environment: `ENCRYPTION_KEY` (encrypts OAuth tokens), `SERVER_URL` (redirect URI), `APPLICATION_API_RATE_LIMITING_LIMIT`, `LOGIC_FUNCTION_TYPE=LOCAL`; on the test server only, `OUTBOUND_HTTP_SAFE_MODE_ENABLED=false` so OAuth can reach the local double.
- Per tenant: the Scheduling settings record (section 7) and each user's OAuth connections with their Calendar setting rows.
- Test runner variables: `SERVER_URL` (required, never production), `MOCK_URL`, `MAILPIT_URL`, `ROAD_ROUTING=off`.

## 7. Settings and configuration

Per tenant, **Scheduling settings** (oldest record; missing or empty values use the default):

| Setting | Default | Effect |
|---|---|---|
| contactMatching | EMAIL | or EMAIL_THEN_PHONE |
| createContacts | true | create a person for unknown customers |
| linkCompanyByEmailDomain | true | |
| maxAppointmentTypes | none | cap on quick create |
| defaultTimeZone | Europe/London | fallback everywhere |
| senderName | empty | customer email sender name |
| notifyAdvisors | true | advisor emails |
| bookingsPerHourPerClient | 10 | public booking limit |

Also per tenant: types, teams (fairness window), advisors (limits, locations), offices, schedules, booking links, and per user the calendar choices.

Server-wide: the variables in section 6; the proxy limit of 120 booking API calls a minute per address; edge caching as in 2.1. Schedules (server clock): calendar sync and reconcile at minute 2 of every 10, reminders at minute 4 of every 15, housekeeping daily at 03:23. Job timeouts: 300 s for jobs, 120 s for record handlers and admin, 60 s for the booking API.

## 8. Notes for the rebuild

Keep:
- The reservation idea: the database, not the code, refuses overlaps. In Postgres use an exclusion constraint on (advisor, held time range) for active appointments, inside the booking transaction; restore and reassignment then re-check for free.
- Seats as unique (session, seat number) rows, or a row lock on the session.
- Fail closed on unreadable calendars; outbox with deterministic provider ids; reconcile least recently checked first.
- Per-workspace signed links over a stored nonce; form ticket and honeypot; grid-snapped public geography.
- Conditional-update claims for every job and send; isolation of emails from calendar writes; audit events for everything.
- Background work under a service identity, never the triggering user's.

Do differently:
- Use transactions. Much of the code compensates for having none (discarding failed bookings, claim-new-then-release-old, sweeps of orphan rows).
- Write side effects to a transactional outbox in the same transaction as the record change; the platform could lose a record event between commit and queue.
- Handle restore, reassignment (old advisor's event and email) and group moves explicitly.
- One slug namespace across types, links, teams and advisors.
- A simpler rate limiter: atomic `INSERT ... ON CONFLICT DO UPDATE ... RETURNING count`, or Redis.
- Send `Content-Security-Policy` with `frame-ancestors` from the type's allowed domains, and a strict CSP on public pages.
- Each platform call cost about a second of process start; a resident service removes the need for the concurrency cap and long job intervals.
- Consider provider push (Google watch channels, Graph subscriptions) instead of polling for external edits.
