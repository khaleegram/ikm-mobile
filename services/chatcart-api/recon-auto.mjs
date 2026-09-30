import 'dotenv/config';
import { config } from './src/config.mjs';

const host = new URL(config.databaseUrl).hostname;

async function q(label, sql) {
  let lastErr;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const res = await fetch(`https://${host}/sql`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Neon-Connection-String': config.databaseUrl },
        body: JSON.stringify({ query: sql, params: [] }),
        signal: AbortSignal.timeout(90000),
      });
      const text = await res.text();
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
      console.log(`### ${label}\n${JSON.stringify(JSON.parse(text).rows, null, 2)}\n`);
      return;
    } catch (e) {
      lastErr = e;
      await new Promise((r) => setTimeout(r, attempt * 3000));
    }
  }
  console.log(`### ${label}\nFAILED after 4 attempts: ${lastErr?.message}\n`);
}

await q('every order by status + escrow', `
  SELECT status, escrow_status, COUNT(*)::int AS n, SUM(total)::numeric AS gmv,
         MIN(created_at)::date AS oldest, MAX(created_at)::date AS newest,
         COUNT(auto_release_date)::int AS has_release_date,
         COUNT(sent_at)::int AS has_sent_at
  FROM orders
  WHERE paystack_reference IS NOT NULL AND paystack_reference <> ''
  GROUP BY 1, 2 ORDER BY 1, 2`);

await q('WOULD RELEASE (auto-release rule)', `
  SELECT id, status, escrow_status, total, created_at::date, sent_at::date, auto_release_date::date
  FROM orders
  WHERE paystack_reference IS NOT NULL AND paystack_reference <> ''
    AND status IN ('Sent', 'Received')
    AND (escrow_status = 'held' OR escrow_status IS NULL)
    AND auto_release_date IS NOT NULL AND auto_release_date <= now()
  ORDER BY auto_release_date`);

await q('WOULD REFUND (auto-cancel rule)', `
  SELECT id, status, escrow_status, total, created_at::date, seller_accepted_at::date, sent_at::date
  FROM orders
  WHERE paystack_reference IS NOT NULL AND paystack_reference <> ''
    AND status IN ('Paid', 'Processing')
    AND seller_accepted_at IS NULL AND sent_at IS NULL
    AND (escrow_status = 'held' OR escrow_status IS NULL)
    AND created_at <= now() - interval '24 hours'
  ORDER BY created_at`);

await q('sent but no auto_release_date', `
  SELECT COUNT(*)::int AS n FROM orders
  WHERE paystack_reference IS NOT NULL AND paystack_reference <> ''
    AND sent_at IS NOT NULL AND auto_release_date IS NULL
    AND escrow_status IS DISTINCT FROM 'released'`);
