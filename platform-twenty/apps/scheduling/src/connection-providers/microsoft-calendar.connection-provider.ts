import { defineConnectionProvider } from 'twenty-sdk/define';

import { IDS } from 'src/constants/ids';
import { MICROSOFT_PROVIDER_NAME } from 'src/lib/calendar/provider-names';

// Sovereign clouds (e.g. https://login.microsoftonline.us) and test doubles set this at build time.
const LOGIN_URL = (process.env.SCHEDULING_MICROSOFT_LOGIN_URL || 'https://login.microsoftonline.com').replace(/\/$/, '');

export default defineConnectionProvider({
  universalIdentifier: IDS.connectionProviders.microsoft,
  name: MICROSOFT_PROVIDER_NAME,
  displayName: 'Microsoft Outlook Calendar',
  type: 'oauth',
  scope: 'USER',
  oauth: {
    authorizationEndpoint: `${LOGIN_URL}/common/oauth2/v2.0/authorize`,
    tokenEndpoint: `${LOGIN_URL}/common/oauth2/v2.0/token`,
    scopes: ['openid', 'email', 'offline_access', 'https://graph.microsoft.com/User.Read', 'https://graph.microsoft.com/Calendars.ReadWrite'],
    clientIdVariable: 'MICROSOFT_CLIENT_ID',
    clientSecretVariable: 'MICROSOFT_CLIENT_SECRET',
    authorizationParams: { prompt: 'select_account' },
    tokenRequestContentType: 'form-urlencoded',
    usePkce: true,
  },
});
