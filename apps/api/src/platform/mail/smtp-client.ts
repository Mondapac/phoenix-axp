import { randomBytes } from 'node:crypto';
import { connect as connectTcp, type Socket } from 'node:net';
import { connect as connectTls, type TLSSocket } from 'node:tls';

// A minimal SMTP submission client (RFC 5321, RFC 3207 STARTTLS, RFC 4954 AUTH PLAIN) on
// node:net and node:tls, with no library (ADR-0026 decision 6): it sends one plain-text UTF-8
// message per connection, which is all the platform's mail needs (sign-in codes, notices).
// The body is base64, so no line of it can be a lone "." and no dot-stuffing is needed.

/** Where and how to submit: `smtps://` is TLS from the start, `smtp://` upgrades with STARTTLS. */
export interface SmtpServer {
  readonly host: string;
  readonly port: number;
  readonly implicitTls: boolean;
  /** `smtp://` without STARTTLS is allowed only when this is false (development catchers). */
  readonly requireTls: boolean;
  /** A credential: never log it. */
  readonly auth: { readonly user: string; readonly password: string } | null;
  readonly timeoutMs: number;
  /** The CA of a private mail server; the system's otherwise. */
  readonly ca?: string;
}

export interface SmtpMessage {
  /** A bare address, `local@domain`. */
  readonly from: string;
  readonly to: string;
  readonly subject: string;
  readonly text: string;
  /** The message's Date header, RFC 5322 form. */
  readonly date: string;
}

/** Why a submission failed: the server's reply code when it answered, never the address. */
export class SmtpError extends Error {
  override readonly name = 'SmtpError';
  constructor(
    message: string,
    readonly replyCode: number | null = null,
  ) {
    super(message);
  }
}

