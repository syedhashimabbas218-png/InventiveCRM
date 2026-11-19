# Handover for Iwcrm, part 3a: Team chat and the realtime service

Part of the handover that starts in `docs/HANDOVER-FOR-IWCRM.md` (part 0, platform-wide rules). WhatsApp, which also
uses the realtime service, is part 3b (`docs/HANDOVER-FOR-IWCRM-3b-whatsapp.md`). This describes behaviour, not Twenty
code. The reference implementation is `apps/team-chat/` (version 0.3.4) and `realtime/`, with suites in
`tests/team-chat/` and `realtime/server.test.mjs`; where this text and the code disagree, the code and its tests are what
ran.

Terms: a **tenant** is one client business (a Twenty workspace); a **member** is a person in a tenant; the **chat route**
is the one signed-in endpoint behind the chat screen.

---

## Team chat

### 1. Purpose

Chat for the people of one tenant, inside the CRM: public and private channels, direct conversations (including notes to
self), @mentions, links to people, companies and deals, unread counts and live updates. Message content is encrypted at
rest, so chat records hold nothing readable even to someone with full API access. There are no push or email
notifications yet.

### 2. Features and business rules

**Callers**
- Only a signed-in person can call the chat route. An API key gets 403; an anonymous call gets 401 or 403.
- The caller's identity comes from their own session, before any work runs with the app's privileges.
- Someone whose role reads no CRM records can still use chat; only record search and link checks follow their permissions.

**#general**
- The first time anyone opens chat in a tenant, a public channel `#general` with topic "Everyone in the team" is created.
- Everyone who opens chat is added to `#general`.
- A tenant has exactly one `#general`. If two first visits create two at once, the oldest is kept and the others deleted.
- Nobody can leave `#general`, and nobody can archive it.
- The screen opens `#general` first (or the first channel if there is none).

**Channels**
- Anyone can create a channel.
- The name becomes a slug: lower case; every run of characters other than a-z, 0-9 and "-" becomes one "-"; leading
  and trailing "-" removed; at most 40 characters. "  Sales & Leads! " becomes `sales-leads`, "#general" becomes `general`.
- A slug shorter than 2 characters is refused.
- Names are unique among channels that are not archived: a taken name is refused ("There is already a #name channel.").
- The name of an archived channel can be used again.
- A topic is optional, trimmed and cut to 250 characters.
- Visibility is PUBLIC (default) or PRIVATE.
- The creator is always a member and can add up to 200 people at creation; ids that are not members of the tenant are dropped.
- Public channels can be browsed (sorted by name, archived ones left out).
- A public channel can be read without joining; the composer is replaced by "Join channel" until the person joins.
- A private channel cannot be browsed, read (403), posted to (403) or joined (403) by a non-member.
- Any member of a channel can add people (up to 200 per call, tenant members not already in it), private channels included.
- Any member can change the topic.
- Only the creator can archive a channel.
- An archived channel disappears from every list and from browse. Posting, editing, deleting, joining and other writes
  in it are refused ("This channel is archived.").
- A member can leave any channel except `#general` and direct conversations.
- The app never deletes channels or direct conversations.
- Starting channels and new direct conversations is capped at 60 an hour per person (429); other people are not affected.

**Direct conversations**
- There is one direct conversation per pair of people, whichever side opens it.
- Opening one with yourself gives "Notes to self", titled "<your name> (you)".
- A direct conversation is private and has no name, topic or settings ("Direct conversations have no settings.").
- It cannot be left, and nobody can be added ("Start a channel to talk with more people.").
- Opening an existing one does not count towards the hourly cap.
- The sidebar lists channels by name and direct conversations newest activity first.

**Messages**
- Text is normalised: CRLF becomes LF, four or more newlines become three, then trimmed and cut to 4,000 characters.
  Longer text is cut, not refused.
- A message needs text or at least one record link; otherwise "Write a message first." (400).
- Each person can post 30 messages a minute. Deleted messages count, so posting and deleting in a loop is limited too (429).
- A post moves the channel's last-message time forward only, never backwards.
- A post marks the channel read for its author.
- Messages load 50 at a time, newest last; "Load earlier messages" pages backwards.
- Each message shows its author, time, "(edited)" when edited, record chips and highlighted mentions; a message that
  mentions the viewer is highlighted.
