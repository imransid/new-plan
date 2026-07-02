import "dotenv/config";
import { PrismaClient } from "./generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import * as bcrypt from "bcryptjs";

// Prisma 7 with the `prisma-client` generator uses a driver adapter — there is
// no built-in engine to fall back on, so the client must be constructed with
// one (mirrors backend/prisma/prisma.service.ts).
const connectionString =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@localhost:5432/dayplan?schema=public";
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString }),
});

/** Dev-only demo user; mobile `src/config/demoAccount.ts` must use the same values. */
const DEMO_EMAIL = "demo@dayplan.local";
const DEMO_PASSWORD = "demo12345";

async function main() {
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 12);
  await prisma.user.upsert({
    where: { email: DEMO_EMAIL },
    update: { passwordHash, name: "Demo User" },
    create: {
      email: DEMO_EMAIL,
      passwordHash,
      name: "Demo User",
      timezone: "UTC",
      reminderSchedule: { create: {} },
    },
  });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
