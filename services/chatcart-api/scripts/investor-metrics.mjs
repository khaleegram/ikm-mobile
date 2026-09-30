/**
 * ChatCart investor metrics — the numbers an angel actually asks for.
 *
 * Read-only. Never writes. Safe to run against production.
 *
 * Usage (from services/chatcart-api):
 *   node scripts/investor-metrics.mjs              # connect, print report, write docs/investor-metrics.md
 *   node scripts/investor-metrics.mjs --sql        # print the SQL only (paste into Neon SQL editor)
 *   node scripts/investor-metrics.mjs --no-write   # print only, write nothing
 *   node scripts/investor-metrics.mjs --out path   # custom report path
 *
 * Env: DATABASE_URL (from .env, or exported).
 *
 * If this times out on port 5432, your network blocks Postgres egress.
 * Run it on Railway instead:  railway run node scripts/investor-metrics.mjs
 * or use --sql and paste into the Neon console.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import 'dotenv/config';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);

// pg returns NUMERIC (1700) and INT8 (20) as strings to protect precision.
// Every money and count column here is well inside float range, and unparsed
// strings render as raw numbers in the report.
pg.types.setTypeParser(1700, (v) => (v === null ? null : Number(v)));
pg.types.setTypeParser(20, (v) => (v === null ? null : Number(v)));

const SQL_ONLY = args.includes('--sql');
const NO_WRITE = args.includes('--no-write');
const outIdx = args.indexOf('--out');
const OUT_PATH = path.resolve(
  outIdx !== -1 && args[outIdx + 1] ? args[outIdx + 1] : path.join(__dirname, '../../../docs/investor-metrics.md')
);

/**
 * Test rows created by scripts/smoke-prod.mjs use ids/refs prefixed `smoke_`.
 * They must never appear in a data-room number.
 */
const EXCLUDE_TEST = `id NOT LIKE 'smoke\\_%' AND COALESCE(paystack_reference, '') NOT LIKE 'smoke\\_%'`;

/** An order only counts as money if a real Paystack charge is attached to it. */
const PAID_FILTER = `${EXCLUDE_TEST} AND paystack_reference IS NOT NULL AND paystack_reference <> ''`;

