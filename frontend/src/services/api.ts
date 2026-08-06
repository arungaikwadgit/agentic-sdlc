/**
 * © 2026 Arun Gaikwad. All rights reserved.
 * Proprietary and Confidential â€” Unauthorized use prohibited.
 */
/**
 * Thin client for the Express proxy (OpenAI-backed).
 * Retries once on JSON parse failure.
 */

const API_URL = import.meta.env.VITE_API_URL ?? '/api';
const ADMIN_BYPASS_BEARER = 'admin-local-bypass-token';
// Local-dev-only shared secret fallback (mirrors services/masterDataCatalog.ts).
// Read it dynamically per request so Vite env values supplied at runtime are
// honored consistently and the proxy token still works after hot reloads.
export function getProxyToken(): string {
  const proxyToken = (import.meta.env.VITE_PROXY_TOKEN ?? '').trim();
  if (!proxyToken) return '';

  const hostname = typeof globalThis.location?.hostname === 'string'
    ? globalThis.location.hostname
    : (typeof window !== 'undefined' ? window.location.hostname : '');
  const isLocalHost = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]' || hostname.endsWith('.local');
  const isLocalDevBuild = Boolean(import.meta.env.DEV);

  return isLocalDevBuild && isLocalHost ? proxyToken : '';
}

/** Returns the best available auth header for the current session. */
export async function getAuthHeader(): Promise<Record<string, string>> {
  // Invite sessions are scoped to a single project and must win over any
  // regular/admin owner session until the user explicitly exits invite mode.
  try {
    const { getInviteSession } = await import('@/services/inviteSession');
    const inviteSession = getInviteSession();
    if (inviteSession?.token) {
      console.log('[auth] getAuthHeader: using invite session token');
      return { Authorization: `Bearer invite:${inviteSession.token}` };
    }
  } catch { /* invite session unavailable - fall through */ }

  // Prefer a real Supabase JWT whenever one exists. This is required for all
  // project CRUD calls forwarded to the server/admin API, which rejects local
  // mock admin tokens by design.
  try {
    const { supabase, isSupabaseConfigured } = await import('@/lib/supabase');
    console.log(`[auth] getAuthHeader: isSupabaseConfigured=${isSupabaseConfigured}`);
    if (isSupabaseConfigured) {
      let { data } = await supabase.auth.getSession();
      let jwt = data?.session?.access_token;
      let expiresAt = data?.session?.expires_at;
      const refreshCutoff = Math.floor(Date.now() / 1000) + 60;

      if (data?.session && (!jwt || !expiresAt || expiresAt <= refreshCutoff)) {
        console.log('[auth] getAuthHeader: Supabase session is missing/near expiry - refreshing before API call');
        const refreshed = await supabase.auth.refreshSession();
        data = refreshed.data;
        jwt = data?.session?.access_token;
        expiresAt = data?.session?.expires_at;
      }

      console.log(
        `[auth] getAuthHeader: supabase session ${jwt ? 'FOUND' : 'NOT FOUND'}` +
        (expiresAt ? `, expires_at=${new Date(expiresAt * 1000).toISOString()}` : '')
      );
      if (jwt) return { Authorization: `Bearer ${jwt}` };
    }
  } catch (e) {
    console.log('[auth] getAuthHeader: supabase session lookup threw:', e instanceof Error ? e.message : e);
  }

  // Local development fallback only. This must come after Supabase so stale
  // admin-mode sessionStorage cannot override a valid real login.
  try {
    const { isAdminMode } = await import('@/lib/adminMode');
    if (isAdminMode()) {
      console.log('[auth] getAuthHeader: using admin-bypass bearer token (dev-mode only)');
      return { Authorization: `Bearer ${ADMIN_BYPASS_BEARER}` };
    }
  } catch { /* admin-mode helper unavailable - continue */ }

  console.log('[auth] getAuthHeader: no auth mechanism available - returning empty headers (unauthenticated request)');
  return {};
}
export interface AgentRequest {
  systemPrompt: string;
  userPrompt: string;
  testMode?: boolean;
  /**
   * Explicit provider override — bypasses per-agent routing hints and the
   * default provider. Either a legacy provider literal ('openai'/'claude')
   * or a MODEL_CATALOG entry id (e.g. an admin-assigned Hugging Face model,
   * set via App Settings → AI Providers). The `(string & {})` intersection
   * keeps 'openai'/'claude' autocomplete while still accepting any catalog
   * id string — see resolveDispatchTarget() in backend/src/proxy.js for how
   * this gets classified server-side.
   */
  provider?: 'openai' | 'claude' | (string & {});
  /** Used by the backend for per-agent provider routing hints when `provider` is not set. */
  agentId?: string;
  /**
   * Project this run belongs to. Optional because some callers (app-wide
   * "Test Connection" checks, one-off meta prompts unrelated to a specific
   * project) have no project context at all -- those are left unaffected.
   * When both projectId and agentId ARE present, the backend's
   * authorizeAgentRun() (see backend/src/proxy.js) enforces per-agent
   * access scoping; omitting either one skips that check, so real
   * pipeline/rerun call sites must always pass this.
   */
  projectId?: string;
  /** Optional AbortSignal for request cancellation / timeout (H-06 fix). */
  signal?: AbortSignal;
  /**
   * Output-token cap for this specific call (2026-07-17 — see
   * agents/contextBudget.ts for the matching input-side enforcement). The
   * backend clamps this to [256, 8192] and defaults to 8192 (today's
   * unconditional behavior) when omitted — every existing caller that
   * doesn't set this is unaffected. l3Runtime.ts sets a lower value on
   * intermediate tool-call/plan-revision iterations, where the response is
   * structurally a short marker + small JSON/step list, never the full
   * deliverable.
   */
  maxTokens?: number;
}

