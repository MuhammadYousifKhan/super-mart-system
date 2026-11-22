import { useStore } from '@/contexts/useStore';
import { Order, OrderItem as OrderItemType } from '@/types/pos';
import { format } from 'date-fns';
import { formatPKR } from '@/pages/Analytics';
import {
  exchangeShareLines,
  getExchangeBreakdown,
  getOrderBreakdown,
  escapeHtml as esc,
  type ExchangeReceiptLine,
} from '@/lib/orderMath';
import { billNumber } from '@/lib/exchange';
import { Button } from '@/components/ui/button';
import { Printer, Share2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  getThermalPrinterConfig,
  isThermalPrinterAvailable,
  printReceiptDirect,
} from '@/lib/thermalPrinter';

type ReceiptSettings = { storeName: string; address: string; phone: string; taxRate: number; receiptFooterMessage: string };

// Standalone print function that can be called from anywhere.
// In the desktop app with a thermal printer chosen in Settings, the receipt goes straight to that
// printer as ESC/POS with no print dialog. Otherwise (browser, no printer chosen, or the printer
// fails) it falls back to the browser print dialog so a sale can always be printed.
export function printOrderReceipt(order: Order, items: OrderItemType[], settings: ReceiptSettings) {
  if (isThermalPrinterAvailable() && getThermalPrinterConfig().printerName) {
    printReceiptDirect(order, items, settings).catch((err) => {
      toast.error(`Thermal printer error: ${err?.message || 'unknown'}. Opening the print dialog instead.`);
      printHtmlReceipt(order, items, settings);
    });
    return;
  }
  printHtmlReceipt(order, items, settings);
}

