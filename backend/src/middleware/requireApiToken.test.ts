import { Request, Response, NextFunction } from 'express';
import { requireApiToken } from './requireApiToken';

function mockRes() {
  const res: Partial<Response> = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res as Response;
}

function mockReq(token?: string): Request {
  return {
    header: (name: string) => (name.toLowerCase() === 'x-api-token' ? token : undefined),
  } as unknown as Request;
}

describe('requireApiToken', () => {
  const ORIGINAL_TOKEN = process.env.RUNTIME_API_TOKEN;
  const ORIGINAL_INTERNAL_TOKEN = process.env.RUNTIME_API_TOKEN_INTERNAL;

  afterEach(() => {
    process.env.RUNTIME_API_TOKEN = ORIGINAL_TOKEN;
    process.env.RUNTIME_API_TOKEN_INTERNAL = ORIGINAL_INTERNAL_TOKEN;
  });

  it('fails closed with 500 when neither RUNTIME_API_TOKEN nor RUNTIME_API_TOKEN_INTERNAL is configured', () => {
    delete process.env.RUNTIME_API_TOKEN;
    delete process.env.RUNTIME_API_TOKEN_INTERNAL;
    const req = mockReq('anything');
    const res = mockRes();
    const next = jest.fn() as NextFunction;

    requireApiToken(req, res, next);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects requests with a missing token header as 401', () => {
    process.env.RUNTIME_API_TOKEN = 'secret-123';
    delete process.env.RUNTIME_API_TOKEN_INTERNAL;
    const req = mockReq(undefined);
    const res = mockRes();
    const next = jest.fn() as NextFunction;

    requireApiToken(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects requests with a wrong token header as 401', () => {
    process.env.RUNTIME_API_TOKEN = 'secret-123';
    delete process.env.RUNTIME_API_TOKEN_INTERNAL;
    const req = mockReq('wrong-token');
    const res = mockRes();
    const next = jest.fn() as NextFunction;

    requireApiToken(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('calls next() when the token header matches RUNTIME_API_TOKEN', () => {
    process.env.RUNTIME_API_TOKEN = 'secret-123';
    delete process.env.RUNTIME_API_TOKEN_INTERNAL;
    const req = mockReq('secret-123');
    const res = mockRes();
    const next = jest.fn() as NextFunction;

    requireApiToken(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  // Item #5 Phase 3: server/src's call into GET /memory-records/similar
  // authenticates with a second, independent secret so rotating it can
  // never affect the existing RUNTIME_API_TOKEN-based integration (the
  // background lifecycle worker) -- see requireApiToken.ts's header comment.
  it('calls next() when the token header matches RUNTIME_API_TOKEN_INTERNAL, with no RUNTIME_API_TOKEN set', () => {
    delete process.env.RUNTIME_API_TOKEN;
    process.env.RUNTIME_API_TOKEN_INTERNAL = 'internal-secret-456';
    const req = mockReq('internal-secret-456');
    const res = mockRes();
    const next = jest.fn() as NextFunction;

    requireApiToken(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  it('calls next() when the token header matches RUNTIME_API_TOKEN_INTERNAL even while RUNTIME_API_TOKEN is also set to a different value', () => {
    process.env.RUNTIME_API_TOKEN = 'secret-123';
    process.env.RUNTIME_API_TOKEN_INTERNAL = 'internal-secret-456';
    const req = mockReq('internal-secret-456');
    const res = mockRes();
    const next = jest.fn() as NextFunction;

    requireApiToken(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  it('rejects a token that matches neither RUNTIME_API_TOKEN nor RUNTIME_API_TOKEN_INTERNAL when both are configured', () => {
    process.env.RUNTIME_API_TOKEN = 'secret-123';
    process.env.RUNTIME_API_TOKEN_INTERNAL = 'internal-secret-456';
    const req = mockReq('neither-of-these');
    const res = mockRes();
    const next = jest.fn() as NextFunction;

    requireApiToken(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });
});
