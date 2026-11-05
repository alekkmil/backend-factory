import { Module } from '@nestjs/common';
import { PrismaModule } from '../../database/prisma.module';
import { GuestSessionController } from './guest-session.controller';
import { GuestSessionService } from './guest-session.service';

@Module({
  imports: [PrismaModule],
  controllers: [GuestSessionController],
  providers: [GuestSessionService],
  exports: [GuestSessionService],
})
export class GuestSessionModule {}