- Messages of people who left the tenant stay, shown as "Former member".
- Day separators sit between days.
- Enter sends; Shift+Enter adds a line. The draft is cleared when the server confirms the post.

**Editing and deleting**
- Only the author can edit or delete a message (403 for anyone else).
- The author also needs write access to the channel (a member, not archived).
- An edit replaces the text, keeps the original mentions and links, and sets the edited time.
- Editing to empty text is refused ("A message cannot be empty. Delete it instead.").
- Deleting is a soft delete; the message disappears from every open screen.

**Mentions**
- Typing "@" followed by up to 30 characters offers up to 6 matching people (never yourself); Enter does not send while
  the suggestions are open.
- A message carries up to 20 mentions, each person once; mentioning yourself is dropped.
- The screen sends only mentions whose "@Name" is still in the text.
- In a public channel anyone in the tenant can be mentioned. A mentioned person who is not a member is added to the
  channel with one unread mention, read up to 1 ms before the message.
- In a private channel or direct conversation only members can be mentioned; mentioning an outsider drops the mention
  and does not let them in.
- Each mention adds one to that member's unread mentions for the channel.

**Record links**
- A message carries up to 5 links, each record once. Only people, companies and deals can be linked.
- Search needs 2 to 100 characters, up to 4 words. People match when every word is in their first name, last name or
  email; companies and deals match on name. Up to 5 of each.
- Search runs with the caller's own permissions: no read access, no results.
- On sending, each link is read again with the sender's own permissions and labelled from the record: "First Last" (or
  "Unnamed contact"), the company name (or "Unnamed company"), the deal name (or "Unnamed deal").
- Links to records that do not exist, that the sender cannot see, or of other types are dropped silently.
- Clicking a chip opens the record.

**Unread**
- Per channel and person, unread is the number of messages by others after the person's read position.
- Opening a channel marks it read up to the newest message shown (never later than now) and clears unread mentions.
- New messages arriving in the open channel mark it read again.
- The sidebar shows "@N" for unread mentions in preference to the unread count; the open channel shows no badge.

**Encryption at rest**
- Message text, mentions and links are stored as one encrypted value per message.
- Channel names and topics are encrypted.
- Member ids are never stored in chat records; a keyed hash per tenant is stored instead.
- Every channel and membership carries a seal (a keyed MAC) only the app can make. Rows without a valid seal are ignored.
- A membership written through the generic API opens nothing; a channel written through it never shows.
- Changing a private channel to public through the generic API makes it unreachable (404 or 403), because the seal covers
  the visibility.
- Ciphertext copied into another message, channel or tenant does not decrypt, and the message is not shown.
- Messages that do not decrypt are left out without an error.

**Live updates and catch-up**
- An idle chat screen sends no requests.
- When anyone posts, edits, deletes, joins, leaves, adds people, changes a topic, archives or creates a channel, every open
  chat screen of the tenant hears of it within a moment; only screens showing that channel fetch it.
- Notices carry channel ids only, never content.
- A post is announced as soon as the message exists, in parallel with the read markers and mention counts.
- A notice about another channel refreshes the unread counts, at most once every 0.8 s.
- A fetch for the open channel asks for messages since the newest shown minus 5 s, and for edits and deletions since the
  server's previous answer minus 10 s. Rows already shown are not re-rendered.
- Each screen runs one fetch at a time; a notice that arrives during a fetch causes exactly one more.
- After a reconnect or a `resync` notice the screen catches up once, at a random moment within 8 s.
- The browser reopens a dropped stream itself (every 3 s). A stream it cannot reopen (for example a refused pass)
  reconnects with a fresh pass, backing off from 2 s doubling to 30 s, times a random 0.5 to 1.
- An `expired` notice reconnects at once with a new pass.
- While down the screen shows "Reconnecting to live updates…". Without the realtime service it says "Live updates are not
  set up here, so new messages appear when you reopen the channel."
- A failed live notice never fails the write that caused it (3 s timeout, logged).

**Screen**
- Switching channel clears the draft, its mentions and links, any edit in progress and notices, so a draft can never go
  to the wrong conversation. Answers that arrive for the previous channel are ignored.
- Under 720 px wide the list and the conversation show one at a time, with "All channels" to go back.

### 3. Data model

