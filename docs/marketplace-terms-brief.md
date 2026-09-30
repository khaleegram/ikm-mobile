# Marketplace terms — working brief

Status: **draft brief, not legal advice.** This is the internal checklist of what the
terms have to cover, written from what the product actually does. It exists so
nothing is forgotten when a lawyer drafts the real document.

Two audiences: the founder (product truth) and the lawyer (what to draft).

## 1. The money model, as actually built

This is the truth the terms must describe. Do not describe a different product.

1. Buyer pays in full at checkout. The charge goes to the platform's Paystack
   account.
2. The platform **holds** that money. It is not paid to the seller at purchase.
3. The seller must accept the order. If they do not accept within **24 hours**,
   the order is cancelled and the buyer refunded.
4. The seller ships and marks the order as sent.
5. **48 hours** after shipment, if the buyer has not confirmed or disputed, the
   funds are released to the seller automatically.
6. The buyer can confirm receipt earlier, which releases immediately.
7. The buyer can open a dispute instead. That freezes the escrow until an admin
   resolves it — either releasing to the seller or refunding the buyer.
8. On release, the platform takes its **commission**, and the remainder becomes
   the seller's withdrawable balance.
9. The seller requests a payout. Minimum **₦5,000**, expected within **3 business
   days**. One pending payout per seller at a time.

## 2. Clause checklist

Grouped by what each clause has to accomplish. Each one should be drafted to match
the behaviour above.

### The platform's role and the hold
- The platform is a **marketplace/intermediary**, not the seller. The sale contract
  is between buyer and seller.
- The platform **receives payment on the seller's behalf and holds it** pending
  delivery. **State the legal capacity explicitly** — agent for the seller,
  custodian, or trustee. All three have different consequences and the lawyer must
  pick one.
- Funds are held in the platform's Paystack account, **not a segregated client
  account**. Say so. Do not imply ring-fencing that does not exist.
- What happens if the platform becomes insolvent during a hold.
- The platform's right to reverse or refuse a release.

### Release and refund triggers
- The 48-hour auto-release after shipment, and that it runs without further buyer
  action.
- Buyer confirmation releases immediately.
- Seller non-acceptance within 24 hours → cancellation and refund.
- Seller failing to ship within an agreed wait window → cancellation and refund.
- Refunds are returned via Paystack. **State that the platform does not control
  bank processing time** and refunds are not instant.
- **State, before payment, whether a refund can leave the buyer out of pocket.**
  If a fee can be withheld on any refund path, it must be disclosed at checkout,
  not only in the terms. Discovering it at refund time is the trust failure the
  product exists to prevent.
