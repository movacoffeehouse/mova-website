// Runs supabase/schema.sql against an in-memory Postgres (PGlite) with a stand-in for
// Supabase's auth schema, then walks through a customer's and a barista's day.
// Usage:  cd tests && npm install && node schema.test.mjs
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

const schema = readFileSync(new URL("../supabase/schema.sql", import.meta.url), "utf8")
  // PGlite has no pgcrypto, so the test supplies look-alike crypt()/gen_salt() below.
  .replace(/create extension if not exists pgcrypto[^;]*;/i, "");

const db = new PGlite();
await db.exec(`
  create role anon; create role authenticated;
  create schema auth;
  create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb default '{}');
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
  create schema extensions;
  create function extensions.gen_salt(text) returns text language sql volatile as $$ select '$stub$' || substr(md5(random()::text), 1, 8) $$;
  create function extensions.crypt(pw text, setting text) returns text language sql immutable as $$ select left(setting, 14) || md5(left(setting, 14) || pw) $$;
`);
await db.exec(schema);

const ids = {
  sam:   "00000000-0000-0000-0000-000000000001",
  amara: "00000000-0000-0000-0000-000000000002",
  till:  "00000000-0000-0000-0000-0000000000a1",
  owner: "00000000-0000-0000-0000-0000000000b1",
};
await db.exec(`
  insert into auth.users values
   ('${ids.sam}', 'sam@example.com', '{"first_name":"Sam","marketing_opt_in":true}'),
   ('${ids.amara}', 'amara@example.com', '{"first_name":"Amara"}'),
   ('${ids.till}', 'till@movacoffee.co.uk', '{}'),
   ('${ids.owner}', 'owner@movacoffee.co.uk', '{}');
  insert into public.shop_accounts (user_id, role) values ('${ids.till}', 'till'), ('${ids.owner}', 'owner');
`);

const as = async (who, sql, params = []) => {
  await db.query(`select set_config('test.uid', $1, false)`, [who ? ids[who] : ""]);
  const r = await db.query(sql, params);
  return r.rows[0] ? Object.values(r.rows[0])[0] : undefined;
};
const fails = async (who, sql, params, msg) => {
  await assert.rejects(() => as(who, sql, params), e => e.message.includes(msg), `expected "${msg}"`);
};
let passed = 0; const ok = (label) => { passed++; console.log("  ✓ " + label); };

// Customers sign up
const sam = await as("sam", "select public.ensure_customer()");
assert.equal(sam.first_name, "Sam"); assert.match(sam.code, /^MV[A-Z2-9]{4}$/); assert.equal(sam.progress, 0);
assert.equal((await as("sam", "select public.ensure_customer()")).code, sam.code);
ok("sign-up creates one card with a MV code, and repeat calls keep the same card");
const amara = await as("amara", "select public.ensure_customer()");
await fails(null, "select public.ensure_customer()", [], "not_signed_in");
ok("signed-out callers are refused");

// Owner adds a barista
await fails("till", "select public.admin_save_staff(null, 'Priya', '1234', true)", [], "owner_only");
const priya = await as("owner", "select public.admin_save_staff(null, 'Priya', '1234', true)");
await fails("owner", "select public.admin_save_staff(null, 'Bad', '12a', true)", [], "pin_must_be_4_to_6_digits");
ok("only the owner can add staff, and PINs must be 4–6 digits");

// Till
await fails("sam", "select public.till_lookup($1)", [sam.code], "not_shop_account");
ok("customers cannot use the till");
assert.equal(await as("till", "select public.till_check_pin($1, '1234')", [priya]), true);
assert.equal(await as("till", "select public.till_check_pin($1, '9999')", [priya]), false);
ok("PIN check accepts the right PIN and rejects a wrong one");
assert.equal((await as("till", "select public.till_lookup($1)", ["mova:" + sam.code.toLowerCase()])).first_name, "Sam");
ok("lookup accepts the raw QR text (MOVA:…) in any case");
await fails("till", "select public.till_lookup('MVZZZZ')", [], "not_found");

let r = await as("till", "select public.till_add_stamps($1, 2, $2, '1234')", [sam.code, priya]);
assert.equal(r.status, "ok"); assert.equal(r.card.progress, 2); assert.equal(r.card.stops.length, 2);
assert.ok(["commute","mid","lunch","afternoon"].includes(r.moment));
ok("adding 2 stamps fills 2 stops, each tagged with the moment of the day");
r = await as("till", "select public.till_add_stamps($1, 1, $2, '1234')", [sam.code, priya]);
assert.equal(r.status, "confirm");
ok("a second stamp within 10 minutes asks for a confirm");
await fails("till", "select public.till_add_stamps($1, 1, $2, '0000', true)", [sam.code, priya], "wrong_pin");
await fails("till", "select public.till_add_stamps($1, 7, $2, '1234', true)", [sam.code, priya], "bad_quantity");
assert.equal((await as("sam", "select public.my_card()")).card_size, 3);
r = await as("till", "select public.till_add_stamps($1, 6, $2, '1234', true)", [sam.code, priya]);
// 2 + 6 = 8 coffees: two full cards of 3 (two free coffees) and 2 stamps on the next card.
assert.equal(r.rewards_earned, 2); assert.equal(r.card.progress, 2); assert.equal(r.card.rewards_available, 2);
assert.equal(r.card.total_coffees, 8);
ok("every 3 coffees earn a free coffee, and extra stamps carry onto the next card");

r = await as("till", "select public.till_redeem($1, $2, '1234')", [sam.code, priya]);
assert.equal(r.card.rewards_available, 1);
r = await as("till", "select public.till_redeem($1, $2, '1234')", [sam.code, priya]);
assert.equal(r.card.rewards_available, 0);
await fails("till", "select public.till_redeem($1, $2, '1234')", [sam.code, priya], "no_reward");
ok("each free coffee can be used once, not twice");

