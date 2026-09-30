# Checkout, commission and subsidy model

Status: **design, nothing implemented.**

Two constraints are fixed and measured, not assumed:

1. **Paystack charge: 1.5% + ₦100, capped at ₦2,000.** The ₦100 is waived when the
   charged amount is under ₦2,500. Taken from Paystack's published Nigeria pricing
   and the account's configured rates (`charge_percentage: 1.5`, `flat_rate: 100`,
   `flat_threshhold: 2500`). The cap binds from a charge of ₦126,666.67.
2. **Nigerian buyer distrust.** The reason the product exists. Every fee decision
   is judged against whether it makes a buyer more or less willing to pay.

All figures in **naira** unless stated. Rates are shown as percentages for
readability; storage must be integer kobo (see §9.4).

## 1. What this replaces

The app currently runs placeholder defaults from the demo, not designed values:

| Thing | Current value | Where |
|---|---|---|
| Seller commission | flat 5% | `platform_settings.platformCommissionRate` |
| Fallback when rate is missing | hardcoded 5% | `functions/src/escrow.ts` |
| Buyer fee | **none** | — |
| Delivery | ₦0 on market orders | `market-checkout.ts` |
| Wallet | **does not exist** | — |
| Promo / subsidy | **does not exist** | — |

Flat 5% loses money at ₦2,500. Commission of ₦125 against a Paystack charge of
₦137.50 is a **₦12.50 loss per order**. Charging by order size is required for
small orders to be viable at all.

## 2. The two-fee model

Two fees, two jobs. Neither side subsidises the other.

### Buyer Protection — covers the payment rail

Priced so it exactly equals Paystack's charge, making the platform neutral on
payments. Paystack's fee depends on the **charged** amount, not the item price, so
protection is a function of the charge and must be solved in three regimes:

```
fee(charge) = 0.015 × charge                              for charge < 2,500
              min(0.015 × charge + 100, 2,000)            otherwise

charge      = item_after_discount + protection
protection  = fee(charge)
```

Solving for the item price `t` gives a direct formula:

```
protection(t) = t ÷ 0.985 − t                             for t < 2,462.50
                (t + 100) ÷ 0.985 − t                     for 2,462.50 ≤ t < 124,666.67
                2,000                                     for t ≥ 124,666.67
```

The boundary in the first branch is the item price at which the charge lands
exactly on ₦2,500: `2,500 × 0.985 = 2,462.50`. Get this wrong and the flat fee is
silently dropped on items that do owe it, under-collecting roughly ₦101 per
affected order.

Protection is calculated on the **post-discount** charge, which is what makes it
match Paystack's fee.

### Seller commission — the platform's revenue

Taken from the item price only, never from the fee the buyer paid for the rail.
This is the actual income line.

### Naming

The fee equals Paystack's charge, while the copy calls it Buyer Protection. The
protection is genuine — escrow, refunds, dispute handling — and the buyer does
pay for it. The copy must therefore be literally true:

> covers payment processing and your refund guarantee

Do not imply insurance. Do not describe a separate protection product that does
not exist.

## 3. Seller commission rate card — Balanced

| Item price | Commission |
|---|---|
| Under ₦5,000 | 4% |
| ₦5,000 – ₦19,999 | 3.5% |
| ₦20,000 – ₦49,999 | 3% |
| ₦50,000 – ₦149,999 | 2.5% |
| ₦150,000 and above | 2% |

Rationale for this scale rather than a leaner one: a 1–3% scale does not cover
modelled infrastructure at 100,000 MAU, which is around $1,460/month.

### 3.1 The bracketed cliff

A ₦4,999 item pays **₦199.96** (4%) and a ₦5,000 item pays **₦175** (3.5%). The
seller pays *less* on the pricier item, so revenue is non-monotonic across band
edges.

The gap is ₦25, or 0.5%. Sellers at the boundary will notice it, and it mildly
discourages pricing just under a threshold. Accepted for launch; documented here
so it is a known property rather than a surprise.

Removing it would require progressive (marginal) rates — each slice charged at
its own band, like income tax — which is much harder for a seller to verify.

