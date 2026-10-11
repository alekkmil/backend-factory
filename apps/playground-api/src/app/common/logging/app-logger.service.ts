import { Injectable, Logger } from "@nestjs/common";
import { requestContext } from "./request-context";

@Injectable()
export class AppLogger {
  private readonly logger = new Logger();

  private format(message: string): string {
    const requestId = requestContext.getStore()?.requestId ?? "system";

    return `[${requestId}] ${message}`;
  }

  log(message: string, context?: string): void {
    this.logger.log(this.format(message), context);
  }

  warn(message: string, context?: string): void {
    this.logger.warn(this.format(message), context);
  }

  error(message: string, trace?: string, context?: string): void {
    this.logger.error(this.format(message), trace, context);
  }

  debug(message: string, context?: string): void {
    this.logger.debug(this.format(message), context);
  }
}
