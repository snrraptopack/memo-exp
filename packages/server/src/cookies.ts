export interface CookieOptions {
  /** Defaults to `/`. Use the same path when deleting the cookie. */
  readonly path?: string;
  readonly domain?: string;
  /** Lifetime in seconds. */
  readonly maxAge?: number;
  readonly expires?: Date;
  readonly httpOnly?: boolean;
  readonly secure?: boolean;
  readonly sameSite?: 'strict' | 'lax' | 'none';
}

const COOKIE_NAME = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
const COOKIE_PATH = /^[\x20-\x3A\x3C-\x7E]+$/;
const COOKIE_DOMAIN = /^(?:\.?[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)*$/;

function validateName(name: string): void {
  if (!COOKIE_NAME.test(name)) throw new TypeError('Invalid cookie name');
}

/** Read one cookie; values written by setCookie are URI-decoded. */
export function getCookie(request: Request, name: string): string | undefined {
  validateName(name);
  const header = request.headers.get('cookie');
  if (header === null) return undefined;
  for (const entry of header.split(';')) {
    const separator = entry.indexOf('=');
    if (separator < 0 || entry.slice(0, separator).trim() !== name) continue;
    let value = entry.slice(separator + 1).trim();
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    try {
      return decodeURIComponent(value);
    } catch {
      // Cookies from other applications may contain literal percent signs.
      return value;
    }
  }
  return undefined;
}

/** Append a cookie to this Response without replacing existing cookies. */
export function setCookie(
  response: Response,
  name: string,
  value: string,
  options: CookieOptions = {},
): void {
  validateName(name);
  const path = options.path ?? '/';
  if (!COOKIE_PATH.test(path) || !path.startsWith('/')) {
    throw new TypeError('Cookie path must start with / and contain no control characters or semicolons');
  }
  const parts = [`${name}=${encodeURIComponent(value)}`, `Path=${path}`];
  if (options.domain !== undefined) {
    if (!COOKIE_DOMAIN.test(options.domain)) throw new TypeError('Invalid cookie domain');
    parts.push(`Domain=${options.domain}`);
  }
  if (options.maxAge !== undefined) {
    if (!Number.isSafeInteger(options.maxAge)) throw new TypeError('Cookie maxAge must be an integer in seconds');
    parts.push(`Max-Age=${options.maxAge}`);
  }
  if (options.expires !== undefined) {
    if (!(options.expires instanceof Date) || !Number.isFinite(options.expires.getTime())) {
      throw new TypeError('Cookie expires must be a valid Date');
    }
    parts.push(`Expires=${options.expires.toUTCString()}`);
  }
  if (options.httpOnly) parts.push('HttpOnly');
  if (options.secure) parts.push('Secure');
  if (options.sameSite !== undefined) {
    const values = { strict: 'Strict', lax: 'Lax', none: 'None' } as const;
    if (!Object.hasOwn(values, options.sameSite)) throw new TypeError('Invalid cookie sameSite');
    parts.push(`SameSite=${values[options.sameSite]}`);
  }
  response.headers.append('set-cookie', parts.join('; '));
}

/** Expire a cookie using the same path/domain as when it was set. */
export function deleteCookie(
  response: Response,
  name: string,
  options: Omit<CookieOptions, 'maxAge' | 'expires'> = {},
): void {
  setCookie(response, name, '', { ...options, maxAge: 0, expires: new Date(0) });
}
