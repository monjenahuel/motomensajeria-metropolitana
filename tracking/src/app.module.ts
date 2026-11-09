import { Module } from '@nestjs/common';
import { RabbitService } from './rabbit.service';
import { RedisService } from './redis.service';
import { TrackingController } from './tracking.controller';
import { TrackingService } from './tracking.service';
import { DatabaseService } from './database.service';
import { ReconciliationService } from './reconciliation.service';

@Module({
  controllers: [TrackingController],
  providers: [RedisService, DatabaseService, TrackingService, RabbitService, ReconciliationService],
})
export class AppModule {}
