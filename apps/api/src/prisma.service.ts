import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from './generated/prisma/client';
import { PrismaLibSql } from '@prisma/adapter-libsql';
import { databaseFile } from './db';

/**
 * Prisma Client (typed ORM layer) bound to the local SQLite file through the
 * libsql driver adapter — no query engine binary, no internet, works offline.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  constructor() {
    const adapter = new PrismaLibSql({ url: `file:${databaseFile()}` });
    super({ adapter } as any);
  }
  async onModuleDestroy() {
    await this.$disconnect();
  }
}
