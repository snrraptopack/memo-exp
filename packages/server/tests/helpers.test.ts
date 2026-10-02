// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { deleteCookie, error, getCookie, json, setCookie } from '../src';
import { createServerFunctionRoutes, createServerRouter } from '../src/http-router';
import { decodeResponse } from '../../data/src/request';

describe('server response helpers', () => {
  it('returns an expected failure from a server function without invoking onError', async () => {
    const onError = vi.fn(() => error(500, 'Unexpected failure'));
    const router = createServerRouter({ onError, routes: createServerFunctionRoutes([{
      id: 'stories/story', method: 'GET', path: '/_fn/stories/story', parameters: [],
      handler: () => error(404, 'Story not found'),
    }]) });
    const response = await router.fetch(new Request('https://app.test/_fn/stories/story'));
    expect(response.status).toBe(404);
    expect(response.headers.get('content-type')).toContain('application/json');
    await expect(decodeResponse(response, undefined)).rejects.toMatchObject({
      kind: 'http', status: 404, data: { message: 'Story not found' },
    });
    expect(onError).not.toHaveBeenCalled();
  });

  it('allows ordinary route middleware to return an error and skip the handler', async () => {
    const handler = vi.fn(() => json({ secret: true }));
    const router = createServerRouter({ routes: [{ method: 'GET', path: '/private',
      middleware: [() => error(401, 'Sign in first')], handler }] });
    const response = await router.fetch(new Request('https://app.test/private'));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ message: 'Sign in first' });
    expect(handler).not.toHaveBeenCalled();
  });

  it.each([200, 399, 600, 404.5, NaN])('rejects invalid failure status %s', status => {
    expect(() => error(status, 'Invalid')).toThrow(RangeError);
  });
});

describe('cookie helpers', () => {
  it('reads exact cookie names and handles duplicates, equals signs, and malformed escapes', () => {
    const request = new Request('https://app.test', { headers: {
      cookie: 'sessionId=wrong; broken; session=first%20value%3D; session=second; raw=10%off; empty=; quoted="hello%20world"',
    } });
    expect(getCookie(request, 'session')).toBe('first value=');
    expect(getCookie(request, 'raw')).toBe('10%off');
    expect(getCookie(request, 'empty')).toBe('');
    expect(getCookie(request, 'quoted')).toBe('hello world');
    expect(getCookie(request, 'missing')).toBeUndefined();
    expect(getCookie(new Request('https://app.test'), 'session')).toBeUndefined();
  });

  it('round-trips encoded values and preserves multiple cookies, headers, and the response body', async () => {
    const response = json({ ok: true }, { status: 201, headers: { 'x-request-id': 'request-1',
      'set-cookie': 'existing=keep; Path=/' } });
    const value = 'a=b; café\n';
    setCookie(response, 'session', value, { httpOnly: true, secure: true, sameSite: 'lax', maxAge: 3600 });
    setCookie(response, 'theme', 'dark');
    const cookies = response.headers.getSetCookie();
    expect(cookies).toHaveLength(3);
    expect(cookies[0]).toBe('existing=keep; Path=/');
    expect(cookies[1]).toBe(`session=${encodeURIComponent(value)}; Path=/; Max-Age=3600; HttpOnly; Secure; SameSite=Lax`);
    const request = new Request('https://app.test', { headers: { cookie: cookies.map(cookie => cookie.split(';')[0]).join('; ') } });
    expect(getCookie(request, 'session')).toBe(value);
    expect(response.status).toBe(201);
    expect(response.headers.get('x-request-id')).toBe('request-1');
    expect(await response.json()).toEqual({ ok: true });
  });

  it('sets expiry and removes cookies at their original path and domain', () => {
    const response = json({ ok: true });
    const scope = { path: '/account', domain: 'app.test', secure: true };
    setCookie(response, 'session', 'token', { ...scope, expires: new Date('2030-01-01T00:00:00Z') });
    deleteCookie(response, 'session', scope);
    const cookies = response.headers.getSetCookie();
    expect(cookies[0]).toContain('Expires=Tue, 01 Jan 2030 00:00:00 GMT');
    expect(cookies[1]).toBe('session=; Path=/account; Domain=app.test; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Secure');
  });

  it('uses the same default path for setting and deleting', () => {
    const response = error(401, 'Session expired');
    setCookie(response, 'session', 'token');
    deleteCookie(response, 'session');
    expect(response.headers.getSetCookie().every(cookie => cookie.includes('Path=/'))).toBe(true);
  });

  it.each([
    { name: 'session; injected', options: {} },
    { name: 'session', options: { path: '/; Secure' } },
    { name: 'session', options: { path: 'relative' } },
    { name: 'session', options: { domain: 'app.test\r\nx-header: injected' } },
    { name: 'session', options: { maxAge: Infinity } },
    { name: 'session', options: { maxAge: 0.5 } },
    { name: 'session', options: { expires: new Date(NaN) } },
  ])('rejects invalid cookie names/options without changing headers: $options', ({ name, options }) => {
    const response = json({ ok: true });
    expect(() => setCookie(response, name, 'token', options)).toThrow(TypeError);
    expect(response.headers.has('set-cookie')).toBe(false);
  });
});
