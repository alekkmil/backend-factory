import { Injectable, Logger, NestMiddleware } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { NextFunction, Request, Response } from "express";
import { requestContext } from "./request-context";

@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  private readonly logger = new Logger("HTTP");

  use(req: Request, res: Response, next: NextFunction): void {
    // Generate a trusted ID for every incoming request.
    const requestId = randomUUID();
    const start = performance.now();

    res.setHeader("X-Request-ID", requestId);

    requestContext.run({ requestId }, () => {
      this.logger.log(`→ ${req.method} ${req.path}`);

      res.on("finish", () => {
        const duration = Math.round(performance.now() - start);

        this.logger.log(
          `← ${req.method} ${req.path} ${res.statusCode} ${duration}ms`,
        );
      });

      next();
    });
  }
}
