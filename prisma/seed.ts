import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

/** Dev-only demo user; mobile `src/config/demoAccount.ts` must use the same values. */
const DEMO_EMAIL = 'demo@dayplan.local';
const DEMO_PASSWORD = 'demo12345';

async function main() {
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 12);
  await prisma.user.upsert({
    where: { email: DEMO_EMAIL },
    update: { passwordHash, name: 'Demo User' },
    create: {
      email: DEMO_EMAIL,
      passwordHash,
      name: 'Demo User',
      timezone: 'UTC',
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
