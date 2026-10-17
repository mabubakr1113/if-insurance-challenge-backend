import { config } from 'dotenv';

config({ path: '.env.local', quiet: true });

async function main() {
  const { resetAndSeed } = await import('../lib/seed');
  const result = await resetAndSeed();
  console.log(`Demo ready. Invitation: ${result.inviteUrl}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
