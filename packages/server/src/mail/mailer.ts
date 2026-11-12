import { appendFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

/**
 * Invio di e-mail. In produzione: SMTP (da collegare a Infomaniak).
 * In sviluppo i messaggi finiscono in un file e nel terminale del server, così si possono leggere i codici.
 */
export interface Mail {
  to: string;
  subject: string;
  text: string;
}

export interface Mailer {
  send(mail: Mail): Promise<void>;
}

export class MemoryMailer implements Mailer {
  readonly sent: Mail[] = [];
  async send(mail: Mail) {
    this.sent.push(mail);
  }
}

export class FileMailer implements Mailer {
  private readonly path: string;
  constructor(path: string, private readonly log: (msg: string) => void = console.log) {
    this.path = resolve(path);
  }
  async send(mail: Mail) {
    await mkdir(dirname(this.path), { recursive: true });
    await appendFile(this.path, JSON.stringify({ at: new Date().toISOString(), ...mail }) + '\n');
    this.log(`\n✉️  E-mail (solo sviluppo) a ${mail.to}\n   ${mail.subject}\n   ${mail.text.replace(/\n/g, '\n   ')}\n`);
  }
}
