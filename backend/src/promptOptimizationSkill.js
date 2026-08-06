/*
 * Copyright (c) 2026 Arun Gaikwad. All rights reserved.
 * Proprietary and Confidential - Unauthorized use prohibited.
 */

const DEFAULT_PROMPT_OPTIMIZATION_SKILL = Object.freeze({
  id: 'token-optimizer-preflight',
  name: 'Token Optimizer Preflight Skill',
  version: 1,
  enabled: true,
  strategy: 'conservative-deterministic',
  description: 'Reduces avoidable prompt tokens before every LLM call without weakening intent, controls, evidence, or output requirements.',
  rules: {
    normalizeLineEndings: true,
    trimTrailingWhitespace: true,
    collapseBlankLines: true,
    deduplicateExactProseBlocks: true,
    minimumDuplicateCharacters: 120,
  },
  protectedTerms: [
    'must', 'never', 'required', 'mandatory', 'approval', 'security', 'privacy',
    'governance', 'legal', 'audit', 'acceptance', 'requirement', 'step', 'output',
  ],
});

function estimateTokens(text) {
  return Math.ceil(String(text ?? '').length / 4);
}

function isProtectedBlock(block, protectedTerms) {
  const value = block.trim();
  if (!value) return true;
  if (/^\s*(?:[-*+] |\d+[.)] |\| |#{1,6} |[A-Z]{2,}-\d+)/m.test(value)) return true;
  if (/[{}\[\]]/.test(value)) return true;
  if (/\b\d+(?:\.\d+)?(?:%|ms|s|MB|GB|tokens?)?\b/i.test(value)) return true;
  const lower = value.toLowerCase();
  return protectedTerms.some((term) => lower.includes(String(term).toLowerCase()));
}

function optimizePlainSegment(segment, skill) {
  const rules = skill.rules ?? {};
  let value = String(segment ?? '');
  if (rules.normalizeLineEndings !== false) value = value.replace(/\r\n?/g, '\n');
  if (rules.trimTrailingWhitespace !== false) {
    value = value.split('\n').map((line) => line.replace(/[ \t]+$/g, '')).join('\n');
  }
  if (rules.collapseBlankLines !== false) value = value.replace(/\n{3,}/g, '\n\n');

  if (rules.deduplicateExactProseBlocks === false) return value;
  const minimum = Math.max(80, Number(rules.minimumDuplicateCharacters) || 120);
  const protectedTerms = Array.isArray(skill.protectedTerms)
    ? skill.protectedTerms
    : DEFAULT_PROMPT_OPTIMIZATION_SKILL.protectedTerms;
  const seen = new Set();
  const blocks = value.split(/\n{2,}/);
  const kept = [];
  for (const block of blocks) {
    const normalized = block.trim().replace(/[ \t]+/g, ' ');
    const duplicateEligible = normalized.length >= minimum && !isProtectedBlock(block, protectedTerms);
    if (duplicateEligible && seen.has(normalized)) continue;
    if (duplicateEligible) seen.add(normalized);
    kept.push(block);
  }
  return kept.join('\n\n');
}

function optimizePrompt(prompt, skill) {
  const source = String(prompt ?? '');
  // Odd-indexed parts are fenced code blocks and must remain byte-for-byte intact.
  return source
    .split(/(```[\s\S]*?```)/g)
    .map((part, index) => (index % 2 === 1 ? part : optimizePlainSegment(part, skill)))
    .join('')
    .trim();
}

function resolveSkill(candidate) {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    return DEFAULT_PROMPT_OPTIMIZATION_SKILL;
  }
  return {
    ...DEFAULT_PROMPT_OPTIMIZATION_SKILL,
    ...candidate,
    rules: { ...DEFAULT_PROMPT_OPTIMIZATION_SKILL.rules, ...(candidate.rules ?? {}) },
    protectedTerms: Array.isArray(candidate.protectedTerms)
      ? candidate.protectedTerms
      : DEFAULT_PROMPT_OPTIMIZATION_SKILL.protectedTerms,
  };
}

function optimizePromptPair({ systemPrompt, userPrompt, skill: candidate }) {
  const skill = resolveSkill(candidate);
  const originalSystem = String(systemPrompt ?? '');
  const originalUser = String(userPrompt ?? '');
  const beforeCharacters = originalSystem.length + originalUser.length;

  if (skill.enabled === false) {
    return {
      systemPrompt: originalSystem,
      userPrompt: originalUser,
      metadata: {
        applied: false,
        skillId: skill.id,
        skillVersion: skill.version,
        reason: 'skill-disabled',
        charactersBefore: beforeCharacters,
        charactersAfter: beforeCharacters,
        estimatedTokensBefore: estimateTokens(originalSystem + originalUser),
        estimatedTokensAfter: estimateTokens(originalSystem + originalUser),
        estimatedTokensSaved: 0,
      },
    };
  }

  const optimizedSystem = optimizePrompt(originalSystem, skill);
  const optimizedUser = optimizePrompt(originalUser, skill);
  const afterCharacters = optimizedSystem.length + optimizedUser.length;
  const estimatedTokensBefore = estimateTokens(originalSystem + originalUser);
  const estimatedTokensAfter = estimateTokens(optimizedSystem + optimizedUser);

  return {
    systemPrompt: optimizedSystem,
    userPrompt: optimizedUser,
    metadata: {
      applied: true,
      skillId: skill.id,
      skillVersion: skill.version,
      strategy: skill.strategy,
      charactersBefore: beforeCharacters,
      charactersAfter: afterCharacters,
      estimatedTokensBefore,
      estimatedTokensAfter,
      estimatedTokensSaved: Math.max(0, estimatedTokensBefore - estimatedTokensAfter),
      estimatedReductionPercent: estimatedTokensBefore > 0
        ? Number((((estimatedTokensBefore - estimatedTokensAfter) / estimatedTokensBefore) * 100).toFixed(2))
        : 0,
    },
  };
}

module.exports = {
  DEFAULT_PROMPT_OPTIMIZATION_SKILL,
  optimizePromptPair,
  estimateTokens,
};
