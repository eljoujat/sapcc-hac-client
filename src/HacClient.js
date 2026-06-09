'use strict';

const axios   = require('axios');
const https   = require('https');
const cheerio = require('cheerio');

/**
 * HacClient – Hybris Administration Console client.
 *
 * Gère le flux d'authentification Spring Security en 3 étapes :
 *   1. GET  /hac/                          → cookies initiaux (JSESSIONID, ROUTE) + CSRF meta
 *   2. POST /hac/j_spring_security_check   → session authentifiée
 *   3. GET  /hac/console/<X>               → CSRF frais avant chaque opération
 *   4. POST /hac/console/<X>               → exécution du script / de la requête
 *
 * Les cookies sont gérés manuellement (pas de dépendance axios-cookiejar-support).
 */
class HacClient {
  /**
   * @param {object}  config
   * @param {string}  config.hacUrl      - URL de base du HAC (sans slash final)
   * @param {string}  config.username    - Utilisateur HAC
   * @param {string}  config.password    - Mot de passe HAC
   * @param {boolean} [config.ignoreSSL=false]
   * @param {number}  [config.timeout=30000]
   */
  constructor(config) {
    // Normalise l'URL : retire le slash final ET /hac s'il est déjà inclus
    // Ex: https://backoffice.xxx.com/hac  →  https://backoffice.xxx.com
    //     https://backoffice.xxx.com/     →  https://backoffice.xxx.com
    this.hacUrl   = config.hacUrl.replace(/\/$/, '').replace(/\/hac$/, '');
    this.username = config.username;
    this.password = config.password;
    this.timeout  = config.timeout || 30000;

    this._authenticated = false;
    this._cookies       = {};   // stockage simple : nom → valeur
    this._debug         = process.env.HAC_DEBUG === 'true';

    this._http = axios.create({
      timeout:        this.timeout,
      maxRedirects:   10,   // pour les appels hors login
      validateStatus: () => true,   // on gère les codes HTTP nous-mêmes
      ...(config.ignoreSSL && {
        httpsAgent: new https.Agent({ rejectUnauthorized: false }),
      }),
    });
  }

  // ─────────────────────────────────────────────
  //  API publique
  // ─────────────────────────────────────────────

  /**
   * Exécute un script Groovy via /hac/console/scripting/execute
   *
   * @param {string}  script
   * @param {object}  [opts]
   * @param {boolean} [opts.commit=false]         - Committer la transaction DB
   * @param {string}  [opts.scriptType='groovy']  - 'groovy' | 'beanshell'
   * @returns {Promise<GroovyResult>}
   */
  async executeGroovy(script, { commit = false, scriptType = 'groovy' } = {}) {
    await this._ensureAuthenticated();

    const pagePath    = '/hac/console/scripting';          // GET → page HTML avec le CSRF
    const executePath = '/hac/console/scripting/execute';  // POST → exécution
    const csrf = await this._getCsrfToken(pagePath);

    const body = new URLSearchParams({ script, scriptType, commit: String(commit) });

    const response = await this._post(`${this.hacUrl}${executePath}`, body.toString(), {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept':       'application/json',
      'X-CSRF-TOKEN': csrf,
    });

    this._assertSuccess(response, executePath);
    return this._parseGroovyResponse(response.data);
  }

  /**
   * Exécute une requête FlexibleSearch via /hac/console/flexiblesearch/execute
   *
   * @param {string}  query
   * @param {object}  [opts]
   * @param {number}  [opts.maxCount=200]
   * @param {string}  [opts.user='admin']
   * @param {string}  [opts.locale='en']
   * @returns {Promise<FlexSearchResult>}
   */
  async executeFlexSearch(query, { maxCount = 200, user = 'admin', locale = 'en' } = {}) {
    await this._ensureAuthenticated();

    const pagePath    = '/hac/console/flexsearch';         // GET → page HTML avec le CSRF
    const executePath = '/hac/console/flexsearch/execute'; // POST → exécution
    const csrf = await this._getCsrfToken(pagePath);

    const body = new URLSearchParams({
      flexibleSearchQuery: query,
      maxCount:            String(maxCount),
      user,
      locale,
    });

    const response = await this._post(`${this.hacUrl}${executePath}`, body.toString(), {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept':       'application/json',
      'X-CSRF-TOKEN': csrf,
    });

    this._assertSuccess(response, executePath);
    return this._parseFlexSearchResponse(response.data);
  }

  /** Force une re-authentification (réinitialise la session). */
  async reconnect() {
    this._authenticated = false;
    this._cookies = {};
    await this.authenticate();
  }

  // ─────────────────────────────────────────────
  //  Authentification
  // ─────────────────────────────────────────────

