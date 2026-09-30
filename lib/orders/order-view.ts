import type { Order } from '@/types';

/**
 * The whole order page, decided in one place.
 *
 * The page used to work out what to show in six separate blocks scattered through the markup
 * (`isSeller && status === 'Paid'`, `isSeller && (Accepted || Preparing || ...)`, and so on),
 * with the "where is it" answer written three times in the header, the summary, and a timeline.
 * That is why it read as messy: every rule was re-derived in the view.
 *
 * Here the rules live once. The screen just renders whatever this says. Adding a status means
 * adding an entry to the switch, not hunting through the page for the places it leaks out.
 */

export type OrderRole = 'buyer' | 'seller';

/** Drives colour. Kept small on purpose — five meanings, not eleven statuses. */
export type OrderTone = 'neutral' | 'info' | 'progress' | 'warn' | 'success' | 'danger';

export type OrderStep = {
  key: string;
  label: string;
  done: boolean;
  current: boolean;
  /** When this step happened, if it has. */
  at: Date | null;
};

export type OrderAction = {
  id: string;
  label: string;
  hint?: string;
  icon?: string;
  tone?: 'default' | 'danger' | 'success';
  run: () => void;
};

export type OrderView = {
  role: OrderRole;
  tone: OrderTone;
  /** Where the order is. One line, no jargon. */
  headline: string;
  /** What happens next, or what the buyer/seller should do. */
  detail: string;
  /** The four-step journey. Four, not eleven. */
  steps: OrderStep[];
  /** The single next thing to do, if there is one. */
  primary: { label: string; tone: 'primary' | 'success' | 'danger'; run: () => void } | null;
  /** Everything else, kept out of the way in a sheet. */
  secondary: OrderAction[];
  escrow: { label: string; amount: string; detail: string; tone: OrderTone };
  /** Full event log, for the rare person who wants it. */
  history: { label: string; at: Date | null }[];
};

export type OrderHandlers = {
  accept: () => void;
  markSent: () => void;
  markReceived: () => void;
  cancel: () => void;
  dispute: () => void;
  review: () => void;
};

export const TONE_COLORS: Record<OrderTone, string> = {
  neutral: '#9CA3AF',
  info: '#0EA5E9',
  progress: '#A67C52',
  warn: '#F59E0B',
  success: '#10B981',
  danger: '#EF4444',
};

export function toDate(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof (value as any)?.toDate === 'function') return (value as any).toDate();
  return null;
}

export function formatMoney(value: number): string {
  return `NGN ${Math.round(value).toLocaleString()}`;
}

