import { useStore } from '@/contexts/StoreContext';
import { Order } from '@/types/pos';
import { format } from 'date-fns';
import { formatPKR } from '@/pages/Analytics';
import { Button } from '@/components/ui/button';
import { Printer, Share2 } from 'lucide-react';

interface ReceiptProps {
  order: Order;
  showActions?: boolean;
}

export function Receipt({ order, showActions = false }: ReceiptProps) {
  const { settings, getOrderItems } = useStore();
  const items = getOrderItems(order.id);

  const generateReceiptText = () => {
    let text = `*${settings.storeName}*\n`;
    text += `${settings.address}\n`;
    text += `Tel: ${settings.phone}\n\n`;
    text += `Date: ${format(new Date(order.createdAt), 'dd/MM/yyyy HH:mm')}\n`;
    text += `Invoice: #${order.id.slice(-8).toUpperCase()}\n`;
    if (order.clientName) {
      text += `Customer: ${order.clientName}\n`;
    }
    text += `Cashier: ${order.cashierName}\n\n`;
    text += `━━━━━━━━━━━━━━━━━━━━\n`;
    text += `*ITEMS*\n`;
    items.forEach((item) => {
      text += `${item.quantity}x ${item.productName}\n`;
      text += `   ${formatPKR(item.unitPriceAtSale * item.quantity)}\n`;
    });
    text += `━━━━━━━━━━━━━━━━━━━━\n`;
    text += `Subtotal: ${formatPKR(order.subtotal)}\n`;
    if (order.discountAmount > 0) {
      text += `Discount: -${formatPKR(order.discountAmount)}\n`;
    }
    text += `Tax (${settings.taxRate}%): ${formatPKR(order.taxAmount)}\n`;
    if (order.cardFeeAmount && order.cardFeeRate) {
      text += `Card Fee (${order.cardFeeRate}%): ${formatPKR(order.cardFeeAmount)}\n`;
    }
    text += `*TOTAL: ${formatPKR(order.totalAmount)}*\n\n`;
    text += `Payment: ${order.paymentMethod.toUpperCase()}`;
    if (order.transferType) {
      text += ` (${order.transferType.toUpperCase()})`;
    }
    if (order.transactionId) {
      text += `\nTID: ${order.transactionId}`;
    }
    if (order.paymentMethod === 'cash' && order.amountTendered) {
      text += `\nCash: ${formatPKR(order.amountTendered)}`;
      text += `\nChange: ${formatPKR(order.changeGiven || 0)}`;
    }
    if (order.status === 'credit') {
      text += `\n⚠️ *CREDIT SALE*`;
    }
    text += `\n\n${settings.receiptFooterMessage}`;
    return text;
  };

  const handleWhatsAppShare = () => {
    const text = encodeURIComponent(generateReceiptText());
    window.open(`https://wa.me/?text=${text}`, '_blank');
  };

  const handlePrint = () => {
    window.print();
  };

  return (
    <>
      {/* Action Buttons - Only shown when showActions is true */}
      {showActions && (
        <div className="flex gap-2 mb-4 no-print">
          <Button onClick={handlePrint} variant="outline" className="flex-1">
            <Printer className="w-4 h-4 mr-2" />
            Print A4
          </Button>
          <Button onClick={handleWhatsAppShare} className="flex-1 bg-green-600 hover:bg-green-700">
            <Share2 className="w-4 h-4 mr-2" />
            WhatsApp
          </Button>
        </div>
      )}

      {/* A4 Print Receipt */}
      <div className="receipt-print-a4">
        {/* Header */}
        <div className="receipt-a4-header">
          {settings.logo && (
            <div className="receipt-a4-logo">
              <img src={settings.logo} alt={settings.storeName} />
            </div>
          )}
          <div className="receipt-a4-company">
            <h1>{settings.storeName}</h1>
            <p>{settings.address}</p>
            <p>Tel: {settings.phone}</p>
          </div>
        </div>

        {/* Invoice Title */}
        <div className="receipt-a4-title">
          <h2>INVOICE</h2>
          <p className="invoice-number">#{order.id.slice(-8).toUpperCase()}</p>
        </div>

        {/* Invoice Details */}
        <div className="receipt-a4-details">
          <div className="detail-left">
            <p><strong>Date:</strong> {format(new Date(order.createdAt), 'dd MMMM yyyy')}</p>
            <p><strong>Time:</strong> {format(new Date(order.createdAt), 'HH:mm')}</p>
            <p><strong>Cashier:</strong> {order.cashierName}</p>
          </div>
          <div className="detail-right">
            {order.clientName && (
              <>
                <p><strong>Customer:</strong> {order.clientName}</p>
                {order.clientPhone && <p><strong>Phone:</strong> {order.clientPhone}</p>}
              </>
            )}
            <p><strong>Payment:</strong> {order.paymentMethod.toUpperCase()}
              {order.transferType && ` (${order.transferType.toUpperCase()})`}
            </p>
            {order.transactionId && <p><strong>TID:</strong> {order.transactionId}</p>}
          </div>
        </div>

        {/* Items Table */}
        <table className="receipt-a4-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Item</th>
              <th>SKU</th>
              <th>Qty</th>
              <th>Price</th>
              <th>Total</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item, index) => (
              <tr key={item.id}>
                <td>{index + 1}</td>
                <td>{item.productName}</td>
                <td>{item.productSku}</td>
                <td>{item.quantity}</td>
                <td>{formatPKR(item.unitPriceAtSale)}</td>
                <td>{formatPKR(item.unitPriceAtSale * item.quantity)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Totals */}
        <div className="receipt-a4-totals">
          <div className="total-row">
            <span>Subtotal:</span>
            <span>{formatPKR(order.subtotal)}</span>
          </div>
          {order.discountAmount > 0 && (
            <div className="total-row discount">
              <span>Discount:</span>
              <span>-{formatPKR(order.discountAmount)}</span>
            </div>
          )}
          <div className="total-row">
            <span>Tax ({settings.taxRate}%):</span>
            <span>{formatPKR(order.taxAmount)}</span>
          </div>
          {order.cardFeeAmount && (
            <div className="total-row">
              <span>Card Fee ({order.cardFeeRate}%)</span>
              <span>{formatPKR(order.cardFeeAmount)}</span>
            </div>
          )}
          <div className="total-row grand-total">
            <span>TOTAL:</span>
            <span>{formatPKR(order.totalAmount)}</span>
          </div>
          {order.paymentMethod === 'cash' && order.amountTendered && (
            <>
              <div className="total-row">
                <span>Cash Received:</span>
                <span>{formatPKR(order.amountTendered)}</span>
              </div>
              <div className="total-row">
                <span>Change:</span>
                <span>{formatPKR(order.changeGiven || 0)}</span>
              </div>
            </>
          )}
        </div>

        {/* Credit Warning */}
        {order.status === 'credit' && (
          <div className="receipt-a4-credit-warning">
            ⚠️ CREDIT SALE - Payment Pending
          </div>
        )}

        {/* Footer */}
        <div className="receipt-a4-footer">
          <p>{settings.receiptFooterMessage}</p>
        </div>
      </div>
    </>
  );
}