## 4. Worked example — where the money goes

| Item | Buyer pays | Protection | Paystack takes | Commission | Seller gets | Platform keeps |
|---|---|---|---|---|---|---|
| ₦2,500 | ₦2,639.60 | ₦139.60 | ₦139.59 | ₦100 (4%) | ₦2,400 | ₦100 |
| ₦10,000 | ₦10,253.81 | ₦253.81 | ₦253.81 | ₦350 (3.5%) | ₦9,650 | ₦350 |
| ₦50,000 | ₦50,862.95 | ₦862.95 | ₦862.94 | ₦1,250 (2.5%) | ₦48,750 | ₦1,250 |
| ₦500,000 | ₦502,000 | ₦2,000 | ₦2,000 | ₦10,000 (2%) | ₦490,000 | ₦10,000 |

Protection equals or narrowly exceeds Paystack's charge in every row, never falls
short of it. The sub-kobo difference is rounding in the platform's favour (§9.4),
so the platform neither gains nor loses materially on the rail and "platform
keeps" is pure commission.

### 4.1 Paystack's ₦2,500 boundary

The waiver is keyed to the **charge**, not the item price. The boundary is
therefore an item price of **₦2,462.50**, where the no-flat charge lands exactly on
₦2,500.

| Item | Charge | Protection | As % of item |
|---|---|---|---|
| ₦2,462.49 | ₦2,499.99 | ₦37.50 | 1.52% |
| ₦2,462.50 | ₦2,601.53 | ₦139.03 | **5.65%** |

A one-kobo price difference costs the buyer **₦101.52**, because the ₦100 flat fee
becomes due and protection is grossed up to cover it. That figure is exactly the
flat fee solved through the same equation (`100 ÷ 0.985`). Sellers pricing small
items just above ₦2,462.50 create a bad experience without knowing it. This should
be surfaced in the seller UI and handled by a platform rule.

Above the cap the problem disappears: at a charge of ₦126,666.67 the fee stops
growing, so protection is a flat ₦2,000 and the effective rate falls with every
naira added.

## 5. Subsidy — the Awoof promo

**Principle: partial discount, never free goods.** The buyer always pays real
money; the platform funds the gap so the seller still receives their full price.

A capped 15% on a ₦10,000 order costs the platform **₦1,150** net and brings in
₦8,730.96 of real buyer cash. The same ₦2,000,000 funds ~1,739 discounted orders
rather than ~200 free ones.

### 5.1 The cap is continuous

```
discount = min(15% × item, cap)
cap      = min(15,000, max(2,000, 5% × item))
```

Everyone gets 15% off until the cap binds. The cap is 5% of the order value, with
a ₦2,000 floor and a ₦15,000 ceiling.

A bracketed cap would be a cliff: ₦99,999 would have taken a ₦5,000 discount and
₦100,000 a ₦15,000 one, so a ₦1 price change would have moved ₦10,000 and sellers
would have repriced around the boundary. A continuous cap removes it.

| Item | 15% | Cap | Discount | Commission | Platform net cost |
|---|---|---|---|---|---|
| ₦2,500 | ₦375 | ₦2,000 | ₦375 | ₦100 (4%) | ₦275 |
| ₦10,000 | ₦1,500 | ₦2,000 | ₦1,500 | ₦350 (3.5%) | ₦1,150 |
| ₦20,000 | ₦3,000 | ₦2,000 | ₦2,000 | ₦600 (3%) | ₦1,400 |
| ₦40,000 | ₦6,000 | ₦2,000 | ₦2,000 | ₦1,200 (3%) | ₦800 |
| ₦100,000 | ₦15,000 | ₦5,000 | ₦5,000 | ₦2,500 (2.5%) | ₦2,500 |
| ₦150,000 | ₦22,500 | ₦7,500 | ₦7,500 | ₦3,000 (2%) | ₦4,500 |
| ₦300,000 | ₦45,000 | ₦15,000 | ₦15,000 | ₦6,000 (2%) | ₦9,000 |
| ₦500,000 | ₦75,000 | ₦15,000 | ₦15,000 | ₦10,000 (2%) | ₦5,000 |
| ₦750,000 | ₦112,500 | ₦15,000 | ₦15,000 | ₦15,000 (2%) | **₦0 — exact break-even** |
| ₦1,000,000 | ₦150,000 | ₦15,000 | ₦15,000 | ₦20,000 (2%) | **+₦5,000 profit** |