const QUERIES = {
  overview: `
    WITH paid AS (
      SELECT
        o.*,
        COALESCE(o.commission_rate, 0.05) AS rate,
        (o.escrow_status = 'refunded') AS refunded,
        (o.status ILIKE 'cancel%') AS cancelled
      FROM orders o
      WHERE ${PAID_FILTER}
    )
    SELECT
      COUNT(*)::int                                                              AS paid_orders,
      COUNT(*) FILTER (WHERE NOT refunded AND NOT cancelled)::int                 AS net_orders,
      COUNT(*) FILTER (WHERE cancelled)::int                                      AS cancelled_orders,
      COUNT(*) FILTER (WHERE refunded)::int                                       AS refunded_orders,
      COUNT(*) FILTER (WHERE NOT refunded AND NOT cancelled AND status = 'Completed')::int AS completed_orders,
      COALESCE(SUM(total), 0)::numeric                                            AS gmv_gross,
      COALESCE(SUM(total) FILTER (WHERE NOT refunded AND NOT cancelled), 0)::numeric AS gmv_net,
      COALESCE(SUM(total * rate) FILTER (WHERE NOT refunded AND NOT cancelled), 0)::numeric AS revenue_booked,
      COALESCE(SUM(total * rate) FILTER (WHERE NOT refunded AND NOT cancelled AND status = 'Completed'), 0)::numeric AS revenue_realised,
      COALESCE(SUM(total) FILTER (WHERE escrow_status = 'held' AND NOT cancelled AND NOT refunded), 0)::numeric AS escrow_held_now,
      COUNT(DISTINCT customer_id)::int                                            AS buyers,
      COUNT(DISTINCT seller_id)::int                                              AS sellers,
      COUNT(DISTINCT post_id)::int                                                AS posts_sold,
      MIN(created_at)                                                             AS first_order_at,
      MAX(created_at)                                                             AS last_order_at
    FROM paid`,

  repeat_buyers: `
    WITH paid AS (
      SELECT o.*, (o.escrow_status = 'refunded') AS refunded, (o.status ILIKE 'cancel%') AS cancelled
      FROM orders o
      WHERE ${PAID_FILTER}
    ),
    per_buyer AS (
      SELECT
        customer_id,
        COUNT(*)::int                     AS orders,
        SUM(total)::numeric               AS spend,
        COUNT(DISTINCT seller_id)::int    AS sellers,
        COUNT(DISTINCT post_id)::int      AS posts,
        MIN(created_at)                   AS first_at,
        MAX(created_at)                   AS last_at
      FROM paid
      WHERE NOT refunded AND NOT cancelled
      GROUP BY 1
    )
    SELECT
      COUNT(*)::int                                            AS buyers,
      COUNT(*) FILTER (WHERE orders >= 2)::int                 AS repeat_buyers,
      COUNT(*) FILTER (WHERE orders >= 3)::int                 AS buyers_3plus,
      COUNT(*) FILTER (WHERE sellers >= 2)::int                AS buyers_multi_seller,
      COUNT(*) FILTER (WHERE posts >= 2)::int                  AS buyers_repeat_post,
      ROUND(100.0 * COUNT(*) FILTER (WHERE orders >= 2) / NULLIF(COUNT(*), 0), 1) AS repeat_rate_pct,
      ROUND(AVG(orders), 2)                                    AS orders_per_buyer,
      ROUND(AVG(spend), 2)                                     AS avg_lifetime_spend,
      ROUND(AVG(EXTRACT(EPOCH FROM (last_at - first_at)) / 86400.0), 1) AS avg_days_first_to_last
    FROM per_buyer`,

  aov: `
    WITH paid AS (
      SELECT o.*, (o.escrow_status = 'refunded') AS refunded, (o.status ILIKE 'cancel%') AS cancelled
      FROM orders o
      WHERE ${PAID_FILTER}
    ),
    per_checkout AS (
      SELECT
        COALESCE(paystack_reference, id) AS ref,
        SUM(total)::numeric              AS checkout_total,
        COUNT(*)::int                    AS seller_orders,
        MAX(created_at)                  AS at
      FROM paid
      WHERE NOT refunded AND NOT cancelled
      GROUP BY 1
    )
    SELECT
      COUNT(*)::int                                                  AS checkouts,
      ROUND(AVG(checkout_total), 2)                                  AS aov_per_checkout,
      ROUND(AVG(seller_orders), 2)                                   AS sellers_per_checkout,
      COUNT(*) FILTER (WHERE seller_orders >= 2)::int                AS multi_seller_checkouts,
      ROUND(100.0 * COUNT(*) FILTER (WHERE seller_orders >= 2) / NULLIF(COUNT(*), 0), 1) AS multi_seller_checkout_pct
    FROM per_checkout`,

  chat_funnel: `
    WITH paid AS (
      SELECT o.*, (o.escrow_status = 'refunded') AS refunded, (o.status ILIKE 'cancel%') AS cancelled
      FROM orders o
      WHERE ${PAID_FILTER}
    ),
    t AS (
      SELECT
        COUNT(*)::int                                                   AS threads_total,
        COUNT(*) FILTER (WHERE created_at >= now() - interval '30 days')::int AS threads_30d,
        COUNT(*) FILTER (WHERE linked_order_id IS NOT NULL)::int        AS threads_with_order
      FROM chat_threads
    ),
    o AS (
      SELECT
        COUNT(*) FILTER (WHERE deal_thread_id IS NOT NULL AND NOT refunded AND NOT cancelled)::int AS orders_from_chat,
        COUNT(*) FILTER (WHERE NOT refunded AND NOT cancelled)::int                                 AS orders_net
      FROM paid
    ),
    m AS (
      SELECT
        COUNT(*)::int AS messages,
        COUNT(DISTINCT thread_id)::int AS threads_with_messages,
        COUNT(DISTINCT sender_id)::int AS people_chatting
      FROM chat_messages
    ),
    offers AS (
      SELECT
        COUNT(*)::int AS offers,
        COUNT(*) FILTER (WHERE status = 'accepted')::int AS offers_accepted
      FROM chat_offers
    )
    SELECT
      t.threads_total,
      t.threads_30d,
      t.threads_with_order,
      ROUND(100.0 * t.threads_with_order / NULLIF(t.threads_total, 0), 1) AS thread_to_order_pct,
      o.orders_from_chat,
      o.orders_net,
      ROUND(100.0 * o.orders_from_chat / NULLIF(o.orders_net, 0), 1)      AS pct_orders_from_chat,
      m.messages,
      m.threads_with_messages,
      m.people_chatting,
      offers.offers,
      offers.offers_accepted,
      ROUND(100.0 * offers.offers_accepted / NULLIF(offers.offers, 0), 1) AS offer_accept_pct
    FROM t, o, m, offers`,

  weekly: `
    WITH paid AS (
      SELECT o.*, COALESCE(o.commission_rate, 0.05) AS rate,
             (o.escrow_status = 'refunded') AS refunded, (o.status ILIKE 'cancel%') AS cancelled
      FROM orders o
      WHERE ${PAID_FILTER}
    ),
    clean AS (SELECT * FROM paid WHERE NOT refunded AND NOT cancelled),
    buyer_first AS (SELECT customer_id, MIN(created_at) AS first_at FROM clean GROUP BY 1)
    SELECT
      date_trunc('week', c.created_at)::date                    AS week,
      COUNT(*)::int                                             AS orders,
      COALESCE(SUM(c.total), 0)::numeric                        AS gmv,
      COALESCE(SUM(c.total * c.rate), 0)::numeric               AS revenue,
      COUNT(DISTINCT c.customer_id)::int                        AS buyers,
      COUNT(DISTINCT c.customer_id) FILTER (WHERE c.created_at > bf.first_at)::int AS returning_buyers,
      COUNT(DISTINCT c.seller_id)::int                          AS sellers,
      COUNT(*) FILTER (WHERE c.created_at > bf.first_at)::int   AS repeat_orders
    FROM clean c
    JOIN buyer_first bf ON bf.customer_id = c.customer_id
    GROUP BY 1
    ORDER BY 1 DESC
    LIMIT 12`,

  supply_funnel: `
    WITH first_post AS (
      SELECT poster_id, MIN(created_at) AS activated_at, COUNT(*)::int AS posts
      FROM posts
      GROUP BY 1
    ),
    first_sale AS (
      SELECT seller_id, MIN(created_at) AS first_sale_at, COUNT(*)::int AS orders
      FROM orders
      WHERE ${PAID_FILTER} AND escrow_status IS DISTINCT FROM 'refunded' AND status NOT ILIKE 'cancel%'
      GROUP BY 1
    )
    SELECT
      COUNT(*)::int                                                    AS sellers_who_posted,
      COUNT(fs.seller_id)::int                                         AS sellers_with_a_sale,
      COUNT(*) FILTER (WHERE fs.seller_id IS NULL)::int                 AS posted_never_sold,
      ROUND(100.0 * COUNT(fs.seller_id) / NULLIF(COUNT(*), 0), 1)      AS post_to_sale_pct,
      ROUND(AVG(fp.posts), 1)                                          AS avg_posts_per_seller,
      ROUND(percentile_cont(0.5) WITHIN GROUP (
        ORDER BY EXTRACT(EPOCH FROM (fs.first_sale_at - fp.activated_at)) / 86400.0
      )::numeric, 1)                                                   AS median_days_post_to_first_sale
    FROM first_post fp
    LEFT JOIN first_sale fs ON fs.seller_id = fp.poster_id`,

  supply_activity: `
    WITH first_post AS (
      SELECT poster_id, MIN(created_at) AS activated_at
      FROM posts GROUP BY 1
    )
    SELECT
      (SELECT COUNT(*)::int FROM users)                                                      AS users_total,
      (SELECT COUNT(*)::int FROM posts)                                                      AS posts_total,
      (SELECT COUNT(*)::int FROM posts WHERE status = 'active')                              AS posts_active,
      (SELECT COUNT(DISTINCT poster_id)::int FROM posts)                                     AS posters_total,
      (SELECT COUNT(DISTINCT poster_id)::int FROM posts WHERE created_at >= now() - interval '30 days') AS posters_30d,
      (SELECT COUNT(DISTINCT poster_id)::int FROM posts WHERE created_at >= now() - interval '7 days')  AS posters_7d,
      (SELECT COUNT(*)::int FROM first_post WHERE activated_at >= now() - interval '30 days') AS new_sellers_30d,
      (SELECT COUNT(DISTINCT poster_id)::int FROM posts WHERE purchase_count > 0)             AS posters_with_a_sale,
      (SELECT COUNT(DISTINCT p.poster_id)::int FROM posts p WHERE p.purchase_count = 0)       AS posters_never_sold_flag`,

  posts_weekly: `
    WITH pw AS (
      SELECT date_trunc('week', created_at)::date AS week,
             COUNT(*)::int AS posts, COUNT(DISTINCT poster_id)::int AS posters
      FROM posts GROUP BY 1
    ),
    tw AS (
      SELECT date_trunc('week', created_at)::date AS week, COUNT(*)::int AS threads
      FROM chat_threads GROUP BY 1
    )
    SELECT COALESCE(pw.week, tw.week) AS week, pw.posts, pw.posters, tw.threads
    FROM pw FULL OUTER JOIN tw ON pw.week = tw.week
    ORDER BY 1 DESC
    LIMIT 12`,

  top_sellers: `
    WITH paid AS (
      SELECT o.*, (o.escrow_status = 'refunded') AS refunded, (o.status ILIKE 'cancel%') AS cancelled
      FROM orders o
      WHERE ${PAID_FILTER}
    )
    SELECT
      o.seller_id,
      COALESCE(u.store_name, u.display_name, u.email, o.seller_id) AS seller,
      COUNT(*)::int                       AS orders,
      COALESCE(SUM(o.total), 0)::numeric  AS gmv,
      COUNT(DISTINCT o.customer_id)::int  AS distinct_buyers,
      MIN(o.created_at)::date             AS first_sale,
      MAX(o.created_at)::date             AS last_sale
    FROM paid o
    LEFT JOIN users u ON u.id = o.seller_id
    WHERE NOT o.refunded AND NOT o.cancelled
    GROUP BY 1, 2
    ORDER BY gmv DESC
    LIMIT 15`,

  data_quality: `
    SELECT
      (SELECT COUNT(*)::int FROM orders WHERE paystack_reference IS NULL OR paystack_reference = '') AS orders_without_payment,
      (SELECT COUNT(*)::int FROM orders WHERE id LIKE 'smoke\\_%' OR COALESCE(paystack_reference, '') LIKE 'smoke\\_%') AS test_rows_present,
      (SELECT COUNT(*)::int FROM orders o WHERE o.customer_id = o.seller_id) AS self_buys,
      (SELECT COUNT(*)::int FROM orders WHERE total IS NULL OR total = 0) AS zero_value_orders,
      (SELECT COUNT(*)::int FROM orders o WHERE o.post_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM posts p WHERE p.id = o.post_id)) AS orphan_orders,
      (SELECT COUNT(*)::int FROM (
        SELECT cp.paystack_reference
        FROM checkout_payments cp
        JOIN orders o ON o.paystack_reference = cp.paystack_reference
        GROUP BY cp.paystack_reference, cp.amount
        HAVING ABS(SUM(o.total) - cp.amount) > 0.01
      ) x) AS checkout_total_mismatches,
      (SELECT COUNT(*)::int FROM orders WHERE escrow_status = 'held' AND created_at < now() - interval '30 days') AS stale_escrow_30d,
      (SELECT COUNT(*)::int FROM orders WHERE status = 'Completed' AND escrow_status = 'held') AS completed_but_unreleased,
      (SELECT COUNT(*)::int FROM orders WHERE escrow_status IS NULL AND paystack_reference IS NOT NULL AND paystack_reference <> '') AS paid_orders_without_escrow_status`,

  integrity_info: `
    SELECT
      (SELECT COUNT(DISTINCT paystack_reference)::int FROM orders
        WHERE paystack_reference IS NOT NULL AND paystack_reference <> ''
          AND paystack_reference IN (
            SELECT paystack_reference FROM orders
            WHERE paystack_reference IS NOT NULL AND paystack_reference <> ''
            GROUP BY paystack_reference HAVING COUNT(DISTINCT seller_id) > 1
          )) AS multi_seller_references,
      (SELECT COUNT(*)::int FROM (
        SELECT paystack_reference, seller_id FROM orders
        WHERE paystack_reference IS NOT NULL AND paystack_reference <> ''
        GROUP BY 1, 2 HAVING COUNT(*) > 1
      ) x) AS duplicate_orders_per_reference_seller,
      (SELECT COUNT(*)::int FROM user_blocks) AS blocked_pairs,
      (SELECT COUNT(*)::int FROM chat_reports WHERE status = 'open') AS open_chat_reports`,
};

