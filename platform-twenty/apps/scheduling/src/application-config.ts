import { defineApplication } from 'twenty-sdk/define';

import { IDS } from 'src/constants/ids';

export default defineApplication({
  universalIdentifier: IDS.application,
  displayName: 'Scheduling',
  description:
    'Appointment types, team and location-based booking, public booking pages and embeds, with Google and Microsoft calendar sync.',
  author: 'InventiveWeb.studio',
  category: 'Sales',
  serverVariables: {
    GOOGLE_CLIENT_ID: { description: 'OAuth client id of the Google Cloud project used for calendar connections.' },
    GOOGLE_CLIENT_SECRET: { description: 'OAuth client secret for Google.', isSecret: true },
    MICROSOFT_CLIENT_ID: { description: 'Application (client) id of the Microsoft Entra app used for calendar connections.' },
    MICROSOFT_CLIENT_SECRET: { description: 'Client secret of the Microsoft Entra app.', isSecret: true },
    GOOGLE_CALENDAR_API_URL: { description: 'Optional. Defaults to https://www.googleapis.com/calendar/v3.' },
    MICROSOFT_GRAPH_API_URL: { description: 'Optional. Defaults to https://graph.microsoft.com/v1.0.' },
    GEOCODER_URL: { description: 'Nominatim-compatible geocoder, e.g. http://nominatim:8080 (self-hosted).' },
    GEOCODER_COUNTRY_CODES: { description: 'Optional ISO country codes to search in, e.g. gb.' },
    ROUTER_URL: { description: 'OSRM server for road distance and travel time, e.g. http://osrm:5000.' },
    MAP_TILE_URL: { description: 'Raster tile URL template for booking-page maps, e.g. https://tiles.example.com/{z}/{x}/{y}.png.' },
    MAP_ATTRIBUTION: { description: 'Map attribution shown under the map.' },
    BOOKING_LINK_SECRET: { description: 'Random secret (openssl rand -hex 32) signing manage links and booking forms.', isSecret: true },
    SMTP_HOST: { description: 'Mail server for booking emails, e.g. mail.' },
    SMTP_PORT: { description: 'Mail server port, usually 587.' },
    SMTP_SECURITY: { description: 'TLS, STARTTLS or NONE (NONE only inside a private network).' },
    SMTP_USERNAME: { description: 'Mail server login, if it needs one.' },
    SMTP_PASSWORD: { description: 'Mail server password.', isSecret: true },
    SMTP_FROM_ADDRESS: { description: 'Sender address for booking emails.' },
  },
});