Per tenant. Our build had no unique constraints or indexes on these objects (Twenty app objects); the constraints below
are what the rebuild should add.

**chat_channel**

| Field | Type | Rules | Meaning |
|---|---|---|---|
| id | uuid | PK, chosen by the app before insert | Part of the seal and of the encryption context |
| name | text | | Encrypted slug, context `channel-name:<id>`; empty for direct conversations |
| topic | text | | Encrypted, context `channel-topic:<id>`, up to 250 characters |
| kind | enum `CHANNEL`, `DIRECT` | default `CHANNEL` | |
| visibility | enum `PUBLIC`, `PRIVATE` | default `PUBLIC`; `DIRECT` is always `PRIVATE` | |
| direct_key | text | unique, see below | Keyed hash of `channel-name:<slug>` for a channel, of `direct:<two member ids sorted>` for a direct conversation |
| last_message_at | timestamptz | moves forward only | |
| archived | bool | default false | |
| created_by_key | text | | Keyed hash of the creator; the hourly cap counts on it |
| seal | text | required for the row to count | MAC over id, kind, visibility, direct_key and created_by_key |
| created_at | timestamptz | | |

**chat_membership**

| Field | Type | Rules | Meaning |
|---|---|---|---|
| id | uuid | PK | |
| channel_id | uuid, FK chat_channel | cascade delete | |
| member_key | text | unique with channel_id | Keyed hash of the member id |
| seal | text | | MAC over `membership:<channel id>:<member id>` |
| last_read_at | timestamptz | | Read position |
| unread_mentions | int | default 0 | |
| muted | bool | default false | Stored; no feature uses it yet |

**chat_message**

| Field | Type | Rules | Meaning |
|---|---|---|---|
| id | uuid | PK, chosen before insert | Part of the encryption context |
| channel_id | uuid, FK chat_channel | cascade delete | |
| author_key | text | | Keyed hash of the author |
| body | text | | Encrypted JSON `{ text, mentions: [member id], links: [{ objectNameSingular, recordId, label }] }`, context `message:<channel id>:<author key>:<message id>` |
| created_at | timestamptz | | Order, unread, rate limit |
| edited_at | timestamptz | | |
| deleted_at | timestamptz | | Soft delete; deleted rows still count for the rate limit |

Relations: a channel has many memberships and many messages, both deleted with it.

Uniqueness rules and the bug each prevents (only code checks in our build):
- one non-archived row per (tenant, direct_key) where kind is `CHANNEL`: two people creating the same name at once, and
  two `#general` from two first visits (we delete extras and keep the oldest);
- one row per (tenant, direct_key) where kind is `DIRECT`: two people opening the same pair at once;
- one membership per (channel_id, member_key): a join racing an invite or a mention. Our code de-duplicates on read, and
  leaving deletes every row the person has in the channel.

Indexes to add: membership (member_key) and (channel_id); message (channel_id, created_at), (author_key, created_at),
(channel_id, edited_at), (channel_id, deleted_at); channel (kind, direct_key) and (created_by_key, created_at).

### 4. Edge cases and bugs found

- Idle screens wrote to the database → every open screen polled and wrote a read marker every 4 s and re-rendered the
  whole timeline, about 30 calls a minute per idle person → no polling at all; fetches follow live notices; read markers
  are written only when new messages appeared; rows already shown are skipped (audit finding 6).
- Hidden rows stalled the client → a page of rows that cannot be shown (forged or undecryptable) never moved the client's
  position, so it asked for them forever → the server returns the newest row it read, shown or not, as the next cursor.
- The browser's clock is not the server's → "changes since" by the browser clock missed or repeated changes → the server
  returns its own clock; the next request uses it minus 10 s, plus 5 s of overlap on new messages, de-duplicated by id.
- Two posts at the same moment → the later post could move last_message_at backwards, and then not count as unread →
  conditional update: only when empty or older.
- Two first visits at once → two `#general` → keep the oldest, delete the rest (a unique constraint in the rebuild).
- Records written straight through the CRM's generic API → a forged membership could open a private channel, a forged
  message could appear as someone else → sealed channels and memberships, hashed member ids, encryption bound to channel,
  author and message id. Tested: a forged membership, a seal copied from another channel, a forged channel, copied
  ciphertext and a private channel flipped to public.
