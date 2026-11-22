import { memo } from 'react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { formatPKR } from '@/pages/Analytics';
import { ShoppingCart } from 'lucide-react';
import type { Product } from '@/types/pos';

interface ProductCardProps {
  product: Product;
  allowNegativeStock: boolean;
  onPick: (product: Product) => void;
}

/**
 * One tile of the POS product grid. Memoized so a scan or a cart change doesn't re-render
 * every tile, and it avoids backdrop-blur (very costly when repeated hundreds of times).
 * The full product name is always shown (wrapped, never cut).
 */
export const ProductCard = memo(function ProductCard({ product, allowNegativeStock, onPick }: ProductCardProps) {
  const isLowStock = product.stockQuantity > 0 && product.stockQuantity < product.lowStockThreshold;
  const isOutOfStock = product.stockQuantity <= 0;

  return (
    <button
      type="button"
      onClick={() => onPick(product)}
      disabled={isOutOfStock && !allowNegativeStock}
      title={product.name}
      className="group p-3 rounded-xl text-left bg-card border border-border/60 shadow-sm hover:bg-primary/5 hover:border-primary/40 disabled:opacity-50 disabled:cursor-not-allowed flex flex-col h-full"
    >
      <div className="flex justify-between items-start gap-2 mb-2">
        <span className="font-mono text-[10px] text-muted-foreground/80 bg-muted/50 px-1.5 py-0.5 rounded border border-border/50 truncate max-w-[70%]">
          {product.sku}
        </span>
        {isLowStock && (
          <Badge variant="outline" className="text-warning border-warning/50 bg-warning/10 text-[10px] px-1.5 h-5">
            Low
          </Badge>
        )}
        {isOutOfStock && (
          <Badge variant="destructive" className="text-[10px] px-1.5 h-5">
            Out
          </Badge>
        )}
      </div>

      <p className="font-medium text-sm leading-snug whitespace-normal break-words text-foreground/90 group-hover:text-primary">
        {product.name}
      </p>
      {product.barcode && (
        <p className="mt-0.5 text-[10px] text-muted-foreground/70 font-mono break-all">{product.barcode}</p>
      )}

      <div className="mt-1.5">
        <span
          className={cn(
            'text-[10px] font-bold px-1.5 py-0.5 rounded-md inline-block',
            isOutOfStock
              ? 'bg-destructive/20 text-destructive border border-destructive/30'
              : isLowStock
                ? 'bg-amber-500/20 text-amber-500 border border-amber-500/30'
                : 'bg-success/20 text-success border border-success/30'
          )}
        >
          Qty: {product.stockQuantity}
        </span>
      </div>

      <div className="mt-auto pt-2 flex items-end justify-between">
        <p className="text-lg font-bold text-foreground tracking-tight">{formatPKR(product.sellingPrice)}</p>
        <ShoppingCart className="w-4 h-4 text-primary opacity-0 group-hover:opacity-100" />
      </div>
    </button>
  );
});
