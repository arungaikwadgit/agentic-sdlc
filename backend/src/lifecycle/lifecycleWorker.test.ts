import { executeLifecycleJob } from './lifecycleWorker';
import { AgentJobRepository } from '../repositories/AgentJobRepository';
import { AgentRunRepository } from '../repositories/AgentRunRepository';

jest.mock('../repositories/AgentJobRepository');
jest.mock('../repositories/AgentRunRepository');

const job = {
  id: 'job-1',
  project_id: '11111111-1111-1111-1111-111111111111',
  agent_key: 'tokenOptimizer',
  status: 'running',
  attempts: 1,
  input_payload: { systemPrompt: 'system', userPrompt: 'user', eventType: 'agent_rerun' },
  created_at: new Date().toISOString(),
} as never;

describe('executeLifecycleJob', () => {
  const markJobSucceeded = jest.fn();
  const markFailedOrRetry = jest.fn();
  const markRunSucceeded = jest.fn();
  const markRunFailed = jest.fn();
  const createRun = jest.fn().mockResolvedValue({ id: 'run-1' });

  beforeEach(() => {
    jest.clearAllMocks();
    (AgentJobRepository as jest.Mock).mockImplementation(() => ({
      markSucceeded: markJobSucceeded,
      markFailedOrRetry,
    }));
    (AgentRunRepository as jest.Mock).mockImplementation(() => ({
      create: createRun,
      markSucceeded: markRunSucceeded,
      markFailed: markRunFailed,
    }));
  });

  it('persists an append-only run, completes the job, and updates the latest project assessment', async () => {
    const query = jest.fn().mockResolvedValue({ rows: [] });
    await executeLifecycleJob({ query } as never, job, jest.fn().mockResolvedValue({
      output: 'optimized', provider: 'openai', model: 'gpt-4o',
    }));

    expect(createRun).toHaveBeenCalled();
    expect(markRunSucceeded).toHaveBeenCalledWith('run-1', 'optimized');
    expect(markJobSucceeded).toHaveBeenCalledWith('job-1', 'optimized', 'run-1');
    expect(query).toHaveBeenCalledWith(expect.stringMatching(/UPDATE projects/), expect.any(Array));
  });

  it('records the failed run and requeues through the repository retry policy', async () => {
    await executeLifecycleJob({ query: jest.fn() } as never, job, jest.fn().mockRejectedValue(new Error('provider down')));

    expect(markRunFailed).toHaveBeenCalledWith('run-1', 'provider down');
    expect(markFailedOrRetry).toHaveBeenCalledWith('job-1', 'provider down', 1);
  });
});