// OpenAI chat completion response shape
export interface AgentResponse {
  choices: Array<{
    message: { role: string; content: string };
    finish_reason: string;
  }>;
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
  /**
   * Echoed back by the proxy: which provider actually served this request.
   * 'openai-compatible' means a MODEL_CATALOG entry (e.g. Hugging Face)
   * served it — see dispatchAgentCall() in backend/src/proxy.js.
   */
  provider?: 'openai' | 'claude' | 'openai-compatible';
  /** Echoed back by the proxy: which model actually served this request. */
  model?: string;
  /** Token Optimizer preflight metrics for this provider call. */
  promptOptimization?: {
    applied: boolean;
    skillId: string;
    skillVersion: number;
    strategy?: string;
    reason?: string;
    charactersBefore: number;
    charactersAfter: number;
    estimatedTokensBefore: number;
    estimatedTokensAfter: number;
    estimatedTokensSaved: number;
    estimatedReductionPercent?: number;
  };
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));


/**
 * Turn a raw HTTP error response (which may be HTML, JSON, or plain text) into
 * a short, human-readable error string suitable for display in the UI.
 */
function parseErrorDetail(status: number, raw: string): string {
  // 1. Try JSON â€” structured errors from our own APIs look like { error: "..." }
  if (raw.trim().startsWith('{')) {
    try {
      const json = JSON.parse(raw) as Record<string, unknown>;
      const msg = (json.error ?? json.message ?? json.detail) as string | undefined;
      if (typeof msg === 'string' && msg.length > 0) {
        return `${status}: ${msg}`;
      }
    } catch { /* fall through */ }
  }

  // 2. Strip HTML â€” Express default error pages, nginx 502s, etc.
  if (/<[a-z]/i.test(raw)) {
    // Pull text out of <pre> or <p> tags first (most useful in Express errors)
    const preMatch = raw.match(/<pre[^>]*>([\s\S]*?)<\/pre>/i);
    const pMatch   = raw.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
    const candidate = (preMatch?.[1] ?? pMatch?.[1] ?? raw)
      .replace(/<[^>]+>/g, ' ')           // strip remaining tags
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\s+/g, ' ')              // collapse whitespace
      .trim()
      .slice(0, 200);                     // cap length
    return candidate.length > 0 ? `${status}: ${candidate}` : `HTTP ${status}`;
  }

  // 3. Plain text â€” trim and cap
  const trimmed = raw.trim().slice(0, 200);
  return trimmed.length > 0 ? `${status}: ${trimmed}` : `HTTP ${status}`;
}

