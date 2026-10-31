import { Controller, Get, HttpStatus, ServiceUnavailableException } from '@nestjs/common';
import { Prisma } from '../../../generated/prisma/client';
import { PrismaService } from '../../database/prisma.service';

@Controller('internal/health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async getHealth(): Promise<{
    status: 'ok' | 'unavailable';
    database: 'reachable' | 'unavailable';
    configuration_ready: boolean;
  }> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      const settings = await this.prisma.shopSettings.findUnique({
        where: { id: 1 },
        select: { ready: true },
      });
      return {
        status: 'ok',
        database: 'reachable',
        configuration_ready: settings?.ready ?? false,
      };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError ||
        error instanceof Prisma.PrismaClientUnknownRequestError ||
        error instanceof Prisma.PrismaClientInitializationError
      ) {
        throw new ServiceUnavailableException({
          statusCode: HttpStatus.SERVICE_UNAVAILABLE,
        });
      }
      throw error;
    }
  }
}