  async authenticate() {
    // Étape 1 – GET direct sur /hac/login pour avoir le CSRF du formulaire de login
    //   (GET /hac/ retourne parfois une page générique dont le CSRF n'est pas accepté
    //    par j_spring_security_check)
    const loginPageUrl = `${this.hacUrl}/hac/login`;
    this._log(`authenticate() → GET ${loginPageUrl}`);

    const initRes = await this._get(loginPageUrl, { Accept: 'text/html' });
    this._log(`  status=${initRes.status}  cookies=${JSON.stringify(this._cookies)}`);

    const csrf = this._extractCsrf(initRes.data);
    if (!csrf) {
      throw new Error(
        '[HacClient] Impossible d\'extraire le token CSRF depuis la page HAC. ' +
        'Vérifiez que HAC_URL est correct et accessible.'
      );
    }
    this._log(`  csrf=${csrf}`);

    // Étape 2 – POST des credentials SANS suivre la redirection
    //   Spring Security répond par un 302 :
    //     - vers /hac/        si login OK (nouveau JSESSIONID dans Set-Cookie)
    //     - vers /hac/login   si login KO (JSESSIONID inchangé ou absent)
    const loginBody = new URLSearchParams({
      j_username: this.username,
      j_password: this.password,
      _csrf:      csrf,
    });

    const origin = new URL(this.hacUrl).origin;
    this._log(`authenticate() → POST ${this.hacUrl}/hac/j_spring_security_check (maxRedirects:0)`);
    this._log(`  body=j_username=${this.username}&j_password=***&_csrf=${csrf.substring(0,12)}...`);
    const loginRes = await this._http.post(
      `${this.hacUrl}/hac/j_spring_security_check`,
      loginBody.toString(),
      {
        maxRedirects: 0,
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'X-CSRF-TOKEN': csrf,
          'Referer':      loginPageUrl,
          'Origin':       origin,
          'Cookie':        this._cookieHeader(),
        },
      }
    );

    // Capture des nouveaux cookies depuis la réponse 302
    this._updateCookies(loginRes);
    const location = loginRes.headers?.location || '';
    this._log(`  login status=${loginRes.status}  location=${location}  cookies=${JSON.stringify(this._cookies)}`);

    // Si la redirection revient vers /login → credentials ou CSRF invalides
    if (location.includes('/login')) {
      // Essai de lire le message d'erreur Spring Security
      const hint = loginRes.headers['x-auth-token'] ||
        (location.includes('error')      ? 'mauvais identifiants'  :
         location.includes('locked')     ? 'compte verrouillé'     :
         location.includes('disabled')   ? 'compte désactivé'      :
         'vérifiez HAC_USERNAME / HAC_PASSWORD');
      throw new Error(
        `[HacClient] Authentification échouée – ${hint}.`
      );
    }

    // Étape 3 – suivre manuellement la redirection pour vérifier la session
    const targetUrl = location
      ? (location.startsWith('http') ? location : `${this.hacUrl}${location}`)
      : `${this.hacUrl}/hac/`;

    this._log(`authenticate() → GET ${targetUrl} (vérification session)`);
    const checkRes = await this._get(targetUrl, { Accept: 'text/html' });
    this._log(`  check status=${checkRes.status}  isLoginPage=${this._isLoginPage(checkRes.data)}`);

    if (this._isLoginPage(checkRes.data)) {
      throw new Error(
        '[HacClient] Authentification échouée – credentials refusés par le HAC.'
      );
    }

