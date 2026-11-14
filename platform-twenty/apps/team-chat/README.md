# Team chat (InventiveCRM app)

Chat for the people in a workspace, inside the CRM: channels, private channels, direct messages, @mentions, links to
contacts, companies and deals, and unread counts. Built on the Twenty apps SDK and twenty-ui; installs per workspace.

## How it works

| Part | Behaviour |
|---|---|
| Channels | Everyone starts in **#general**. Anyone can create a channel; public channels can be browsed, looked into and joined, private ones only by people who are added. Names are unique. The creator can archive a channel; nobody can leave #general |
| Direct messages | One conversation per pair of people (and "Notes to self"). They cannot be left |
| Mentions | Type @ to pick someone. In a public channel the person is added so they see it; in a private channel or direct message only members can be mentioned. Unread mentions show as a red @ count |
| Record links | "Link a record" searches people, companies and deals with the user's own permissions, so nobody can link records they cannot see. Links open the record |
| Unread | Per channel, from each person's read position; opening a channel marks it read |
| Updates | Polling: the open channel every 4 seconds, unread counts every 15 seconds, paused while the tab is hidden. There is no push or email notification yet |
| Privacy | Message text, mentions and links are encrypted (AES-256-GCM) with a key derived per workspace from `CHAT_SECRET` and bound to the channel. The chat records exist in the data model, but anyone reading them there (API, exports, other apps) sees only ciphertext. Every read and write goes through the app's route, which checks channel membership |
| Limits | 4,000 characters and 5 links per message, 30 messages a minute per person. Authors can edit and delete their own messages |

## Server variables

`node ../../scripts/set-app-variables.mjs --app 6c6eba62-6fc2-487e-a212-3b8b01bb4365 ...`

| Variable | Meaning |
|---|---|
| `CHAT_SECRET` | 32+ random characters (`openssl rand -hex 32`). Encrypts messages. Back it up with the other secrets: changing or losing it makes every existing message unreadable |

## Install

Same flow as the other apps (see `../../UPDATES.md`, "Releasing an app"). Application id:
`6c6eba62-6fc2-487e-a212-3b8b01bb4365`.

## Tests

`yarn test` covers encryption (wrong channel, wrong workspace, tampering), message limits, links, mentions and channel
names. `../../tests/team-chat/e2e.mjs` runs two real users through the app on the throwaway test server (27 checks,
including private channel isolation and search permissions).