async function callAgent(req: AgentRequest, attempt = 1): Promise<AgentResponse> {
  // Diagnostic logging (temporary) â€” see getAuthHeader() above. Traces the
  // full request lifecycle for Test Connection / agent calls without ever
  // logging secret values (API keys, JWTs).
  console.log(`[callAgent] attempt=${attempt} provider=${req.provider ?? '(default)'} agentId=${req.agentId ?? '(none)'} testMode=${!!req.testMode}`);
  const authHeaders = await getAuthHeader();
  const proxyToken = getProxyToken();
  console.log(
    `[callAgent] Authorization header ${authHeaders.Authorization ? 'PRESENT' : 'ABSENT'}; ` +
    `X-API-Token fallback ${(!authHeaders.Authorization && proxyToken) ? 'will be used' : 'not used'}`
  );
  const res = await fetch(`${API_URL}/agents/call`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders,
      // Local-dev fallback: when there's no Supabase session / admin-mode / invite
      // session (so getAuthHeader() returned {}), attach the shared PROXY_TOKEN the
      // same way fetchMasterCatalog() already does. Without this, every /api/agents/call
      // in that state hits the proxy's checkToken 401 path, which the UI reports as
      // "Authentication failed" even when the OpenAI/Anthropic key itself is fine.
      ...(!authHeaders.Authorization && proxyToken ? { 'X-API-Token': proxyToken } : {}),
    },
    body: JSON.stringify(req),
    // H-06 fix: thread through caller-supplied AbortSignal for timeout/cancel support
    signal: req.signal,
  });
  console.log(`[callAgent] response status=${res.status}`);

  // 429 Too Many Requests â€” back off and retry up to 4 times
  if (res.status === 429 && attempt <= 4) {
    // Honour Retry-After header if present, otherwise exponential back-off
    const retryAfter = res.headers.get('Retry-After');
    const waitMs = retryAfter
      ? parseFloat(retryAfter) * 1000
      : Math.min(2000 * 2 ** (attempt - 1), 30_000); // 2s, 4s, 8s, 16s
    await sleep(waitMs);
    return callAgent(req, attempt + 1);
  }

  if (!res.ok) {
    const raw = await res.text().catch(() => '');
    const detail = parseErrorDetail(res.status, raw);
    throw new Error(detail);
  }

  let data: AgentResponse;
  try {
    data = await res.json();
  } catch (e) {
    if (attempt < 2) {
      return callAgent(req, 2);
    }
    throw new Error(`JSON parse failed: ${String(e)}`);
  }

  return data;
}

export function extractText(resp: AgentResponse): string {
  return resp.choices?.[0]?.message?.content ?? '';
}

/**
 * Ask the model to rewrite/enhance an agent's system prompt for clarity,
 * specificity, and output quality. Returns the improved prompt as plain text
 * (no markdown fences, no commentary) so it can be dropped straight into the
 * prompt textarea for further editing.
 */
async function enhancePrompt(currentPrompt: string, agentName?: string): Promise<string> {
  const metaSystemPrompt = [
    'You are an expert prompt engineer.',
    'You will be given the system prompt for an AI agent that produces a software-delivery document (e.g. requirements, architecture, test plans).',
    'Rewrite and improve this system prompt to make it clearer, more specific, and more likely to produce a high-quality, well-structured markdown document.',
    'Preserve the original intent, role, and output format of the prompt â€” do not change what the agent is fundamentally responsible for.',
    'You may: tighten wording, add missing structure or sections, clarify formatting expectations, add useful constraints (e.g. consistency, completeness, professional tone).',
    'Respond with ONLY the rewritten system prompt as plain text. Do not wrap it in markdown code fences, do not add commentary, explanations, or a preamble.',
  ].join(' ');

  const userPrompt = [
    agentName ? `Agent: ${agentName}` : null,
    'Current system prompt:',
    '"""',
    currentPrompt,
    '"""',
  ].filter(Boolean).join('\n\n');

  const resp = await callAgent({ systemPrompt: metaSystemPrompt, userPrompt });
  let text = extractText(resp).trim();

  // Strip accidental code fences if the model adds them anyway
  if (text.startsWith('```')) {
    text = text.replace(/^```[a-z]*\n?/i, '').replace(/```$/, '').trim();
  }

  return text;
}

