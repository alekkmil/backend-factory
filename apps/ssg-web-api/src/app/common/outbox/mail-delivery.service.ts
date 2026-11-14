import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { isEmail } from "class-validator";
import { createHash } from "node:crypto";
import nodemailer from "nodemailer";
import type { Transporter } from "nodemailer";
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
  private readonly transporter?: Transporter;
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
    if (!this.smtpEnabled) {
      return this.capture.capture(key, mail);
    }

    const transporter = this.transporter;
    const from = this.config.get<string>("MAIL_FROM");
    const recipient = this.config.get<string>("MAIL_TO");
    if (!transporter || !from || !recipient) {
      throw new MailDeliveryError("SMTP_CONFIGURATION_UNAVAILABLE");
    }
    const messageId = `<${createHash("sha256").update(key).digest("hex")}@ssg-web-api.invalid>`;
    try {
      const result = await transporter.sendMail({
        from,
        to: recipient,
        subject: mail.subject,
        text: mail.text,
        html: mail.html,
        messageId,
      });
      return result.messageId;
    } catch (e) {
      console.log(e);
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
      Buffer.byteLength(JSON.stringify(mail), "utf8") > 1024 * 1024
    ) {
      throw new MailDeliveryError("MAIL_INVALID");
    }
  }
}
