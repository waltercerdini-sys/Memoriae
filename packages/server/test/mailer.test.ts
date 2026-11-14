import { createServer, type Socket } from 'node:net';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DevMailer, FileMailer, SmtpMailer } from '../src/mail/mailer';

/** Server SMTP minimo, senza cifratura, solo per provare l'invio. */
let port = 0;
const ricevuti: string[] = [];
const server = createServer((sock: Socket) => {
  let data = false;
  let buf = '';
  sock.write('220 prova ESMTP\r\n');
  sock.on('data', (chunk) => {
    buf += chunk.toString();
    let i;
    while ((i = buf.indexOf('\r\n')) >= 0) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 2);
      if (data) {
        if (line === '.') {
          data = false;
          sock.write('250 ok\r\n');
        } else ricevuti.push(line);
        continue;
      }
      const cmd = line.slice(0, 4).toUpperCase();
      if (cmd === 'EHLO') sock.write('250-prova\r\n250 AUTH PLAIN LOGIN\r\n');
      else if (cmd === 'AUTH') sock.write('235 ok\r\n');
      else if (cmd === 'DATA') {
        data = true;
        sock.write('354 vai\r\n');
      } else if (cmd === 'QUIT') sock.end('221 ciao\r\n');
      else sock.write('250 ok\r\n');
    }
  });
});

beforeAll(async () => {
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', () => ok()));
  port = (server.address() as { port: number }).port;
});
afterAll(() => new Promise<void>((ok) => server.close(() => ok())));

describe('invio e-mail', () => {
  it('in prova: scrive nel file e invia davvero via SMTP', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'posta-'));
    const log: string[] = [];
    const smtp = new SmtpMailer({ host: '127.0.0.1', port, user: 'prova@example.ch', password: 'x', from: 'MEMORIAE <prova@example.ch>' });
    const mailer = new DevMailer(new FileMailer(join(dir, 'posta.log'), () => undefined), smtp, (m) => log.push(m));
    await mailer.send({ to: 'anna@example.ch', subject: 'Invito MEMORIAE', text: 'Ciao Anna' });
    expect(ricevuti.join('\n')).toContain('Subject: Invito MEMORIAE');
    expect(ricevuti.join('\n')).toContain('Ciao Anna');
    expect(await readFile(join(dir, 'posta.log'), 'utf8')).toContain('anna@example.ch');
    expect(log.join()).toContain('inviata davvero a anna@example.ch');
  });

  it('in prova: un invio non riuscito non blocca, viene solo segnalato', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'posta-'));
    const log: string[] = [];
    const rotto = new SmtpMailer({ host: '127.0.0.1', port: 1, user: 'x', password: 'x', from: 'x@example.ch' });
    const mailer = new DevMailer(new FileMailer(join(dir, 'posta.log'), () => undefined), rotto, (m) => log.push(m));
    await mailer.send({ to: 'b@example.ch', subject: 'S', text: 'T' });
    expect(log.join()).toContain('non riuscito');
  });
});
