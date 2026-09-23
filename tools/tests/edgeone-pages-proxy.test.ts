import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

type ProxyModule = {
  onRequest: (context: {
    request: Request;
    env: { BACKEND_URL: string };
  }) => Promise<Response>;
};

type BackendHandler = (
  request: IncomingMessage,
  response: ServerResponse,
  body: string,
) => void;

let server: ReturnType<typeof createServer>;
let backendBaseUrl: string;
let handler: BackendHandler;

beforeEach(async () => {
  handler = (_request, response) => {
    response.writeHead(404, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ message: 'not found' }));
  };

  server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) {
      chunks.push(Buffer.from(chunk));
    }
    handler(request, response, Buffer.concat(chunks).toString('utf8'));
  });

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address() as AddressInfo;
  backendBaseUrl = `http://127.0.0.1:${address.port}`;
});

afterEach(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

describe('EdgeOne Pages API proxy', () => {
  it('forwards public exam requests', async () => {
    let requestedPath = '';
    handler = (request, response) => {
      requestedPath = request.url || '';
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ items: [{ id: 1 }] }));
    };

    const proxy = await loadProxy();
    const response = await proxy.onRequest({
      request: new Request('https://exam.example/api/v1/tools/exam?page=1&page_size=50'),
      env: { BACKEND_URL: backendBaseUrl },
    });

    expect(response.status).toBe(200);
    expect(requestedPath).toBe('/api/v1/tools/exam?page=1&page_size=50');
    await expect(response.json()).resolves.toEqual({ items: [{ id: 1 }] });
  });

  it('stores login tokens in cookies without returning them to the browser', async () => {
    handler = (_request, response) => {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(
        JSON.stringify({
          accessToken: 'access-token',
          refreshToken: 'refresh-token',
          expiresIn: 900,
        }),
      );
    };

    const proxy = await loadProxy();
    const response = await proxy.onRequest({
      request: new Request('https://exam.example/api/v1/auth/login-email', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'user@example.com', password: 'secret' }),
      }),
      env: { BACKEND_URL: backendBaseUrl },
    });
    const body = await response.json();
    const cookies = response.headers.get('set-cookie') || '';

    expect(response.status).toBe(200);
    expect(body).toEqual({
      ok: true,
      requires2FA: false,
      twoFactorToken: null,
      expiresIn: 900,
    });
    expect(body.accessToken).toBeUndefined();
    expect(cookies).toContain('fztbu_access=access-token');
    expect(cookies).toContain('fztbu_refresh=refresh-token');
    expect(cookies).toContain('HttpOnly');
  });

  it('injects the access token from the cookie', async () => {
    let authorization = '';
    handler = (request, response) => {
      authorization = String(request.headers.authorization || '');
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ user: { id: 7 } }));
    };

    const proxy = await loadProxy();
    const response = await proxy.onRequest({
      request: new Request('https://exam.example/api/v1/auth/me', {
        headers: { cookie: 'fztbu_access=old-access' },
      }),
      env: { BACKEND_URL: backendBaseUrl },
    });

    expect(response.status).toBe(200);
    expect(authorization).toBe('Bearer old-access');
  });

  it('refreshes once and retries when the access token expires', async () => {
    const authorizationCalls: string[] = [];
    handler = (request, response, body) => {
      if (request.url === '/api/v1/auth/refresh') {
        expect(JSON.parse(body)).toEqual({ refreshToken: 'refresh-token' });
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(
          JSON.stringify({
            accessToken: 'new-access',
            refreshToken: 'new-refresh',
            expiresIn: 900,
          }),
        );
        return;
      }

      authorizationCalls.push(String(request.headers.authorization || ''));
      if (authorizationCalls.length === 1) {
        response.writeHead(401, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ message: 'expired' }));
        return;
      }

      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ user: { id: 7 } }));
    };

    const proxy = await loadProxy();
    const response = await proxy.onRequest({
      request: new Request('https://exam.example/api/v1/auth/me', {
        headers: {
          cookie: 'fztbu_access=old-access; fztbu_refresh=refresh-token',
        },
      }),
      env: { BACKEND_URL: backendBaseUrl },
    });
    const cookies = response.headers.get('set-cookie') || '';

    expect(response.status).toBe(200);
    expect(authorizationCalls).toEqual(['Bearer old-access', 'Bearer new-access']);
    expect(cookies).toContain('fztbu_access=new-access');
    expect(cookies).toContain('fztbu_refresh=new-refresh');
  });

  it('clears cookies when refresh fails', async () => {
    handler = (request, response) => {
      const status = request.url === '/api/v1/auth/refresh' ? 401 : 401;
      response.writeHead(status, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ message: 'expired' }));
    };

    const proxy = await loadProxy();
    const response = await proxy.onRequest({
      request: new Request('https://exam.example/api/v1/auth/me', {
        headers: {
          cookie: 'fztbu_access=old-access; fztbu_refresh=expired-refresh',
        },
      }),
      env: { BACKEND_URL: backendBaseUrl },
    });
    const cookies = response.headers.get('set-cookie') || '';

    expect(response.status).toBe(401);
    expect(cookies).toContain('fztbu_access=;');
    expect(cookies).toContain('fztbu_refresh=;');
    expect(cookies).toContain('Max-Age=0');
  });
});

async function loadProxy(): Promise<ProxyModule> {
  const source = readFileSync(
    new URL('../../edgeone-pages/functions/api/[[default]].js', import.meta.url),
    'utf8',
  );
  const moduleUrl = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
  return (await import(/* @vite-ignore */ moduleUrl)) as ProxyModule;
}
