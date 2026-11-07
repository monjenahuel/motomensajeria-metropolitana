import { Injectable, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';

/**
 * Dos conexiones: una para comandos y otra dedicada a Pub/Sub
 * (una conexión suscrita no puede ejecutar otros comandos).
 */
@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly url = process.env.REDIS_URL ?? 'redis://localhost:6379';
  readonly cmd = new Redis(this.url);
  readonly sub = new Redis(this.url);

  async onModuleDestroy() {
    await Promise.all([this.cmd.quit(), this.sub.quit()]);
  }
}