- Mentioning an outsider in a private channel → would have added them and opened the channel → in private channels and
  direct conversations only members can be mentioned.
- Spoofed record chips → a link could claim to be another record, or point at one the sender cannot see → links are read
  again with the sender's permissions and labelled from the record.
- API keys acting with the app's full role → a read-only integration key could read every channel → the route refuses
  anyone who is not a signed-in person (audit finding 1).
- Post-and-delete loops → a limit on live messages alone is bypassed → deleted messages count towards 30 a minute.
- Channels are never deleted → unbounded creation → 60 new channels and direct conversations an hour per person.
- A draft sent to the wrong channel → type, switch channel, send → switching clears draft, mentions, links and edits;
  late answers for the old channel are dropped.
- People leaving the tenant → requiring a known author would hide their messages → messages stay, shown as "Former member".
- Edits and deletions did not reach other screens → only new messages were fetched → each fetch also returns messages
  edited or deleted since the previous answer.
- Resync storm after a realtime restart → every open screen catching up at once is one app call each (about a second of
  CPU each on Twenty), 3,000 screens meant 3,000 calls in the same second → each screen waits a random 0 to 8 s.
- Slow unread counts → one count query per channel → channels with nothing new are skipped; the rest are counted from one
  scan of the newest 1,000 messages; only if that scan is full are the channels it missed counted one by one.
- An empty "in" list in a query → the platform refused the query → only the record types actually linked are looked up.
- Losing or changing `CHAT_SECRET` → every stored message becomes unreadable (no key versions) → back it up with the other
  secrets; the rebuild should version keys.
- Members could still delete chat records through the generic API → hardening step for a tenant: remove the Member role's
  access to the chat objects; the app uses its own role.
- Live notices name channel ids, and the hub does not filter by membership → any member's screen learns that some
  private channel changed, not what → accepted; the rebuild can filter by membership.

### 5. Test checklist

**Unit** (`apps/team-chat/src/__tests__/chat.test.ts`, 11 tests)
- [ ] Encrypt then decrypt: round-trips; another channel, another tenant or a tampered value gives nothing; the same text encrypts differently each time; plain text is never accepted.
- [ ] Member keys and seals: keys hide the id, are stable and differ per tenant; seals differ per member and per visibility; a forged or missing seal fails; the direct key is the same in both orders.
- [ ] `CHAT_SECRET` under 32 characters: encryption refuses to work.
- [ ] Text with CRLF, many newlines or over 4,000 characters: normalised and cut; non-strings become empty.
- [ ] Links with duplicates, bad object names, bad ids, more than five: each record once, at most five, bad ones dropped.
- [ ] Mentions of outsiders, duplicates, non-ids: only people who can see the channel, each once.
- [ ] Channel names with spaces, symbols or "#": become slugs.
- [ ] A fetch that only repeats what is shown: nothing changes.
- [ ] A fetch with new rows, real edits, unchanged rows and removals: only new, really edited and removed shown messages apply.
- [ ] Pass and publish signatures: exactly what the realtime service checks.
- [ ] Realtime not configured: no pass and a silent no-op publish, never a failure.

**End to end** (`tests/team-chat/e2e.mjs`, 35 checks, two real people: an admin and a restricted Member)
- [ ] First visit of both people: both land in the same #general.
- [ ] #general records: exactly one.
- [ ] Post with a mention (plus a non-member id) and record links: mention and real link kept.
- [ ] Links with a false label, an unknown record and another object type: label from the record, the others dropped.
- [ ] Mentioned person: one unread message and one unread mention.
- [ ] Other person: reads the message.
- [ ] Mark read: unread and mentions cleared.
- [ ] Messages after the last one: only newer ones returned.
- [ ] Stored message record: no readable text, mention, link or author id.
- [ ] Someone else edits or deletes your message: 403.
- [ ] Author edits: mentions and links kept, edited time set.
- [ ] Author deletes: gone.
- [ ] Changes since a time: edits and deletions reported to open screens.
- [ ] Private channel and an outsider: read, post and join 403; not in browse.
- [ ] Private channel through the generic API: name and topic unreadable.
- [ ] Membership written through the generic API, new or with a copied seal: private channel stays closed (403).
- [ ] Channel written through the generic API: never shows in browse.
- [ ] Message copied or forged through the generic API: not shown.
- [ ] Private channel flipped to public through the generic API: still closed (403 or 404).
- [ ] Outsider mentioned in a private channel: mention dropped, still no access.
- [ ] Invite to the private channel: can read it.
- [ ] Both sides open a direct conversation: the same one.
- [ ] Direct message: the other side reads it.
- [ ] Leave a direct conversation: 400.
- [ ] Second channel with the same slug: 400.
- [ ] Public channel before and after joining: readable with joined false, post 403, then post 200.
- [ ] Leave #general: 400.
- [ ] 5,000-character message: cut to 4,000.
- [ ] Blank message: 400.
- [ ] 32 quick posts: 429 before the end.
- [ ] Hourly channel cap: 429 at the cap, another person unaffected, allowed again below it.
- [ ] Anonymous caller and API key on the chat route: 401 or 403, and 403.
- [ ] Record search: finds the CRM record.
- [ ] Record search by someone whose role reads nothing: no results.
- [ ] Chat for that person: still works.

