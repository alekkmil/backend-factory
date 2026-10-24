import { Injectable, Logger, NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { NextFunction, Request, Response } from 'express';
import { requestContext } from './request-context';

@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  private readonly logger = new Logger('HTTP');

  use(req: Request, res: Response, next: NextFunction): void {
    const requestId = randomUUID();
    const startedAt = performance.now();
    let responseFinished = false;

    res.setHeader('X-Request-ID', requestId);

    requestContext.run({ requestId }, () => {
      this.logger.log(`Request started: ${req.method}`);

      res.once('finish', () => {
        responseFinished = true;
        const duration = Math.round(performance.now() - startedAt);
        const route = req.route?.path;
        const safePath =
          typeof route === 'string'
            ? `${req.baseUrl}${route}`
            : req.baseUrl || '<unmatched>';

        this.logger.log(
          `${req.method} ${safePath} ${res.statusCode} ${duration}ms`,
        );
      });

      res.once('close', () => {
        if (!responseFinished) {
          this.logger.warn(
            `Connection closed before response completed: ${req.method}`,
          );
        }
      });

      next();
    });
  }
}