// Branding signals extracted from a live site by the backend's /api/fetch-site
export type LlmProvider = 'openai' | 'claude';

export interface ProviderTestResult {
  ok: boolean;
  servedBy?: LlmProvider;
  model?: string;
  fellBack?: boolean;
  sample?: string;
  error?: string;
}

/**
 * Convert a raw error string into a short, user-friendly message â€” strips
 * stack traces, internal file paths, and HTML before classifying the error.
 */
function friendlyConnectionError(raw: string): string {
  const stripped = raw
    .replace(/([A-Z]:\\|\/[a-z]+\/)[\w\\/.\-]+(\.js|\.ts)(:\d+)?(:\d+)?/g, '')
    .replace(/at\s+\S+\s+\([^)]+\)/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();

  const lower = stripped.toLowerCase();

  if (lower.includes('invalid or expired session'))
    return 'Your login session expired. Sign in again, then retry Test Connection.';
  if (lower.includes('authentication required. please sign in'))
    return 'You must be signed in before Test Connection can call the backend proxy.';
  if (lower.includes('401: unauthorized') || lower === 'unauthorized' || lower.endsWith(': unauthorized'))
    return 'Proxy authentication failed. This is usually a backend session/proxy auth issue, not an OpenAI key issue.';
  if (lower.includes('cors') || lower.includes('not allowed'))
    return "Cannot reach the proxy server. Check that the backend is running and ALLOWED_ORIGINS includes this app's URL.";
  if (lower.includes('failed to fetch') || lower.includes('networkerror') || lower.includes('econnrefused'))
    return 'Network error — the proxy server is not reachable. Make sure it is running on the expected port.';
  if (lower.includes('503') || lower.includes('not reachable') || lower.includes('not running'))
    return 'Backend server is not running. Start it with: cd server && npm run dev';
  if (lower.includes('404') || lower.includes('not found'))
    return 'Backend server is not running or the API route is missing. Start it with: cd server && npm run dev';
  if (
    (lower.includes('401') || lower.includes('unauthorized')) &&
    (lower.includes('api key') || lower.includes('openai') || lower.includes('anthropic'))
  )
    return 'Authentication failed — check that your API key is correct and has not expired.';
  if (lower.includes('403') || lower.includes('forbidden'))
    return 'Access denied — your API key does not have permission for this model or endpoint.';
  if (lower.includes('429') || lower.includes('rate limit') || lower.includes('too many'))
    return 'Rate limit reached â€” too many requests. Wait a moment then try again.';
  if (lower.includes('500') || lower.includes('internal server'))
    return 'The proxy server returned an internal error. Check backend logs for details.';
  if (lower.includes('502') || lower.includes('504'))
    return 'The server is temporarily unavailable. Try again in a moment.';
  if (lower.includes('timeout') || lower.includes('aborted') || lower.includes('abort'))
    return 'The request timed out. The server may be overloaded â€” try again.';
  if (lower.includes('json') || lower.includes('parse'))
    return 'Received an unexpected response from the server. Check that the proxy URL is correct.';

  return stripped.slice(0, 150) || 'Connection failed. Check your settings and try again.';
}

async function testProviderConnection(provider: LlmProvider): Promise<ProviderTestResult> {
  try {
    const resp = await callAgent({
      systemPrompt: 'You are a connectivity test. Reply with exactly: OK',
      userPrompt: 'Reply with exactly: OK',
      provider,
    });
    const sample = extractText(resp).trim().slice(0, 120);
    if (!resp.provider) {
      return { ok: sample.length > 0, sample, error: sample.length > 0 ? undefined : 'Empty response from proxy.' };
    }
    return { ok: true, servedBy: resp.provider as LlmProvider, model: resp.model, fellBack: resp.provider !== provider, sample };
  } catch (e) {
    const raw = e instanceof Error ? e.message : String(e);
    return { ok: false, error: friendlyConnectionError(raw) };
  }
}