**Browser** (`tests/team-chat/live.cjs`, Chromium, needs the realtime service)
- [ ] Bob's bootstrap: he is in #general.
- [ ] livePass: a token and a `/v1/stream` address.
- [ ] Chat screen open: no "live updates are not set up" warning.
- [ ] Idle screen for 10 s: no message fetch.
- [ ] Bob posts through the route: the message appears on the admin's screen by itself (measured 1.7 to 3 s).

**Tenant smoke** (`tests/qa/workspace-smoke.mjs`)
- [ ] Chat records: reachable in the tenant.
- [ ] Chat route with an API key or another tenant's key: 403, and 401 or 403.

### 6. Integrations and exact contracts

**Chat route.** `POST /s/chat/api` with JSON `{ action, ... }`, signed-in person only. Success is 200 with JSON and
`cache-control: no-store`. A refusal is `{ error }` with 400 (bad input), 403 (not a person, not a member, not yours), 404
(gone), 429 (a limit) or 500 ("Something went wrong. Please try again.").

| Action | Input | Answer |
|---|---|---|
| `bootstrap` | | `{ me, members: [{ id, name, email, avatarUrl }], channels }`; creates #general if needed and adds the caller |
| `channels` | | `{ channels: [{ id, name, topic, kind, visibility, partnerId, lastMessageAt, unread, unreadMentions, muted }] }` |
| `messages` | `channelId`, optional `after` or `before` (ISO), optional `changesSince` | `{ messages, hasMore, cursor?, changed?, removed?, joined, now }` |
| `post` | `channelId`, `text`, `mentions` (member ids), `links` | `{ message }` |
| `edit` | `messageId`, `text` | `{ message, channelId }` |
| `remove` | `messageId` | `{ removed: true, channelId }` |
| `markRead` | `channelId`, optional `upTo` | `{ read: true }` |
| `createChannel` | `name`, `topic`, `visibility`, `memberIds` | `{ id }` |
| `browse` | | `{ channels: [{ id, name, topic, joined }] }` |
| `join`, `leave` | `channelId` | `{ joined: true }`, `{ left: true }` |
| `invite` | `channelId`, `memberIds` | `{ added }` |
| `channelMembers` | `channelId` | `{ memberIds }` |
| `updateChannel` | `channelId`, optional `topic`, optional `archived: true` | `{ saved: true }` |
| `openDirect` | `memberId` (yourself for notes to self) | `{ id }` |
| `livePass` | | `{ live: { url, token, expiresAt } }`, or `{ live: null }` when the realtime service is not configured |
| `searchRecords` | `query` | `{ records: [{ objectNameSingular, recordId, label }] }` |

A message is `{ id, createdAt, authorId, text, mentions, links, editedAt }`; `authorId` is empty for a former member.
`partnerId` of a direct conversation is the other person, or the caller for notes to self. `cursor` is the time of the
newest row read on an `after` request. `members` lists up to 500 tenant members.

**Encryption and seals.**
- Tenant key: HMAC-SHA256 with `CHAT_SECRET` as key over `workspace:<tenant id>`.
- Purpose keys: HMAC-SHA256 with the tenant key over `chat-messages` (encryption) and `chat-seals` (hashes and seals).
- Hashes and seals: HMAC-SHA256 with the seals key, base64url, first 32 characters, compared in constant time. Inputs:
  `member:<id>`, `membership:<channel>:<member>`, `channel:<id>:<kind>:<visibility>:<direct key>:<created by key>`,
  `channel-name:<slug>`, `direct:<id>:<id>` (ids sorted).
