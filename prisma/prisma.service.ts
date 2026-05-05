import { Injectable, OnModuleInit } from "@nestjs/common";
import { PrismaClient } from "./generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const DEFAULT_DATABASE_URL =
  "postgresql://postgres:postgres@localhost:5432/dayplan?schema=public";

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit {
  constructor() {
    const connectionString = process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL;
    const pool = new PrismaPg({ connectionString });
    super({ adapter: pool });
  }
  async onModuleInit() {
    // Note: this is optional
    await this.$connect();
  }
}
