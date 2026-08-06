import { AgentJobRepository } from './AgentJobRepository';

describe('AgentJobRepository lifecycle idempotency', () => {
  it('uses the idempotency key to return one durable job for duplicate events', async () => {
    const query = jest.fn().mockResolvedValue({ rows: [{ id: 'job-1', status: 'queued' }] });
    const repo = new AgentJobRepository({ query } as never);

    await repo.create({
      project_id: 'project-1',
      agent_key: 'tokenOptimizer',
      input_payload: { systemPrompt: 'system', userPrompt: 'user' },
      trigger_type: 'agent_rerun',
      idempotency_key: 'rerun:architecture:version-2',
    });

    expect(query).toHaveBeenCalledWith(
      expect.stringMatching(/ON CONFLICT \(project_id, agent_key, idempotency_key\)/),
      expect.arrayContaining(['project-1', 'tokenOptimizer', 'agent_rerun', 'rerun:architecture:version-2']),
    );
  });
});
