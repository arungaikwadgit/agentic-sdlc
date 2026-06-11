/**
 * Thin client for the Express proxy (OpenAI-backed).
 * Retries once on JSON parse failure.
 */

const API_URL = import.meta.env.VITE_API_URL ?? '/api';
const PROXY_TOKEN = import.meta.env.VITE_PROXY_TOKEN ?? '';

export interface AgentRequest {
  systemPrompt: string;
  userPrompt: string;
  testMode?: boolean;
}

// OpenAI chat completion response shape
export interface AgentResponse {
  choices: Array<{
    message: { role: string; content: string };
    finish_reason: string;
  }>;
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}

async function callAgent(req: AgentRequest, attempt = 1): Promise<AgentResponse> {
  const res = await fetch(`${API_URL}/agent`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Token': PROXY_TOKEN,
    },
    body: JSON.stringify(req),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`API error ${res.status}: ${detail}`);
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
    'Preserve the original intent, role, and output format of the prompt — do not change what the agent is fundamentally responsible for.',
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

/**
 * Ask the model to act as a domain expert and produce a comprehensive,
 * detailed, reusable Domain Knowledge brief for the project's Knowledge tab.
 * This brief is prepended to every agent's system prompt as domain context,
 * so it should be thorough, well-structured, and project-specific (not generic).
 *
 * Note: this calls the standard OpenAI Chat Completions endpoint via the proxy —
 * it does not have live internet access. "Thorough research" here means the
 * model draws deeply on its trained knowledge of the domain, not real-time
 * web lookups.
 *
 * If the current input is sparse, the model is instructed to make explicit,
 * clearly-labeled assumptions (rather than asking back-and-forth questions,
 * which this single-shot UI can't support) and list open questions for the
 * user to confirm/edit at the top of the output.
 */
async function generateDomainKnowledge(opts: {
  domainLabel: string;
  domainTemplate?: string;
  projectName: string;
  projectDescription?: string;
  currentInput?: string;
}): Promise<string> {
  const { domainLabel, domainTemplate, projectName, projectDescription, currentInput } = opts;

  const metaSystemPrompt = [
    `You are a senior ${domainLabel} domain consultant and solutions architect with deep, current expertise in this industry's regulations, architecture patterns, integration ecosystems, and operational standards.`,
    'You are writing a "Domain Knowledge Brief" that will be saved to a software project and prepended to the system prompt of every AI agent (requirements, architecture, design, development, QA) working on that project. It must give those agents enough grounded, specific context to produce domain-correct outputs without further research.',
    '',
    'Requirements for your response:',
    '1. Begin with a section titled "## Assumptions & Open Questions" — a short bullet list of any assumptions you made about the project (target users, scale, geography, regulatory scope, etc.) due to missing information, and any clarifying questions the user should answer to sharpen this brief. If the input is already detailed, keep this section brief or note that no major assumptions were needed.',
    '2. Then produce the full brief in well-organized markdown with clear ## headings, covering (at minimum, adapted to the project): Project-Specific Context, Key Regulatory & Compliance Requirements, Architecture Considerations, Integration Landscape (named real-world systems/vendors/standards where relevant), Data & Security Considerations, and Non-Functional Requirements (availability, performance, scalability targets).',
    '3. Be specific and concrete: name real standards, protocols, vendors, and patterns relevant to this domain rather than generic advice. Prefer specifics the user provided over generic domain defaults.',
    '4. Write it so it remains useful and reusable throughout the project lifecycle — avoid one-off details that would go stale after a single phase.',
    '5. Output ONLY the markdown brief (starting with the Assumptions & Open Questions section). No commentary, no preamble, no code fences.',
  ].join('\n');

  const userPromptParts = [
    `Project name: ${projectName}`,
    projectDescription ? `Project description: ${projectDescription}` : null,
    `Domain: ${domainLabel}`,
    currentInput?.trim()
      ? `Current draft / notes from the project team (use these as the primary source of truth, expand and structure them):\n"""\n${currentInput.trim()}\n"""`
      : null,
    !currentInput?.trim() && domainTemplate
      ? `No project-specific notes have been entered yet. Here is the generic starter template for this domain — use it only as a structural reference, and replace its generic placeholders with a thorough, project-tailored brief:\n"""\n${domainTemplate}\n"""`
      : null,
  ].filter(Boolean);

  const resp = await callAgent({ systemPrompt: metaSystemPrompt, userPrompt: userPromptParts.join('\n\n') });
  let text = extractText(resp).trim();

  if (text.startsWith('```')) {
    text = text.replace(/^```[a-z]*\n?/i, '').replace(/```$/, '').trim();
  }

  return text;
}

// Branding signals extracted from a live site by the backend's /api/fetch-site
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
 * This is a static HTML scan — it does not execute JavaScript, so
 * fully client-rendered sites may yield sparse results.
 */
async function fetchSiteBranding(url: string): Promise<SiteBrandingSignals> {
  const res = await fetch(`${API_URL}/fetch-site`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Token': PROXY_TOKEN,
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
      // ignore — use default message
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
 * fully client-rendered (no server HTML/CSS) may yield sparse signals —
 * in that case the model is told to say so explicitly rather than invent
 * details.
 *
 * If `url` is omitted, the model expands the free-text `notes` into a
 * structured brief using general design knowledge (same pattern as
 * generateDomainKnowledge) — no live fetch occurs.
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
        '2. Then provide structured sections: ## Color Palette (list concrete hex values from the signals where available, with a likely role for each — primary, secondary, background, accent, text), ## Typography (font families found, with fallbacks), ## Tone & Voice (inferred from the page title/description/og tags), and ## Layout & Style Notes (any spacing, border-radius, or visual style patterns evident from the inline CSS sample).',
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

// ── GitHub integration ──────────────────────────────────────────────────────

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
      'X-API-Token': PROXY_TOKEN,
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
      // ignore — use default message
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
      'X-API-Token': PROXY_TOKEN,
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
      // ignore — use default message
    }
    throw new Error(message);
  }

  return res.json();
}

export const api = {
  callAgent,
  extractText,
  enhancePrompt,
  generateDomainKnowledge,
  fetchSiteBranding,
  generateBrandingGuidelines,
  testGithubConnection,
  pushIssuesToGithub,
};