Break-even is exactly ₦750,000, where commission equals the ₦15,000 ceiling.

### 5.2 Tickets gate the top band

A ticket is required once the cap exceeds ₦5,000, which happens above an item
price of **₦100,000**. Below that the discount is standard, no ticket needed.

Even at the ceiling, 25 big tickets a month cost under 10% of budget. **The ticket
limit is therefore a marketing device, not a cost control.** Scarcity is the
product. "3 Awoof deals left this month", visible in-app, does as much work as the
discount — and a big cap that is always available stops being an event and becomes
an ordinary price cut.

### 5.3 Ticket entitlement

| Concept | Scope | Rule |
|---|---|---|
| **Baseline entitlement** | Per identity | **1 big ticket, lifetime.** Every buyer gets one, so the top tier is reachable on a first order |
| **Referral grants** | Per identity | Additional entitlement on top of the baseline: +1 one-time (5 friends), +2/month (10 friends), +5/month (20 friends) |
| **Monthly issue pool** | Global | Caps tickets *issued* per month for budget pacing. If more people qualify than the pool allows, they queue to the next month |

The baseline makes the top tier part of the ordinary experience. Referral grants
are strictly additional, which is why they do not conflict with a one-per-identity
baseline. The global pool paces spend.

### 5.4 Two discount types

| Type | Purpose | Restriction |
|---|---|---|
| **Awoof promo** | Acquire new buyers | Buyer's **first order only** |
| **Referral reward** | Retain and reward existing buyers | Usable on **any** order |

Tickets are independent of discount type. A first-time buyer holding the baseline
ticket may spend it with Awoof on an order above ₦100,000. A referrer spends
earned tickets with a referral reward on any order. **The two discount types never
stack** — one discount per order — which keeps the subsidy computable and stops a
15% Awoof and a ₦500 reward from combining on a small order.

### 5.5 Referral unlocks

| Friends who complete an order | Reward earned at this tier | Total reward ever | Also unlocks |
|---|---|---|---|
| 1 | ₦500 | ₦500 | — |
| 3 | +₦1,000 | ₦1,500 | — |
| 5 | +₦1,500 | ₦3,000 | +1 big ticket (one-time) |
| 10 | +₦2,000 | ₦5,000 | +2 tickets/month |
| 20 | +₦3,000 | ₦8,000 | +5 tickets/month |

Rewards are paid as **increments**, not re-issued at each tier. The totals are the
headline numbers, and nobody loses a reward by passing a tier. The ladder is
one-time: **maximum ₦8,000 per referrer, ever.** Only tickets recur monthly, so
the recurring exposure is bounded by the monthly issue pool.

Each invited friend gets ₦500 off their own first order, so they have a reason to
**buy**, not just sign up.

**Count completed orders, never invites sent.** Invite-count is the most farmed
mechanic in consumer apps; five dead accounts take a minute. Additionally:

- **Minimum order value** for a referral to count, and for a reward to be
  redeemed. Without it, five ₦500 orders unlock a ₦15,000 cap. See §8.3 and §14.
- **Count only after the dispute window closes**, so a referral cannot rest on an
  order that is later refunded.
- **Distinct BVNs** required across referrer and referee.

#### 5.5.1 Referral rewards exceed single-order commission

A referral reward is never covered by the commission on the order it is spent on.
The commission needed to cover a ₦500 reward is only reached at an item price of
about ₦16,700, and the higher tiers need orders far into six figures:

| Reward | Item price at which commission alone covers it |
|---|---|
| ₦500 | ~₦16,700 |
| ₦1,500 | ~₦60,000 |
| ₦3,000 | ~₦120,000 |
| ₦5,000 | ~₦200,000 |
| ₦8,000 | ~₦320,000 |

