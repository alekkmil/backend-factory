import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { isEmail } from "class-validator";
import { createHash } from "node:crypto";
import nodemailer from "nodemailer";
import type { Transporter } from "nodemailer";
import type SMTPTransport from "nodemailer/lib/smtp-transport";
import { LocalMailCaptureService } from "./local-mail-capture.service";
import type { CapturedMail } from "./local-mail-capture.service";
import { parseMailRecipients } from "./mail-recipients";

type MailChannel = "standard" | "purchase" | "staff-payment";

export class MailDeliveryError extends Error {
  constructor(
    readonly code:
      | "MAIL_INVALID"
      | "SMTP_CONFIGURATION_UNAVAILABLE"
      | "SMTP_AUTHENTICATION_FAILED"
      | "SMTP_DELIVERY_FAILED",
  ) {
    super(code);
  }
}

@Injectable()
export class MailDeliveryService {
  private readonly logger = new Logger(MailDeliveryService.name);
  private readonly transporter?: Transporter<SMTPTransport.SentMessageInfo>;
  private readonly purchaseTransporter?: Transporter<SMTPTransport.SentMessageInfo>;
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
    const purchaseHost = this.config.get<string>("PURCHASE_SMTP_HOST");
    if (purchaseHost) {
      const port = this.config.get<number>("PURCHASE_SMTP_PORT");
      const user = this.config.get<string>("PURCHASE_SMTP_USER");
      const password = this.config.get<string>("PURCHASE_SMTP_PASSWORD");
      const secure = this.config.get<boolean>("PURCHASE_SMTP_SECURE");
      if (!port || !user || !password || secure === undefined) {
        throw new MailDeliveryError("SMTP_CONFIGURATION_UNAVAILABLE");
      }
      this.purchaseTransporter = nodemailer.createTransport({
        host: purchaseHost, port, secure, requireTLS: !secure,
        auth: { user, pass: password }, logger: false, debug: false,
      });
    }
  }

  async lookup(key: string, channel: MailChannel = "standard"): Promise<string | null> {
    if (this.smtpEnabled || (channel === "purchase" && this.purchaseTransporter)) {
      return null;
    }
    return this.capture.lookup(key);
  }

  async deliver(key: string, mail: CapturedMail, channel: MailChannel = "standard"): Promise<string> {
    this.validate(key, mail);
    const production = this.config.get<string>("NODE_ENV") === "production";
    const development = this.config.get<string>("NODE_ENV") === "development";
    const testRecipients = production ? [] : parseMailRecipients(this.config.get<string>("MAIL_TO") ?? "");
    const testRecipient = testRecipients[0];
    if (!production && !testRecipient) {
      throw new MailDeliveryError("SMTP_CONFIGURATION_UNAVAILABLE");
    }
    const usePurchase = channel === "purchase" && !!this.purchaseTransporter;
    if (channel === "purchase" && !usePurchase && (production || this.smtpEnabled)) {
      throw new MailDeliveryError("SMTP_CONFIGURATION_UNAVAILABLE");
    }
    const transporter = usePurchase ? this.purchaseTransporter : this.transporter;
    const recipient = production || (development && transporter) ? mail.recipient : testRecipient;
    if (!recipient || !isEmail(recipient)) {
      throw new MailDeliveryError("SMTP_CONFIGURATION_UNAVAILABLE");
    }
    const fromName = (channel === "purchase" && this.config.get<string>("PURCHASE_SMTP_FROM_NAME")) ||
      mail.fromName;
    const outgoing = {
      ...mail,
      ...(fromName ? { fromName } : {}),
      recipient,
      subject: production || mail.subject.startsWith("[DEV] ") ? mail.subject : `[DEV] ${mail.subject}`,
    };
    if (!transporter) {
      if (production) throw new MailDeliveryError("SMTP_CONFIGURATION_UNAVAILABLE");
      return this.capture.capture(key, outgoing);
    }

    const from = this.config.get<string>(usePurchase ? "PURCHASE_SMTP_FROM" : "MAIL_FROM");
    const replyTo = usePurchase ? this.config.get<string>("PURCHASE_SMTP_REPLY_TO") : mail.replyTo;
    if (!from || (usePurchase && !replyTo)) {
      throw new MailDeliveryError("SMTP_CONFIGURATION_UNAVAILABLE");
    }
    const messageId = `<${createHash("sha256").update(key).digest("hex")}@ssg-web-api.invalid>`;
    try {
      const result = await transporter.sendMail({
        from: fromName ? { name: fromName, address: from } : from,
        to: recipient,
        ...(development && channel === "standard"
          ? { bcc: testRecipients.filter((address) => address.toLowerCase() !== recipient.toLowerCase()) }
          : {}),
        ...(replyTo ? { replyTo } : {}),
        ...(usePurchase ? { envelope: { from, to: recipient } } : {}),
        subject: outgoing.subject,
        text: mail.text,
        html: mail.html,
        messageId,
      });
      if (result.rejected.length > 0) {
        throw new MailDeliveryError("SMTP_DELIVERY_FAILED");
      }
      return result.messageId;
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "EAUTH") {
        this.logger.error("SMTP authentication failed; disable the worker and verify credentials");
        throw new MailDeliveryError("SMTP_AUTHENTICATION_FAILED");
      }
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
