import {
  ESCROW_HELD,
  ESCROW_RELEASED,
  ESCROW_RELEASED_LEGACY,
  ESCROW_REFUNDED,
  ESCROW_REFUND_PENDING,
  isEscrowHeld,
  isEscrowReleased,
  isEscrowRefunded,
  isEscrowSettled,
  ledgerDocIds,
  roundMoney,
  sellerAmountForOrder,
  splitEarningsByEscrow,
  toSaleLedgerEntry,
  type SaleLedgerEntry,
} from '../escrow';

describe('escrow state', () => {
  it('treats released as released', () => {
    expect(isEscrowReleased(ESCROW_RELEASED)).toBe(true);
  });

  it('treats the legacy free-order value as released', () => {
    // Free orders wrote escrowStatus: 'completed' before this module existed.
    // If that were read as "not released", those sellers could never be paid.
    expect(isEscrowReleased(ESCROW_RELEASED_LEGACY)).toBe(true);
  });

  it('does not treat held or refunded as released', () => {
    expect(isEscrowReleased(ESCROW_HELD)).toBe(false);
    expect(isEscrowReleased(ESCROW_REFUNDED)).toBe(false);
    expect(isEscrowReleased(ESCROW_REFUND_PENDING)).toBe(false);
    expect(isEscrowReleased(undefined)).toBe(false);
  });

  it('treats a missing escrow status as held, never as released', () => {
    // A blank field must fail safe: unset means the money is still ours to hold.
    expect(isEscrowHeld(undefined)).toBe(true);
    expect(isEscrowHeld('')).toBe(true);
    expect(isEscrowHeld(ESCROW_RELEASED)).toBe(false);
  });

  it('knows when escrow has finished moving', () => {
    expect(isEscrowSettled(ESCROW_RELEASED)).toBe(true);
    expect(isEscrowSettled(ESCROW_REFUNDED)).toBe(true);
    expect(isEscrowSettled(ESCROW_HELD)).toBe(false);
    expect(isEscrowRefunded(ESCROW_REFUND_PENDING)).toBe(true);
  });

  it('derives both ledger document ids for single-seller refund lookups', () => {
    expect(ledgerDocIds('order-1', 'REF123')).toEqual(['ledger_order-1', 'ledger_REF123']);
    // No point listing the same id twice.
    expect(ledgerDocIds('order-1', 'order-1')).toEqual(['ledger_order-1']);
    expect(ledgerDocIds('order-1', null)).toEqual(['ledger_order-1']);
  });
});

describe('sellerAmountForOrder', () => {
  it('subtracts the commission stored on the order', () => {
    expect(sellerAmountForOrder({ total: 10000, commissionRate: 0.05 })).toBe(9500);
  });

  it('falls back to 5% when no rate was recorded', () => {
    expect(sellerAmountForOrder({ total: 20000 })).toBe(19000);
  });

  it('ignores a nonsense rate rather than paying out the full amount', () => {
    expect(sellerAmountForOrder({ total: 10000, commissionRate: -1 })).toBe(9500);
    expect(sellerAmountForOrder({ total: 10000, commissionRate: Number.NaN })).toBe(9500);
  });

  it('rounds to kobo', () => {
    expect(roundMoney(0.1 + 0.2)).toBe(0.3);
    expect(sellerAmountForOrder({ total: 3333, commissionRate: 0.05 })).toBe(3166.35);
  });
});