On a ₦2,500 order a ₦500 reward costs the platform **₦400 net**, because the
commission is only ₦100.

This is not a flaw to engineer away — it is what a customer-acquisition cost looks
like. It must be treated as **acquisition spend recovered over repeat orders**, and
gated by the repeat rate in §10.1, not judged against the single order's margin.
Two bounds keep it honest: the ladder is one-time, and a reward is only redeemable
on an order of ₦10,000 or more, so the worst ratio on a ₦2,500 order cannot occur.

### 5.6 Reward shape — discount, not cash

Rewards are discounts on a future order. A discount cannot be cashed out, so it
needs **no wallet** and no withdrawal path. That removes both the largest fraud
vector and a large build.

## 6. Promo order lifecycle

Escrow holds **less** than the seller is owed:

| Component | ₦10,000 promo order |
|---|---|
| Escrow holds (buyer paid) | ₦8,730.96 |
| Paystack takes | ₦230.96 |
| Lands in platform balance | ₦8,500 |
| Seller is owed (item − commission) | ₦9,650 |
| **Gap the platform must fund** | **₦1,150** |

### 6.1 The liability model

| Event | Action |
|---|---|
| **Charge time** | Record a platform liability of the gap (discount − commission) against the order |
| **Release** | Platform funds the gap so the seller receives the full amount owed |
| **Refund** | Liability is cancelled. Buyer receives what they actually paid |

There is no phantom money and no double-count: a refund returns exactly what was
collected.

### 6.2 Promo orders enter escrow

`escrowStatus: 'held'` is **true** for a promo order, because buyer money is
genuinely held. There is one lifecycle, with an extra funding leg. What differs:

- A recorded platform liability covering the gap (§6.1)
- A funding-source tag (`fundingSource: 'platform_promo'`)
- Release rules that combine buyer funds and platform funds

### 6.3 The subsidy is real cash, not only a liability

The gap must exist as **cash in the Paystack balance at the moment of release**,
because transfers draw from that balance. A liability recorded only in the
database does not fund a transfer.

So the ₦2,000,000 budget is a **reserved balance**: it is parked in the Paystack
account and drawn down as promo orders release, not merely tracked as an
accounting figure.

Reconciliation rule, checked continuously and before every promo issuance:

```
available Paystack balance  ≥  seller-owed escrow
                             + committed payouts (pending and pending_otp)
                             + unspent promo budget
```

If projected promo liability would breach that, promo issuance **pauses**. Without
this check the platform can accept orders it cannot fund on release, which is the
one failure mode where the marketplace cannot pay a seller who did nothing wrong.

Reconciliation must report budget versus disbursed, so the drawdown is observable
rather than inferred from the balance.

### 6.4 Who bears Paystack's fee on a refund — by fault

Paystack does not return its fee when a transaction is refunded, so someone
absorbs it. The buyer is not the default bearer: that would charge them for
someone else's failure.

**Partial refunds are already supported** — the refund flow accepts an explicit
`amountNgn` and only defaults to the full remaining amount (`refunds.ts`). Who
bears the fee is therefore an amount decision, not new machinery.

| Why the refund happened | Who bears the fee | Mechanism |
|---|---|---|
| **Seller at fault** — never shipped, cancelled, lost a dispute | **Seller.** Buyer made whole | Set-off against the seller's future earnings. Requires the set-off right in the terms |
| **Buyer cancels / changes mind** | **Buyer** | Refund reduced by the fee |
| **Platform error** — duplicate charge, bug | **Platform** | Absorb it |
| **Seller has no balance to set off** | Platform absorbs; seller flagged | Cannot recover what does not exist. Suspension threshold applies |

#### 6.4.1 Why the buyer is not the default bearer

1. **It contradicts "Buyer Protection."** "You are protected — you will only lose
   ₦254" is not protection, and the name becomes a trick.
2. **It is regressive.** ₦139.60 on ₦2,500 is **5.58%**; ₦2,000 on ₦500,000 is
   **0.4%**. It falls hardest on buyers with the least capacity and the least
   existing trust.