- Encryption: AES-256-GCM, random 12-byte IV, the context string as associated data. Stored as
  `v1.<base64url IV>.<base64url ciphertext and 16-byte tag>`.

**Realtime.** Topic `chat` (contract in the realtime section below). Notices:
- `{ kind: "messages", ids: [channel id] }` after a post, edit or delete;
- `{ kind: "channel", ids: [channel id] }` after join, leave, invite, a topic change or archive, and for a new channel
  or direct conversation.

Passes carry `topics: ["chat"]` and last an hour.

**CRM data read.** Tenant members (names, emails, avatars) with the app's role; people, companies and deals for links,
always with the caller's own permissions.

### 7. Settings and configuration

Server-wide variables (set once per server, never per tenant):

| Variable | Meaning |
|---|---|
| `CHAT_SECRET` | 32 or more random characters. Encrypts messages; tenant keys are derived from it. Back it up: changing or losing it makes every stored message unreadable |
| `REALTIME_SECRET` | The realtime service's shared secret (32 or more characters); signs notices and passes |
| `REALTIME_INTERNAL_URL` | Where the server publishes, for example the service's private address on port 3200 |
| `REALTIME_PUBLIC_URL` | Where browsers connect, for example `https://realtime.<CRM domain>` |

Live updates are off unless all three realtime values are set. There are no per-tenant settings.

| Limit | Value |
|---|---|
| Message length | 4,000 characters |
| Links per message | 5 |
| Mentions per message | 20 |
| Messages per person | 30 a minute, deleted ones included |
| New channels and direct conversations per person | 60 an hour |
| People added per call | 200 |
| Topic | 250 characters |
| Page | 50 messages |
| Unread scan | 1,000 newest messages |
| Pass lifetime | 1 hour |

### 8. Notes for the rebuild

- Put the three uniqueness rules in the database; ours were check-then-write.
- Messages took 1.7 to 3 s to reach another screen, mostly the cost of two app calls. In-process handlers would make it
  sub-second.
- If server-side encryption stays, version the key so `CHAT_SECRET` can be rotated.
- Consider filtering live notices by channel membership in the hub, so members do not see that a private channel changed.
- Not built: mute, notifications for new mentions after an edit, push or email notifications, file attachments.

---

## Realtime service

### 1. Purpose

A small push hub for the app screens. When server code changes records that a screen shows, it publishes "these
records changed" (ids only). Every open screen of that tenant hears it over Server-Sent Events and re-reads those records
through the normal API, so normal permissions decide what each person sees. It replaces polling. Twenty's app screens
could not hold a stream open through Twenty (their requests went through a relay that waits for the whole response), so
they connect to this hub directly, cross-origin. One process, no dependencies, nothing on disk: `realtime/server.mjs`.

### 2. Features and business rules

**Passes**
- A pass is minted by an app's signed-in route for the person asking, bound to one tenant, one member and a list of topics.
- A pass is valid for 1 hour.
- The hub accepts a pass only if its signature matches, its payload is unchanged, it has not expired, tenant and member
  are 1 to 64 letters, digits or "-", topics is a list of strings and the expiry is a whole number of seconds.
