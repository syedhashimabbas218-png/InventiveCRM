import { describe, expect, it } from 'vitest';

import { grantedPermissions, isUsable } from 'src/lib/calendar/permissions';
import { CalendarAuthError, CalendarPermissionError, CalendarRequestError, classifyProviderFailure, parseRetryAfter } from 'src/lib/calendar/types';

const GOOGLE_ALL = [
  'openid',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
  'https://www.googleapis.com/auth/calendar.freebusy',
  'https://www.googleapis.com/auth/calendar.events.owned',
];

describe('granted permissions', () => {
  it('accepts a full Google grant', () => {
    const permissions = grantedPermissions('GOOGLE', GOOGLE_ALL);
    expect(permissions.missing).toEqual([]);
    expect(isUsable(permissions)).toBe(true);
  });

  it('switches off writing when the user unticks the events permission', () => {
    const permissions = grantedPermissions('GOOGLE', GOOGLE_ALL.filter((scope) => !scope.endsWith('events.owned')));
    expect(permissions.writeEvents).toBe(false);
    expect(isUsable(permissions)).toBe(false);
    expect(permissions.missing).toEqual(['See, create, change, and delete events on Google calendars you own']);
  });

  it('keeps working with only the primary calendar when the list permission is withheld', () => {
    const permissions = grantedPermissions('GOOGLE', GOOGLE_ALL.filter((scope) => !scope.endsWith('calendarlist.readonly')));
    expect(permissions.listCalendars).toBe(false);
    expect(isUsable(permissions)).toBe(true);
  });

  it('reads Microsoft short scope names', () => {
    expect(isUsable(grantedPermissions('MICROSOFT', ['openid', 'email', 'User.Read', 'Calendars.ReadWrite']))).toBe(true);
    expect(isUsable(grantedPermissions('MICROSOFT', ['openid', 'User.Read']))).toBe(false);
    expect(isUsable(grantedPermissions('MICROSOFT', ['https://graph.microsoft.com/Calendars.ReadWrite']))).toBe(true);
  });

  it('assumes the requested scopes when the provider reports none', () => {
    expect(isUsable(grantedPermissions('GOOGLE', []))).toBe(true);
  });
});

describe('provider failures', () => {
  it('retries Google rate limits sent as 403', () => {
    const error = classifyProviderFailure(403, JSON.stringify({ error: { code: 403, errors: [{ reason: 'rateLimitExceeded' }] } }), 2000);
    expect(error).toBeInstanceOf(CalendarRequestError);
    expect((error as CalendarRequestError).retryable).toBe(true);
    expect((error as CalendarRequestError).retryAfterMs).toBe(2000);
  });

  it('asks for a reconnect when a Google scope is missing', () => {
    const error = classifyProviderFailure(403, JSON.stringify({ error: { code: 403, status: 'PERMISSION_DENIED', details: [{ reason: 'ACCESS_TOKEN_SCOPE_INSUFFICIENT' }] } }), null);
    expect(error).toBeInstanceOf(CalendarPermissionError);
    expect(error).toBeInstanceOf(CalendarAuthError);
  });

  it('does not ask for a reconnect when a calendar is simply not writable', () => {
    const error = classifyProviderFailure(403, JSON.stringify({ error: { code: 403, errors: [{ reason: 'requiredAccessLevel' }] } }), null);
    expect(error).toBeInstanceOf(CalendarRequestError);
    expect(error).not.toBeInstanceOf(CalendarAuthError);
    expect((error as CalendarRequestError).retryable).toBe(false);
  });

  it('explains a Microsoft account without a mailbox', () => {
    const error = classifyProviderFailure(404, JSON.stringify({ error: { code: 'MailboxNotEnabledForRESTAPI', message: 'REST API is not yet supported for this mailbox.' } }), null);
    expect(error?.message).toMatch(/no Exchange Online mailbox/);
    expect((error as CalendarRequestError).retryable).toBe(false);
  });

  it('treats Graph access denied as a missing permission and 429 as retryable', () => {
    expect(classifyProviderFailure(403, JSON.stringify({ error: { code: 'ErrorAccessDenied' } }), null)).toBeInstanceOf(CalendarPermissionError);
    expect((classifyProviderFailure(429, '{}', 10_000) as CalendarRequestError).retryAfterMs).toBe(10_000);
  });

  it('leaves 404 and 5xx to the caller', () => {
    expect(classifyProviderFailure(404, JSON.stringify({ error: { code: 'ErrorItemNotFound' } }), null)).toBeNull();
    expect(classifyProviderFailure(503, '', null)).toBeNull();
  });

  it('parses Retry-After as seconds or a date', () => {
    expect(parseRetryAfter('10')).toBe(10_000);
    expect(parseRetryAfter('Thu, 05 Nov 2026 12:00:30 GMT', Date.parse('2026-11-05T12:00:00Z'))).toBe(30_000);
    expect(parseRetryAfter(null)).toBeNull();
  });
});
