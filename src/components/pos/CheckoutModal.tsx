import { useState } from 'react';
import { useStore } from '@/contexts/useStore';
import { PaymentMethod, TransferType, Order } from '@/types/pos';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Banknote, CreditCard, ArrowLeftRight, UserCheck, Building2, Smartphone, User } from 'lucide-react';
import { toast } from 'sonner';
import { formatPKR } from '@/pages/Analytics';

// cardFeePercent is now retrieved from settings in useStore hook

interface CheckoutModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onComplete: (order: Order) => void;
}

export function CheckoutModal({ open, onOpenChange, onComplete }: CheckoutModalProps) {
  const {
    cart,
    createOrder,
    clearCart,
    calculateTotal,
    globalDiscount,
    globalDiscountType,
    settings,
    customers,
    getCustomerById,
    products,
  } = useStore();

  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash');
  const [amountTendered, setAmountTendered] = useState('');
  const [clientName, setClientName] = useState('');
  const [clientPhone, setClientPhone] = useState('');
  const [transferType, setTransferType] = useState<TransferType>('bank');
  const [transactionId, setTransactionId] = useState('');
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const total = calculateTotal();
  const tendered = parseFloat(amountTendered) || 0;
  // Card fee calculation (UI) - based on store settings
  const cardFeeRate = settings.cardFeePercent;
  const cardFee = paymentMethod === 'card' && cardFeeRate > 0 ? (total * cardFeeRate) / 100 : 0;
  const finalTotal = total + cardFee;
  const change = tendered - finalTotal;

  const canProceed = () => {
    if (paymentMethod === 'cash') {
      return tendered >= finalTotal;
    }
    if (paymentMethod === 'credit') {
      // Credit sale must be linked to an existing customer for ledger tracking
      return selectedCustomerId !== '';
    }
    if (paymentMethod === 'transfer') {
      return transactionId.trim() !== '';
    }
    return true; // card
  };

  const handleComplete = async () => {
    for (const item of cart) {
      // Check against current stock: the cart's product copy may be older than a stock change.
      const liveStock = products.find((p) => p.id === item.product.id)?.stockQuantity ?? item.product.stockQuantity;
      if (liveStock < item.quantity && !settings.allowNegativeStock) {
        toast.error(`Insufficient stock for ${item.product.name}`);
        return;
      }
    }

    // For credit, get customer info
    let finalClientName = clientName;
    let finalClientPhone = clientPhone;
    let customerId = selectedCustomerId || undefined;

    if (paymentMethod === 'credit') {
      if (!selectedCustomerId) {
        toast.error('Please select a customer for credit sale');
        return;
      }
      const customer = getCustomerById(selectedCustomerId);
      if (!customer) {
        toast.error('Selected customer not found');
        return;
      }
      finalClientName = customer.name;
      finalClientPhone = customer.phone;
      customerId = customer.id;
    }

    setIsSubmitting(true);
    try {
      const order = await createOrder({
        items: cart,
        paymentMethod,
        globalDiscount,
        globalDiscountType,
        amountTendered: paymentMethod === 'cash' ? tendered : undefined,
        clientName: finalClientName || undefined,
        clientPhone: finalClientPhone || undefined,
        transferType: paymentMethod === 'transfer' ? transferType : undefined,
        transactionId: paymentMethod === 'transfer' ? transactionId : undefined,
        customerId: paymentMethod === 'credit' ? customerId : undefined,
      });

      clearCart();
      resetForm();
      onComplete(order);
    } catch (error) {
      console.error('Checkout error:', error);
      toast.error('Failed to complete checkout');
    } finally {
      setIsSubmitting(false);
    }
  };

  const resetForm = () => {
    setAmountTendered('');
    setPaymentMethod('cash');
    setClientName('');
    setClientPhone('');
    setTransferType('bank');
    setTransactionId('');
    setSelectedCustomerId('');
  };

  const quickAmounts = [
    total,
    Math.ceil(total / 100) * 100,
    Math.ceil(total / 500) * 500,
    Math.ceil(total / 1000) * 1000,
  ].filter((v, i, a) => a.indexOf(v) === i);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Complete Payment</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
                <div className="text-center p-4 bg-muted rounded-lg">
                  <p className="text-sm text-muted-foreground">Total Amount</p>
                  <p className="text-3xl font-bold">{formatPKR(finalTotal)}</p>
                  {paymentMethod === 'card' && cardFee > 0 && (
                    <p className="text-xs text-muted-foreground mt-1">Includes card fee {cardFeeRate}% ({formatPKR(cardFee)})</p>
                  )}
                </div>

          {/* Client Info (Optional for non-credit payments) */}
          {paymentMethod !== 'credit' && (
            <div className="space-y-3 p-3 border rounded-lg bg-card">
              <Label className="text-sm font-medium">Customer Info (Optional)</Label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <Input
                  placeholder="Customer Name"
                  value={clientName}
                  onChange={(e) => setClientName(e.target.value)}
                  className="h-10"
                />
                <Input
                  placeholder="Phone (optional)"
                  value={clientPhone}
                  onChange={(e) => setClientPhone(e.target.value)}
                  className="h-10"
                />
              </div>
            </div>
          )}

          <div>
            <Label className="text-sm">Payment Method</Label>
            <ToggleGroup
              type="single"
              value={paymentMethod}
              onValueChange={(v) => v && setPaymentMethod(v as PaymentMethod)}
              className="mt-2 grid grid-cols-2 sm:grid-cols-4 gap-2"
            >
              <ToggleGroupItem value="cash" className="flex-col h-auto py-3">
                <Banknote className="w-5 h-5 mb-1" />
                <span className="text-xs">Cash</span>
              </ToggleGroupItem>
              <ToggleGroupItem value="card" className="flex-col h-auto py-3">
                <CreditCard className="w-5 h-5 mb-1" />
                <span className="text-xs">Card</span>
              </ToggleGroupItem>
              <ToggleGroupItem value="transfer" className="flex-col h-auto py-3">
                <ArrowLeftRight className="w-5 h-5 mb-1" />
                <span className="text-xs">Transfer</span>
              </ToggleGroupItem>
              <ToggleGroupItem value="credit" className="flex-col h-auto py-3">
                <UserCheck className="w-5 h-5 mb-1" />
                <span className="text-xs">Credit</span>
              </ToggleGroupItem>
            </ToggleGroup>
          </div>

          {/* Cash Payment Options */}
          {paymentMethod === 'cash' && (
            <div className="space-y-3">
              <div>
                <Label htmlFor="tendered">Amount Tendered</Label>
                <Input
                  id="tendered"
                  type="number"
                  value={amountTendered}
                  onChange={(e) => setAmountTendered(e.target.value)}
                  placeholder="0"
                  min="0"
                  step="1"
                  className="text-lg h-12 mt-1"
                  autoFocus
                />
              </div>

              <div className="grid grid-cols-4 gap-2">
                {quickAmounts.slice(0, 4).map((amount, i) => (
                  <Button
                    key={i}
                    variant="outline"
                    size="sm"
                    onClick={() => setAmountTendered(amount.toString())}
                  >
                    {amount >= 1000 ? `${(amount/1000).toFixed(0)}k` : amount}
                  </Button>
                ))}
              </div>

              {tendered > 0 && (
                <div className="p-3 bg-muted rounded-lg text-center">
                  <p className="text-sm text-muted-foreground">Change Due</p>
                  <p className={`text-2xl font-bold ${change >= 0 ? 'text-success' : 'text-destructive'}`}>
                    {formatPKR(Math.max(0, change))}
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Transfer Payment Options */}
          {paymentMethod === 'transfer' && (
            <div className="space-y-3 p-3 border rounded-lg bg-card">
              <Label className="text-sm font-medium">Transfer Details</Label>
              <ToggleGroup
                type="single"
                value={transferType}
                onValueChange={(v) => v && setTransferType(v as TransferType)}
                className="grid grid-cols-3 gap-2"
              >
                <ToggleGroupItem value="bank" className="flex-col h-auto py-2">
                  <Building2 className="w-4 h-4 mb-1" />
                  <span className="text-xs">Bank</span>
                </ToggleGroupItem>
                <ToggleGroupItem value="jazzcash" className="flex-col h-auto py-2 data-[state=on]:bg-red-500/20 data-[state=on]:text-red-500">
                  <Smartphone className="w-4 h-4 mb-1" />
                  <span className="text-xs">JazzCash</span>
                </ToggleGroupItem>
                <ToggleGroupItem value="easypaisa" className="flex-col h-auto py-2 data-[state=on]:bg-green-500/20 data-[state=on]:text-green-500">
                  <Smartphone className="w-4 h-4 mb-1" />
                  <span className="text-xs">Easypaisa</span>
                </ToggleGroupItem>
              </ToggleGroup>
              <div>
                <Label htmlFor="tid">Transaction ID (TID) <span className="text-destructive">*</span></Label>
                <Input
                  id="tid"
                  value={transactionId}
                  onChange={(e) => setTransactionId(e.target.value)}
                  placeholder="Enter transaction ID"
                  className="mt-1"
                />
              </div>
            </div>
          )}

          {/* Credit Payment Info */}
          {paymentMethod === 'credit' && (
            <div className="space-y-3 p-3 border border-warning/50 rounded-lg bg-warning/10">
              <div className="flex items-center justify-between">
                <p className="text-sm text-warning font-medium">⚠️ Credit Sale (Digi Khata)</p>
              </div>
              
              {customers.length > 0 && (
                <div className="space-y-2">
                  <Label className="text-sm">Select Existing Customer <span className="text-destructive">*</span></Label>
                  <Select value={selectedCustomerId} onValueChange={setSelectedCustomerId}>
                    <SelectTrigger className="bg-background">
                      <SelectValue placeholder="Select a customer" />
                    </SelectTrigger>
                    <SelectContent>
                      {customers.map((customer) => (
                        <SelectItem key={customer.id} value={customer.id}>
                          <div className="flex items-center gap-2">
                            <User className="w-4 h-4 text-muted-foreground" />
                            <span>{customer.name}</span>
                            <span className="text-muted-foreground">({customer.phone})</span>
                            {customer.balance > 0 && (
                              <span className="text-xs text-red-500 ml-2">
                                Balance: Rs. {customer.balance.toLocaleString()}
                              </span>
                            )}
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  
                  {selectedCustomerId && (
                    <div className="p-2 rounded bg-background/50 text-xs">
                      {(() => {
                        const c = getCustomerById(selectedCustomerId);
                        return c ? (
                          <div className="space-y-1">
                            <p><strong>Name:</strong> {c.name}</p>
                            <p><strong>Phone:</strong> {c.phone}</p>
                            <p><strong>Current Balance:</strong> <span className="text-red-500">Rs. {c.balance.toLocaleString()}</span></p>
                            <p><strong>After this sale:</strong> <span className="text-red-500 font-bold">Rs. {(c.balance + total).toLocaleString()}</span></p>
                          </div>
                        ) : null;
                      })()}
                    </div>
                  )}
                </div>
              )}

              {customers.length === 0 && (
                <div className="space-y-2">
                  <Label className="text-sm">Customer Info <span className="text-destructive">*</span></Label>
                  <Input
                    placeholder="Customer Name"
                    value={clientName}
                    onChange={(e) => setClientName(e.target.value)}
                    className="bg-background"
                  />
                  <Input
                    placeholder="Phone (optional)"
                    value={clientPhone}
                    onChange={(e) => setClientPhone(e.target.value)}
                    className="bg-background"
                  />
                  <p className="text-xs text-muted-foreground">
                    Please add customer first from the Customers page, then select that customer for credit sale.
                  </p>
                </div>
              )}

              {customers.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  Credit sales are only allowed for existing customers so Digi Khata balance updates correctly.
                </p>
              )}
            </div>
          )}

          <Button
            size="lg"
            className="w-full h-12"
            onClick={handleComplete}
            disabled={!canProceed() || isSubmitting}
          >
            {isSubmitting ? 'Processing...' : 'Complete Sale'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
