import {
  All,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Req,
  Res,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { Request, Response } from "express";
import { SubmitEnquiryDto } from "./dto/submit-enquiry.dto";
import { EnquiryException } from "./enquiry-exception";
import { AcceptedEnquiry, EnquiriesService } from "./enquiries.service";

@Controller("enquiries")
export class EnquiriesController {
  constructor(
    private readonly enquiriesService: EnquiriesService,
    private readonly config: ConfigService,
  ) {}

  @All()
  @HttpCode(HttpStatus.ACCEPTED)
  async handle(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Headers("idempotency-key") idempotencyKey?: string,
  ): Promise<AcceptedEnquiry | undefined> {
    response.setHeader("Cache-Control", "no-store");
    if (request.method !== "POST") {
      response.setHeader("Allow", "POST");
      throw new EnquiryException(405, "method_not_allowed");
    }
    if (!request.is("application/json")) {
      throw new EnquiryException(415, "unsupported_media_type");
    }

    const origin = request.get("origin");
    const allowedOrigins = this.config.getOrThrow<string[]>("CORS_ORIGINS");
    if (!origin || !allowedOrigins?.includes(origin)) {
      throw new EnquiryException(403, "origin_rejected");
    }
    if (!idempotencyKey) {
      throw new EnquiryException(400, "invalid_request");
    }

    const ipAddress = request.ip || request.socket.remoteAddress;
    if (!ipAddress) {
      throw new EnquiryException(503, "service_unavailable");
    }

    if (
      typeof request.body !== "object" ||
      request.body === null ||
      Array.isArray(request.body)
    ) {
      throw new EnquiryException(400, "invalid_request");
    }
    const body = plainToInstance(SubmitEnquiryDto, request.body);
    const validationErrors = await validate(body, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });
    if (validationErrors.length > 0) {
      if (validationErrors.some((error) => error.property === "routeContext")) {
        throw new EnquiryException(422, "validation_failed", {
          routeContext: ["invalid_context"],
        });
      }
      throw new EnquiryException(400, "invalid_request");
    }

    return this.enquiriesService.submit(body, idempotencyKey, ipAddress);
  }
}