const NUMERIC_KEYS = new Set([
  'gmv_gross', 'gmv_net', 'revenue_booked', 'revenue_realised', 'escrow_held_now',
  'gmv', 'revenue', 'spend', 'avg_lifetime_spend', 'aov_per_checkout', 'total', 'checkout_total',
]);

const ngn = (v) => '₦' + Number(v || 0).toLocaleString('en-NG', { maximumFractionDigits: 0 });
const pct = (v) => (v === null || v === undefined ? '—' : `${v}%`);
const num = (v) => (v === null || v === undefined ? '—' : Number(v).toLocaleString('en-NG'));
const d = (v) => (v ? new Date(v).toISOString().slice(0, 10) : '—');

const money = (key) => NUMERIC_KEYS.has(key) || /^(gmv|revenue|escrow|aov)/.test(key);

const ACRONYMS = { gmv: 'GMV', aov: 'AOV', pct: '%', id: 'ID', '7d': '7D', '30d': '30D' };

const label = (key) =>
  key
    .replace(/_/g, ' ')
    .replace(/\b3plus\b/g, '3+')
    .split(' ')
    .map((w) => ACRONYMS[w.toLowerCase()] ?? w)
    .map((w) => (w === '%' || w === '3+' || /^\d/.test(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ');

function renderValue(key, value) {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'number') {
    if (/_pct$/.test(key)) return pct(value);
    if (money(key)) return ngn(value);
    return num(value);
  }
  if (value instanceof Date) return d(value);
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value)) return d(value);
  // SQL-over-HTTPS returns NUMERIC and INT8 as strings to protect precision.
  if (typeof value === 'string' && /^-?\d+(\.\d+)?$/.test(value)) {
    const n = Number(value);
    if (/_pct$/.test(key)) return pct(n);
    if (money(key)) return ngn(n);
    return num(n);
  }
  return String(value);
}

