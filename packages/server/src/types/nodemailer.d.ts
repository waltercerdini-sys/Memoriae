// Tipi minimi per la parte di nodemailer che usiamo (il pacchetto non include i suoi).
declare module 'nodemailer' {
  interface SmtpOptions {
    host: string;
    port: number;
    secure: boolean;
    auth: { user: string; pass: string };
    connectionTimeout?: number;
  }
  interface MailOptions {
    from: string;
    to: string;
    subject: string;
    text: string;
  }
  interface Transporter {
    sendMail(mail: MailOptions): Promise<{ messageId: string }>;
    verify(): Promise<true>;
    close(): void;
  }
  export function createTransport(options: SmtpOptions): Transporter;
  const nodemailer: { createTransport: typeof createTransport };
  export default nodemailer;
}