- A stream request without a valid pass gets 401 ("The live updates pass is missing or has expired.").
- The topics streamed are those asked for (or all of the pass's topics if none are asked for), limited to the pass's
  topics and the topics the hub serves; if none remain, 403 ("This pass does not cover these updates.").
- When the pass expires, the stream gets `event: expired` and closes; the screen fetches a new pass.

**Streams**
- The first frame is `retry: 3000`.
- Each notice is a frame `id: <n>`, `event: change`, `data: { topic, kind, ids, at }`.
- A `: ping` comment is sent every 20 s so proxies and screens know the line is alive.
- Any origin may connect (`access-control-allow-origin: *`): sandboxed app screens have an opaque origin. Preflights get 204.

**Publishes**
- Only server code publishes; the public proxy answers 404 to `/v1/publish`.
- A publish must carry a timestamp within 5 minutes either way and a valid signature over timestamp and raw body
  (compared in constant time); otherwise 401 ("Bad signature.").
- A body over 64 KiB gets 413; a body that is not JSON gets 400.
- The body must be `{ workspace, topic, events: [{ kind, ids }] }`: a valid tenant id, a topic the hub serves, 1 to 50
  events, each kind starting with a lower-case letter (1 to 40 letters), each event up to 500 ids of 1 to 64 letters,
  digits or "-". Anything else gets 400.
- A valid publish answers 202 `{ delivered }`, the number of frames written.
- Each event gets the next id and goes to every open stream of that tenant that covers the topic, and nowhere else.
- Notices never carry content.

**Limits**
- At most 5,000 open streams in all (503 "Too many live connections.").
- At most 20 open streams per person in a tenant (429).
- The last 500 notices per tenant are kept for catching up.
- A screen that stops reading is dropped once 1 MiB is waiting for it; it reconnects and resyncs.
- Streams have no request timeout; headers must arrive within 10 s.

**Catch-up and resync**
- Ids start at the hub's start time in milliseconds and grow by one per notice, so they keep increasing across restarts.
- A screen reconnecting sends its last id (`Last-Event-ID` header or `lastEventId` query parameter).
- If every notice after that id is still kept, the hub replays them for the stream's topics.
- If the id is older than the oldest kept notice minus one, or newer than the newest id issued (it comes from before a
  restart), the hub sends `event: resync` and the screen re-reads everything it shows.
- A screen connecting with no last id gets no replay.
- Screens spread their resync over a random few seconds (8 s in Team chat, 5 s in WhatsApp).

**Health**
- `GET /healthz` answers `{ ok: true, streams }`.

### 3. Data model

No database. Everything is in memory and lost on restart, which the resync rule covers.

| Structure | Contents |
|---|---|
| Open streams | Per connection: tenant, member, topics, the open response |
| History | Per tenant, the last 500 notices: `{ id, topic, kind, ids, at }` |
| Sequence | The last id issued; starts at the start time in ms |

Kinds in use: `messages` and `channel` (topic `chat`, ids are channel ids); `conversation` and `message` (topic
`whatsapp`, ids are WhatsApp conversation and message record ids).

### 4. Edge cases and bugs found

- A restart loses the history → screens would silently miss notices sent while they reconnected → ids continue from the
  clock, so any id from before a restart is unknown and gets a resync.
- Resync storm → after a restart every screen resyncs at once, one app call each; 3,000 screens meant 3,000 calls in one
  moment → screens wait a random 0 to 5 s (WhatsApp) or 0 to 8 s (Team chat).
- Slow or stuck clients → their buffers grow without bound → drop a client with over 1 MiB waiting.
- Node's default request timeout cut streams after 5 minutes → the request timeout is off; only headers have one (10 s).
- Proxy buffering would delay frames → no buffering at the proxy (`flush_interval -1`), `x-accel-buffering: no`,
  `cache-control: no-store, no-transform`.
- Passes travel in the query string → they would land in access logs → the proxy rewrites `token=...` in logged URLs.
- An expired pass is refused with 401 → a browser EventSource would retry the same URL forever → screens fetch a new pass
  when the stream closes for good, and at once on `expired`.
- EventSource hides `: ping` comments → no way to notice a dead line → the WhatsApp screens read the stream with a
  streamed fetch and reconnect after 45 s without data or ping.
- A tenant subdomain called `realtime` would collide with the hub's host name → that subdomain is reserved.
- One secret for every app → a leaked app environment could mint passes for any tenant (ids only, no content) → accepted
  for now; per-app or per-tenant keys would close it.
- No per-record filtering → members learn that something changed (for example a private channel), not what → accepted.
- One instance only → a second one would miss publishes made to the first → run one; shared publishes (for example Redis
  pub/sub) are needed before scaling out.

### 5. Test checklist

**Unit and integration** (`realtime/server.test.mjs`, `node --test`, 8 tests against a real server on a free port)
- [ ] Own pass, then one signed with another secret, an altered payload, an expired one, one without signature, nonsense: the first accepted, the rest refused.
- [ ] Publish to one tenant and topic: delivered within 500 ms as `text/event-stream` with CORS `*`; another tenant and another topic get nothing.
- [ ] Reconnect with `Last-Event-ID`: the missed notices replayed in order; `lastEventId=1`: `resync`.
- [ ] Pass that expires in a second: `expired` frame.
- [ ] Open stream: `: ping` heartbeats.
- [ ] No pass, bad pass, topic outside the pass, a fourth stream with a cap of 3: 401, 401, 403, 429.
- [ ] Unsigned, wrongly signed, 10-minute-old publish; foreign topic; invalid id: 401, 401, 401, 400, 400.
- [ ] Browser preflight from origin `null`: 204 with `*`.

**Load and restart** (`realtime/load.mjs [screens] [tenants] [notices]`, starts its own hub)
- [ ] Many screens over many tenants, a burst of notices: every screen gets every notice of its tenant. Measured 1,000 screens over 50 tenants at 101 MB, 7 ms p50, 15 ms p95; 3,000 over 200 tenants at 162 MB, 13 ms p95.
- [ ] Restart in the middle: every screen reconnects and is told to resync (measured within 2.6 s).

### 6. Integrations and exact contracts

| Call | Who | Contract |
|---|---|---|
| `GET /v1/stream?token=<pass>&topics=<a,b>&lastEventId=<n>` | Browsers, any origin | Server-Sent Events as in section 2. `Last-Event-ID` header works instead of `lastEventId` |
| `POST /v1/publish` | Server code only | Body `{ workspace, topic, events: [{ kind, ids }] }`; headers `X-Realtime-Timestamp` (unix seconds) and `X-Realtime-Signature` |
| `GET /healthz` | Monitoring | `{ ok, streams }` |
| `OPTIONS *` | Browsers | 204 with CORS headers |

- Pass format: `v1.<payload>.<signature>`, where payload is base64url of the JSON `{ workspace, member, topics, exp }`
  (exp in unix seconds) and signature is base64url of HMAC-SHA256 with `REALTIME_SECRET` over `v1.<payload>`.
- Publish signature: `sha256=` followed by hex HMAC-SHA256 with `REALTIME_SECRET` over `<timestamp>.<raw body>`. The
  WhatsApp gateway and InventiveChat webhooks use the same scheme with other secrets.
- Change frame: `id: <n>` / `event: change` / `data: {"topic","kind","ids","at"}` (`at` is the publish time, ISO).
- Other frames: `event: resync` with `data: {}`; `event: expired` with `data: {}`; comment `: ping`.
- Errors are JSON `{ error }`: 400, 401, 403, 404, 413, 429, 503.
- CORS: `access-control-allow-origin: *`, `access-control-allow-methods: GET`, `access-control-allow-headers:
  Last-Event-ID`, `access-control-max-age: 600`.
- Publishers time out after 3 s and never fail their own write because of the hub.

### 7. Settings and configuration

| Variable | Default | Meaning |
|---|---|---|
| `REALTIME_SECRET` | required, 32 or more characters | Shared with every publishing app; signs passes and publishes |
| `REALTIME_HOST`, `REALTIME_PORT` | `0.0.0.0`, `3200` | Where it listens |
| `REALTIME_TOPICS` | `whatsapp,chat` | Topics served |
| `REALTIME_MAX_STREAMS` | 5000 | Open streams in all |
| `REALTIME_MAX_STREAMS_PER_MEMBER` | 20 | Per person in a tenant |
| `REALTIME_BUFFER_PER_WORKSPACE` | 500 | Notices kept per tenant |
| `REALTIME_HEARTBEAT_MS` | 20000 | Ping interval |

Production: started only with `COMPOSE_PROFILES=realtime` and `REALTIME_SECRET` in `deploy/.env`; bound to 127.0.0.1:3200,
read-only file system, 256 MB limit; the proxy serves `realtime.<CRM domain>` with publishing refused. Each publishing app
gets `REALTIME_SECRET`, `REALTIME_INTERNAL_URL` and `REALTIME_PUBLIC_URL` (Team chat above, WhatsApp in part 3b).

### 8. Notes for the rebuild

- The design is worth keeping: ids-only notices, one-hour passes bound to tenant and person, replay from a short buffer,
  resync on any gap, spread-out resyncs, publishes that never fail the write.
- If the rebuild's screens can hold a stream to the main server, the hub can live in-process; keep the same protocol.
- Before running two instances, share publishes between them.
- Consider per-app secrets and membership-aware filtering.
