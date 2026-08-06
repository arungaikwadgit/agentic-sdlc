const {
  DEFAULT_PROMPT_OPTIMIZATION_SKILL,
  optimizePromptPair,
} = require('./promptOptimizationSkill');

describe('Token Optimizer preflight skill', () => {
  it('removes redundant whitespace and exact duplicate prose before an LLM call', () => {
    const repeated = 'This contextual paragraph describes a reusable low-risk observation in sufficient detail while preserving ordinary contextual meaning.';
    const result = optimizePromptPair({
      systemPrompt: 'System instructions.   \n\n\nContinue safely.',
      userPrompt: repeated + '\n\n' + repeated,
      skill: DEFAULT_PROMPT_OPTIMIZATION_SKILL,
    });

    expect(result.systemPrompt).toBe('System instructions.\n\nContinue safely.');
    expect(result.userPrompt).toBe(repeated);
    expect(result.metadata.applied).toBe(true);
    expect(result.metadata.estimatedTokensSaved).toBeGreaterThan(0);
  });

  it('preserves fenced code and protected mandatory requirements', () => {
    const code = '```json\n{  "required": true,  "limit": 100 }\n```';
    const protectedRequirement = 'MUST preserve SEC-001, approval evidence, and the 99.9% availability requirement.';
    const result = optimizePromptPair({
      systemPrompt: code,
      userPrompt: protectedRequirement + '\n\n' + protectedRequirement,
      skill: DEFAULT_PROMPT_OPTIMIZATION_SKILL,
    });

    expect(result.systemPrompt).toBe(code);
    expect(result.userPrompt).toBe(protectedRequirement + '\n\n' + protectedRequirement);
  });

  it('honors an application-level disabled skill without modifying prompts', () => {
    const result = optimizePromptPair({
      systemPrompt: 'Keep this.   ',
      userPrompt: 'And this.   ',
      skill: { ...DEFAULT_PROMPT_OPTIMIZATION_SKILL, enabled: false, version: 2 },
    });

    expect(result.systemPrompt).toBe('Keep this.   ');
    expect(result.userPrompt).toBe('And this.   ');
    expect(result.metadata).toMatchObject({ applied: false, reason: 'skill-disabled', skillVersion: 2 });
  });
});
