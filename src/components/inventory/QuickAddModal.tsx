import { useState } from 'react';
import { useStore } from '@/contexts/StoreContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { toast } from 'sonner';

interface QuickAddModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function QuickAddModal({ open, onOpenChange }: QuickAddModalProps) {
  const { products, updateProduct } = useStore();
  const [sku, setSku] = useState('');
  const [quantity, setQuantity] = useState('');
  const [foundProduct, setFoundProduct] = useState<typeof products[0] | null>(null);

  const handleSkuChange = (value: string) => {
    setSku(value);
    const product = products.find(
      (p) => p.sku.toLowerCase() === value.toLowerCase()
    );
    setFoundProduct(product || null);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!foundProduct || !quantity) return;

    const addQty = parseInt(quantity, 10);
    if (isNaN(addQty) || addQty <= 0) {
      toast.error('Invalid quantity');
      return;
    }

    updateProduct(foundProduct.id, {
      stockQuantity: foundProduct.stockQuantity + addQty,
    });

    toast.success(`Added ${addQty} units to ${foundProduct.name}`);
    setSku('');
    setQuantity('');
    setFoundProduct(null);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Quick Add Stock</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="quick-sku">Scan or Enter SKU</Label>
            <Input
              id="quick-sku"
              value={sku}
              onChange={(e) => handleSkuChange(e.target.value)}
              placeholder="PROD-001"
              className="font-mono"
              autoFocus
            />
          </div>

          {foundProduct && (
            <div className="p-3 bg-muted rounded-lg">
              <p className="font-medium">{foundProduct.name}</p>
              <p className="text-sm text-muted-foreground">
                Current stock: {foundProduct.stockQuantity}
              </p>
            </div>
          )}

          {sku && !foundProduct && (
            <p className="text-sm text-destructive">Product not found</p>
          )}

          <div className="space-y-2">
            <Label htmlFor="quick-qty">Quantity to Add</Label>
            <Input
              id="quick-qty"
              type="number"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              min="1"
              disabled={!foundProduct}
            />
          </div>

          <Button type="submit" className="w-full" disabled={!foundProduct || !quantity}>
            Add Stock
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
