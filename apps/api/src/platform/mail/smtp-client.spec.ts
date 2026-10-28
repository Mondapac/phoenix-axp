import { createServer, type Server, type Socket } from 'node:net';
import { encodeHeader, formatMessage, sendSmtp, SmtpError, type SmtpServer } from './smtp-client';

// The minimal SMTP client (ADR-0026 decision 6) against a scripted server on a local port: the
// dialogue, AUTH PLAIN, the UTF-8 message, refusals and the STARTTLS requirement.

interface Session {
  readonly commands: string[];
  data: string;
}

/** A plain SMTP server that answers each command from `replies`, and records the session. */
function scriptedServer(options: {
  readonly startTls?: boolean;
  readonly refuseRecipient?: boolean;
}) {
  const sessions: Session[] = [];
  const server: Server = createServer((socket: Socket) => {
    const session: Session = { commands: [], data: '' };
    sessions.push(session);
    let inData = false;
    let buffer = '';
    socket.setEncoding('utf8');
    socket.write('220 test ESMTP\r\n');
    socket.on('data', (chunk: string) => {
      buffer += chunk;
      if (inData) {
        const end = buffer.indexOf('\r\n.\r\n');
        if (end < 0) return;
        session.data = buffer.slice(0, end);
        buffer = buffer.slice(end + 5);
        inData = false;
        socket.write('250 queued\r\n');
      }
      let index: number;
      while (!inData && (index = buffer.indexOf('\r\n')) >= 0) {
        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 2);
        session.commands.push(line);
        const verb = line.split(' ')[0]!.toUpperCase();
        if (verb === 'EHLO') {
          socket.write(
            `250-test\r\n${options.startTls ? '250-STARTTLS\r\n' : ''}250 AUTH PLAIN\r\n`,
          );
        } else if (verb === 'AUTH') socket.write('235 ok\r\n');
        else if (verb === 'MAIL') socket.write('250 ok\r\n');
        else if (verb === 'RCPT')
          socket.write(options.refuseRecipient ? '550 no such user\r\n' : '250 ok\r\n');
        else if (verb === 'DATA') {
          inData = true;
          socket.write('354 go\r\n');
        } else if (verb === 'QUIT') {
          socket.end('221 bye\r\n');
        } else socket.write('502 no\r\n');
      }
    });
  });
  return { server, sessions };
}

async function listen(server: Server): Promise<number> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('no port');
  return address.port;
}

const message = {
  from: 'portal@example.test',
  to: 'zahra@example.test',
  subject: 'کد ورود به پورتال نمونه',
  text: 'کد ورود شما: 123456\nThis line is English.\n.',
  date: 'Wed, 28 Oct 2026 09:00:00 GMT',
};

const serverOf = (port: number, extra: Partial<SmtpServer> = {}): SmtpServer => ({
  host: '127.0.0.1',
  port,
  implicitTls: false,
  requireTls: false,
  auth: { user: 'mailer', password: 'secret' },
  timeoutMs: 2000,
  ...extra,
});

describe('the SMTP client', () => {
  it('submits one UTF-8 message with AUTH PLAIN and quits', async () => {
    const { server, sessions } = scriptedServer({});
    const port = await listen(server);
    try {
      await sendSmtp(serverOf(port), message, 'example.test');
      const [session] = sessions;
      expect(session!.commands).toEqual([
        'EHLO example.test',
        `AUTH PLAIN ${Buffer.from('\0mailer\0secret').toString('base64')}`,
        'MAIL FROM:<portal@example.test>',
        'RCPT TO:<zahra@example.test>',
        'DATA',
        'QUIT',
      ]);
      const [headers, body] = session!.data.split('\r\n\r\n');
      expect(headers).toContain('Content-Type: text/plain; charset=UTF-8');
      expect(headers).toContain('Content-Transfer-Encoding: base64');
      expect(headers).toMatch(/^Subject: =\?UTF-8\?B\?/m);
      expect(Buffer.from(body!.replace(/\r\n/g, ''), 'base64').toString('utf8')).toBe(
        message.text.replace(/\n/g, '\r\n'),
      );
    } finally {
      server.close();
    }
  });

  it('throws the reply code of a refusal, and refuses plain text where TLS is required', async () => {
    const refusing = scriptedServer({ refuseRecipient: true });
    const port = await listen(refusing.server);
    try {
      await expect(sendSmtp(serverOf(port), message, 'example.test')).rejects.toMatchObject({
        name: 'SmtpError',
        replyCode: 550,
      });
      await expect(
        sendSmtp(serverOf(port, { requireTls: true }), message, 'example.test'),
      ).rejects.toThrow('The mail server offers no STARTTLS');
    } finally {
      refusing.server.close();
    }
  });

  it('fails cleanly when nothing listens', async () => {
    const { server } = scriptedServer({});
    const port = await listen(server);
    server.close();
    await new Promise((resolve) => setTimeout(resolve, 20));
    await expect(sendSmtp(serverOf(port), message, 'example.test')).rejects.toBeInstanceOf(
      SmtpError,
    );
  });

  it('encodes headers and refuses header injection and odd addresses', () => {
    expect(encodeHeader('plain')).toBe('plain');
    const encoded = encodeHeader('سلام '.repeat(20));
    for (const word of encoded.split('\r\n '))
      expect(word).toMatch(/^=\?UTF-8\?B\?[A-Za-z0-9+/=]+\?=$/);
    expect(() => encodeHeader('a\r\nBcc: x@example.test')).toThrow(SmtpError);
    expect(() => formatMessage({ ...message, to: 'a@b>\r\nRCPT TO:<c@d' }, 'example.test')).toThrow(
      SmtpError,
    );
  });
});
