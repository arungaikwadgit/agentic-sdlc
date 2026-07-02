// backend/src/proxy.sendInviteEmail.test.ts
//
// Targeted tests for the Gmail-SMTP invite email sender in proxy.js
// (replaces the old Resend-based implementation). Covers:
//   - dev-mode fallback when GMAIL_USER/GMAIL_APP_PASSWORD are not configured
//   - a real send path via a mocked nodemailer transporter
//   - error propagation when Gmail rejects the send
//
// proxy.js reads GMAIL_USER/GMAIL_APP_PASSWORD into module-level constants at
// require() time, so each scenario needs its own process.env + jest.resetModules()
// before requiring the module fresh.

describe('sendInviteEmail (Gmail SMTP)', () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    jest.resetModules();
    jest.dontMock('nodemailer');
    process.env = { ...ORIGINAL_ENV, PORT: '0' };
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  it('falls back to dev mode (logs the link, does not send) when Gmail creds are not configured', async () => {
    process.env.GMAIL_USER = '';
    process.env.GMAIL_APP_PASSWORD = '';

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { sendInviteEmail, getGmailTransporter } = require('./proxy');

    expect(getGmailTransporter()).toBeNull();

    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    const result = await sendInviteEmail({
      to: 'invitee@example.com',
      name: 'Invitee',
      projectName: 'Test Project',
      appRole: 'editor',
      inviteLink: 'https://app.example.com/invite?token=abc',
      invitedBy: 'Arun',
    });
    logSpy.mockRestore();

    expect(result).toEqual({ ok: true, dev: true });
  });

  it('sends via a nodemailer Gmail transport when GMAIL_USER + GMAIL_APP_PASSWORD are set', async () => {
    process.env.GMAIL_USER = 'sender@gmail.com';
    process.env.GMAIL_APP_PASSWORD = 'abcd efgh ijkl mnop';

    const sendMailMock = jest.fn().mockResolvedValue({ messageId: '<test-id@gmail.com>' });
    const createTransportMock = jest.fn(() => ({ sendMail: sendMailMock }));
    jest.doMock('nodemailer', () => ({ createTransport: createTransportMock }));

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { sendInviteEmail, getGmailTransporter } = require('./proxy');

    expect(getGmailTransporter()).not.toBeNull();
    expect(createTransportMock).toHaveBeenCalledWith(
      expect.objectContaining({
        service: 'gmail',
        auth: { user: 'sender@gmail.com', pass: 'abcd efgh ijkl mnop' },
      }),
    );

    const result = await sendInviteEmail({
      to: 'invitee@example.com',
      name: 'Invitee',
      projectName: 'Test Project',
      appRole: 'reviewer',
      inviteLink: 'https://app.example.com/invite?token=xyz',
      invitedBy: 'Arun',
    });

    expect(result.ok).toBe(true);
    expect(sendMailMock).toHaveBeenCalledTimes(1);

    const callArg = sendMailMock.mock.calls[0][0];
    expect(callArg.to).toBe('invitee@example.com');
    expect(callArg.from).toContain('sender@gmail.com');
    expect(callArg.subject).toContain('Test Project');
    expect(callArg.html).toContain('Reviewer');
    expect(callArg.html).toContain('https://app.example.com/invite?token=xyz');
  });

  it('returns ok:false with an error message when Gmail rejects the send', async () => {
    process.env.GMAIL_USER = 'sender@gmail.com';
    process.env.GMAIL_APP_PASSWORD = 'abcd efgh ijkl mnop';

    const sendMailMock = jest
      .fn()
      .mockRejectedValue(new Error('Invalid login: 535-5.7.8 Username and Password not accepted'));
    jest.doMock('nodemailer', () => ({
      createTransport: jest.fn(() => ({ sendMail: sendMailMock })),
    }));

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { sendInviteEmail } = require('./proxy');

    const result = await sendInviteEmail({
      to: 'invitee@example.com',
      name: 'Invitee',
      projectName: 'Test Project',
      appRole: 'viewer',
      inviteLink: 'https://app.example.com/invite?token=xyz',
      invitedBy: 'Arun',
    });

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Username and Password not accepted/);
  });

  it('reuses the same transporter instance across multiple calls (singleton)', async () => {
    process.env.GMAIL_USER = 'sender@gmail.com';
    process.env.GMAIL_APP_PASSWORD = 'abcd efgh ijkl mnop';

    const createTransportMock = jest.fn(() => ({ sendMail: jest.fn().mockResolvedValue({}) }));
    jest.doMock('nodemailer', () => ({ createTransport: createTransportMock }));

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { getGmailTransporter } = require('./proxy');

    const first = getGmailTransporter();
    const second = getGmailTransporter();

    expect(first).toBe(second);
    expect(createTransportMock).toHaveBeenCalledTimes(1);
  });
});
