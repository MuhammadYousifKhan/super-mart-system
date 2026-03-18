import { useStore } from '@/contexts/StoreContext';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Clock, X } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { formatPKR } from '@/pages/Analytics';

export function HeldCartsPanel() {
  const { heldCarts, recallCart, deleteHeldCart } = useStore();

  if (heldCarts.length === 0) return null;

  return (
    <div className="p-3 bg-accent/50 rounded-lg">
      <div className="flex items-center gap-2 mb-2">
        <Clock className="w-4 h-4 text-muted-foreground" />
        <span className="text-sm font-medium">Held Transactions</span>
        <Badge variant="secondary">{heldCarts.length}</Badge>
      </div>
      <div className="flex flex-wrap gap-2">
        {heldCarts.map((held) => (
          <div
            key={held.id}
            className="flex items-center gap-1 bg-card border rounded-md"
          >
            <Button
              variant="ghost"
              size="sm"
              className="h-8 text-xs"
              onClick={() => recallCart(held.id)}
            >
              {held.items.length} items • {formatPKR(
                held.items.reduce((s, i) => s + i.product.sellingPrice * i.quantity, 0)
              )}
              <span className="text-muted-foreground ml-1">
                ({formatDistanceToNow(new Date(held.heldAt), { addSuffix: true })})
              </span>
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-muted-foreground hover:text-destructive"
              onClick={() => deleteHeldCart(held.id)}
            >
              <X className="w-3 h-3" />
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}