export interface GenerateDomainKnowledgeRequest {
  domainLabel: string;
  domainTemplate: string;
  projectName: string;
  projectDescription: string;
  currentInput: string;
}

async function generateDomainKnowledge(req: GenerateDomainKnowledgeRequest): Promise<string | null> {
  const systemPrompt =
    'You are an expert in the ' + req.domainLabel + ' domain. ' +
    'Your task is to provide a complete, practical, and structured overview of domain knowledge for ' + req.domainLabel + '. ' +
    'Use plain language but be precise. Assume the reader is new to the domain but technically capable. ' +
    'If anything is uncertain, state assumptions clearly rather than guessing. ' +
    'Format your response with ## section headers exactly matching the structure requested. ' +
    'Be specific and actionable â€” this knowledge will be injected directly into AI agent prompts ' +
    'to help them produce accurate, domain-appropriate SDLC documents.';

  const userPrompt = [
    'Project: ' + req.projectName,
    'Description: ' + req.projectDescription,
    'Domain: ' + req.domainLabel,
    '',
    'Provide a complete domain knowledge brief covering ALL of the following sections:',
    '',
    '## 1. Executive Summary',
    'A concise 2-3 paragraph overview of the domain.',
    '',
    '## 2. Definition and Scope',
    'What the domain covers, its boundaries, and what is out of scope.',
    '',
    '## 3. Core Business Processes and Workflows',
    'The main end-to-end processes, step by step.',
    '',
    '## 4. Key Roles, Stakeholders, and Responsibilities',
    'Who does what in this domain.',
    '',
    '## 5. Important Terminology and Concepts',
    'Domain-specific language a team member must know.',
    '',
    '## 6. Common Systems, Tools, and Integrations',
    'Typical software, platforms, and third-party services used.',
    '',
    '## 7. Standard Data Entities and Business Rules',
    'Core data objects (e.g. Order, Customer, Invoice) and the rules that govern them.',
    '',
    '## 8. Typical Customer / User Journeys',
    'Key user flows and touchpoints.',
    '',
    '## 9. Major Risks, Exceptions, and Edge Cases',
    'What goes wrong, and how it is handled.',
    '',
    '## 10. Industry KPIs, Metrics, and Success Measures',
    'How performance is measured in this domain.',
    '',
    '## 11. Compliance, Security, and Regulatory Considerations',
    'Laws, standards, certifications, and data protection requirements (if applicable).',
    '',
    '## 12. Common Pain Points and Operational Challenges',
    'Recurring problems teams face in this domain.',
    '',
    '## 13. Domain-Specific Best Practices',
    'What high-performing teams do differently.',
    '',
    '## 14. Real-World Use Cases',
    'Concrete examples of how this domain operates in practice.',
    '',
    '## 15. Glossary of Essential Terms',
    'A table of key terms and their definitions.',
    '',
    '## 16. Common Interview Questions and Answers',
    'A list of Q&A pairs someone should know to demonstrate domain competency.',
    '',
    '## 17. Competency Checklist',
    'A checklist of what someone must know/do to be considered competent in this domain.',
    '',
    '## 18. Subdomains and Industry Variants',
    'Related subdomains, industry-specific variants, and niche areas.',
    '',
    '## 19. Common System Failure Scenarios',
    'Typical failure modes, what causes them, and how they are resolved.',
    '',
    '## 20. Questions to Ask Domain Experts',
    'Validation questions to ask subject-matter experts to fill knowledge gaps.',
    '',
    req.currentInput ? ('Existing knowledge to enhance or replace:\n' + req.currentInput) : '',
  ].filter(s => s !== null).join('\n');

  const resp = await callAgent({ systemPrompt, userPrompt });
  const text = extractText(resp).trim();
  return text.length > 0 ? text : null;
}