    this._authenticated = true;
  }

  async _ensureAuthenticated() {
    if (!this._authenticated) {
      await this.authenticate();
    }
  }

  /**
   * GET une page console pour extraire un CSRF token frais.
   */
  /**
   * Pages candidates pour extraire un CSRF token (ordre de préférence).
   * Le CSRF Spring Security est scope-session : le même token est valide
   * pour toutes les opérations (scripting ET flexiblesearch).
   */
  static get CSRF_CANDIDATE_PAGES() {
    return [
      '/hac/console/scripting',
      '/hac/console/flexsearch',
      '/hac/console/flexiblesearch',
      '/hac/',
    ];
  }

  async _getCsrfToken(preferredPath) {
    // Liste des pages à essayer : preferred en premier, puis les candidates
    const candidates = [
      preferredPath,
      ...HacClient.CSRF_CANDIDATE_PAGES.filter(p => p !== preferredPath),
    ];

    for (const path of candidates) {
      this._log(`_getCsrfToken → GET ${this.hacUrl}${path}`);
      const res = await this._get(`${this.hacUrl}${path}`, { Accept: 'text/html' });
      this._log(`  status=${res.status}  contentType=${res.headers?.['content-type']}`);

      if (res.status === 404 || res.status === 405) {
        this._log(`  skip (${res.status})`);
        continue;
      }

      // Session expirée → re-authentification transparente
      if (this._isLoginPage(res.data)) {
        this._log(`_getCsrfToken: session expirée, re-auth...`);
        this._authenticated = false;
        this._cookies = {};
        await this.authenticate();
        // Réessaie depuis le début après re-auth
        return this._getCsrfToken(preferredPath);
      }

      const csrf = this._extractCsrf(res.data);
      this._log(`  csrf=${csrf ? csrf.substring(0, 16) + '...' : 'null'}`);

      if (csrf) return csrf;
      this._log(`  no CSRF on ${path}, trying next candidate...`);
    }

    throw new Error(
      `[HacClient] Impossible d'extraire le CSRF (essayé: ${candidates.join(', ')}).`
    );
  }

  // ─────────────────────────────────────────────
  //  Gestion manuelle des cookies
  // ─────────────────────────────────────────────

  /** Extrait et stocke les cookies depuis les headers Set-Cookie. */
  _updateCookies(response) {
    const setCookie = response.headers?.['set-cookie'];
    if (!setCookie) return;
    const list = Array.isArray(setCookie) ? setCookie : [setCookie];
    list.forEach((entry) => {
      const match = entry.match(/^([^=]+)=([^;]*)/);
      if (match) {
        this._cookies[match[1].trim()] = match[2].trim();
      }
    });
  }

  /** Construit le header Cookie depuis le store interne. */
  _cookieHeader() {
    return Object.entries(this._cookies)
      .map(([k, v]) => `${k}=${v}`)
      .join('; ');
  }

  async _get(url, extraHeaders = {}) {
    const res = await this._http.get(url, {
      headers: { Cookie: this._cookieHeader(), ...extraHeaders },
    });
    this._updateCookies(res);
    return res;
  }

  async _post(url, body, extraHeaders = {}) {
    const res = await this._http.post(url, body, {
      headers: { Cookie: this._cookieHeader(), ...extraHeaders },
    });
    this._updateCookies(res);
    return res;
  }

  // ─────────────────────────────────────────────
  //  Debug
  // ─────────────────────────────────────────────

  _log(msg) {
    if (this._debug) process.stderr.write(`[HAC DEBUG] ${msg}\n`);
  }

  // ─────────────────────────────────────────────
  //  Parsers HTML / réponse
  // ─────────────────────────────────────────────

  _extractCsrf(html) {
    const $ = cheerio.load(html);
    return (
      $('meta[name="_csrf"]').attr('content') ||
      $('input[name="_csrf"]').attr('value')  ||
      null
    );
  }

  _isLoginPage(html) {
    return (
      html.includes('j_spring_security_check') ||
      html.includes('j_username')              ||
      html.includes('loginForm')
    );
  }

  _assertSuccess(response, path) {
    if (response.status < 200 || response.status >= 400) {
      throw new Error(`[HacClient] HTTP ${response.status} inattendu depuis ${path}`);
    }
  }

  _parseGroovyResponse(data) {
    if (typeof data === 'string') {
      try { data = JSON.parse(data); } catch { return { success: true, raw: data }; }
    }
    const stacktrace = data.stacktraceText ?? '';
    const hasError   =
      (typeof stacktrace === 'string' && stacktrace.trim().length > 0) ||
      (data.executionResult != null && String(data.executionResult).startsWith('groovy.lang.MissingMethodException'));
    return {
      success:         !hasError,
      executionResult: data.executionResult ?? null,
      outputText:      data.outputText      ?? null,
      stacktrace:      stacktrace,
    };
  }

  _parseFlexSearchResponse(data) {
    if (typeof data === 'string') {
      try { data = JSON.parse(data); } catch { return { success: true, raw: data }; }
    }
    // Le HAC renvoie exception=null en succès, objet/string en erreur
    if (data.exception != null) {
      const ex  = data.exception;
      const msg = typeof ex === 'string'
        ? ex
        : (ex?.message || ex?.localizedMessage || ex?.detailMessage ||
           JSON.stringify(ex).substring(0, 300));
      return { success: false, error: msg, headers: [], rows: [] };
    }
    // résultat : clé 'resultList' dans les versions récentes du HAC, 'results' en fallback
    const rows = data.resultList ?? data.results ?? [];
    return {
      success:       true,
      resultCount:   data.resultCount   ?? rows.length,
      executionTime: data.executionTime ?? null,
      headers:       data.headers       ?? [],
      rows,
    };
  }
}

module.exports = HacClient;
