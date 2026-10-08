import { useEffect, useState } from 'react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { formatPKR } from '@/pages/Analytics';
import { billNumber, isExchangeOrder } from '@/lib/exchange';
import type { Order } from '@/types/pos';

interface CancelBillDialogProps {
  /** The bill to cancel; null closes the dialog. */
  order: Order | null;
  onOpenChange: (open: boolean) => void;
  /** Resolves true when the bill was cancelled. */
  onConfirm: (order: Order, reason: string) => Promise<boolean>;
}

/** Asks before cancelling a bill or an exchange, with an optional reason kept in the bill's history. */
export function CancelBillDialog({ order, onOpenChange, onConfirm }: CancelBillDialogProps) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (order) setReason('');
  }, [order]);

  const exchange = order ? isExchangeOrder(order) : false;
  const onAccount = !!order && order.paymentMethod === 'credit' && !!order.customerId && order.totalAmount !== 0;

  const confirm = async () => {
    if (!order || busy) return;
    setBusy(true);
    try {
      if (await onConfirm(order, reason)) onOpenChange(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AlertDialog open={!!order} onOpenChange={(open) => !busy && onOpenChange(open)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            Cancel {exchange ? 'exchange' : 'bill'} #{order ? billNumber(order.id) : ''}?
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2 text-sm text-muted-foreground">
              {exchange && order?.originalOrderId ? (
                <p>
                  The returned items go back on bill #{billNumber(order.originalOrderId)} and out of stock again; any new
                  items the customer took go back into stock.
                </p>
              ) : (
                <p>All items on this bill go back into stock. This cannot be undone.</p>
              )}
              {onAccount && order && (
                <p>
                  {order.totalAmount > 0
                    ? `${formatPKR(order.totalAmount)} comes off the customer's account.`
                    : `The ${formatPKR(-order.totalAmount)} refunded to the customer's account is taken back.`}
                </p>
              )}
              {!onAccount && order && order.totalAmount !== 0 && order.paymentMethod !== 'credit' && (
                <p>
                  {order.totalAmount > 0
                    ? `Give back the ${formatPKR(order.totalAmount)} the customer paid (${order.paymentMethod}).`
                    : `Take back the ${formatPKR(-order.totalAmount)} refunded to the customer (${order.paymentMethod}).`}
                </p>
              )}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="space-y-1">
          <Label htmlFor="cancel-reason" className="text-xs">
            Reason (optional)
          </Label>
          <Textarea
            id="cancel-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Wrong items rung up"
            className="min-h-[60px]"
            maxLength={300}
          />
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Keep {exchange ? 'exchange' : 'bill'}</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            disabled={busy}
            onClick={(e) => {
              // Closed by confirm() once the bill is cancelled.
              e.preventDefault();
              void confirm();
            }}
          >
            {busy ? 'Cancelling...' : `Cancel ${exchange ? 'exchange' : 'bill'}`}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
