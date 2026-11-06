import { defineConnectionProvider } from 'twenty-sdk/define';

import { IDS } from 'src/constants/ids';
import { GOOGLE_PROVIDER_NAME } from 'src/lib/calendar/provider-names';

// Build-time overrides exist for provider test doubles; production uses Google's endpoints.
const AUTHORIZE_URL = process.env.SCHEDULING_GOOGLE_AUTHORIZE_URL || 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = process.env.SCHEDULING_GOOGLE_TOKEN_URL || 'https://oauth2.googleapis.com/token';

// Least privilege: free/busy, the calendar list, and events only on calendars the user owns. No mail or contacts.
export default defineConnectionProvider({
  universalIdentifier: IDS.connectionProviders.google,
  name: GOOGLE_PROVIDER_NAME,
  displayName: 'Google Calendar',
  type: 'oauth',
  scope: 'USER',
  oauth: {
    authorizationEndpoint: AUTHORIZE_URL,
    tokenEndpoint: TOKEN_URL,
    revokeEndpoint: 'https://oauth2.googleapis.com/revoke',
    scopes: [
      'openid',
      'email',
      'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
      'https://www.googleapis.com/auth/calendar.freebusy',
      'https://www.googleapis.com/auth/calendar.events.owned',
    ],
    clientIdVariable: 'GOOGLE_CLIENT_ID',
    clientSecretVariable: 'GOOGLE_CLIENT_SECRET',
    authorizationParams: { access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true' },
    tokenRequestContentType: 'form-urlencoded',
    usePkce: true,
  },
});
