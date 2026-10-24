import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EnquiryException } from './enquiry-exception';
import {
  EnquiryRouteContextDto,
  TunnelId,
} from './dto/submit-enquiry.dto';

export interface PublicEnquiryContext {
  sourcePath: string;
  pageId?: string;
  routeId?: string;
  tunnelId?: TunnelId;
}

@Injectable()
export class EnquiryContextRegistryService {
  private readonly contexts: PublicEnquiryContext[];

  constructor(config: ConfigService) {
    this.contexts =
      config.get<PublicEnquiryContext[]>('ENQUIRY_PUBLIC_CONTEXTS') ?? [];
  }

  assertAllowed(
    sourcePath: string,
    routeContext?: EnquiryRouteContextDto,
  ): void {
    if (this.contexts.length === 0) {
      throw new ServiceUnavailableException(
        'Public enquiry context registry is not configured',
      );
    }

    const context = {
      ...(routeContext?.pageId === undefined
        ? {}
        : { pageId: routeContext.pageId }),
      ...(routeContext?.routeId === undefined
        ? {}
        : { routeId: routeContext.routeId }),
      ...(routeContext?.tunnelId === undefined
        ? {}
        : { tunnelId: routeContext.tunnelId }),
    };
    const allowed = this.contexts.some(
      (entry) =>
        entry.sourcePath === sourcePath &&
        entry.pageId === context.pageId &&
        entry.routeId === context.routeId &&
        entry.tunnelId === context.tunnelId,
    );

    if (!allowed) {
      throw new EnquiryException(422, 'validation_failed', {
        sourcePath: ['invalid_context'],
      });
    }
  }
}
