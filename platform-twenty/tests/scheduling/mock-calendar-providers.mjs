#!/usr/bin/env node
// Test double for Google Calendar and Microsoft Graph, including their OAuth authorize and token endpoints, so the
// scheduling app can be exercised end to end without real accounts. It follows the documented request and response
// shapes the adapters use. Control endpoints under /admin let tests add busy time, edit or delete events "in the
// provider", revoke access and simulate outages.
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';

const port = Number(process.env.PORT || 8095);
const accounts = new Map(); // email -> { provider, calendars, events, revoked, outage }
const pendingLogin = { google: [], microsoft: [] };
const codes = new Map();
const log = [];

const account = (email, provider) => {
  if (!accounts.has(email)) {
    accounts.set(email, {
      provider,
      revoked: false,
      // false, 'down' (503) or 'rate-limit' (Google 403 rateLimitExceeded, Graph 429 with Retry-After).
      outage: false,
      // Scopes the user unticks on the consent screen at their next login.
      withheldScopes: [],
      grantedScope: '',
      calendars: [
        { id: provider === 'google' ? email : `cal-${email}-primary`, name: provider === 'google' ? email : 'Calendar', primary: true },
        { id: provider === 'google' ? `team-${email}` : `cal-${email}-team`, name: 'Team rota', primary: false },
      ],
      events: [],
    });
  }
  return accounts.get(email);
};

const base64url = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
const idToken = (email) => `${base64url({ alg: 'none', typ: 'JWT' })}.${base64url({ email, email_verified: true, sub: email, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600 })}.`;
const tokenFor = (provider, email) => `${provider}.${Buffer.from(email).toString('base64url')}.${randomUUID()}`;

const send = (response, status, body, headers = {}) => {
  response.writeHead(status, { 'Content-Type': 'application/json', ...headers });
  response.end(body === undefined ? '' : JSON.stringify(body));
};

const readBody = (request) =>
  new Promise((resolve) => {
    let raw = '';
    request.on('data', (chunk) => (raw += chunk));
    request.on('end', () => resolve(raw));
  });

const authAccount = (request, provider) => {
  const token = (request.headers.authorization ?? '').replace(/^Bearer /, '');
  const [tokenProvider, encoded] = token.split('.');
  if (tokenProvider !== provider || !encoded) return { error: 401 };
  const email = Buffer.from(encoded, 'base64url').toString();
  // Tokens carry the account, so a restarted double still recognises connections Twenty already stores.
  const found = account(email, provider);
  if (found.revoked) return { error: 401 };
  if (found.outage === 'rate-limit') return { error: provider === 'google' ? 403 : 429, rateLimited: true };
  if (found.outage) return { error: 503 };
  return { email, account: found };
};

const overlaps = (event, from, to) => event.status !== 'cancelled' && event.status !== 'deleted' && Date.parse(event.start) < to && Date.parse(event.end) > from;