3. **It suppresses disputes.** A buyer who loses money by complaining complains
   less, muting the signal that keeps the market safe.
4. **Legal exposure.** Where the seller never performed, consumer protection
   generally restores the buyer to their pre-purchase position. Withholding a fee
   can run against that. See §13 decision 19.

#### 6.4.2 Disclosure before payment

If any refund path leaves the buyer out of pocket, the checkout modal must state
it before payment. Discovering it at refund time is the trust-destroying surprise
the product exists to prevent.

#### 6.4.3 Cash-flow note

Paystack's fee is spent at charge time; recovery from the seller happens later by
set-off. If the seller never sells again it is never recovered. Model a bad-debt
allowance rather than assuming full recovery.

## 7. Self-dealing — quantified

Because the buyer pays real money, giving the discount to yourself requires
fronting capital.

| | Self-dealer nets | Platform loses |
|---|---|---|
| ₦10,000 fake order | **+₦919.04** | **−₦1,150** |
| ₦500,000 fake order (with ticket) | **+₦3,000** | **−₦5,000** |

Arithmetic for ₦10,000: buyer pays ₦8,730.96; Paystack takes ₦230.96; seller
(same person) receives ₦9,650. Fraudster +₦919.04, Paystack +₦230.96, platform
−₦1,150.

Per order the gain is small. **At volume it is not:** 100 fake ₦10,000 orders
extract **₦91,904** from the platform at a cost of **₦115,000**.

### 7.1 Capital lockup is a rate limiter, not a cap

The fraudster's float returns after each release, so a patient attacker with a few
thousand naira can cycle it repeatedly. Lockup only bites if promo holds are
**meaningfully longer** than the standard 48 hours.

The promo hold length is therefore explicit:

| Order type | Release |
|---|---|
| Normal order | Buyer confirmation, or 48h after the seller marks the order sent — whichever comes first |
| **Promo-funded order** | Buyer confirmation, or **7 days after the seller marks the order delivered** — whichever comes first |

Buyer confirmation always releases immediately, on both paths. The longer window
is the fallback for a buyer who never confirms, not a penalty for confirming. At
7 days, cycling is slow, and the float requirement per unit of extraction rises
about 3.5x.

### 7.2 The payout gate is the primary defence

Money must leave as a verified bank withdrawal to a name matching the account.
That is where identity is enforced, and it matters more than the hold.

## 8. Anti-fraud guardrails

### 8.1 Identity ladder — friction proportional to value

Verification is tied to the **cap band**, not to whether a discount exists. A
small discount must not put a KYC step in front of a first-time buyer; that works
against the buyer-trust constraint in the header.

| Discount | Requirement |
|---|---|
| Standard discount (cap ≤ ₦5,000, item ≤ ₦100,000) | Verified phone |
| Top band (cap > ₦5,000, item > ₦100,000) | BVN/NIN + bank account in the buyer's own name |

BVN is load-bearing for the top band: tied to a real identity, not easily
recycled, and it makes mass account creation expensive. It gates the band where
the money is.

**Buyers never need a payout path.** There is no wallet (§5.6), and refunds return
to the original payment method, so a buyer has nothing to withdraw. Identity is
enforced where money actually leaves — the seller's payout (§7.2) — which is the
choke point that matters. Verification on the buyer side exists only to make
buyer ≠ seller checkable.

### 8.2 Hard blocks and risk signals

BVN and bank account are hard blocks. Device and network signals are not, because
Nigerian mobile networks use carrier-grade NAT so unrelated people share IPs, and
family members share phones. Blocking on those would reject legitimate users.

| Signal | Treatment |
|---|---|
| **BVN match** | **Hard block** |
| **Bank account match** | **Hard block** |
| Same device fingerprint | Risk signal → manual review |
| Same IP | Risk signal → manual review |
| Same phone number | Risk signal → manual review |

### 8.3 Guardrails

