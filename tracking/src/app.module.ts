import { Module } from '@nestjs/common';
import { RabbitService } from './rabbit.service';
import { RedisService } from './redis.service';
import { TrackingController } from './tracking.controller';
import { TrackingService } from './tracking.service';

@Module({
  controllers: [TrackingController],
  providers: [RedisService, TrackingService, RabbitService],
})
export class AppModule {}
