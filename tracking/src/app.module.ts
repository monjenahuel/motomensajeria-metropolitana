import { Module } from '@nestjs/common';
import { RabbitService } from './rabbit.service';
import { RedisService } from './redis.service';
import { TrackingController } from './tracking.controller';
import { TrackingService } from './tracking.service';
import { DatabaseService } from './database.service';
import { ReconciliationService } from './reconciliation.service';
import { CadeteAuthGuard } from './cadete-auth.guard';

@Module({
  controllers: [TrackingController],
  providers: [RedisService, DatabaseService, TrackingService, RabbitService, ReconciliationService, CadeteAuthGuard],
})
export class AppModule {}
