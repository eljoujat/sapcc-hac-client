'use strict';

const HacClient = require('../src/HacClient');

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Build a client with internal methods pre-spied so tests don't have to
 * fight with the axios + cheerio + cookie-jar mock chain.
 */
function makeClient(overrides = {}) {
  const client = new HacClient({
    hacUrl:   'https://hac.example.com',
    username: 'admin',
    password: 'password',
    ...overrides,
  });
  return client;
}

// ─────────────────────────────────────────────────────────────────────────────
//  authenticate()
// ─────────────────────────────────────────────────────────────────────────────

describe('HacClient – authenticate()', () => {
  let client;

  beforeEach(() => {
    client = makeClient();
  });

  it('sets _authenticated=true after successful login', async () => {
    // Stub _http layer
    jest.spyOn(client._http, 'get').mockImplementation(async (url) => {
      if (url.includes('/hac/')) {
        return {
          status:  200,
          data:    '<html><head><meta name="_csrf" content="CSRF_TOKEN"/></head></html>',
          headers: {},
        };
      }
      return { status: 200, data: '', headers: {} };
    });

    jest.spyOn(client._http, 'post').mockResolvedValue({
      status:  302,
      data:    '',
      headers: { location: '/hac/' },
    });

    await client.authenticate();
    expect(client._authenticated).toBe(true);
  });

  it('throws when redirected to login?error page', async () => {
    jest.spyOn(client._http, 'get').mockResolvedValue({
      status: 200,
      data:    '<html><head><meta name="_csrf" content="CSRF_TOKEN"/></head></html>',
      headers: {},
    });

    jest.spyOn(client._http, 'post').mockResolvedValue({
      status:  302,
      data:    '',
      headers: { location: '/hac/login?error=true' },
    });

    await expect(client.authenticate()).rejects.toThrow('Authentification échouée');
  });

  it('throws when CSRF token cannot be extracted from HTML', async () => {
    jest.spyOn(client._http, 'get').mockResolvedValue({
      status: 200,
      data:   '<html><body><p>No CSRF here</p></body></html>',
    });

    await expect(client.authenticate()).rejects.toThrow('Impossible d\'extraire le token CSRF');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
//  executeGroovy()
// ─────────────────────────────────────────────────────────────────────────────

describe('HacClient – executeGroovy()', () => {
  let client;

  beforeEach(() => {
    client = makeClient();
    client._authenticated = true;

    // Stub _getCsrfToken to avoid real HTTP calls
    jest.spyOn(client, '_getCsrfToken').mockResolvedValue('SCRIPTING_CSRF');
  });

  it('returns success=true with executionResult', async () => {
    jest.spyOn(client._http, 'post').mockResolvedValue({
      status: 200,
      data: {
        executionResult: 'Hello World',
        outputText:      '',
        stacktraceText:  '',
      },
    });

    const result = await client.executeGroovy('return "Hello World"');

    expect(result.success).toBe(true);
    expect(result.executionResult).toBe('Hello World');
    expect(result.stacktrace).toBe('');
  });

  it('sends the script body and CSRF header', async () => {
    const postSpy = jest.spyOn(client._http, 'post').mockResolvedValue({
      status: 200,
      data:   { executionResult: 'ok', outputText: '', stacktraceText: '' },
    });

    await client.executeGroovy('return 42');

    const [url, body, config] = postSpy.mock.calls[0];
    expect(url).toContain('/hac/console/scripting/execute');
    expect(body).toContain('script=');
    expect(config.headers['X-CSRF-TOKEN']).toBe('SCRIPTING_CSRF');
  });

  it('returns success=false when stacktrace is present', async () => {
    jest.spyOn(client._http, 'post').mockResolvedValue({
      status: 200,
      data: {
        executionResult: null,
        outputText:      '',
        stacktraceText:  'groovy.lang.MissingMethodException: No signature of method ...',
      },
    });

    const result = await client.executeGroovy('unknownMethod()');

    expect(result.success).toBe(false);
    expect(result.stacktrace).toContain('MissingMethodException');
  });

  it('passes commit=true in request body', async () => {
    const postSpy = jest.spyOn(client._http, 'post').mockResolvedValue({
      status: 200,
      data:   { executionResult: 'done', outputText: '', stacktraceText: '' },
    });

    await client.executeGroovy('modifyData()', { commit: true });

    const body = postSpy.mock.calls[0][1];
    expect(body).toContain('commit=true');
  });

  it('passes scriptType=beanshell when requested', async () => {
    const postSpy = jest.spyOn(client._http, 'post').mockResolvedValue({
      status: 200,
      data:   { executionResult: 'ok', outputText: '', stacktraceText: '' },
    });

    await client.executeGroovy('script.exec()', { scriptType: 'beanshell' });

    const body = postSpy.mock.calls[0][1];
    expect(body).toContain('scriptType=beanshell');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
//  executeFlexSearch()
// ─────────────────────────────────────────────────────────────────────────────

describe('HacClient – executeFlexSearch()', () => {
  let client;

  beforeEach(() => {
    client = makeClient();
    client._authenticated = true;
    jest.spyOn(client, '_getCsrfToken').mockResolvedValue('FLEXSEARCH_CSRF');
  });

  it('returns parsed rows and headers on success', async () => {
    jest.spyOn(client._http, 'post').mockResolvedValue({
      status: 200,
      data: {
        resultCount:   2,
        executionTime: 42,
        headers:       ['PK', 'code', 'name'],
        results:       [
          ['8796093055073', 'PRODUCT_A', 'Product A'],
          ['8796093055074', 'PRODUCT_B', 'Product B'],
        ],
      },
    });

    const result = await client.executeFlexSearch(
      "SELECT {pk},{code},{name} FROM {Product}"
    );

    expect(result.success).toBe(true);
    expect(result.resultCount).toBe(2);
    expect(result.executionTime).toBe(42);
    expect(result.headers).toEqual(['PK', 'code', 'name']);
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0][1]).toBe('PRODUCT_A');
    expect(result.rows[1][2]).toBe('Product B');
  });

  it('sends query and CSRF header', async () => {
    const postSpy = jest.spyOn(client._http, 'post').mockResolvedValue({
      status: 200,
      data:   { resultCount: 0, headers: [], results: [] },
    });

    await client.executeFlexSearch("SELECT {pk} FROM {Product}");

    const [url, body, config] = postSpy.mock.calls[0];
    expect(url).toContain('/hac/console/flexsearch/execute');
    expect(body).toContain('flexibleSearchQuery=');
    expect(config.headers['X-CSRF-TOKEN']).toBe('FLEXSEARCH_CSRF');
  });

  it('returns success=false on FlexibleSearchException', async () => {
    jest.spyOn(client._http, 'post').mockResolvedValue({
      status: 200,
      data: {
        exception: 'de.hybris.platform.servicelayer.search.FlexibleSearchException: Unknown type {Prouct}',
      },
    });

    const result = await client.executeFlexSearch("SELECT {pk} FROM {Prouct}");

    expect(result.success).toBe(false);
    expect(result.error).toContain('FlexibleSearchException');
    expect(result.rows).toEqual([]);
  });

  it('forwards maxCount and locale options', async () => {
    const postSpy = jest.spyOn(client._http, 'post').mockResolvedValue({
      status: 200,
      data:   { resultCount: 0, headers: [], results: [] },
    });

    await client.executeFlexSearch("SELECT {pk} FROM {Product}", {
      maxCount: 10,
      locale:   'fr',
      user:     'customerManager',
    });

    const body = postSpy.mock.calls[0][1];
    expect(body).toContain('maxCount=10');
    expect(body).toContain('locale=fr');
    expect(body).toContain('user=customerManager');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
//  _parseGroovyResponse() – unit
// ─────────────────────────────────────────────────────────────────────────────

describe('HacClient – _parseGroovyResponse()', () => {
  let client;
  beforeEach(() => { client = makeClient(); });

  it('handles plain object with empty stacktrace → success', () => {
    const result = client._parseGroovyResponse({
      executionResult: 'ok',
      outputText:      'printed line',
      stacktraceText:  '',
    });
    expect(result.success).toBe(true);
    expect(result.executionResult).toBe('ok');
    expect(result.outputText).toBe('printed line');
  });

  it('handles non-empty stacktraceText → failure', () => {
    const result = client._parseGroovyResponse({
      executionResult: null,
      outputText:      '',
      stacktraceText:  'groovy.lang.MissingMethodException: boom',
    });
    expect(result.success).toBe(false);
    expect(result.stacktrace).toContain('MissingMethodException');
  });

  it('handles JSON string input', () => {
    const raw = JSON.stringify({
      executionResult: 'done',
      outputText:      '',
      stacktraceText:  '',
    });
    const result = client._parseGroovyResponse(raw);
    expect(result.success).toBe(true);
    expect(result.executionResult).toBe('done');
  });

  it('handles non-JSON string input gracefully', () => {
    const result = client._parseGroovyResponse('plain text output');
    expect(result).toEqual({ success: true, raw: 'plain text output' });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
//  _parseFlexSearchResponse() – unit
// ─────────────────────────────────────────────────────────────────────────────

describe('HacClient – _parseFlexSearchResponse()', () => {
  let client;
  beforeEach(() => { client = makeClient(); });

  it('maps resultCount, headers, rows', () => {
    const result = client._parseFlexSearchResponse({
      resultCount:   3,
      executionTime: 15,
      headers:       ['a', 'b'],
      results:       [['1', 'x'], ['2', 'y'], ['3', 'z']],
    });
    expect(result.success).toBe(true);
    expect(result.resultCount).toBe(3);
    expect(result.headers).toEqual(['a', 'b']);
    expect(result.rows).toHaveLength(3);
  });

  it('returns success=false on exception field', () => {
    const result = client._parseFlexSearchResponse({ exception: 'FlexibleSearchException: bad query' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('FlexibleSearchException');
  });

  it('handles JSON string input', () => {
    const raw = JSON.stringify({ resultCount: 0, headers: [], results: [] });
    const result = client._parseFlexSearchResponse(raw);
    expect(result.success).toBe(true);
    expect(result.rows).toEqual([]);
  });

  it('falls back to results.length when resultCount absent', () => {
    const result = client._parseFlexSearchResponse({
      headers: ['pk'],
      results: [['001'], ['002']],
    });
    expect(result.resultCount).toBe(2);
  });
});
