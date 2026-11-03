#!/bin/sh
# Runs against a fresh multi-workspace instance at http://localhost:3000 (IS_MULTIWORKSPACE_ENABLED=true, EMAIL_DRIVER=LOGGER,
# worker container named pt-worker). Needs Playwright with Chromium. State files are written to the current directory.
set -e
cd "$(dirname "$0")"
node mt1-admin-signup.js
node mt2-onboard.js mt-admin.json http://acme.localhost:3000/ Admin User
node mt3-second-workspace.js
node mt2-onboard.js mt-admin-bright.json http://bright.localhost:3000/ Admin User
node mt4-isolation.js
node mt5-invite.js
sleep 6
docker logs pt-worker 2>&1 | grep -oE 'http://bright\.localhost:3000/invite/[^" ]+' | head -1 | sed 's/&amp;/\&/g' > mt-invite-link.txt
node mt6-client-join.js
node mt2-onboard.js mt-client.json http://bright.localhost:3000/ Client User
node mt7-client-limits.js
node mt-crawl.js mt-admin.json acme.localhost
node mt-crawl.js mt-client.json bright.localhost
