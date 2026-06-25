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
  const ORIGINAL_ENV = process.env.RUNTIME_API_TOKEN;

  afterEach(() => {
    process.env.RUNTIME_API_TOKEN = ORIGINAL_ENV;
  });

  it('fails closed with 500 when RUNTIME_API_TOKEN is not configured', () => {
    delete process.env.RUNTIME_API_TOKEN;
    const req = mockReq('anything');
    const res = mockRes();
    const next = jest.fn() as NextFunction;

    requireApiToken(req, res, next);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects requests with a missing token header as 401', () => {
    process.env.RUNTIME_API_TOKEN = 'secret-123';
    const req = mockReq(undefined);
    const res = mockRes();
    const next = jest.fn() as NextFunction;

    requireApiToken(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects requests with a wrong token header as 401', () => {
    process.env.RUNTIME_API_TOKEN = 'secret-123';
    const req = mockReq('wrong-token');
    const res = mockRes();
    const next = jest.fn() as NextFunction;

    requireApiToken(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('calls next() when the token header matches RUNTIME_API_TOKEN', () => {
    process.env.RUNTIME_API_TOKEN = 'secret-123';
    const req = mockReq('secret-123');
    const res = mockRes();
    const next = jest.fn() as NextFunction;

    requireApiToken(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });
});