const today = await as("till", "select public.till_today()");
assert.equal(today.length, 4); assert.equal(today[0].kind, "reward"); assert.equal(today[0].staff, "Priya");
ok("today's log lists stamps and free coffees with the barista's name");

// Undo
const stampId = today.find(x => x.kind === "stamp" && x.qty === 6).id;
await as("till", "select public.till_void('stamp', $1, $2, '1234')", [stampId, priya]);
const card = await as("sam", "select public.my_card()");
assert.equal(card.total_coffees, 2); assert.equal(card.progress, 2); assert.equal(card.rewards_available, 0);
ok("undoing a stamp removes it from the card; a used free coffee isn't handed back twice");
await db.exec(`update public.stamps set created_at = now() - interval '2 hours' where voided_at is null`);
const oldId = (await db.query(`select id from public.stamps where voided_at is null limit 1`)).rows[0].id;
await fails("till", "select public.till_void('stamp', $1, $2, '1234')", [oldId, priya], "too_old_to_undo");
assert.equal(await as("owner", "select public.till_void('stamp', $1, $2, '1234')", [oldId, priya]), true);
ok("staff can undo for 30 minutes; the owner can undo anything");

// Moments and history
const moments = await db.query(`select public.moment_for(t) m from unnest(array[
  '2026-11-12 08:05+00','2026-11-12 09:29+00','2026-11-12 09:30+00','2026-11-12 11:45+00','2026-11-12 13:30+00','2026-07-01 07:45+00','2026-07-01 08:45+00'
]::timestamptz[]) t`);
// In July, 07:45 UTC is 08:45 in London (commute) and 08:45 UTC is 09:45 (mid-morning).
assert.deepEqual(moments.rows.map(x => x.m), ["commute","commute","mid","lunch","afternoon","commute","mid"]);
ok("moment boundaries use UK time, including British Summer Time");

await db.exec(`insert into public.stamps (customer_id, qty, moment, shop, created_at) values
  ('${ids.amara}', 3, 'commute', 'High Cross', now() - interval '3 days'),
  ('${ids.amara}', 1, 'lunch',   'High Cross', now() - interval '2 days'),
  ('${ids.amara}', 1, 'commute', 'High Cross', now() - interval '1 day')`);
const a = await as("amara", "select public.my_card()");
assert.deepEqual(a.moments, {commute: 4, mid: 0, lunch: 1, afternoon: 0});
assert.equal(a.discount_percent, 0);
// 5 coffees on a 3-stop card: one full card, then the last 2 coffees are on the current card.
assert.equal(a.progress, 2);
assert.deepEqual(a.stops.map(s => s.moment), ["lunch","commute"]);
assert.equal(a.history[0].moment, "commute"); assert.equal(a.history.length, 3);
ok("lifetime moment totals and card stops come back in the right order");

// Discounts
await fails("till", "select public.admin_set_discount($1, 20, 'High Cross tenant')", [amara.code], "owner_only");
await fails("amara", "select public.admin_set_discount($1, 20, 'High Cross tenant')", [amara.code], "not_shop_account");
await fails("owner", "select public.admin_set_discount($1, 120, 'x')", [amara.code], "bad_discount");
let d = await as("owner", "select public.admin_set_discount($1, 20, '  High Cross tenant ')", [amara.code]);
assert.equal(d.discount_percent, 20); assert.equal(d.discount_label, "High Cross tenant");
assert.equal((await as("till", "select public.till_lookup($1)", [amara.code])).discount_percent, 20);
assert.equal((await as("amara", "select public.my_card()")).discount_label, "High Cross tenant");
await as("till", "select public.till_add_stamps($1, 1, $2, '1234', true)", [amara.code, priya]);
assert.equal((await as("till", "select public.till_today()"))[0].discount_percent, 20);
ok("only the owner can give a discount; the till, the card and the stamp log all show it");
d = await as("owner", "select public.admin_set_discount($1, 0, 'ignored')", [amara.code]);
assert.equal(d.discount_percent, 0); assert.equal(d.discount_label, null);
ok("setting the discount to 0 removes it and its label");

// Owner overview and privacy
const ov = await as("owner", "select public.admin_overview()");
assert.equal(ov.members, 2); assert.equal(ov.marketing_opt_ins, 1);
assert.equal(ov.customers.find(c => c.first_name === "Amara").top_moment, "commute");
await fails("till", "select public.admin_overview()", [], "owner_only");
ok("owner overview counts members and works out each customer's top moment");

await as("sam", "select public.set_my_details('Samuel', false)");
assert.equal((await as("sam", "select public.my_card()")).first_name, "Samuel");
await as("sam", "select public.delete_my_account()");
assert.equal((await db.query(`select count(*)::int n from public.customers where id = '${ids.sam}'`)).rows[0].n, 0);
assert.equal((await db.query(`select count(*)::int n from public.stamps where customer_id = '${ids.sam}'`)).rows[0].n, 0);
ok("members can update their details and delete their account and history");

const grants = await db.query(`select has_function_privilege('anon', 'public.till_lookup(text)', 'execute') a,
  has_function_privilege('authenticated', 'public.till_lookup(text)', 'execute') b`);
assert.deepEqual(grants.rows[0], {a: false, b: true});
ok("signed-out website visitors can't call any MOVA Miles function");

// The schema file must be safe to run again on a live database (how updates are applied).
await db.exec(schema);
assert.equal((await db.query(`select count(*)::int n from public.customers`)).rows[0].n, 1);
ok("running the schema file again keeps existing members and data");

console.log(`\n${passed} checks passed`);