function printHtmlReceipt(order: Order, items: OrderItemType[], settings: ReceiptSettings) {
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
  // An exchange/return prints its own title and body; everything else is the normal invoice.
  const isExchange = breakdown.isExchange;
  const hasTax = Math.abs(order.taxAmount) >= 0.005;
  const hasAdjustments = breakdown.discount > 0 || hasTax || breakdown.cardFee > 0;

  printWindow.document.write(`
    <html>
      <head>
        <title>${isExchange ? 'Exchange' : 'Invoice'} #${order.id.slice(-8).toUpperCase()}</title>
        <style>
          @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');

          * { margin: 0; padding: 0; box-sizing: border-box; }

          /* Kept compact on purpose: every millimetre here is paper used on every sale. */
          body {
            font-family: 'Inter', 'Segoe UI', Arial, sans-serif;
            font-size: 11px;
            font-weight: 600;
            line-height: 1.25;
            color: #000;
            width: 72mm;
            max-width: 72mm;
            margin: 0 auto;
            padding: 1mm 2mm;
            background: #fff;
          }

          .receipt-header {
            text-align: center;
            padding-bottom: 2px;
            margin-bottom: 2px;
          }

          .store-name {
            font-size: 16px;
            font-weight: 800;
            letter-spacing: 0.5px;
            text-transform: uppercase;
          }

          .store-details {
            font-size: 10px;
            font-weight: 700;
            color: #000;
          }

          .invoice-title {
            text-align: center;
            margin: 2px 0;
            padding: 1px 0;
            background: #000;
            color: #fff;
            font-size: 11px;
            font-weight: 700;
            letter-spacing: 1px;
            text-transform: uppercase;
          }

          .invoice-number {
            text-align: center;
            font-size: 10px;
            font-weight: 700;
            color: #000;
            margin-bottom: 2px;
          }

          .order-info {
            padding-bottom: 2px;
            border-bottom: 1px dashed #000;
            margin-bottom: 2px;
          }

          .info-row {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
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
            font-size: 10px;
            font-weight: 800;
            text-transform: uppercase;
            margin-top: 2px;
          }

          .item-table {
            width: 100%;
            border-collapse: collapse;
            margin-bottom: 2px;
          }

          .item-table th {
            font-size: 9px;
            font-weight: 800;
            text-transform: uppercase;
            padding: 0 2px 1px;
            border-bottom: 1px solid #000;
            color: #000;
            text-align: left;
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
            padding: 1px 2px;
            border-bottom: 1px dotted #000;
            vertical-align: top;
          }

          .item-name {
            font-weight: 800;
          }

          .item-meta {
            font-size: 9px;
            font-weight: 700;
          }

          .summary-section {
            margin: 2px 0;
          }

          .summary-row {
            display: flex;
            justify-content: space-between;
            font-size: 10px;
            font-weight: 700;
          }

          .summary-row.discount {
            color: #000;
            font-style: italic;
          }

          .summary-row.grand-total {
            margin-top: 1px;
            padding-top: 1px;
            border-top: 1px solid #000;
            font-size: 14px;
            font-weight: 800;
          }

          .payment-info {
            margin: 2px 0;
            padding-top: 2px;
            border-top: 1px dashed #000;
          }

          .credit-warning {
            text-align: center;
            padding: 1px;
            margin: 2px 0;
            border: 1px solid #000;
            font-weight: 800;
            font-size: 10px;
            text-transform: uppercase;
          }

          .receipt-footer {
            margin-top: 2px;
            padding-top: 2px;
            border-top: 1px dashed #000;
            text-align: center;
          }

          .footer-message {
            font-size: 10px;
            font-weight: 700;
          }

          .footer-credit {
            font-size: 9px;
            font-weight: 700;
          }

          @media print {
            @page {
              size: 80mm auto;
              margin: 0;
            }
            body {
              width: 72mm;
              max-width: 72mm;
              padding: 1mm 2mm;
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
        ${isExchange ? exchangeTitleHtml(order) : `<div class="invoice-title">Invoice #${order.id.slice(-8).toUpperCase()}</div>`}

        <!-- Order Info -->
        <div class="order-info">
          <div class="info-row">
            <span class="label">Date:</span>
            <span class="value">${orderDate}, ${orderTime}</span>
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

        ${isExchange ? exchangeBodyHtml(order, items) : `<!-- Items -->
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
                  ${item.quantity !== 1 ? `<div class="item-meta">@ ${formatPKR(item.unitPriceAtSale)} ea</div>` : ''}
                </td>
                <td>${item.quantity}</td>
                <td>${formatPKR(item.unitPriceAtSale * item.quantity)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>

        <!-- Totals: subtotal only when something changes it, and no zero tax line -->
        <div class="summary-section">
          ${hasAdjustments ? `
          <div class="summary-row">
            <span>Subtotal:</span>
            <span>${formatPKR(breakdown.subtotal)}</span>
          </div>` : ''}
          ${breakdown.discount > 0 ? `
          <div class="summary-row discount">
            <span>Discount:</span>
            <span>-${formatPKR(breakdown.discount)}</span>
          </div>` : ''}
          ${hasTax ? `
          <div class="summary-row">
            <span>Tax (${breakdown.taxRate}%):</span>
            <span>${formatPKR(order.taxAmount)}</span>
          </div>` : ''}
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
        </div>` : ''}`}

        <!-- Footer -->
        <div class="receipt-footer">
          ${settings.receiptFooterMessage ? `<div class="footer-message">${esc(settings.receiptFooterMessage)}</div>` : ''}
          <div class="footer-credit">Aceva Technology · +92 305 555 2230</div>
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

const signedPKR = (amount: number) => (amount < 0 ? `-${formatPKR(-amount)}` : formatPKR(amount));

function exchangeTitleHtml(order: Order): string {
  return `<div class="invoice-title">Exchange / Return #${billNumber(order.id)}</div>
        <div class="invoice-number">Against bill #${billNumber(order.originalOrderId || '')}</div>`;
}

/** One list of an exchange receipt. Quantities print as positive; returned amounts as negative. */
function exchangeItemsHtml(title: string, lines: ExchangeReceiptLine[], returned: boolean): string {
  if (lines.length === 0) return '';
  return `
        <div class="items-header">${title}</div>
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
            ${lines.map((l, index) => `
              <tr>
                <td>${index + 1}</td>
                <td>
                  <div class="item-name">${esc(l.item.productName)}</div>
                  ${l.quantity !== 1 || l.discount > 0.005 ? `<div class="item-meta">@ ${formatPKR(l.item.unitPriceAtSale)} ea${l.discount > 0.005 ? ` · less discount ${formatPKR(l.discount)}` : ''}</div>` : ''}
                </td>
                <td>${l.quantity}</td>
                <td>${returned ? '-' : ''}${formatPKR(l.net)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>`;
}

/** Items, totals and settlement of an exchange/return receipt. */
function exchangeBodyHtml(order: Order, items: OrderItemType[]): string {
  const ex = getExchangeBreakdown(order, items);
  const totalLabel = ex.settlement === 'Even exchange' ? 'EVEN EXCHANGE' : `${ex.settlement.toUpperCase()}:`;
  const totalValue = ex.settlement === 'Even exchange' ? '' : formatPKR(ex.settlementAmount);
  const paymentRows = [
    ex.settledVia ? `
          <div class="info-row">
            <span class="label">${esc(ex.settledVia.label)}:</span>
            <span class="value">${esc(ex.settledVia.method.toUpperCase())}</span>
          </div>` : '',
    order.transactionId ? `
          <div class="info-row">
            <span class="label">TID:</span>
            <span class="value">${esc(order.transactionId)}</span>
          </div>` : '',
    order.paymentMethod === 'cash' && order.amountTendered ? `
          <div class="info-row">
            <span class="label">Cash:</span>
            <span class="value">${formatPKR(order.amountTendered)}</span>
          </div>
          <div class="info-row">
            <span class="label">Change:</span>
            <span class="value">${formatPKR(order.changeGiven || 0)}</span>
          </div>` : '',
  ].join('');

  return `<!-- Exchange -->
        ${exchangeItemsHtml('Returned', ex.returned, true)}
        ${exchangeItemsHtml('New items', ex.added, false)}

        <div class="summary-section">
          <div class="summary-row">
            <span>Returned:</span>
            <span>-${formatPKR(ex.returnedNet)}</span>
          </div>
          ${ex.added.length > 0 ? `
          <div class="summary-row">
            <span>New items:</span>
            <span>${formatPKR(ex.newNet)}</span>
          </div>` : ''}
          ${Math.abs(ex.tax) >= 0.005 ? `
          <div class="summary-row">
            <span>Tax:</span>
            <span>${signedPKR(ex.tax)}</span>
          </div>` : ''}
          ${ex.cardFee > 0 ? `
          <div class="summary-row">
            <span>Card Fee (${order.cardFeeRate ?? 0}%):</span>
            <span>${formatPKR(ex.cardFee)}</span>
          </div>` : ''}
          <div class="summary-row grand-total">
            <span>${totalLabel}</span>
            <span>${totalValue}</span>
          </div>
        </div>

        ${paymentRows ? `<div class="payment-info">${paymentRows}
        </div>` : ''}

        ${order.status === 'credit' ? `
        <div class="credit-warning">
          ⚠ ADDED TO ACCOUNT — PAYMENT PENDING
        </div>` : ''}
`;
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
    if (order.originalOrderId) {
      // Exchange/return: its own layout from here down to the footer.
      text += `*EXCHANGE / RETURN* #${billNumber(order.id)}\n`;
      text += `Against bill: #${billNumber(order.originalOrderId)}\n`;
      if (order.clientName) text += `Customer: ${order.clientName}\n`;
      text += `Cashier: ${order.cashierName}\n\n`;
      text += `━━━━━━━━━━━━━━━━━━━━\n`;
      text += exchangeShareLines(order, items, formatPKR).join('\n');
      if (order.transactionId) text += `\nTID: ${order.transactionId}`;
      if (order.paymentMethod === 'cash' && order.amountTendered) {
        text += `\nCash: ${formatPKR(order.amountTendered)}`;
        text += `\nChange: ${formatPKR(order.changeGiven || 0)}`;
      }
      text += `\n\n${settings.receiptFooterMessage}`;
      text += `\n\nAceva Technology\nContact: +92 305 555 2230`;
      return text;
    }
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
    text += `\n\nAceva Technology\nContact: +92 305 555 2230`;
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