function table(rows, title) {
  if (!rows?.length) return `### ${title}\n\nNo data.\n`;
  const cols = Object.keys(rows[0]);
  const head = `| ${cols.map(label).join(' | ')} |`;
  const sep = `| ${cols.map(() => '---').join(' | ')} |`;
  const body = rows
    .map((r) => `| ${cols.map((c) => renderValue(c, r[c])).join(' | ')} |`)
    .join('\n');
  return `### ${title}\n\n${head}\n${sep}\n${body}\n`;
}

function keyValueBlock(row, title) {
  if (!row) return `### ${title}\n\nNo data.\n`;
  const lines = Object.entries(row).map(([k, v]) => `- **${label(k)}:** ${renderValue(k, v)}`);
  return `### ${title}\n\n${lines.join('\n')}\n`;
}

function buildReport(results) {
  const o = results.overview?.[0] || {};
  const r = results.repeat_buyers?.[0] || {};
  const c = results.chat_funnel?.[0] || {};
  const q = results.data_quality?.[0] || {};

  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

  const warnings = [];
  if (q.test_rows_present > 0) warnings.push(`${plural(q.test_rows_present, 'smoke-test row is', 'smoke-test rows are')} still in the orders table.`);
  if (q.completed_but_unreleased > 0) warnings.push(`${plural(q.completed_but_unreleased, 'order is', 'orders are')} Completed with escrow still held — sellers not paid for delivered work.`);
  if (q.stale_escrow_30d > 0) warnings.push(`${plural(q.stale_escrow_30d, 'order has', 'orders have')} held escrow older than 30 days.`);
  if (q.orphan_orders > 0) warnings.push(`${plural(q.orphan_orders, 'order points', 'orders point')} at a post that no longer exists.`);
  if (q.self_buys > 0) warnings.push(`${plural(q.self_buys, 'order is', 'orders are')} a buyer buying from themselves.`);
  if (q.checkout_total_mismatches > 0) warnings.push(`${plural(q.checkout_total_mismatches, 'Paystack charge does', 'Paystack charges do')} not match the sum of their child orders.`);
  if (q.paid_orders_without_escrow_status > 0) warnings.push(`${plural(q.paid_orders_without_escrow_status, 'paid order has', 'paid orders have')} no escrow status set.`);

  const lines = [];
  lines.push('# ChatCart — Investor Metrics');
  lines.push('');
  lines.push(`Generated ${new Date().toISOString().slice(0, 19).replace('T', ' ')} UTC · read-only snapshot of the Neon primary.`);
  lines.push('');
  lines.push('## Headline');
  lines.push('');
  lines.push(`- **GMV (net of refunds and cancellations):** ${ngn(o.gmv_net)} across ${num(o.net_orders)} orders`);
  lines.push(`- **Platform revenue booked:** ${ngn(o.revenue_booked)} · **realised (Completed only):** ${ngn(o.revenue_realised)}`);
  lines.push(`- **Customers who paid:** ${num(o.buyers)} · **sellers who sold:** ${num(o.sellers)}`);
  lines.push(`- **Repeat purchase rate:** ${pct(r.repeat_rate_pct)} (${num(r.repeat_buyers)} of ${num(r.buyers)} buyers bought twice or more)`);
  lines.push(`- **Orders that started in a chat thread:** ${pct(c.pct_orders_from_chat)}`);
  lines.push(`- **Escrow held right now:** ${ngn(o.escrow_held_now)}`);
  lines.push('');

  if (warnings.length) {
    lines.push('## Before you show anyone this');
    lines.push('');
    for (const w of warnings) lines.push(`- ${w}`);
    lines.push('');
  }

  lines.push('## Money');
  lines.push('');
  lines.push(keyValueBlock(results.overview?.[0], 'Totals'));
  lines.push('');
  lines.push(table(results.aov, 'Checkout size'));
  lines.push('');
  lines.push(table(results.weekly, 'Weekly trend (last 12 weeks)'));
  lines.push('');
  lines.push(table(results.top_sellers, 'Top sellers by GMV'));
  lines.push('');

  lines.push('## Demand');
  lines.push('');
  lines.push(table(results.repeat_buyers, 'Repeat purchase'));
  lines.push('');
  lines.push(table(results.chat_funnel, 'Chat to order funnel'));
  lines.push('');

  lines.push('## Supply');
  lines.push('');
  lines.push(table(results.supply_funnel, 'Post to sale funnel'));
  lines.push('');
  lines.push(table(results.supply_activity, 'Supply activity'));
  lines.push('');
  lines.push(table(results.posts_weekly, 'Weekly posts and threads (last 12 weeks)'));
  lines.push('');

  lines.push('## Data quality');
  lines.push('');
  lines.push(keyValueBlock(results.data_quality?.[0], 'Checks'));
  lines.push('');
  lines.push(keyValueBlock(results.integrity_info?.[0], 'Integrity'));
  lines.push('');

  lines.push('---');
  lines.push('');
  lines.push('Definitions. An order counts as money only when a Paystack reference is attached to it. Net excludes');
  lines.push('cancelled orders and orders whose escrow status is refunded. Revenue booked = order total x the');
  lines.push('commission rate stored on that order at checkout. Rows created by the smoke tests are excluded.');
  lines.push('');

  return lines.join('\n');
}

