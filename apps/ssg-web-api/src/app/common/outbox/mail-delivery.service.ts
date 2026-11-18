import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { isEmail } from "class-validator";
import { createHash } from "node:crypto";
import nodemailer from "nodemailer";
import type { Transporter } from "nodemailer";
import type SMTPTransport from "nodemailer/lib/smtp-transport";
import { LocalMailCaptureService } from "./local-mail-capture.service";
import type { CapturedMail } from "./local-mail-capture.service";

export class MailDeliveryError extends Error {
  constructor(
    readonly code:
      | "MAIL_INVALID"
      | "SMTP_CONFIGURATION_UNAVAILABLE"
      | "SMTP_DELIVERY_FAILED",
  ) {
    super(code);
  }
}

@Injectable()
export class MailDeliveryService {
  private readonly logger = new Logger(MailDeliveryService.name);
  private readonly transporter?: Transporter<SMTPTransport.SentMessageInfo>;
  private readonly smtpEnabled: boolean;

  constructor(
    private readonly config: ConfigService,
    private readonly capture: LocalMailCaptureService,
  ) {
    const host = this.config.get<string>("SMTP_HOST");
    this.smtpEnabled = Boolean(host);
    if (this.smtpEnabled) {
      const port = this.config.get<number>("SMTP_PORT");
      const user = this.config.get<string>("SMTP_USER");
      const password = this.config.get<string>("SMTP_PASSWORD");
      if (!host || !port || !user || !password) {
        throw new MailDeliveryError("SMTP_CONFIGURATION_UNAVAILABLE");
      }
      this.transporter = nodemailer.createTransport({
        host,
        port,
        secure: port === 465,
        auth: { user, pass: password },
        logger: false,
        debug: false,
      });
    }
  }

  async lookup(key: string): Promise<string | null> {
    if (this.smtpEnabled) {
      return null;
    }
    return this.capture.lookup(key);
  }

  async deliver(key: string, mail: CapturedMail): Promise<string> {
    this.validate(key, mail);
    const production = this.config.get<string>("NODE_ENV") === "production";
    const development = this.config.get<string>("NODE_ENV") === "development";
    const testRecipient = production ? undefined : this.config.get<string>("MAIL_TO");
    if (!production && (!testRecipient || !isEmail(testRecipient) || /[\r\n]/.test(testRecipient))) {
      throw new MailDeliveryError("SMTP_CONFIGURATION_UNAVAILABLE");
    }
    const recipient = production || (development && this.smtpEnabled) ? mail.recipient : testRecipient;
    if (!recipient || !isEmail(recipient)) {
      throw new MailDeliveryError("SMTP_CONFIGURATION_UNAVAILABLE");
    }
    const outgoing = {
      ...mail,
      recipient,
      subject: production || mail.subject.startsWith("[DEV] ") ? mail.subject : `[DEV] ${mail.subject}`,
    };
    if (!this.smtpEnabled) {
      if (production) throw new MailDeliveryError("SMTP_CONFIGURATION_UNAVAILABLE");
      return this.capture.capture(key, outgoing);
    }

    const transporter = this.transporter;
    const from = this.config.get<string>("MAIL_FROM");
    if (!transporter || !from) {
      throw new MailDeliveryError("SMTP_CONFIGURATION_UNAVAILABLE");
    }
    const messageId = `<${createHash("sha256").update(key).digest("hex")}@ssg-web-api.invalid>`;
    try {
      const result = await transporter.sendMail({
        from: mail.fromName ? { name: mail.fromName, address: from } : from,
        to: recipient,
        ...(development && testRecipient && testRecipient.toLowerCase() !== recipient.toLowerCase()
          ? { bcc: testRecipient } : {}),
        ...(mail.replyTo ? { replyTo: mail.replyTo } : {}),
        subject: outgoing.subject,
        text: mail.text,
        html: mail.html,
        messageId,
      });
      if (result.rejected.length > 0) {
        throw new MailDeliveryError("SMTP_DELIVERY_FAILED");
      }
      return result.messageId;
    } catch {
      this.logger.warn("SMTP delivery failed");
      throw new MailDeliveryError("SMTP_DELIVERY_FAILED");
    }
  }

  private validate(key: string, mail: CapturedMail): void {
    if (
      key.length < 1 ||
      key.length > 255 ||
      !isEmail(mail.recipient) ||
      /[\r\n]/.test(mail.recipient) ||
      !mail.subject ||
      /[\r\n]/.test(mail.subject) ||
      (mail.fromName !== undefined && (!mail.fromName.trim() || /[\r\n]/.test(mail.fromName))) ||
      (mail.replyTo !== undefined && (!isEmail(mail.replyTo) || /[\r\n]/.test(mail.replyTo))) ||
      Buffer.byteLength(JSON.stringify(mail), "utf8") > 1024 * 1024
    ) {
      throw new MailDeliveryError("MAIL_INVALID");
    }
  }
}
