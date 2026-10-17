import { config } from 'dotenv';

config({ path: '.env.local', quiet: true });

async function main() {
  const { usesMemoryStore } = await import('../lib/supabase');
  if (usesMemoryStore()) {
    console.log('No Supabase configured: the API keeps the demo in memory and seeds it on the first request.');
    console.log('To start over, use "Reset all demo data" on /demo or restart the API.');
    return;
  }
  const { resetAndSeed } = await import('../lib/seed');
  const result = await resetAndSeed();
  console.log(`Demo ready. Invitation: ${result.inviteUrl}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
