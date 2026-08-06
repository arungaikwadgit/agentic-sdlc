/**
 * 2026 Arun Gaikwad. All rights reserved.
 * Proprietary and Confidential - Unauthorized use prohibited.
 */

const MAX_MEMORY_ANSWER_CHARS = 3_000;
const MIN_MATCH_TERMS = 3;

const STOP_WORDS = new Set([
  'a', 'about', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'can', 'do', 'does',
  'for', 'from', 'how', 'i', 'in', 'is', 'it', 'me', 'of', 'on', 'or', 'our',
  'please', 'project', 'tell', 'that', 'the', 'this', 'to', 'what', 'when', 'where',
  'which', 'who', 'why', 'with', 'you', 'your',
]);

const VOLATILE_TERMS = new Set([
  'active', 'blocked', 'current', 'failed', 'failure', 'gate', 'latest', 'pending',
  'progress', 'recent', 'running', 'status', 'today',
]);

function normalizeText(value) {
  return String(value ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function significantTerms(value) {
  return [...new Set(normalizeText(value)
    .split(/[\s-]+/)
    .filter((term) => term.length >= 3 && !STOP_WORDS.has(term)))];
}

function isVolatileQuestion(question) {
  return significantTerms(question).some((term) => VOLATILE_TERMS.has(term));
}

function scoreMemory(question, item) {
  const questionTerms = significantTerms(question);
  if (questionTerms.length < MIN_MATCH_TERMS) return 0;

  const title = normalizeText(item?.title);
  const content = normalizeText(item?.excerpt);
  const searchable = `${title} ${content}`.trim();
  if (!searchable) return 0;

  const matched = questionTerms.filter((term) => searchable.includes(term));
  const coverage = matched.length / questionTerms.length;
  const titleMatches = questionTerms.filter((term) => title.includes(term)).length;
  const titleCoverage = titleMatches / questionTerms.length;
  const phraseBonus = content.includes(normalizeText(question)) ? 0.12 : 0;
  return Math.min(1, (coverage * 0.78) + (titleCoverage * 0.1) + phraseBonus);
}

function findMemoryAnswer(question, evidence = []) {
  if (isVolatileQuestion(question)) return null;

  let best = null;
  for (const item of evidence) {
    if (item?.sourceType !== 'memory' || item?.authorized === false || !item?.excerpt) continue;
    const score = scoreMemory(question, item);
    if (!best || score > best.score) best = { item, score };
  }

  if (!best || best.score < 0.78) return null;
  return {
    answer: String(best.item.excerpt).slice(0, MAX_MEMORY_ANSWER_CHARS),
    evidence: best.item,
    confidence: Math.max(98, Math.min(100, Math.round(best.score * 100))),
  };
}

module.exports = {
  findMemoryAnswer,
  isVolatileQuestion,
  normalizeText,
  scoreMemory,
  significantTerms,
};