| Rule | Blocks |
|---|---|
| Buyer ≠ seller on BVN and bank | Self-dealing |
| Caps keyed to BVN, not account id | Account-multiplying to reset caps |
| Baseline one big ticket per identity; referral grants are additional | Repeat claiming of the top band |
| Minimum order value to qualify for, and to redeem, a referral reward | Farming with trivial orders |
| Referral counts only after dispute window | Referrals on refunded orders |
| Distinct BVNs across referrer/referee | Referral farming |
| One discount per order — Awoof and referral rewards never stack | Combining subsidies on one order |
| Cap total promo spend per seller | One seller absorbing the budget |
| Daily/weekly budget pacing | Spending ₦2M in week one |
| Discount on a buyer's first order only | Paying for existing customers |
| Pairs created minutes apart | The classic pair-farm |

The load-bearing rules are the first three. Without caps keyed to identity, every
other limit is bypassable by creating another account.

### 8.4 Promo payout review

The 7-day hold in §7.1 is not a review; it is the promo release window and applies
to every promo order. Review is separate and narrow: the **first** promo-funded
payout from a seller, or any payout from a flagged account, goes to manual review.
Everything else releases on the normal schedule. A blanket no-auto-release would
punish honest sellers for the behaviour of a few.

## 9. Costs to model

### 9.1 Payout transfers (per payout, not per order)

| Transfer amount | Paystack fee | Stamp duty | Total |
|---|---|---|---|
| ≤ ₦5,000 | ₦10 | — | ₦10 |
| ₦5,001 – ₦9,999 | ₦25 | — | ₦25 |
| ₦10,000 – ₦50,000 | ₦25 | **₦50** | **₦75** |
| Above ₦50,000 | ₦50 | **₦50** | **₦100** |

Stamp duty is a Nigerian government levy under the **Nigeria Tax Act 2025**, in
force from **1 January 2026**, on electronic transfers of ₦10,000 or more. It is
reclassified from the former Electronic Money Transfer Levy, the amount is
unchanged at ₦50, and liability moved to the **sender** of the transfer rather
than the recipient. Exemptions include transfers below ₦10,000, salary payments,
and intra-bank self-transfers. Paystack does not keep it.

The platform is the sender, so it bears the ₦50. Paystack's transfer fee schedule
on the account itemises only the ₦10/₦25/₦50 transfer fee, with no separate stamp
duty line, so whether it is charged on top or absorbed should be confirmed on the
first live payout before this figure is treated as settled.

**Implication: batch payouts, never per-order.** The cost is per withdrawal, so a
seller with 50 orders withdrawing once pays ₦100 total. This is a strong argument
for keeping the existing ₦5,000 minimum and one-pending-payout rule.

### 9.2 KYC unit cost

BVN/NIN checks are paid **per check**. Free users completing KYC to unlock a small
discount is a real cost. A per-check price is needed before setting the threshold
at which KYC is required — and §8.1 deliberately restricts KYC to the top band
partly to keep this cost off the common path.

### 9.3 Small buyers pay the most

At ₦2,500 the buyer adds **5.58%**; at ₦500,000 it is 0.4%. The fee hits hardest
where trust is lowest and orders are smallest — the opposite of what the product
constraint in the header wants.

Options, with the cost of each on a ₦2,500 order:

| Option | Buyer pays extra | Platform keeps (after 4% commission of ₦100) |
|---|---|---|
| Full pass-through | ₦139.60 | ₦100 |
| Cap protection at 2% of item | ₦50 | ₦11.75 |
| Absorb the ₦100 flat below ₦5,000 | ₦38.07 | **₦0** |

Each relief row is computed on the charge it actually produces, not on the
full pass-through fee. Capping protection at 2% makes the charge ₦2,550, on which
Paystack takes ₦138.25, so the platform absorbs ₦88.25 against the ₦100
commission and keeps ₦11.75.

Every form of relief costs most of the commission on small orders. **Small orders
barely work at any fee split.** The remaining options are to accept it, set a
marketplace minimum order value near ₦2,500, or treat small orders as paid
acquisition. A/B test before deciding; Buyer Protection on a new buyer's first
order is the strongest candidate for a deliberate subsidy.

### 9.4 Money storage and rounding

Store all money as **integer kobo**. Never store floats.