- What happens if a refund fails (e.g. the buyer's bank rejects it).

### Disputes
- How a buyer opens one, and by when.
- What evidence is required (photos, video, chat record).
- That opening a dispute freezes the funds.
- **Who decides and within what time** — no SLA exists in the product today, so
  either commit to one and build it, or state that timing is at the platform's
  discretion.
- The decision is final, and what happens if a party does not respond.
- The platform's right to release or refund unilaterally.

### Fees
- The seller commission is **tiered by order value**, not a flat rate. The terms
  must publish the rate card, and state that the rate applied is **the one
  published at the time of the order** — never a later change applied backwards.
  See `docs/checkout-commission-promo-model.md` §3 for the current card.
- **Buyer Protection** is a separate buyer-side fee. The terms must define what it
  actually covers (payment processing, the refund guarantee, dispute handling) and
  must not imply insurance or a standalone protection product. See §2 of the model
  doc.
- **Who bears Paystack's fee on a refund**, by cause of refund: seller when the
  seller failed, buyer when the buyer cancels, platform on its own error. See
  model doc §6.4.
- That the platform may **set off** a fee it bore against the responsible seller's
  future earnings. This clause is what makes fault-based recovery enforceable.
- Deductions that can reduce a payout: refunds, chargebacks, dispute losses, and
  set-off from earlier failed orders.
- **Notice period for changing fees.** Never let a fee change apply to an order
  already placed.
- Do not hard-code a rate in the terms with no change mechanism — the product
  reads rates from settings, so the terms need a "published rate at time of order"
  construction.

### Payouts
- Minimum ₦5,000, one pending at a time, expected 3 business days.
- The seller is responsible for accurate bank details.
- What happens to a payout sent to wrong details supplied by the seller.
- Unclaimed or dormant balances — **no rule exists today. Decide one.**
- Set-off: the platform's right to deduct from future payouts.

### Who owes what
- Buyer: pay, provide accurate delivery details, inspect on delivery, raise
  disputes in time.
- Seller: accurate listings, actually ship, honour the price, not cancel
  arbitrarily.
- Platform: hold funds properly, run the release rules, handle disputes in good
  faith.

### Prohibited items, accounts, and conduct
- What cannot be sold.
- Account suspension and what happens to money in a suspended account.
- That the platform may withhold funds from an account under investigation.

### Reviews, content, and data
- Rules for reviews after completion.
- Content ownership, licence scope, and takedown.
- Chat is stored and may be used as dispute evidence. **Say this explicitly** —
  buyers and sellers must know their conversation can be read for a dispute.

### Legal boilerplate
- Governing law (Nigeria) and the forum for disputes.
- Liability cap and exclusions.
- Changes to terms and how notice is given.
- Severability, entire agreement, assignment.
- Whether users are consumers under Nigerian consumer protection law and what
  that gives them.

## 3. Numbers that must stay in sync

Every one of these is configurable or in code. If a term states one, it must be
published from the same place the product reads it, or it will drift.

| Figure | Value | Source of truth |
|---|---|---|
| Auto-release after shipment | 48 hours | `functions/src/orders.ts` (`markOrderAsSent`) |
| Seller accept window | 24 hours | `functions/src/orders.ts` (`cancelIgnoredOrders`) |
| Offer expiry in negotiation | 72 hours | `services/chatcart-api/src/chat.mjs` (`OFFER_TTL_HOURS`) |
| Seller commission | **tiered 4% → 2% by order value** (proposed, not built) | `docs/checkout-commission-promo-model.md` §3 |
| Buyer Protection | covers Paystack's charge exactly (proposed) | model doc §2 |
| Minimum payout | ₦5,000 default | `platform_settings.minimumPayoutAmount` |
| Payout processing | 3 business days default | `platform_settings.payoutProcessingDays` |

The commission rate card is **proposed and not yet built** — today the system
still runs a flat 5%. Do not publish the tiered card in the terms until it ships.
The payout settings are **runtime settings, not constants**, so the terms must
either freeze them or promise only "the rate published at the time of your order."

## 4. Promises the product cannot keep yet

**Draft the terms against the system you will have, not the one you have today —
but do not publish a promise before it is true.**

| A term would naturally say | Reality today | Action |
|---|---|---|
| "Seller balances are paid out within 3 business days" | **Nothing pays sellers.** No transfer exists. Payouts only create a `pending` record and stop. | Either build payout before publishing this, or word it as an aspiration with no fixed time |
| "Commission is 5%" | Proposes to become tiered 4%→2%, not yet built; today it is still flat 5% with a hardcoded 5% fallback in code | Publish only the card that is actually live, with the "rate at time of order" construction |
| "Disputes are resolved within X days" | No SLA exists | Build the SLA or drop the number |
| "Funds are held in a segregated account" | They are in the platform's operating Paystack balance | Do not claim segregation |
| "Refunds are processed immediately" | Stuck at `refund_pending` until Paystack's webhook confirms | Say "processing time depends on your bank" |

The payout row is the serious one. The other four are wording. That one is a
promise the business currently cannot honour at any volume.

## 5. What must be true before volume

Not legal drafting — operational, and each is a real exposure:

1. **Manual Payouts must be enabled.** By default Paystack settles to the business's
   bank account daily, so there is nothing left in the balance to pay sellers with.
   Paystack calls the alternative *Manual Payouts* (payout schedule "Settled to
   Balance"): funds accrue in the Paystack balance and the business transfers them
   out via the Transfers API. It is **not a self-serve toggle** — support switches it
   on the back end, and the eligibility conditions are:
   - a **registered business** (starter businesses are not eligible),
   - **compliance completed and approved**,
   - ideally an existing transaction history,
   - no outstanding pending payouts.

   This account meets none of them yet: `business_type: starter`,
   `can_transfer: False`, `compliance_status: SUBMITTED` with `reviewed_at: null`,
   and compliance due 26 Nov 2025. Until the tier is upgraded and compliance is
   approved, there is no payout rail and the terms must not promise one.

   Separately, `transfer_using_otp` is `True`, so transfers pause for an OTP. For a
   fully automatic rail, uncheck *Confirm transfers before sending* in Preferences.
2. **Seller identity.** Nothing verifies who a seller is before they receive
   money. At volume this is the largest fraud surface. Terms should give the
   platform the right to verify and to hold funds pending verification.
3. **A ledger that can be reconciled.** Per-order escrow state exists; confirm it
   is complete enough to answer "how much do we owe, and to whom" on demand.
4. **Platform funds vs seller funds must be separable in reporting**, even if they
   sit in one balance. Right now they are the same number.
5. **A lawyer's review.** Send this brief to a Nigerian fintech lawyer. They will
   tell you which capacity to hold funds in and whether the shape is acceptable.

## 6. Open questions for the lawyer

- In what capacity should the platform hold funds — agent, custodian, or trustee?
- Does this trigger any CBN licensing threshold, and at what scale?
- Are sellers "merchants" and buyers "consumers" under Nigerian consumer law, and
  what rights does that create that the product does not currently honour?
- Is a stated auto-release period enforceable, or does it need active consent?
- What must be disclosed at checkout, before payment, versus in the terms?
- **Can a refund ever leave the buyer out of pocket?** Where the seller never
  performed, consumer protection generally restores the buyer to their
  pre-purchase position. Deducting Paystack's fee in that case may not be
  enforceable, which would move the cost to the platform or the seller. See
  `docs/checkout-commission-promo-model.md` §6.4.
- **Is the Buyer Protection name defensible** when it is priced to equal the
  payment cost? It funds genuine cover, but it must not read as insurance.
- **Is a seller set-off right enforceable** against future earnings from a seller
  who has left the platform?
- **BVN/NIN storage under the Nigeria Data Protection Act** — lawful basis,
  retention period, and whether hashing alone is sufficient.
- **Does VAT apply to commission and to Buyer Protection?** Paystack's own charge
  showed no VAT on the observed transactions, but the platform's own fees are a
  separate question — this may need an accountant rather than a lawyer.
- Liability cap: what is actually enforceable against a consumer in Nigeria?