/** "30 Sep, 4:12 PM" — short enough to sit under a step. */
export function formatWhen(date: Date | null): string | null {
  if (!date) return null;
  return date.toLocaleString([], {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** "in 42 hours" / "2 hours ago" — reads better than a raw timestamp for the money line. */
function relative(target: Date, now: Date): string {
  const diffMs = target.getTime() - now.getTime();
  const past = diffMs < 0;
  const hours = Math.floor(Math.abs(diffMs) / 3_600_000);
  if (hours < 1) return past ? 'moments ago' : 'within the hour';
  if (hours < 48) return past ? `${hours}h ago` : `in ${hours}h`;
  const days = Math.round(hours / 24);
  return past ? `${days}d ago` : `in ${days}d`;
}

/** Auto-release is 48h after sending, unless the order already carries a date. */
function autoReleaseAt(order: Order): Date | null {
  const explicit = toDate(order.autoReleaseDate);
  if (explicit) return explicit;
  const sentAt = toDate(order.sentAt);
  if (!sentAt) return null;
  return new Date(sentAt.getTime() + 48 * 60 * 60 * 1000);
}

type Phase =
  | 'pending_payment'
  | 'preparing'
  | 'on_the_way'
  | 'received'
  | 'done'
  | 'cancelled'
  | 'disputed';

/** Eleven statuses collapse into seven phases — that collapse is what makes the copy simple. */
function phaseOf(status: string | undefined): Phase {
  switch (String(status || '')) {
    case 'PendingPayment':
      return 'pending_payment';
    case 'Paid':
    case 'Processing':
    case 'Accepted':
    case 'Preparing':
    case 'AvailabilityCheck':
      return 'preparing';
    case 'Sent':
      return 'on_the_way';
    case 'Received':
      return 'received';
    case 'Completed':
      return 'done';
    case 'Cancelled':
      return 'cancelled';
    case 'Disputed':
      return 'disputed';
    default:
      return 'preparing';
  }
}

/** Which stepper step the order has reached: 0 paid, 1 on the way, 2 received, 3 done. */
function stepIndex(phase: Phase): number {
  switch (phase) {
    case 'pending_payment':
      return -1;
    case 'preparing':
      return 0;
    case 'on_the_way':
      return 1;
    case 'received':
      return 2;
    case 'done':
      return 3;
    default:
      return -1;
  }
}

function buildSteps(order: Order, phase: Phase): OrderStep[] {
  const reached = stepIndex(phase);
  const at = [
    toDate(order.paymentVerifiedAt) ?? toDate(order.createdAt),
    toDate(order.sentAt),
    toDate(order.receivedAt),
    toDate(order.fundsReleasedAt),
  ];
  return [
    { key: 'paid', label: 'Paid' },
    { key: 'sent', label: 'On the way' },
    { key: 'received', label: 'Received' },
    { key: 'done', label: 'Done' },
  ].map((step, index) => ({
    ...step,
    done: index <= reached,
    current: index === reached,
    at: index <= reached ? at[index] : null,
  }));
}

function buildHistory(order: Order, events: any[]): { label: string; at: Date | null }[] {
  const fromEvents = (events || [])
    .map((event) => {
      const raw = event?.createdAt ?? event?.at ?? null;
      const when =
        typeof raw === 'number' ? new Date(raw) : (raw?.seconds ? new Date(raw.seconds * 1000) : toDate(raw));
      const label = String(event?.title || event?.event || event?.status || '')
        .replace(/_/g, ' ')
        .trim();
      return { label: label || 'Update', at: when };
    })
    .filter((row) => row.label);

  if (fromEvents.length) return fromEvents.reverse();

  // No event log yet — fall back to the dates the order itself carries.
  return [
    { label: 'Order placed', at: toDate(order.createdAt) },
    { label: 'Payment confirmed', at: toDate(order.paymentVerifiedAt) },
    { label: 'Seller accepted', at: toDate(order.sellerAcceptedAt) },
    { label: 'Sent', at: toDate(order.sentAt) },
    { label: 'Received', at: toDate(order.receivedAt) },
    { label: 'Money released', at: toDate(order.fundsReleasedAt) },
  ].filter((row) => row.at);
}

function escrowLine(order: Order, role: OrderRole, now: Date): OrderView['escrow'] {
  const amount = formatMoney(Number(order.total || 0));
  const state = order.escrowStatus || 'held';
  const other = role === 'buyer' ? 'the seller' : 'you';

  if (order.refundStatus === 'failed') {
    return {
      label: 'Refund failed',
      amount,
      detail: 'Something went wrong sending your money back. Support can retry it.',
      tone: 'danger',
    };
  }
  if (state === 'refund_pending') {
    return {
      label: 'Refund on the way',
      amount,
      detail: 'Back to the original payment method, usually within a few days.',
      tone: 'info',
    };
  }
  if (state === 'refunded') {
    return { label: 'Refunded', amount, detail: 'This order was refunded.', tone: 'neutral' };
  }
  if (state === 'released') {
    return {
      label: 'Released',
      amount,
      detail: `Paid out to ${other}. Nothing more to do.`,
      tone: 'success',
    };
  }

  // Still held.
  const release = autoReleaseAt(order);
  const when = release ? formatWhen(release) : null;
  const remaining = release ? relative(release, now) : null;
  return {
    label: 'Held safely',
    amount,
      detail:
        role === 'buyer'
          ? `You're covered until you confirm. ${when ? `Releases ${when}` : 'Releases 48h after it arrives'}.`
          : `Releases to you ${when ? `${when} (${remaining})` : '48h after the buyer confirms'}, unless there's a problem.`,
      tone: 'warn',
    };
}

/**
 * Work out the entire page for this viewer.
 *
 * `role` is passed in rather than sniffed from `user.uid` so this stays testable and so the
 * screen can't disagree with itself about who is looking.
 */
export function deriveOrderView(params: {
  order: Order;
  role: OrderRole;
  events?: any[];
  handlers: OrderHandlers;
  now?: Date;
}): OrderView {
  const { order, role, handlers, events = [] } = params;
  const now = params.now ?? new Date();
  const phase = phaseOf(order.status);
  const buyer = role === 'buyer';
  const days = Number(order.waitTimeDays || 0);

  let tone: OrderTone = 'info';
  let headline = 'Processing';
  let detail = '';
  let primary: OrderView['primary'] = null;
  const secondary: OrderAction[] = [];

  switch (phase) {
    case 'pending_payment':
      tone = 'neutral';
      headline = 'Waiting for payment';
      detail = buyer
        ? "This order isn't paid for yet, so the seller can't send it."
        : "This order isn't paid for yet — nothing to do until it is.";
      if (!buyer) secondary.push(cancelAction(handlers, 'Cancel this order'));
      break;

    case 'preparing':
      if (order.status === 'AvailabilityCheck') {
        tone = 'info';
        headline = 'Taking a little longer';
        detail =
          days > 0
            ? buyer
              ? `The seller needs about ${days} day${days === 1 ? '' : 's'} to get it ready.`
              : `You said about ${days} day${days === 1 ? '' : 's'}. Send it as soon as it's ready.`
            : buyer
              ? 'The seller has been asked to confirm when they can send it.'
              : "Confirm when you can send it, then send it.";
      } else if (order.status === 'Paid') {
        tone = 'info';
        headline = buyer ? 'Payment received' : 'New paid order';
        detail = buyer
          ? "The seller has been told. They'll get it ready to send."
          : 'Accept it to start, then send it when ready.';
      } else {
        tone = 'info';
        headline = buyer ? 'Being prepared' : 'Getting it ready';
        detail = buyer
          ? 'The seller is preparing your item.'
          : "Send it when it's ready — add a photo so the buyer knows it's coming.";
      }

      if (!buyer && order.status === 'Paid') {
        primary = { label: 'Accept order', tone: 'primary', run: handlers.accept };
      }
      if (!buyer && order.status !== 'Paid') {
        primary = { label: "Send it", tone: 'primary', run: handlers.markSent };
      }
      if (buyer) secondary.push(cancelAction(handlers, 'Cancel this order'));
      else secondary.push(cancelAction(handlers, 'Cancel this order'));
      break;

    case 'on_the_way':
      tone = 'progress';
      headline = 'On the way';
      detail = buyer
        ? 'Confirm when it arrives. If anything is wrong, open a dispute instead.'
        : "Waiting for the buyer to confirm. Money releases on its own if they don't.";
      if (buyer) {
        primary = { label: 'I got it', tone: 'success', run: handlers.markReceived };
        secondary.push({
          id: 'dispute',
          label: 'Something is wrong',
          hint: 'Open a dispute and we will step in',
          icon: 'exclamationmark.triangle.fill',
          tone: 'danger',
          run: handlers.dispute,
        });
      }
      break;

    case 'received':
      tone = 'success';
      headline = 'Received';
      detail = buyer ? 'Thanks! The money is being released.' : 'The buyer confirmed. Money is on its way to you.';
      if (buyer) primary = { label: 'Rate the seller', tone: 'primary', run: handlers.review };
      break;

    case 'done':
      tone = 'success';
      headline = 'Completed';
      detail = buyer ? 'All done — the seller has been paid.' : 'All done — the money has been released to you.';
      if (buyer) primary = { label: 'Rate the seller', tone: 'primary', run: handlers.review };
      break;

    case 'cancelled':
      tone = 'neutral';
      headline = 'Cancelled';
      detail =
        order.escrowStatus === 'refund_pending' || order.escrowStatus === 'refunded'
          ? 'Your money is going back to the payment method you used.'
          : 'This order was cancelled. Nothing more to do.';
      break;

    case 'disputed':
      tone = 'danger';
      headline = 'Dispute open';
      detail = "We're looking into this. Money stays held until it's settled.";
      break;
  }

  return {
    role,
    tone,
    headline,
    detail,
    steps: buildSteps(order, phase),
    primary,
    secondary,
    escrow: escrowLine(order, role, now),
    history: buildHistory(order, events),
  };
}

function cancelAction(handlers: OrderHandlers, label: string): OrderAction {
  return {
    id: 'cancel',
    label,
    hint: 'Refunded to the payment method used',
    icon: 'xmark.circle.fill',
    tone: 'danger',
    run: handlers.cancel,
  };
}
