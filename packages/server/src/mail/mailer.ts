import nodemailer from 'nodemailer';
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

export interface SmtpConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  from: string;
}

/** Invio vero via SMTP (per esempio la casella Infomaniak di MEMORIAE). */
export class SmtpMailer implements Mailer {
  private readonly transport;
  constructor(private readonly cfg: SmtpConfig) {
    this.transport = nodemailer.createTransport({
      host: cfg.host,
      port: cfg.port,
      secure: cfg.port === 465,
      auth: { user: cfg.user, pass: cfg.password },
      connectionTimeout: 15_000,
    });
  }
  async send(mail: Mail) {
    await this.transport.sendMail({ from: this.cfg.from, to: mail.to, subject: mail.subject, text: mail.text });
  }
  verify() {
    return this.transport.verify();
  }
}

/**
 * In prova: ogni e-mail va nel file e nel terminale e, se configurato, parte anche davvero.
 * Un invio non riuscito non blocca la prova: viene segnalato nel terminale.
 */
export class DevMailer implements Mailer {
  constructor(private readonly file: FileMailer, private readonly smtp: SmtpMailer | null, private readonly log: (msg: string) => void = console.log) {}
  async send(mail: Mail) {
    await this.file.send(mail);
    if (!this.smtp) return;
    try {
      await this.smtp.send(mail);
      this.log(`   ✅ inviata davvero a ${mail.to}`);
    } catch (e) {
      this.log(`   ⚠️  invio a ${mail.to} non riuscito: ${(e as Error).message}`);
    }
  }
}