describe('toSaleLedgerEntry', () => {
  const base = { orderId: 'o1', amount: 9500, commission: 500 };

  it('reads a healthy sale', () => {
    expect(toSaleLedgerEntry('ledger_o1', base)).toEqual({
      orderId: 'o1',
      net: 9500,
      commission: 500,
    });
  });

  it('falls back to the document id when orderId is missing', () => {
    expect(toSaleLedgerEntry('ledger_o1', { amount: 100 })?.orderId).toBe('o1');
  });

  it('excludes fully refunded sales', () => {
    expect(toSaleLedgerEntry('ledger_o1', { ...base, refundStatus: 'refunded' })).toBeNull();
    expect(toSaleLedgerEntry('ledger_o1', { ...base, status: ESCROW_REFUNDED })).toBeNull();
  });

  it('excludes refunds still in flight', () => {
    // Once a refund is pending the money is the buyer's, not the seller's.
    expect(toSaleLedgerEntry('ledger_o1', { ...base, refundStatus: 'pending' })).toBeNull();
  });

  it('nets off a partial refund and prorates the commission', () => {
    const entry = toSaleLedgerEntry('ledger_o1', {
      ...base,
      amount: 10000,
      commission: 500,
      refundedSellerAmount: 2500,
      refundStatus: 'partial',
    });
    expect(entry).toEqual({ orderId: 'o1', net: 7500, commission: 375 });
  });

  it('drops a sale refunded down to nothing', () => {
    expect(
      toSaleLedgerEntry('ledger_o1', { ...base, refundedSellerAmount: 9500 })
    ).toBeNull();
  });

  it('ignores a zero-value sale', () => {
    expect(toSaleLedgerEntry('ledger_o1', { orderId: 'o1', amount: 0 })).toBeNull();
  });
});

describe('splitEarningsByEscrow — what a seller may actually withdraw', () => {
  const entries: SaleLedgerEntry[] = [
    { orderId: 'delivered', net: 9500, commission: 500 },
    { orderId: 'in-transit', net: 19000, commission: 1000 },
    { orderId: 'vanished', net: 1000, commission: 50 },
  ];

  it('counts only released orders as withdrawable', () => {
    // THE core rule. 'in-transit' has a completed ledger entry (that is how the
    // old code wrote it the moment the buyer paid) and must still not be payable.
    const result = splitEarningsByEscrow(
      entries,
      new Map<string, string | null | undefined>([
        ['delivered', ESCROW_RELEASED],
        ['in-transit', ESCROW_HELD],
        ['vanished', ESCROW_HELD],
      ])
    );

    expect(result.releasable).toBe(9500);
    expect(result.pendingEscrow).toBe(20000);
    expect(result.commission).toBe(500);
    expect(result.releasableOrders).toBe(1);
    expect(result.releasableOrderIds).toEqual(['delivered']);
  });

  it('does not pay out an order it cannot read', () => {
    const result = splitEarningsByEscrow(
      entries,
      new Map<string, string | null | undefined>([
        ['delivered', ESCROW_RELEASED],
        ['in-transit', null],
      ])
    );

    // 'vanished' is absent entirely, 'in-transit' resolved to null — both wait.
    expect(result.releasable).toBe(9500);
    expect(result.pendingEscrow).toBe(20000);
  });

  it('pays a free order through its legacy completed value', () => {
    const result = splitEarningsByEscrow(
      [{ orderId: 'free', net: 0, commission: 0 }],
      new Map([['free', ESCROW_RELEASED_LEGACY]])
    );
    expect(result.releasable).toBe(0);
    expect(result.releasableOrders).toBe(1);
  });

  it('excludes a refund in flight even if the order looks delivered', () => {
    // The order says released but the refund is pending: the refund wins, because
    // the buyer has already been promised their money back. It is neither
    // withdrawable nor "waiting" — that money is gone.
    const result = splitEarningsByEscrow(
      [entries[0]],
      new Map<string, string | null | undefined>([['delivered', ESCROW_REFUND_PENDING]])
    );
    expect(result.releasable).toBe(0);
    expect(result.pendingEscrow).toBe(0);
    expect(result.releasableOrders).toBe(0);
  });

  it('returns zeroes for a seller with no sales', () => {
    const result = splitEarningsByEscrow([], new Map());
    expect(result).toEqual({
      releasable: 0,
      pendingEscrow: 0,
      commission: 0,
      releasableOrders: 0,
      releasableOrderIds: [],
    });
  });

  it('adds up multiple released orders exactly, with no float drift', () => {
    const many: SaleLedgerEntry[] = Array.from({ length: 3 }, (_, i) => ({
      orderId: `o${i}`,
      net: 3166.35,
      commission: 166.65,
    }));
    const result = splitEarningsByEscrow(
      many,
      new Map<string, string | null | undefined>(many.map((e) => [e.orderId, ESCROW_RELEASED]))
    );
    expect(result.releasable).toBe(9499.05);
    expect(result.commission).toBe(499.95);
    expect(result.releasableOrders).toBe(3);
  });
});
