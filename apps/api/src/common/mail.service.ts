import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import nodemailer, { type Transporter } from 'nodemailer';

export interface Mail {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

/** The backoffice's address, for links in emails: WEB_URL, else the first allowed web origin. */
export function webUrl() {
  const url = process.env.WEB_URL || (process.env.CORS_ORIGINS ?? '').split(',')[0].trim() || 'http://localhost:3000';
  return url.replace(/\/+$/, '');
}

/**
 * Sends email through any SMTP account, set with SMTP_URL, for example
 * `smtps://you%40gmail.com:app-password@smtp.gmail.com:465` (a Gmail app password works),
 * and optionally MAIL_FROM ("Floatly <you@gmail.com>"; by default the SMTP login).
 *
 * Without SMTP_URL, outside production each email is written to the log instead, and kept
 * in `sent` for the tests; in production there's no way to send, and `ready` says so.
 */
@Injectable()
export class MailService {
  private readonly log = new Logger('Mail');
  private transport?: Transporter;

  /** Emails that went to the log instead (development and tests), newest last. */
  readonly sent: Mail[] = [];

  /** Whether email can go out. */
  get ready() {
    return !!process.env.SMTP_URL || process.env.NODE_ENV !== 'production';
  }

  async send(mail: Mail) {
    const url = process.env.SMTP_URL;
    if (!url) {
      if (!this.ready) throw new ServiceUnavailableException('Email is not set up on this Floatly server');
      this.sent.push(mail);
      // In development the whole email, so its links can be followed; the tests read `sent`.
      if (process.env.NODE_ENV !== 'test') this.log.log(`Not sent (no SMTP_URL). To ${mail.to}: ${mail.subject}\n${mail.text}`);
      return;
    }
    this.transport ??= nodemailer.createTransport(
      // Short timeouts: a stuck mail server mustn't hold the request until the platform kills it.
      { url, connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 20_000 },
      { from: process.env.MAIL_FROM || `Floatly <${decodeURIComponent(new URL(url).username)}>` },
    );
    try {
      await this.transport.sendMail(mail);
    } catch (err) {
      this.log.error(`Couldn't send "${mail.subject}": ${(err as Error).message}`);
      throw new ServiceUnavailableException("The email couldn't be sent just now. Try again in a few minutes.");
    }
  }
}
