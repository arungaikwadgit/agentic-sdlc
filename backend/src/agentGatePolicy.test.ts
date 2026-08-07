export {};

const { resolveAgentGateAuthorization } = require('./agentGatePolicy');

function fakeDb({
  project = { data: { reviewGates: {} }, phase_id: 'phase1', agent_phase_order: 3 },
  gates = [{ gate_id: 'gate0', gate_after_order: 0 }],
  failOn,
}: {
  project?: any;
  gates?: any[];
  failOn?: number;
} = {}) {
  let call = 0;
  return {
    query: jest.fn(async () => {
      call += 1;
      if (failOn === call) throw new Error('database unavailable');
      return call === 1 ? { rows: project ? [project] : [] } : { rows: gates };
    }),
  };
}

describe('resolveAgentGateAuthorization', () => {
  it('allows the first phase without requiring an earlier gate', async () => {
    const db = fakeDb({
      project: { data: {}, phase_id: 'phase0', agent_phase_order: 0 },
    });

    await expect(resolveAgentGateAuthorization({
      db,
      projectId: 'project-1',
      agentId: 'sdlcOrchestrator',
    })).resolves.toEqual({
      allowed: true,
      phaseId: 'phase0',
      requiredGates: [],
    });
    expect(db.query).toHaveBeenCalledTimes(1);
  });

  it('blocks when an earlier gate is missing from project state', async () => {
    const result = await resolveAgentGateAuthorization({
      db: fakeDb(),
      projectId: 'project-1',
      agentId: 'manager',
    });

    expect(result).toMatchObject({
      allowed: false,
      status: 403,
      blockingGate: 'gate0',
    });
  });

  it('blocks when an earlier gate is explicitly rejected or pending', async () => {
    const result = await resolveAgentGateAuthorization({
      db: fakeDb({
        project: {
          data: { reviewGates: { gate0: { approved: false, status: 'rejected' } } },
          phase_id: 'phase1',
          agent_phase_order: 3,
        },
      }),
      projectId: 'project-1',
      agentId: 'manager',
    });

    expect(result.allowed).toBe(false);
    expect(result.error).toMatch(/gate0 must be approved/i);
  });

  it('requires every earlier gate, not only the immediately preceding gate', async () => {
    const result = await resolveAgentGateAuthorization({
      db: fakeDb({
        project: {
          data: {
            reviewGates: {
              gate0: { approved: true },
              gate1: { approved: false },
            },
          },
          phase_id: 'phase3',
          agent_phase_order: 7,
        },
        gates: [
          { gate_id: 'gate0', gate_after_order: 0 },
          { gate_id: 'gate1', gate_after_order: 4 },
          { gate_id: 'gate2', gate_after_order: 6 },
        ],
      }),
      projectId: 'project-1',
      agentId: 'architecture',
    });

    expect(result).toMatchObject({
      allowed: false,
      blockingGate: 'gate1',
      requiredGates: ['gate0', 'gate1', 'gate2'],
    });
  });

  it('allows execution only after every earlier gate is approved', async () => {
    const result = await resolveAgentGateAuthorization({
      db: fakeDb({
        project: {
          data: {
            reviewGates: {
              gate0: { approved: true },
              gate1: { approved: true },
            },
          },
          phase_id: 'phase2',
          agent_phase_order: 5,
        },
        gates: [
          { gate_id: 'gate0', gate_after_order: 0 },
          { gate_id: 'gate1', gate_after_order: 4 },
        ],
      }),
      projectId: 'project-1',
      agentId: 'userStory',
    });

    expect(result).toEqual({
      allowed: true,
      phaseId: 'phase2',
      requiredGates: ['gate0', 'gate1'],
    });
  });

  it('rejects unknown projects and agents', async () => {
    await expect(resolveAgentGateAuthorization({
      db: fakeDb({ project: null }),
      projectId: 'missing',
      agentId: 'manager',
    })).resolves.toMatchObject({ allowed: false, status: 404 });

    await expect(resolveAgentGateAuthorization({
      db: fakeDb({ project: { data: {}, phase_id: null, agent_phase_order: null } }),
      projectId: 'project-1',
      agentId: 'madeUpAgent',
    })).resolves.toMatchObject({ allowed: false, status: 400 });
  });

  it('fails closed when gate configuration or database access is unavailable', async () => {
    await expect(resolveAgentGateAuthorization({
      db: fakeDb({ gates: [] }),
      projectId: 'project-1',
      agentId: 'manager',
    })).rejects.toThrow(/no review-gate boundary/i);

    await expect(resolveAgentGateAuthorization({
      db: fakeDb({ failOn: 2 }),
      projectId: 'project-1',
      agentId: 'manager',
    })).rejects.toThrow(/database unavailable/i);
  });
});