const handleOAuth = async (request, response, url, provider) => {
  if (url.pathname.endsWith('/authorize') || url.pathname.endsWith('/auth')) {
    const email = pendingLogin[provider].shift() ?? `default-${provider}@example.test`;
    account(email, provider);
    const code = randomUUID();
    const target = account(email, provider);
    const requested = (url.searchParams.get('scope') ?? '').split(' ').filter(Boolean);
    // Like Google and Microsoft, the token response lists what the user actually granted.
    codes.set(code, { email, provider, scope: requested.filter((scope) => !target.withheldScopes.some((withheld) => scope.endsWith(withheld))).join(' ') });
    const redirect = new URL(url.searchParams.get('redirect_uri'));
    redirect.searchParams.set('code', code);
    redirect.searchParams.set('state', url.searchParams.get('state') ?? '');
    log.push({ oauth: 'authorize', provider, email, pkce: Boolean(url.searchParams.get('code_challenge')), scope: url.searchParams.get('scope') });
    response.writeHead(302, { Location: redirect.toString() });
    return response.end();
  }
  const params = new URLSearchParams(await readBody(request));
  if (params.get('grant_type') === 'authorization_code') {
    const entry = codes.get(params.get('code'));
    if (!entry) return send(response, 400, { error: 'invalid_grant' });
    codes.delete(params.get('code'));
    log.push({ oauth: 'token', provider, email: entry.email, verifier: Boolean(params.get('code_verifier')), scope: entry.scope });
    account(entry.email, provider).grantedScope = entry.scope;
    return send(response, 200, {
      access_token: tokenFor(provider, entry.email),
      refresh_token: `refresh.${provider}.${Buffer.from(entry.email).toString('base64url')}`,
      expires_in: 3600,
      token_type: 'Bearer',
      scope: entry.scope,
      id_token: idToken(entry.email),
    });
  }
  if (params.get('grant_type') === 'refresh_token') {
    const [, refreshProvider, encoded] = (params.get('refresh_token') ?? '').split('.');
    const email = Buffer.from(encoded ?? '', 'base64url').toString();
    const found = email ? account(email, provider) : null;
    if (refreshProvider !== provider || !found || found.revoked) return send(response, 400, { error: 'invalid_grant' });
    log.push({ oauth: 'refresh', provider, email });
    return send(response, 200, { access_token: tokenFor(provider, email), expires_in: 3600, token_type: 'Bearer', scope: found.grantedScope });
  }
  return send(response, 400, { error: 'unsupported_grant_type' });
};

const googleEvent = (event) => ({
  id: event.id,
  status: event.status,
  updated: event.updated,
  summary: event.title,
  start: { dateTime: event.start },
  end: { dateTime: event.end },
  ...(event.meet ? { hangoutLink: event.meet } : {}),
});

const handleGoogle = async (request, response, url) => {
  const auth = authAccount(request, 'google');
  if (auth.rateLimited) return send(response, 403, { error: { code: 403, message: 'Rate Limit Exceeded', errors: [{ domain: 'usageLimits', reason: 'rateLimitExceeded' }] } });
  if (auth.error) return send(response, auth.error, { error: { code: auth.error, message: auth.error === 401 ? 'Invalid Credentials' : 'Backend Error' } });
  const path = url.pathname.replace('/google/calendar/v3', '');
  if (path === '/users/me/calendarList') return send(response, 200, { items: auth.account.calendars.map((calendar) => ({ id: calendar.id, summary: calendar.name, primary: calendar.primary, accessRole: calendar.primary ? 'owner' : 'writer' })) });
  if (path === '/freeBusy' && request.method === 'POST') {
    const body = JSON.parse(await readBody(request));
    const from = Date.parse(body.timeMin);
    const to = Date.parse(body.timeMax);
    const calendars = {};
    for (const { id } of body.items) {
      const resolved = id === 'primary' ? auth.email : id;
      calendars[id] = { busy: auth.account.events.filter((event) => event.calendarId === resolved && overlaps(event, from, to)).map((event) => ({ start: event.start, end: event.end })) };
    }
    log.push({ api: 'google.freeBusy', email: auth.email, calendars: body.items.length });
    return send(response, 200, { kind: 'calendar#freeBusy', calendars });
  }
  const match = /^\/calendars\/([^/]+)\/events(?:\/([^/?]+))?$/.exec(path);
  if (!match) return send(response, 404, { error: { message: 'not found' } });
  const calendarId = decodeURIComponent(match[1]) === 'primary' ? auth.email : decodeURIComponent(match[1]);
  const eventId = match[2] ? decodeURIComponent(match[2]) : null;
  if (request.method === 'POST' && !eventId) {
    const body = JSON.parse(await readBody(request));
    if (auth.account.events.some((event) => event.id === body.id)) return send(response, 409, { error: { code: 409, message: 'The requested identifier already exists.' } });
    const event = {
      id: body.id ?? randomUUID().replace(/-/g, ''),
      calendarId,
      title: body.summary,
      start: body.start.dateTime,
      end: body.end.dateTime,
      status: 'confirmed',
      updated: new Date().toISOString(),
      meet: body.conferenceData?.createRequest ? `https://meet.google.com/mock-${randomUUID().slice(0, 8)}` : null,
      origin: 'app',
    };
    auth.account.events.push(event);
    log.push({ api: 'google.insert', email: auth.email, id: event.id });
    return send(response, 200, googleEvent(event));
  }
  const event = auth.account.events.find((candidate) => candidate.id === eventId && candidate.calendarId === calendarId);
  if (!event) return send(response, 404, { error: { code: 404, message: 'Not Found' } });
  if (request.method === 'GET') return send(response, 200, googleEvent(event));
  if (request.method === 'PATCH') {
    const body = JSON.parse(await readBody(request));
    Object.assign(event, { title: body.summary ?? event.title, start: body.start?.dateTime ?? event.start, end: body.end?.dateTime ?? event.end, status: body.status ?? event.status, updated: new Date().toISOString() });
    log.push({ api: 'google.patch', email: auth.email, id: event.id });
    return send(response, 200, googleEvent(event));
  }
  if (request.method === 'DELETE') {
    if (event.status === 'cancelled') return send(response, 410, { error: { code: 410, message: 'Resource has been deleted' } });
    event.status = 'cancelled';
    log.push({ api: 'google.delete', email: auth.email, id: event.id });
    response.writeHead(204);
    return response.end();
  }
  return send(response, 405, {});
};

