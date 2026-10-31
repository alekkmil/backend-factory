import { Injectable, Logger, NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { NextFunction, Request, Response } from 'express';
import { requestContext } from './request-context';

@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  private readonly logger = new Logger('HTTP');

  use(request: Request, response: Response, next: NextFunction): void {
    const requestId = randomUUID();
    const startedAt = performance.now();
    let logged = false;

    response.setHeader('X-Request-ID', requestId);

    requestContext.run({ requestId }, () => {
      const logCompletion = (closedPrematurely: boolean): void => {
        if (logged) {
          return;
        }
        logged = true;

        const routePath =
          typeof request.route?.path === 'string'
            ? `${request.baseUrl}${request.route.path}`
            : '[unmatched]';
        const duration = Math.round(performance.now() - startedAt);
        const closeNote = closedPrematurely ? ' connection-closed' : '';

        this.logger.log(
          `${request.method} ${routePath} ${response.statusCode} ${duration}ms${closeNote}`,
        );
      };

      response.once('finish', () => logCompletion(false));
      response.once('close', () => {
        if (!response.writableFinished) {
          logCompletion(true);
        }
      });

      next();
    });
  }
}