async function main() {
  if (SQL_ONLY) {
    for (const [name, sql] of Object.entries(QUERIES)) {
      console.log(`\n-- ============================================================\n-- ${name}\n-- ============================================================\n${sql.trim()};\n`);
    }
    return;
  }

  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is not set. Export it, or run from services/chatcart-api (it reads .env).');
    process.exit(1);
  }

  const isLocal = /(^|@)(localhost|127\.0\.0\.1|\[::1\])(:|\/)/.test(url);

  // Prefer a direct TCP connection (full type fidelity). Many networks block
  // outbound 5432, so fall back to Neon's SQL-over-HTTPS endpoint on 443.
  let runQuery;
  let close = async () => {};
  let transport = 'tcp';

  const client = new pg.Client({
    connectionString: url,
    ...(isLocal ? {} : { ssl: { rejectUnauthorized: false } }),
  });

  try {
    await client.connect();
    runQuery = async (sql) => (await client.query(sql)).rows;
    close = () => client.end();
  } catch (err) {
    console.error(
      `\nDirect Postgres connection failed (${err.code || err.message}). Falling back to HTTPS on 443.`
    );
    transport = 'https';
    const host = new URL(url).hostname;
    runQuery = async (sql) => {
      const res = await fetch(`https://${host}/sql`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Neon-Connection-String': url },
        body: JSON.stringify({ query: sql, params: [] }),
        signal: AbortSignal.timeout(60000),
      });
      const text = await res.text();
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);
      return JSON.parse(text).rows || [];
    };
  }

  const results = {};
  try {
    for (const [name, sql] of Object.entries(QUERIES)) {
      try {
        results[name] = await runQuery(sql);
      } catch (err) {
        results[name] = null;
        console.error(`! ${name} failed: ${err.message}`);
      }
    }
  } finally {
    await close().catch(() => {});
  }

  console.error(`\nRead ${Object.keys(QUERIES).length} queries via ${transport}.`);
  const report = buildReport(results);
  console.log(`\n${report}`);

  if (!NO_WRITE) {
    fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
    fs.writeFileSync(OUT_PATH, report);
    fs.writeFileSync(OUT_PATH.replace(/\.md$/, '.json'), JSON.stringify(results, null, 2));
    console.log(`\nWrote ${OUT_PATH}`);
    console.log(`Wrote ${OUT_PATH.replace(/\.md$/, '.json')}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