const graphTime = (iso) => ({ dateTime: new Date(iso).toISOString().replace('Z', '0000'), timeZone: 'UTC' });
const graphEvent = (event) => ({
  id: event.id,
  subject: event.title,
  isCancelled: event.status === 'cancelled',
  showAs: event.showAs ?? 'busy',
  lastModifiedDateTime: event.updated,
  start: graphTime(event.start),
  end: graphTime(event.end),
  onlineMeeting: event.teams ? { joinUrl: event.teams } : null,
});
const fromGraph = (value) => new Date(value.dateTime.endsWith('Z') ? value.dateTime : `${value.dateTime}Z`).toISOString();

const handleGraph = async (request, response, url) => {
  const auth = authAccount(request, 'microsoft');
  if (auth.rateLimited) return send(response, 429, { error: { code: 'TooManyRequests', message: 'Too many requests' } }, { 'Retry-After': '1' });
  if (auth.error) return send(response, auth.error, { error: { code: auth.error === 401 ? 'InvalidAuthenticationToken' : 'ServiceUnavailable', message: 'mock' } });
  const path = url.pathname.replace('/graph/v1.0', '');
  if (path === '/me/calendars') return send(response, 200, { value: auth.account.calendars.map((calendar) => ({ id: calendar.id, name: calendar.name, isDefaultCalendar: calendar.primary, canEdit: true })) });
  const view = /^\/me\/calendars\/([^/]+)\/calendarView$/.exec(path);
  if (view) {
    const calendarId = decodeURIComponent(view[1]);
    const from = Date.parse(url.searchParams.get('startDateTime'));
    const to = Date.parse(url.searchParams.get('endDateTime'));
    log.push({ api: 'graph.calendarView', email: auth.email, calendarId, prefer: request.headers.prefer ?? '' });
    return send(response, 200, { value: auth.account.events.filter((event) => event.calendarId === calendarId && overlaps(event, from, to)).map(graphEvent) });
  }
  const create = /^\/me\/calendars\/([^/]+)\/events$/.exec(path);
  if (create && request.method === 'POST') {
    const body = JSON.parse(await readBody(request));
    const existing = auth.account.events.find((event) => event.transactionId && event.transactionId === body.transactionId);
    if (existing) return send(response, 201, graphEvent(existing));
    const event = {
      id: `AAMk${randomUUID().replace(/-/g, '')}`,
      calendarId: decodeURIComponent(create[1]),
      transactionId: body.transactionId,
      title: body.subject,
      start: fromGraph(body.start),
      end: fromGraph(body.end),
      status: 'confirmed',
      updated: new Date().toISOString(),
      teams: body.isOnlineMeeting ? `https://teams.microsoft.com/l/meetup-join/mock-${randomUUID().slice(0, 8)}` : null,
      attendees: body.attendees ?? [],
      origin: 'app',
    };
    auth.account.events.push(event);
    log.push({ api: 'graph.create', email: auth.email, id: event.id, attendees: event.attendees.length });
    return send(response, 201, graphEvent(event));
  }
  const single = /^\/me\/events\/([^/?]+)$/.exec(path);
  if (single) {
    const event = auth.account.events.find((candidate) => candidate.id === decodeURIComponent(single[1]) && candidate.status !== 'deleted');
    if (!event) return send(response, 404, { error: { code: 'ErrorItemNotFound' } });
    if (request.method === 'GET') return send(response, 200, graphEvent(event));
    if (request.method === 'PATCH') {
      const body = JSON.parse(await readBody(request));
      Object.assign(event, { title: body.subject ?? event.title, start: body.start ? fromGraph(body.start) : event.start, end: body.end ? fromGraph(body.end) : event.end, updated: new Date().toISOString() });
      log.push({ api: 'graph.patch', email: auth.email, id: event.id });
      return send(response, 200, graphEvent(event));
    }
    if (request.method === 'DELETE') {
      event.status = 'deleted';
      log.push({ api: 'graph.delete', email: auth.email, id: event.id });
      response.writeHead(204);
      return response.end();
    }
  }
  return send(response, 404, { error: { code: 'NotFound' } });
};