Protection rounds **up** to the kobo, not half-up, and the charge is then
`item + protection` so the two always reconcile exactly. Protection must be at
least Paystack's actual charge; rounding down by a fraction of a kobo would leave
the platform paying the difference on every order, which is invisible in testing
and accumulates across millions. Commission and discount may round half-up, since
an error there moves money between the platform and the seller rather than against
the rail.

Protected by a test: for every item price from ₦1 to ₦3,000,000, the rounded
protection must be greater than or equal to Paystack's fee on the resulting charge.

### 9.5 VAT and tax

Paystack's charge on the observed transactions showed no VAT on top (₦10,000 →
exactly ₦250). Whether **VAT applies to commission and to Buyer Protection** — and
whether the ₦50 stamp duty is recoverable — is unanswered and needs an accountant.

## 10. Metrics integrity

**Subsidised orders must never be reported as unsubsidised.** Discounted orders
carry real Paystack references, so they flow into every existing metric by default.

Excluding them entirely is also wrong, because it understates real buyer cash. The
buyer genuinely pays that money, and it is genuine demand. The correct treatment
is to include the order, label the subsidy, and net it:

- GMV includes the buyer's real payment
- A **subsidised share** is reported as its own line, never blended
- The platform subsidy is **netted against revenue**, so take rate reflects it
- Order counts distinguish fully-paid from subsidised

Every promo order must record:

- `fundingSource: 'platform_promo'`
- The code used, the platform's contribution, and the referral chain
- Whether the discount was Awoof or a referral reward

The rule that matters is that it is **never hidden**. The current metrics script
filters on having a Paystack reference, which is insufficient — it must carry the
subsidy label through to every report.

### 10.1 Payback

On a ₦10,000 promo order: platform cost **₦1,150**, ongoing commission **₦350**
per full-price order.

- Needs 3.29 further orders to recover → **4 more full-price orders**
- Cumulative profit turns positive after **5 orders total** (1 promo + 4 full price)

**Track repeat rate before scaling the ₦2M.** If the promo cohort does not return
4+ times, the subsidy is a giveaway with better branding. This is the number that
should gate the budget, and it applies equally to referral rewards, which are
never recovered on the order they are spent on (§5.5.1).

## 11. Checkout modal — UI mechanics

The modal exists and works (`components/market/payment-sheet-modal.tsx`, states
`REVIEW`, `INITIALIZING`, `GATEWAY`, `CONFIRMING`, `SUCCESS`, `ERROR`).

### 11.1 Display

- **Awoof price as the headline**, original struck through, **"App Only"** badge.
  "Awoof" means bargain in Nigerian street usage and carries none of the staleness
  of "promo".
- **Buyer Protection** as its own line with a plain reason — never an unexplained
  surcharge.
- **Remaining ticket count** ("3 Awoof deals left this month").
- The seller always sees the full item price and normal commission, never a
  discounted number.

### 11.2 Honesty rule

Only strike through a price the item genuinely sold at. A fake reference price is
misleading pricing and a regulatory risk, not a growth hack.

### 11.3 New states needed

Discount applied (with amount), an Awoof receipt line, and a clear failure state
for a rejected code or exhausted ticket — saying why, and when it resets.

## 12. What must be built

| Item | Size | Note |
|---|---|---|
| Tiered commission table + admin UI with effective dates | Medium | Otherwise every rate change is a deploy |
| Buyer Protection as a three-regime function of the charge | Small | Not on delivery fees. Ceiling rounding in §9.4 |
| Promo code and contribution ledger | Medium | No wallet needed |
| Continuous cap formula | Small | Replaces the bracketed cap |
| Platform-liability record per promo order (§6.1) | Small | Required for correct release |
| **Reserved-balance reconciliation (§6.3)** | Medium | Blocks issuance when unfundable |
| Promo release window (7 days) | Small | Distinct from the 48h normal path |
| Referral tracking, order-completion gated, incremental milestones | Medium | Most farmed surface |
| Identity ladder (phone vs BVN/bank) | **Large** | External provider, per-check cost |
| Fraud matching (BVN/bank hard, device/IP soft) | Medium | |
| Risk score + manual review queue | Medium | Gates promo payouts |
| Metrics: subsidy label through every report | Small | Non-optional |
| Money-as-integer-kobo migration | Medium | Touches every amount in the system |

