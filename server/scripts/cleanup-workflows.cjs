const { PrismaClient } = require('@prisma/client');

async function main() {
  const prisma = new PrismaClient();
  const deleted = await prisma.workflow.deleteMany({});
  console.log(`deleted ${deleted.count} workflows`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