export interface SiteBrandingSignals {
  url: string;
  title: string | null;
  description: string | null;
  themeColor: string | null;
  ogTags: Record<string, string>;
  cssVars: string[];
  googleFonts: string[];
  colorsFound: string[];
  styleSampleChars: string;
}

/**
 * Fetches a live page's HTML via the backend proxy and extracts a compact
 * set of branding signals (title, meta tags, theme-color, CSS custom
 * properties, Google Fonts, hex colors, and a sample of inline CSS).
 * This is a static HTML scan â€” it does not execute JavaScript, so
 * fully client-rendered sites may yield sparse results.
 */
async function fetchSiteBranding(url: string): Promise<SiteBrandingSignals> {
  const res = await fetch(`${API_URL}/fetch-site`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(await getAuthHeader()),
    },
    body: JSON.stringify({ url }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    let message = `Failed to fetch site (${res.status})`;
    try {
      const parsed = JSON.parse(detail);
      if (parsed?.error) message = parsed.error;
    } catch {
      // ignore â€” use default message
    }
    throw new Error(message);
  }

  return res.json();
}

/**
 * Generates a structured Branding Guidelines brief.
 *
 * If `url` is provided, the backend fetches that page's HTML and the
 * extracted branding signals (colors, fonts, meta tags, inline CSS) are
 * given to the model as ground truth so it can describe the site's actual
 * visual identity rather than guessing from training data. Sites that are
 * fully client-rendered (no server HTML/CSS) may yield sparse signals â€”
 * in that case the model is told to say so explicitly rather than invent
 * details.
 *
 * If `url` is omitted, the model expands the free-text `notes` into a
 * structured brief using general design knowledge (same pattern as
 * generateDomainKnowledge) â€” no live fetch occurs.
 */
async function generateBrandingGuidelines(opts: {
  projectName: string;
  projectDescription?: string;
  notes?: string;
  url?: string;
}): Promise<{ brief: string; signals?: SiteBrandingSignals }> {
  const { projectName, projectDescription, notes, url } = opts;

  let signals: SiteBrandingSignals | undefined;
  if (url?.trim()) {
    signals = await fetchSiteBranding(url.trim());
  }

  const metaSystemPrompt = signals
    ? [
        'You are a senior brand and UI designer. You will be given raw branding signals extracted from the HTML/CSS of a live website (colors, fonts, meta tags, theme color, inline styles).',
        'Your job is to write a "Branding Guidelines" brief for a software project that wants its UI to match this site\'s visual identity. This brief will be given to a UX/UI design agent to guide its design concepts.',
        '',
        'Requirements:',
        '1. Start with a section "## Source & Confidence" stating the URL analyzed, and being explicit about which details below are directly evidenced by the extracted signals versus inferred/estimated. If the extracted signals are sparse (e.g. the site is heavily JavaScript-rendered and little CSS/color data was found), say so plainly and note that the brief is a best-effort estimate.',
        '2. Then provide structured sections: ## Color Palette (list concrete hex values from the signals where available, with a likely role for each â€” primary, secondary, background, accent, text), ## Typography (font families found, with fallbacks), ## Tone & Voice (inferred from the page title/description/og tags), and ## Layout & Style Notes (any spacing, border-radius, or visual style patterns evident from the inline CSS sample).',
        '3. Do NOT invent specific hex codes or font names that are not present in the provided signals. If you need to recommend something not directly evidenced, clearly label it as a recommendation, not an extracted fact.',
        '4. Output ONLY the markdown brief. No commentary, no preamble, no code fences.',
      ].join('\n')
    : [
        'You are a senior brand and UI designer. Expand the user\'s notes into a structured "Branding Guidelines" brief for a software project, to guide a UX/UI design agent.',
        '',
        'Requirements:',
        '1. Start with a section "## Assumptions & Open Questions" listing anything you assumed due to missing detail, and questions the user should confirm.',
        '2. Then provide structured sections: ## Color Palette, ## Typography, ## Tone & Voice, and ## Layout & Style Notes.',
        '3. Be concrete (e.g. suggest specific hex codes and font names) but clearly label suggestions as recommendations, not facts about any specific brand, unless the user named a well-known brand/product whose identity is common knowledge.',
        '4. Output ONLY the markdown brief. No commentary, no preamble, no code fences.',
      ].join('\n');

  const userPromptParts = signals
    ? [
        `Project name: ${projectName}`,
        projectDescription ? `Project description: ${projectDescription}` : null,
        `Source URL: ${signals.url}`,
        `Page title: ${signals.title ?? '(none found)'}`,
        `Meta description: ${signals.description ?? '(none found)'}`,
        `Theme color meta tag: ${signals.themeColor ?? '(none found)'}`,
        Object.keys(signals.ogTags).length ? `Open Graph tags: ${JSON.stringify(signals.ogTags)}` : 'Open Graph tags: (none found)',
        signals.cssVars.length ? `CSS custom properties found:\n${signals.cssVars.join('\n')}` : 'CSS custom properties: (none found)',
        signals.googleFonts.length ? `Google Fonts referenced: ${signals.googleFonts.join(', ')}` : 'Google Fonts referenced: (none found)',
        signals.colorsFound.length ? `Hex colors found in markup/CSS: ${signals.colorsFound.join(', ')}` : 'Hex colors found in markup/CSS: (none found)',
        signals.styleSampleChars ? `Sample of inline <style> CSS (truncated):\n"""\n${signals.styleSampleChars}\n"""` : 'Inline <style> CSS: (none found)',
        notes?.trim() ? `Additional notes from the project team: ${notes.trim()}` : null,
      ].filter(Boolean)
    : [
        `Project name: ${projectName}`,
        projectDescription ? `Project description: ${projectDescription}` : null,
        `Notes from the project team:\n"""\n${(notes ?? '').trim()}\n"""`,
      ].filter(Boolean);

  const resp = await callAgent({ systemPrompt: metaSystemPrompt, userPrompt: userPromptParts.join('\n\n') });
  let text = extractText(resp).trim();

  if (text.startsWith('```')) {
    text = text.replace(/^```[a-z]*\n?/i, '').replace(/```$/, '').trim();
  }

  return { brief: text, signals };
}