## 13. Decisions

| # | Decision | Value |
|---|---|---|
| 1 | Delivery fees in the commission base | No commission and no protection on delivery fees |
| 2 | Partial refunds | Proportionate |
| 3 | The hardcoded 5% fallback | Removed. Fail loudly rather than bill a guessed rate |
| 4 | Protection on post-discount charge | Yes — that is what makes it match Paystack |
| 5 | Who bears Paystack's fee on a refund | By fault (§6.4): seller when at fault, buyer when they cancel, platform on its own error |
| 6 | Promo release window | Buyer confirmation, else 7 days after delivery; normal orders 48h after shipment |
| 7 | Small-order buyer fee relief | A/B test; consider subsidising a new buyer's first order |
| 8 | Big ticket count | 5/month — a marketing choice, not a cost constraint |
| 9 | Rounding rule | Integer kobo; protection rounds up, commission and discount round half-up |
| 10 | Cap shape | Continuous: 15% off, capped at 5% of item, ₦2,000 floor, ₦15,000 ceiling |
| 11 | Ticket baseline | 1 per identity, lifetime, so the top band is reachable on a first order |
| 12 | Referral reward shape | Increments, not re-issued; one-time, max ₦8,000 per referrer |
| 13 | Referral redemption floor | ₦10,000 item price |
| 14 | Discount stacking | Never — one discount per order |
| 15 | Identity gate | Phone for standard discounts; BVN + own-name bank for the top band |

Still open:

| # | Decision | Options |
|---|---|---|
| 16 | Budget exhausted mid-month | Codes die, or queue to next month |
| 17 | Referral reward expiry | Expiry drives urgency; too short feels unfair |
| 18 | Who reviews the first promo payout | Needs a named owner and a time bound |
| 19 | Enforceability of a fee deduction on refund | Lawyer question. Consumer protection may require the buyer be made whole when the seller never performed |

## 14. Known gaps

1. **Referral farming with five real orders.** A genuine buyer of a ₦100,000 item
   can profitably farm five small orders to unlock the top band. A minimum order
   value, dispute-window delay and distinct BVNs help; a complete fix probably does
   not exist. **Unresolved.**
2. **Recovering Paystack fees on refunds.** Fault-based recovery depends on the
   seller selling again. If they never do, the platform absorbs it. Needs a
   bad-debt allowance and a suspension threshold for sellers accumulating unpaid
   fee debt.
3. **Small-order economics.** Buyer fee is 5.58% at ₦2,500 and every relief option
   costs most of the commission. See §9.3. **Unresolved.**
4. **KYC unit cost against discounts.** Unmodelled until a per-check price is
   known. §8.1 limits exposure but does not price it.
5. **Promo liability accounting.** The §6.1 model is sound in principle, and §6.3
   makes the cash requirement explicit, but reconciliation across many
   simultaneously-open promo orders is untested.
6. **Risk review queue.** The soft signals in §8.2 need an owner and a time bound,
   or the queue becomes a backlog.
7. **Bracketed commission cliffs.** Documented, not fixed. Revenue is
   non-monotonic across the rate-card band edges (§3.1), which is a separate cliff
   from the discount cap now removed in §5.1.
8. **Compliance.** Storing BVN/NIN falls under the Nigeria Data Protection Act —
   store hashes where possible, minimise retention, get consent, confirm the lawful
   basis. VAT on commission and protection, and stamp duty recoverability, need an
   accountant. Neither is resolvable in this document.
9. **₦2,000,000 reserved balance.** Sizing is a capital decision, not a formula.
   The reserve must cover liability at all times (§6.3), so the budget and the
   working balance are not independent.

## 15. Related documents

- `docs/marketplace-terms-brief.md` — what the terms must cover
- `docs/firebase-exit-plan.md` — backend migration, including moving payments off
  Cloud Functions
- `docs/investor-metrics.md` — the metrics that must carry the subsidy label
