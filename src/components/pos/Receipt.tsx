import { useStore } from '@/contexts/useStore';
import { Order, OrderItem as OrderItemType } from '@/types/pos';
import { format } from 'date-fns';
import { formatPKR } from '@/pages/Analytics';
import { getOrderBreakdown, escapeHtml as esc } from '@/lib/orderMath';
import { Button } from '@/components/ui/button';
import { Printer, Share2 } from 'lucide-react';

// Standalone print function that can be called from anywhere
export function printOrderReceipt(
  order: Order,
  items: OrderItemType[],
  settings: { storeName: string; address: string; phone: string; taxRate: number; receiptFooterMessage: string }
) {
  // Print from a hidden frame inside the POS window instead of a new window, so nothing is left
  // open for the cashier to close before serving the next customer.
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.style.cssText = 'position:fixed;left:-10000px;top:0;width:800px;height:600px;border:0;';
  document.body.appendChild(frame);
  const printWindow = frame.contentWindow;
  if (!printWindow) {
    frame.remove();
    return;
  }

  const orderDate = format(new Date(order.createdAt), 'dd MMM yyyy');
  const orderTime = format(new Date(order.createdAt), 'hh:mm a');
  const breakdown = getOrderBreakdown(order, items);

  printWindow.document.write(`
    <html>
      <head>
        <title>Invoice #${order.id.slice(-8).toUpperCase()}</title>
        <style>
          @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');

          * { margin: 0; padding: 0; box-sizing: border-box; }

          body {
            font-family: 'Inter', 'Segoe UI', Arial, sans-serif;
            font-size: 11px;
            font-weight: 600;
            line-height: 1.4;
            color: #000;
            width: 72mm;
            max-width: 72mm;
            margin: 0 auto;
            padding: 6mm 4mm;
            background: #fff;
          }

          .receipt-header {
            text-align: center;
            padding-bottom: 8px;
            border-bottom: 2px solid #000;
            margin-bottom: 8px;
          }

          .store-name {
            font-size: 17px;
            font-weight: 800;
            letter-spacing: 1px;
            text-transform: uppercase;
            margin-bottom: 2px;
          }

          .store-details {
            font-size: 10px;
            font-weight: 700;
            color: #000;
            line-height: 1.5;
          }

          .invoice-title {
            text-align: center;
            margin: 10px 0;
            padding: 6px 0;
            background: #000;
            color: #fff;
            font-size: 12px;
            font-weight: 700;
            letter-spacing: 2px;
            text-transform: uppercase;
            border-radius: 2px;
          }

          .invoice-number {
            text-align: center;
            font-size: 11px;
            font-weight: 700;
            color: #000;
            margin-bottom: 8px;
          }

          .order-info {
            padding: 8px 0;
            border-bottom: 2px dashed #000;
            margin-bottom: 8px;
          }

          .info-row {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            padding: 2px 0;
            font-size: 10px;
          }

          .info-row .label {
            font-weight: 800;
            color: #000;
            min-width: 55px;
          }

          .info-row .value {
            text-align: right;
            font-weight: 700;
            flex: 1;
            word-break: break-word;
          }

          .items-header {
            text-align: center;
            font-size: 10px;
            font-weight: 700;
            letter-spacing: 1.5px;
            text-transform: uppercase;
            margin: 8px 0 4px;
            padding: 5px 0;
            border-top: 2px dashed #000;
            border-bottom: 2px dashed #000;
          }

          .item-table {
            width: 100%;
            border-collapse: collapse;
            margin-bottom: 8px;
          }

          .item-table th {
            font-size: 9px;
            font-weight: 800;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            padding: 4px 2px;
            border-bottom: 2px solid #000;
            color: #000;
          }

          .item-table th:last-child,
          .item-table td:last-child {
            text-align: right;
          }

          .item-table th:nth-child(3),
          .item-table td:nth-child(3) {
            text-align: center;
          }

          .item-table td {
            font-size: 10px;
            font-weight: 700;
            padding: 4px 2px;
            border-bottom: 1px dotted #000;
            vertical-align: top;
          }

          .item-name {
            font-weight: 800;
          }

          .item-sku {
            font-size: 8px;
            font-weight: 700;
            color: #222;
            font-family: monospace;
          }

          .summary-section {
            margin: 10px 0;
            padding: 8px;
            border: 2px solid #000;
            border-radius: 3px;
          }

          .summary-title {
            text-align: center;
            font-size: 10px;
            font-weight: 700;
            letter-spacing: 1.5px;
            text-transform: uppercase;
            margin-bottom: 6px;
            padding-bottom: 4px;
            border-bottom: 1.5px solid #000;
          }

          .summary-row {
            display: flex;
            justify-content: space-between;
            padding: 2px 0;
            font-size: 10px;
            font-weight: 700;
          }

          .summary-row.discount {
            color: #000;
            font-style: italic;
          }

          .summary-row.grand-total {
            margin-top: 4px;
            padding-top: 6px;
            border-top: 2px solid #000;
            font-size: 14px;
            font-weight: 800;
          }

          .payment-info {
            margin: 8px 0;
            padding: 6px 0;
            border-top: 2px dashed #000;
            border-bottom: 2px dashed #000;
          }

          .credit-warning {
            text-align: center;
            padding: 6px;
            margin: 8px 0;
            border: 2px solid #000;
            font-weight: 800;
            font-size: 11px;
            text-transform: uppercase;
            letter-spacing: 1px;
          }

          .receipt-footer {
            margin-top: 12px;
            padding-top: 8px;
            border-top: 2px solid #000;
            text-align: center;
          }

          .footer-message {
            font-size: 11px;
            font-weight: 700;
            margin-bottom: 4px;
          }

          .footer-generated {
            font-size: 9px;
            font-weight: 700;
            color: #222;
            margin-top: 4px;
          }

          .divider-dots {
            text-align: center;
            letter-spacing: 3px;
            color: #000;
            font-size: 8px;
            margin: 4px 0;
          }

          .footer-credit {
            margin-top: 8px;
            padding-top: 6px;
            border-top: 2px solid #000;
            text-align: center;
            font-size: 10px;
            font-weight: 700;
          }

          .footer-credit .team {
            font-size: 12px;
            font-weight: 800;
            letter-spacing: 1px;
          }

          @media print {
            @page {
              size: 80mm auto;
              margin: 0;
            }
            body {
              width: 72mm;
              max-width: 72mm;
              padding: 3mm;
              -webkit-print-color-adjust: exact;
              print-color-adjust: exact;
            }
          }
        </style>
      </head>
      <body>
        <!-- Header -->
        <div class="receipt-header">
          <div class="store-name">${esc(settings.storeName)}</div>
          <div class="store-details">
            ${esc(settings.address)}<br/>
            Tel: ${esc(settings.phone)}
          </div>
        </div>

        <!-- Invoice Title -->
        <div class="invoice-title">Invoice</div>
        <div class="invoice-number">#${order.id.slice(-8).toUpperCase()}</div>

        <!-- Order Info -->
        <div class="order-info">
          <div class="info-row">
            <span class="label">Date:</span>
            <span class="value">${orderDate}</span>
          </div>
          <div class="info-row">
            <span class="label">Time:</span>
            <span class="value">${orderTime}</span>
          </div>
          <div class="info-row">
            <span class="label">Cashier:</span>
            <span class="value">${esc(order.cashierName)}</span>
          </div>
          ${order.clientName ? `
          <div class="info-row">
            <span class="label">Customer:</span>
            <span class="value">${esc(order.clientName)}</span>
          </div>` : ''}
          ${order.clientPhone ? `
          <div class="info-row">
            <span class="label">Phone:</span>
            <span class="value">${esc(order.clientPhone)}</span>
          </div>` : ''}
        </div>

        <!-- Items -->
        <div class="items-header">Items</div>
        <table class="item-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Item</th>
              <th>Qty</th>
              <th>Total</th>
            </tr>
          </thead>
          <tbody>
            ${items.map((item, index) => `
              <tr>
                <td>${index + 1}</td>
                <td>
                  <div class="item-name">${esc(item.productName)}</div>
                  <div class="item-sku">${esc(item.productSku)} · ${formatPKR(item.unitPriceAtSale)} ea</div>
                </td>
                <td>${item.quantity}</td>
                <td>${formatPKR(item.unitPriceAtSale * item.quantity)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>

        <!-- Totals -->
        <div class="summary-section">
          <div class="summary-title">Order Total</div>
          <div class="summary-row">
            <span>Subtotal:</span>
            <span>${formatPKR(breakdown.subtotal)}</span>
          </div>
          ${breakdown.discount > 0 ? `
          <div class="summary-row discount">
            <span>Discount:</span>
            <span>-${formatPKR(breakdown.discount)}</span>
          </div>` : ''}
          <div class="summary-row">
            <span>Tax (${breakdown.taxRate}%):</span>
            <span>${formatPKR(order.taxAmount)}</span>
          </div>
          ${breakdown.cardFee > 0 ? `
          <div class="summary-row">
            <span>Card Fee (${order.cardFeeRate ?? 0}%):</span>
            <span>${formatPKR(breakdown.cardFee)}</span>
          </div>` : ''}
          <div class="summary-row grand-total">
            <span>TOTAL:</span>
            <span>${formatPKR(order.totalAmount)}</span>
          </div>
        </div>

        <!-- Payment Info -->
        <div class="payment-info">
          <div class="info-row">
            <span class="label">Payment:</span>
            <span class="value">${order.paymentMethod.toUpperCase()}${order.transferType ? ` (${order.transferType.toUpperCase()})` : ''}</span>
          </div>
          ${order.transactionId ? `
          <div class="info-row">
            <span class="label">TID:</span>
            <span class="value">${esc(order.transactionId)}</span>
          </div>` : ''}
          ${order.paymentMethod === 'cash' && order.amountTendered ? `
          <div class="info-row">
            <span class="label">Cash:</span>
            <span class="value">${formatPKR(order.amountTendered)}</span>
          </div>
          <div class="info-row">
            <span class="label">Change:</span>
            <span class="value">${formatPKR(order.changeGiven || 0)}</span>
          </div>` : ''}
        </div>

        ${order.status === 'credit' ? `
        <!-- Credit Warning -->
        <div class="credit-warning">
          ⚠ CREDIT SALE — PAYMENT PENDING
        </div>` : ''}

        <!-- Footer -->
        <div class="receipt-footer">
          <div class="footer-message">${esc(settings.receiptFooterMessage)}</div>
          <div class="divider-dots">• • • • • • • • • • •</div>
          <div class="footer-generated">Generated: ${new Date().toLocaleString()}</div>
        </div>
        <div class="footer-credit">
          <div class="team">Team Axioms</div>
          <div>Contact: 03367544180</div>
        </div>
      </body>
    </html>
  `);
  printWindow.document.close();

  const cleanup = () => frame.remove();
  printWindow.addEventListener('afterprint', cleanup);
  // Fallback in case the afterprint event never fires.
  setTimeout(cleanup, 120000);
  // Short delay so the receipt styles and logo are laid out before the print dialog opens.
  setTimeout(() => {
    printWindow.focus();
    printWindow.print();
  }, 250);
}

interface ReceiptProps {
  order?: Order;
  showActions?: boolean;
}

export function Receipt({ order, showActions = false }: ReceiptProps) {
  const { settings, getOrderItems } = useStore();
  if (!order) {
    return null;
  }

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
    const breakdown = getOrderBreakdown(order, items);
    text += `Subtotal: ${formatPKR(breakdown.subtotal)}\n`;
    if (breakdown.discount > 0) {
      text += `Discount: -${formatPKR(breakdown.discount)}\n`;
    }
    text += `Tax (${breakdown.taxRate}%): ${formatPKR(order.taxAmount)}\n`;
    if (breakdown.cardFee > 0) {
      text += `Card Fee (${order.cardFeeRate ?? 0}%): ${formatPKR(breakdown.cardFee)}\n`;
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
    text += `\n\nTeam Axioms\nContact: 03367544180`;
    return text;
  };

  const handleWhatsAppShare = () => {
    const text = encodeURIComponent(generateReceiptText());
    window.open(`https://wa.me/?text=${text}`, '_blank');
  };

  const handlePrint = () => {
    printOrderReceipt(order, items, settings);
  };

  return (
    <>
      {/* Action Buttons - Only shown when showActions is true */}
      {showActions && (
        <div className="flex gap-2 mb-4 no-print">
          <Button onClick={handlePrint} variant="outline" className="flex-1">
            <Printer className="w-4 h-4 mr-2" />
            Print Receipt
          </Button>
          <Button onClick={handleWhatsAppShare} className="flex-1 bg-green-600 hover:bg-green-700">
            <Share2 className="w-4 h-4 mr-2" />
            WhatsApp
          </Button>
        </div>
      )}
    </>
  );
}