const handleAdmin = async (request, response, url) => {
  const body = request.method === 'POST' ? JSON.parse((await readBody(request)) || '{}') : {};
  switch (url.pathname) {
    case '/admin/next-login':
      pendingLogin[body.provider].push(body.email);
      return send(response, 200, { queued: true });
    case '/admin/busy': {
      const target = account(body.email, body.provider);
      const event = { id: `ext-${randomUUID().slice(0, 8)}`, calendarId: body.calendarId ?? target.calendars[0].id, title: body.title ?? 'Private', start: body.start, end: body.end, status: 'confirmed', updated: new Date().toISOString(), origin: 'external' };
      target.events.push(event);
      return send(response, 200, event);
    }
    case '/admin/events':
      return send(response, 200, accounts.get(url.searchParams.get('email'))?.events ?? []);
    case '/admin/edit-event': {
      const event = accounts.get(body.email)?.events.find((candidate) => candidate.id === body.id);
      if (!event) return send(response, 404, {});
      if (body.delete) event.status = event.calendarId && accounts.get(body.email).provider === 'microsoft' ? 'deleted' : 'cancelled';
      if (body.start) Object.assign(event, { start: body.start, end: body.end });
      event.updated = new Date().toISOString();
      return send(response, 200, event);
    }
    case '/admin/revoke':
      accounts.get(body.email).revoked = body.revoked !== false;
      return send(response, 200, { revoked: accounts.get(body.email).revoked });
    case '/admin/outage':
      accounts.get(body.email).outage = body.on ? (body.mode ?? 'down') : false;
      return send(response, 200, { outage: accounts.get(body.email).outage });
    case '/admin/withhold-scopes':
      account(body.email, body.provider).withheldScopes = body.scopes ?? [];
      return send(response, 200, { withheld: body.scopes ?? [] });
    case '/admin/reset':
      for (const value of accounts.values()) value.events = [];
      log.length = 0;
      return send(response, 200, { reset: true });
    case '/admin/log':
      return send(response, 200, log);
    default:
      return send(response, 404, {});
  }
};

createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host}`);
  try {
    if (url.pathname.startsWith('/google/oauth')) return await handleOAuth(request, response, url, 'google');
    if (url.pathname.startsWith('/microsoft/common/oauth2')) return await handleOAuth(request, response, url, 'microsoft');
    if (url.pathname.startsWith('/google/calendar/v3')) return await handleGoogle(request, response, url);
    if (url.pathname.startsWith('/graph/v1.0')) return await handleGraph(request, response, url);
    if (url.pathname.startsWith('/admin')) return await handleAdmin(request, response, url);
    send(response, 404, { error: 'unknown path' });
  } catch (error) {
    send(response, 500, { error: error.message });
  }
}).listen(port, '127.0.0.1', () => console.log(`mock calendar providers on 127.0.0.1:${port}`));