/** An address the client puts in a command or header: no CR, LF, angle brackets or spaces. */
const ADDRESS = /^[^\s<>()\\,;:"@]+@[A-Za-z0-9.-]+$/;

/** RFC 2047 encoded-word for a header value that is not plain ASCII. */
export function encodeHeader(value: string): string {
  if (/[\r\n]/.test(value)) throw new SmtpError('A header value contains a line break');
  if (/^[\x20-\x7e]*$/.test(value)) return value;
  // Split on characters, not bytes, so no UTF-8 sequence is cut between two words.
  const words: string[] = [];
  let chunk = '';
  for (const character of value) {
    if (Buffer.byteLength(chunk + character, 'utf8') > 45) {
      words.push(chunk);
      chunk = '';
    }
    chunk += character;
  }
  if (chunk !== '') words.push(chunk);
  return words
    .map((word) => `=?UTF-8?B?${Buffer.from(word, 'utf8').toString('base64')}?=`)
    .join('\r\n ');
}

/** The full message: headers, a blank line, then the base64 body in 76-character lines. */
export function formatMessage(message: SmtpMessage, messageIdDomain: string): string {
  for (const address of [message.from, message.to]) {
    if (!ADDRESS.test(address)) throw new SmtpError('An address is not a plain mailbox');
  }
  const body = Buffer.from(message.text.replace(/\r?\n/g, '\r\n'), 'utf8').toString('base64');
  const lines = body.match(/.{1,76}/g) ?? [];
  return [
    `From: ${message.from}`,
    `To: ${message.to}`,
    `Subject: ${encodeHeader(message.subject)}`,
    `Date: ${message.date}`,
    `Message-ID: <${randomBytes(16).toString('hex')}@${messageIdDomain}>`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    ...lines,
  ].join('\r\n');
}

/** Reads the server's replies, one multi-line reply at a time. */
class ReplyReader {
  #buffer = '';
  #waiting: ((reply: { code: number; text: string }) => void) | null = null;
  #failure: ((error: Error) => void) | null = null;
  #lines: string[] = [];
  #error: Error | null = null;

  attach(socket: Socket | TLSSocket): void {
    socket.setEncoding('utf8');
    socket.on('data', (data: string) => {
      this.#buffer += data;
      if (this.#buffer.length > 64 * 1024) {
        this.fail(new SmtpError('The server sent an oversized reply'));
        return;
      }
      let index: number;
      while ((index = this.#buffer.indexOf('\r\n')) >= 0) {
        const line = this.#buffer.slice(0, index);
        this.#buffer = this.#buffer.slice(index + 2);
        this.#lines.push(line);
        // The last line of a reply has a space (or nothing) after its code, not a hyphen.
        if (!/^\d{3}-/.test(line)) this.#deliver();
      }
    });
  }

  detach(socket: Socket | TLSSocket): void {
    socket.removeAllListeners('data');
    this.#buffer = '';
  }

  fail(error: Error): void {
    this.#error ??= error;
    this.#failure?.(error);
    this.#waiting = null;
    this.#failure = null;
  }

  #pending: { code: number; text: string }[] = [];

  #deliver(): void {
    const lines = this.#lines;
    this.#lines = [];
    const code = Number(lines.at(-1)?.slice(0, 3));
    const reply = {
      code: Number.isInteger(code) ? code : 0,
      text: lines.map((line) => line.slice(4)).join('\n'),
    };
    if (this.#waiting !== null) {
      const resolve = this.#waiting;
      this.#waiting = null;
      this.#failure = null;
      resolve(reply);
    } else {
      this.#pending.push(reply);
    }
  }

  next(): Promise<{ code: number; text: string }> {
    if (this.#error !== null) return Promise.reject(this.#error);
    const queued = this.#pending.shift();
    if (queued !== undefined) return Promise.resolve(queued);
    return new Promise((resolve, reject) => {
      this.#waiting = resolve;
      this.#failure = reject;
    });
  }
}

/**
 * Submits one message, then quits. Throws {@link SmtpError} on any refusal, a timeout or a
 * server that offers no STARTTLS where TLS is required.
 */
export async function sendSmtp(
  server: SmtpServer,
  message: SmtpMessage,
  clientName: string,
): Promise<void> {
  const data = formatMessage(message, clientName);
  const reader = new ReplyReader();
  let socket: Socket | TLSSocket = await open(server);
  const timer = setTimeout(() => {
    reader.fail(new SmtpError('The mail server timed out'));
    socket.destroy();
  }, server.timeoutMs);
  socket.on('error', () => reader.fail(new SmtpError('The mail server connection failed')));
  socket.on('close', () => reader.fail(new SmtpError('The mail server closed the connection')));
  reader.attach(socket);

  const write = (line: string) => socket.write(`${line}\r\n`);
  const expect = async (codes: readonly number[], what: string) => {
    const reply = await reader.next();
    if (!codes.includes(reply.code)) {
      throw new SmtpError(`The mail server refused ${what}`, reply.code);
    }
    return reply;
  };

  try {
    await expect([220], 'the connection');
    write(`EHLO ${clientName}`);
    let hello = await expect([250], 'EHLO');
    if (!server.implicitTls) {
      const offersTls = /^STARTTLS$/im.test(hello.text);
      if (offersTls) {
        write('STARTTLS');
        await expect([220], 'STARTTLS');
        reader.detach(socket);
        socket = await upgrade(socket, server);
        socket.on('error', () => reader.fail(new SmtpError('The mail server connection failed')));
        reader.attach(socket);
        write(`EHLO ${clientName}`);
        hello = await expect([250], 'EHLO');
      } else if (server.requireTls) {
        throw new SmtpError('The mail server offers no STARTTLS');
      }
    }
    if (server.auth !== null) {
      const token = Buffer.from(
        `\u0000${server.auth.user}\u0000${server.auth.password}`,
        'utf8',
      ).toString('base64');
      write(`AUTH PLAIN ${token}`);
      await expect([235], 'the credentials');
    }
    write(`MAIL FROM:<${message.from}>`);
    await expect([250], 'the sender');
    write(`RCPT TO:<${message.to}>`);
    await expect([250, 251], 'the recipient');
    write('DATA');
    await expect([354], 'DATA');
    socket.write(`${data}\r\n.\r\n`);
    await expect([250], 'the message');
    write('QUIT');
    await reader.next().catch(() => undefined);
  } finally {
    clearTimeout(timer);
    socket.removeAllListeners('close');
    socket.end();
    socket.destroy();
  }
}

function open(server: SmtpServer): Promise<Socket | TLSSocket> {
  return new Promise((resolve, reject) => {
    const fail = () => reject(new SmtpError('The mail server cannot be reached'));
    if (server.implicitTls) {
      const socket = connectTls(
        { host: server.host, port: server.port, servername: server.host, ca: server.ca },
        () => resolve(socket),
      );
      socket.once('error', fail);
      socket.setTimeout(server.timeoutMs, () => socket.destroy(new Error('timeout')));
    } else {
      const socket = connectTcp({ host: server.host, port: server.port }, () => resolve(socket));
      socket.once('error', fail);
      socket.setTimeout(server.timeoutMs, () => socket.destroy(new Error('timeout')));
    }
  });
}

function upgrade(socket: Socket, server: SmtpServer): Promise<TLSSocket> {
  return new Promise((resolve, reject) => {
    const secure = connectTls({ socket, servername: server.host, ca: server.ca }, () =>
      resolve(secure),
    );
    secure.once('error', () => reject(new SmtpError('The mail server TLS handshake failed')));
  });
}