// â”€â”€ GitHub integration â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export interface GithubConnectionParams {
  token: string;
  owner: string;
  repo: string;
}

export interface GithubTestResult {
  ok: boolean;
  message: string;
}

/** Verifies a GitHub PAT can read the configured owner/repo. Routed through the backend (CORS). */
async function testGithubConnection(params: GithubConnectionParams): Promise<GithubTestResult> {
  const res = await fetch(`${API_URL}/github/test`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(await getAuthHeader()),
    },
    body: JSON.stringify(params),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    let message = `Connection check failed (${res.status})`;
    try {
      const parsed = JSON.parse(detail);
      if (parsed?.error) message = parsed.error;
    } catch {
      // ignore â€” use default message
    }
    return { ok: false, message };
  }

  return res.json();
}

export interface GithubIssueDraft {
  title: string;
  body?: string;
  labels?: string[];
}

export interface GithubIssueResult {
  title: string;
  ok: boolean;
  number?: number;
  url?: string;
  error?: string;
}

export interface GithubPushResult {
  created: number;
  total: number;
  results: GithubIssueResult[];
}

/** Creates issues in the configured GitHub repo. Routed through the backend (CORS + token safety). */
async function pushIssuesToGithub(params: GithubConnectionParams & { issues: GithubIssueDraft[] }): Promise<GithubPushResult> {
  const res = await fetch(`${API_URL}/github/issues`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(await getAuthHeader()),
    },
    body: JSON.stringify(params),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    let message = `Failed to push issues (${res.status})`;
    try {
      const parsed = JSON.parse(detail);
      if (parsed?.error) message = parsed.error;
    } catch {
      // ignore â€” use default message
    }
    throw new Error(message);
  }

  return res.json();
}

export const api = {
  callAgent,
  extractText,
  enhancePrompt,
  testProviderConnection,
  generateDomainKnowledge,
  fetchSiteBranding,
  generateBrandingGuidelines,
  testGithubConnection,
  pushIssuesToGithub,
};
