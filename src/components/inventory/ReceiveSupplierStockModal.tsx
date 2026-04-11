import { useMemo, useState } from 'react';
import { useStore } from '@/contexts/useStore';
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
import { formatPKR } from '@/pages/Analytics';
import { Plus, Trash2 } from 'lucide-react';

interface ReceiveSupplierStockModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ReceiveSupplierStockModal({
  open,
  onOpenChange,
}: ReceiveSupplierStockModalProps) {
  const { products, suppliers, receiveSupplierStockBatch } = useStore();

  const [selectedSupplierId, setSelectedSupplierId] = useState('');
  const [scanInput, setScanInput] = useState('');
  const [items, setItems] = useState<Array<{ productId: string; quantity: string; unitCost: string; expiryDate: string }>>([]);
  const [paidAmount, setPaidAmount] = useState('0');
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [purchaseDate, setPurchaseDate] = useState(new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState('');

  const selectedSupplier = useMemo(
    () => suppliers.find((s) => s.id === selectedSupplierId),
    [suppliers, selectedSupplierId]
  );

  const purchaseAmount = items.reduce((total, item) => {
    const qty = Number(item.quantity || 0);
    const unitCost = Number(item.unitCost || 0);
    if (!Number.isFinite(qty) || !Number.isFinite(unitCost)) return total;
    return total + qty * unitCost;
  }, 0);

  const parsedPaid = Number(paidAmount || 0);
  const supplierBalanceAfter = selectedSupplier
    ? Number((selectedSupplier.balance + purchaseAmount - parsedPaid).toFixed(2))
    : 0;

  const resetForm = () => {
    setSelectedSupplierId('');
    setScanInput('');
    setItems([]);
    setPaidAmount('0');
    setInvoiceNumber('');
    setPurchaseDate(new Date().toISOString().slice(0, 10));
    setNote('');
  };

  const addItemByProductId = (productId: string) => {
    const product = products.find((p) => p.id === productId);
    if (!product) {
      toast.error('Product not found');
      return;
    }

    setItems((prev) => {
      const existingIndex = prev.findIndex((item) => item.productId === product.id);
      if (existingIndex >= 0) {
        const next = [...prev];
        const currentQty = Number(next[existingIndex].quantity || 0);
        next[existingIndex] = {
          ...next[existingIndex],
          quantity: String(currentQty + 1),
        };
        return next;
      }

      return [
        ...prev,
        {
          productId: product.id,
          quantity: '1',
          unitCost: String(product.costPrice),
          expiryDate: product.expiryDate || '',
        },
      ];
    });
  };

  const handleScanAdd = () => {
    const query = scanInput.trim().toLowerCase();
    if (!query) return;

    const matchedProduct =
      products.find((p) => p.sku.toLowerCase() === query) ||
      products.find((p) => p.barcode && p.barcode.toLowerCase() === query);

    if (!matchedProduct) {
      toast.error('No product matched this SKU/barcode');
      return;
    }

    addItemByProductId(matchedProduct.id);
    setScanInput('');
  };

  const updateItem = (index: number, key: 'productId' | 'quantity' | 'unitCost' | 'expiryDate', value: string) => {
    setItems((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], [key]: value };
      if (key === 'productId') {
        const product = products.find((p) => p.id === value);
        if (product) {
          next[index].unitCost = String(product.costPrice);
          next[index].expiryDate = product.expiryDate || '';
        }
      }
      return next;
    });
  };

  const addEmptyRow = () => {
    setItems((prev) => [...prev, { productId: '', quantity: '1', unitCost: '', expiryDate: '' }]);
  };

  const removeRow = (index: number) => {
    setItems((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!selectedSupplier) {
      toast.error('Please select a supplier');
      return;
    }
    if (items.length === 0) {
      toast.error('Please add at least one item');
      return;
    }

    const normalizedItems: Array<{ productId: string; quantity: number; unitCost: number; expiryDate?: string }> = [];

    for (const item of items) {
      const product = products.find((p) => p.id === item.productId);
      if (!product) {
        toast.error('Please select a valid product for each row');
        return;
      }

      const qty = Number(item.quantity || 0);
      const unitCost =
        item.unitCost.trim() === '' ? product.costPrice : Number(item.unitCost || 0);

      if (!Number.isFinite(qty) || qty <= 0) {
        toast.error('Each row must have quantity greater than 0');
        return;
      }

      if (!Number.isFinite(unitCost) || unitCost < 0) {
        toast.error('Each row must have a valid non-negative unit cost');
        return;
      }

      normalizedItems.push({
        productId: product.id,
        quantity: qty,
        unitCost,
        expiryDate: item.expiryDate.trim() || undefined,
      });
    }

    if (!Number.isFinite(parsedPaid) || parsedPaid < 0) {
      toast.error('Paid amount must be a valid non-negative number');
      return;
    }

    if (parsedPaid > purchaseAmount) {
      toast.error('Paid amount cannot be greater than total purchase amount');
      return;
    }

    receiveSupplierStockBatch({
      supplierId: selectedSupplier.id,
      items: normalizedItems,
      paidAmount: parsedPaid,
      purchaseDate,
      invoiceNumber: invoiceNumber.trim() || undefined,
      note: note.trim() || undefined,
    });

    toast.success('Stock intake saved for all items and supplier balance updated');
    resetForm();
    onOpenChange(false);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          resetForm();
        }
        onOpenChange(nextOpen);
      }}
    >
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Receive Supplier Stock</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="supplier-stock-scan">Scan SKU/Barcode</Label>
            <div className="flex gap-2">
              <Input
                id="supplier-stock-scan"
                value={scanInput}
                onChange={(e) => setScanInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleScanAdd();
                  }
                }}
                placeholder="Scan and press Enter"
                className="font-mono"
              />
              <Button type="button" variant="outline" onClick={handleScanAdd}>
                Add
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Re-scan the same item to increase quantity automatically.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="supplier-stock-supplier">Supplier</Label>
            <select
              id="supplier-stock-supplier"
              aria-label="Supplier"
              title="Supplier"
              value={selectedSupplierId}
              onChange={(e) => setSelectedSupplierId(e.target.value)}
              className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="">Select supplier</option>
              {suppliers.map((supplier) => (
                <option key={supplier.id} value={supplier.id}>
                  {supplier.name}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Items</Label>
              <Button type="button" variant="outline" size="sm" onClick={addEmptyRow}>
                <Plus className="w-4 h-4 mr-1" />
                Add Row
              </Button>
            </div>

            <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
              {items.length === 0 ? (
                <p className="text-sm text-muted-foreground border rounded-md p-3">
                  No items added yet. Scan SKU/barcode or add a row manually.
                </p>
              ) : (
                items.map((item, index) => (
                  <div key={`${item.productId}-${index}`} className="grid grid-cols-12 gap-2 items-end border rounded-md p-2">
                    <div className="col-span-4 space-y-1">
                      <Label className="text-xs">Product</Label>
                      <select
                        value={item.productId}
                        onChange={(e) => updateItem(index, 'productId', e.target.value)}
                        className="w-full h-9 rounded-md border border-input bg-background px-2 text-sm"
                        aria-label={`Product row ${index + 1}`}
                        title={`Product row ${index + 1}`}
                      >
                        <option value="">Select product</option>
                        {products.map((product) => (
                          <option key={product.id} value={product.id}>
                            {product.sku} - {product.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="col-span-2 space-y-1">
                      <Label className="text-xs">Qty</Label>
                      <Input
                        type="number"
                        min="1"
                        value={item.quantity}
                        onChange={(e) => updateItem(index, 'quantity', e.target.value)}
                      />
                    </div>
                    <div className="col-span-2 space-y-1">
                      <Label className="text-xs">Cost</Label>
                      <Input
                        type="number"
                        min="0"
                        step="0.01"
                        value={item.unitCost}
                        onChange={(e) => updateItem(index, 'unitCost', e.target.value)}
                      />
                    </div>
                    <div className="col-span-3 space-y-1">
                      <Label className="text-xs">Expiry</Label>
                      <Input
                        type="date"
                        value={item.expiryDate}
                        onChange={(e) => updateItem(index, 'expiryDate', e.target.value)}
                      />
                    </div>
                    <div className="col-span-1 flex justify-end">
                      <Button type="button" variant="ghost" size="icon" onClick={() => removeRow(index)}>
                        <Trash2 className="w-4 h-4 text-destructive" />
                      </Button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Amount Paid Now</Label>
              <Input
                type="number"
                min="0"
                step="0.01"
                value={paidAmount}
                onChange={(e) => setPaidAmount(e.target.value)}
                placeholder="0.00"
              />
            </div>
            <div className="space-y-2">
              <Label>Purchase Date</Label>
              <Input
                type="date"
                value={purchaseDate}
                onChange={(e) => setPurchaseDate(e.target.value)}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Invoice Number</Label>
              <Input
                value={invoiceNumber}
                onChange={(e) => setInvoiceNumber(e.target.value)}
                placeholder="Leave blank to auto-generate"
              />
            </div>
            <div className="space-y-2">
              <Label>Note (optional)</Label>
              <Input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Batch info"
              />
            </div>
          </div>

          <div className="rounded-md border bg-muted/40 p-3 text-sm space-y-1">
            <p>
              Total purchase amount: <span className="font-medium">{formatPKR(purchaseAmount)}</span>
            </p>
            {selectedSupplier && (
              <p>
                Supplier balance after this entry:{' '}
                <span className="font-medium">{formatPKR(supplierBalanceAfter)}</span>
              </p>
            )}
          </div>

          <Button
            type="submit"
            className="w-full"
            disabled={products.length === 0 || suppliers.length === 0}
          >
            Save Stock Intake
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
