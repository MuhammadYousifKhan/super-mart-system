import { todayLocal } from '@/lib/dates';
import { applySupplierLedger, isStockIntakeEntry, parseAmount } from '@/lib/ledger';
import { escapeHtml } from '@/lib/orderMath';
import { useMemo, useState } from 'react';
import { useStore } from '@/contexts/useStore';
import { Supplier, ScheduleFrequency, SupplierPaymentSchedule, SupplierPurchase } from '@/types/pos';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
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
import { Switch } from '@/components/ui/switch';
import { toast } from 'sonner';
import { Building2, Plus, ReceiptText, CalendarClock, CalendarDays, Wrench, CheckCircle2, Printer, Trash2, Edit2 } from 'lucide-react';

function formatPKR(amount: number) {
  return `Rs. ${amount.toLocaleString()}`;
}

export default function Suppliers() {
  const {
    suppliers,
    supplierPurchases,
    supplierPaymentSchedules,
    addSupplier,
    updateSupplier,
    deleteSupplier,
    getSupplierById,
    addSupplierPurchase,
    updateSupplierPurchase,
    deleteSupplierPurchase,
    getSupplierPurchases,
    addSupplierPaymentSchedule,
    updateSupplierPaymentSchedule,
    deleteSupplierPaymentSchedule,
    getSupplierPaymentSchedules,
    getDueSupplierPaymentSchedules,
    markSupplierSchedulePaid,
    settings,
  } = useStore();

  const [activeTab, setActiveTab] = useState('records');
  const [search, setSearch] = useState('');
  const [selectedSupplierId, setSelectedSupplierId] = useState('');
  const [showDateRangeDialog, setShowDateRangeDialog] = useState(false);

  // Date range for ledger print
  const [ledgerFromDate, setLedgerFromDate] = useState('');
  const [ledgerToDate, setLedgerToDate] = useState(todayLocal());

  const [supplierDialogOpen, setSupplierDialogOpen] = useState(false);
  const [editingSupplier, setEditingSupplier] = useState<Supplier | null>(null);

  const [editingLedgerEntry, setEditingLedgerEntry] = useState<SupplierPurchase | null>(null);
  const [ledgerEditForm, setLedgerEditForm] = useState({
    amount: '',
    description: '',
    isPayment: false,
    purchaseDate: '',
    invoiceNumber: '',
  });
  const [deletingLedgerEntry, setDeletingLedgerEntry] = useState<SupplierPurchase | null>(null);
  const [deletingSupplierId, setDeletingSupplierId] = useState<string | null>(null);

  const [editingSchedule, setEditingSchedule] = useState<SupplierPaymentSchedule | null>(null);
  const [scheduleEditForm, setScheduleEditForm] = useState({
    frequency: 'monthly' as ScheduleFrequency,
    nextPaymentDate: '',
    amount: '',
    note: '',
    isActive: true,
  });
  const [payingScheduleId, setPayingScheduleId] = useState<string | null>(null);
  const [deletingScheduleId, setDeletingScheduleId] = useState<string | null>(null);

  const [supplierForm, setSupplierForm] = useState({
    name: '',
    phone: '',
    address: '',
    contactPerson: '',
    notes: '',
  });

  const [purchaseForm, setPurchaseForm] = useState({
    supplierId: '',
    entryType: 'purchase' as 'purchase' | 'payment',
    description: '',
    amount: '',
    purchaseDate: todayLocal(),
    invoiceNumber: '',
  });

  const [scheduleForm, setScheduleForm] = useState({
    supplierId: '',
    frequency: 'monthly' as ScheduleFrequency,
    nextPaymentDate: todayLocal(),
    amount: '',
    note: '',
  });

  const [healthResult, setHealthResult] = useState<{
    checkedAt: string;
    durationMs: number;
    orphanPurchases: number;
    orphanSchedules: number;
    dueSchedules: number;
    suppliersWithNegativeBalance: number;
    ok: boolean;
  } | null>(null);

  const filteredSuppliers = useMemo(() => {
    const query = search.toLowerCase().trim();
    if (!query) return suppliers;
    return suppliers.filter((s) =>
      s.name.toLowerCase().includes(query) ||
      s.phone.includes(query) ||
      (s.contactPerson || '').toLowerCase().includes(query)
    );
  }, [suppliers, search]);

  const selectedSupplier = selectedSupplierId ? getSupplierById(selectedSupplierId) : undefined;
  const dueSchedules = getDueSupplierPaymentSchedules();

  const openCreateSupplier = () => {
    setEditingSupplier(null);
    setSupplierForm({
      name: '',
      phone: '',
      address: '',
      contactPerson: '',
      notes: '',
    });
    setSupplierDialogOpen(true);
  };

  const openEditSupplier = (supplier: Supplier) => {
    setEditingSupplier(supplier);
    setSupplierForm({
      name: supplier.name,
      phone: supplier.phone,
      address: supplier.address,
      contactPerson: supplier.contactPerson || '',
      notes: supplier.notes || '',
    });
    setSupplierDialogOpen(true);
  };

  const saveSupplier = () => {
    if (!supplierForm.name.trim() || !supplierForm.phone.trim() || !supplierForm.address.trim()) {
      toast.error('Name, phone, and address are required');
      return;
    }

    if (editingSupplier) {
      updateSupplier(editingSupplier.id, {
        name: supplierForm.name.trim(),
        phone: supplierForm.phone.trim(),
        address: supplierForm.address.trim(),
        contactPerson: supplierForm.contactPerson.trim() || undefined,
        notes: supplierForm.notes.trim() || undefined,
      });
      toast.success('Supplier updated');
    } else {
      addSupplier({
        name: supplierForm.name.trim(),
        phone: supplierForm.phone.trim(),
        address: supplierForm.address.trim(),
        contactPerson: supplierForm.contactPerson.trim() || undefined,
        notes: supplierForm.notes.trim() || undefined,
      });
      toast.success('Supplier added');
    }

    setSupplierDialogOpen(false);
  };

  const submitPurchase = () => {
    const amount = parseAmount(purchaseForm.amount);
    const isPayment = purchaseForm.entryType === 'payment';
    if (!purchaseForm.supplierId || (!isPayment && !purchaseForm.description.trim()) || amount === null) {
      toast.error(
        isPayment
          ? 'Supplier and a valid amount (above 0, at most 2 decimals) are required'
          : 'Supplier, description and a valid amount (above 0, at most 2 decimals) are required'
      );
      return;
    }
    if (!purchaseForm.purchaseDate) {
      toast.error('Choose a date');
      return;
    }

    const saved = addSupplierPurchase({
      supplierId: purchaseForm.supplierId,
      description: purchaseForm.description.trim() || (isPayment ? 'Payment to supplier' : ''),
      // Payments to the supplier are stored as negative amounts.
      amount: isPayment ? -amount : amount,
      purchaseDate: purchaseForm.purchaseDate,
      invoiceNumber: purchaseForm.invoiceNumber.trim() || undefined,
    });
    if (!saved) return;

    toast.success(isPayment ? 'Payment recorded' : 'Purchase entry recorded');
    setPurchaseForm({
      supplierId: purchaseForm.supplierId,
      entryType: purchaseForm.entryType,
      description: '',
      amount: '',
      purchaseDate: todayLocal(),
      invoiceNumber: '',
    });
  };

  const submitSchedule = () => {
    const amount = parseAmount(scheduleForm.amount);
    if (!scheduleForm.supplierId || amount === null) {
      toast.error('Supplier and a valid schedule amount (above 0, at most 2 decimals) are required');
      return;
    }

    const saved = addSupplierPaymentSchedule({
      supplierId: scheduleForm.supplierId,
      frequency: scheduleForm.frequency,
      nextPaymentDate: scheduleForm.nextPaymentDate,
      amount,
      note: scheduleForm.note.trim() || undefined,
    });
    if (!saved) return;

    toast.success('Payment schedule added');
    setScheduleForm({
      supplierId: scheduleForm.supplierId,
      frequency: scheduleForm.frequency,
      nextPaymentDate: todayLocal(),
      amount: '',
      note: '',
    });
  };

  const openEditLedgerEntry = (purchase: SupplierPurchase) => {
    setEditingLedgerEntry(purchase);
    setLedgerEditForm({
      amount: Math.abs(purchase.amount).toString(),
      description: purchase.description,
      isPayment: purchase.amount < 0,
      purchaseDate: purchase.purchaseDate,
      invoiceNumber: purchase.invoiceNumber || '',
    });
  };

  const submitLedgerEdit = () => {
    if (!editingLedgerEntry) return;
    const amount = parseAmount(ledgerEditForm.amount);
    if (amount === null) {
      toast.error('Enter an amount above 0 with at most 2 decimals');
      return;
    }
    if (!ledgerEditForm.purchaseDate) {
      toast.error('Choose a date');
      return;
    }

    const saved = updateSupplierPurchase(editingLedgerEntry.id, {
      amount: ledgerEditForm.isPayment ? -amount : amount,
      // An empty description keeps the old one: the database requires one.
      description: ledgerEditForm.description,
      purchaseDate: ledgerEditForm.purchaseDate,
      invoiceNumber: ledgerEditForm.invoiceNumber,
    });
    if (!saved) return;

    toast.success('Ledger entry updated');
    setEditingLedgerEntry(null);
  };

  const handleDeleteLedgerEntry = () => {
    if (!deletingLedgerEntry) return;
    if (deleteSupplierPurchase(deletingLedgerEntry.id)) toast.success('Ledger entry deleted');
    setDeletingLedgerEntry(null);
  };

  // Balance effects shown in the confirmations (same rules as the database).
  const deletingEntrySupplier = deletingLedgerEntry ? getSupplierById(deletingLedgerEntry.supplierId) : undefined;
  const balanceAfterEntryDelete =
    deletingLedgerEntry && deletingEntrySupplier
      ? applySupplierLedger(deletingEntrySupplier, { removed: [deletingLedgerEntry] }).balance
      : null;

  const editingEntrySupplier = editingLedgerEntry ? getSupplierById(editingLedgerEntry.supplierId) : undefined;
  const editAmount = parseAmount(ledgerEditForm.amount);
  const balanceAfterEntryEdit =
    editingLedgerEntry && editingEntrySupplier && editAmount !== null
      ? applySupplierLedger(editingEntrySupplier, {
          removed: [editingLedgerEntry],
          added: [{ amount: ledgerEditForm.isPayment ? -editAmount : editAmount }],
        }).balance
      : null;

  const deletingSupplier = deletingSupplierId ? getSupplierById(deletingSupplierId) : undefined;
  const confirmDeleteSupplier = () => {
    if (!deletingSupplier) return;
    deleteSupplier(deletingSupplier.id);
    if (selectedSupplierId === deletingSupplier.id) setSelectedSupplierId('');
    toast.success('Supplier deleted');
    setDeletingSupplierId(null);
  };

  // Payment schedules
  const openEditSchedule = (schedule: SupplierPaymentSchedule) => {
    setEditingSchedule(schedule);
    setScheduleEditForm({
      frequency: schedule.frequency,
      nextPaymentDate: schedule.nextPaymentDate,
      amount: String(schedule.amount),
      note: schedule.note || '',
      isActive: schedule.isActive,
    });
  };

  const submitScheduleEdit = () => {
    if (!editingSchedule) return;
    const amount = parseAmount(scheduleEditForm.amount);
    if (amount === null) {
      toast.error('Enter an amount above 0 with at most 2 decimals');
      return;
    }
    if (!scheduleEditForm.nextPaymentDate) {
      toast.error('Choose the next payment date');
      return;
    }
    const saved = updateSupplierPaymentSchedule(editingSchedule.id, {
      frequency: scheduleEditForm.frequency,
      nextPaymentDate: scheduleEditForm.nextPaymentDate,
      amount,
      note: scheduleEditForm.note.trim() || undefined,
      isActive: scheduleEditForm.isActive,
    });
    if (!saved) return;
    toast.success('Payment schedule updated');
    setEditingSchedule(null);
  };

  const payingSchedule = payingScheduleId ? supplierPaymentSchedules.find((s) => s.id === payingScheduleId) : undefined;
  const payingSupplier = payingSchedule ? getSupplierById(payingSchedule.supplierId) : undefined;
  const balanceAfterSchedulePayment =
    payingSchedule && payingSupplier
      ? applySupplierLedger(payingSupplier, { added: [{ amount: -payingSchedule.amount }] }).balance
      : null;
  const confirmSchedulePaid = () => {
    if (payingSchedule && markSupplierSchedulePaid(payingSchedule.id)) {
      toast.success(`Payment of ${formatPKR(payingSchedule.amount)} recorded in the ledger`);
    }
    setPayingScheduleId(null);
  };

  const deletingSchedule = deletingScheduleId ? supplierPaymentSchedules.find((s) => s.id === deletingScheduleId) : undefined;
  const confirmDeleteSchedule = () => {
    if (deletingSchedule) {
      deleteSupplierPaymentSchedule(deletingSchedule.id);
      toast.success('Payment schedule deleted');
    }
    setDeletingScheduleId(null);
  };

  const runHealthCheck = () => {
    const started = performance.now();

    const supplierIds = new Set(suppliers.map((s) => s.id));
    const orphanPurchases = supplierPurchases.filter((p) => !supplierIds.has(p.supplierId)).length;
    const orphanSchedules = supplierPaymentSchedules.filter((s) => !supplierIds.has(s.supplierId)).length;
    const suppliersWithNegativeBalance = suppliers.filter((s) => s.balance < 0).length;
    const dueSchedulesCount = getDueSupplierPaymentSchedules().length;

    const durationMs = Math.round((performance.now() - started) * 100) / 100;
    const ok = orphanPurchases === 0 && orphanSchedules === 0 && suppliersWithNegativeBalance === 0;

    setHealthResult({
      checkedAt: new Date().toISOString(),
      durationMs,
      orphanPurchases,
      orphanSchedules,
      dueSchedules: dueSchedulesCount,
      suppliersWithNegativeBalance,
      ok,
    });

    if (ok) {
      toast.success('Health checks passed');
    } else {
      toast.warning('Health checks found issues');
    }
  };

  const openPrintDateDialog = () => {
    setLedgerFromDate('');
    setLedgerToDate(todayLocal());
    setShowDateRangeDialog(true);
  };

  const handlePrintSupplierLedger = (supplierId?: string) => {
    const purchases = supplierId && supplierId !== 'all'
      ? getSupplierPurchases(supplierId)
      : supplierPurchases;

    const supplier = supplierId && supplierId !== 'all' ? getSupplierById(supplierId) : null;

    // Filter by date range
    const filteredPurchases = purchases.filter((p) => {
      const pDate = new Date(p.purchaseDate);
      if (ledgerFromDate) {
        const from = new Date(ledgerFromDate);
        from.setHours(0, 0, 0, 0);
        if (pDate < from) return false;
      }
      if (ledgerToDate) {
        const to = new Date(ledgerToDate);
        to.setHours(23, 59, 59, 999);
        if (pDate > to) return false;
      }
      return true;
    });

    const sortedPurchases = [...filteredPurchases].sort(
      (a, b) => new Date(a.purchaseDate).getTime() - new Date(b.purchaseDate).getTime()
    );

    const printWindow = window.open('', '_blank');
    if (printWindow) {
      printWindow.document.write(`
        <html>
          <head>
            <title>Supplier Ledger${supplier ? ` - ${escapeHtml(supplier.name)}` : ''}</title>
            <style>
              @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');

              * { margin: 0; padding: 0; box-sizing: border-box; }

              body {
                font-family: 'Inter', 'Segoe UI', Arial, sans-serif;
                font-size: 11px;
                line-height: 1.4;
                color: #1a1a1a;
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
                font-size: 16px;
                font-weight: 700;
                letter-spacing: 1px;
                text-transform: uppercase;
                margin-bottom: 2px;
              }

              .store-details {
                font-size: 9px;
                color: #444;
                line-height: 1.5;
              }

              .ledger-title {
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

              .supplier-info {
                padding: 8px 0;
                border-bottom: 1px dashed #999;
                margin-bottom: 8px;
              }

              .supplier-info .info-row {
                display: flex;
                justify-content: space-between;
                align-items: flex-start;
                padding: 2px 0;
                font-size: 10px;
              }

              .info-row .label {
                font-weight: 600;
                color: #555;
                min-width: 55px;
              }

              .info-row .value {
                text-align: right;
                flex: 1;
                word-break: break-word;
              }

              .all-suppliers-label {
                text-align: center;
                font-size: 11px;
                font-weight: 600;
                color: #333;
                padding: 6px 0;
                border-bottom: 1px dashed #999;
                margin-bottom: 8px;
              }

              .summary-section {
                margin: 10px 0;
                padding: 8px;
                border: 1.5px solid #000;
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
                border-bottom: 1px solid #ddd;
              }

              .summary-row {
                display: flex;
                justify-content: space-between;
                padding: 3px 0;
                font-size: 10px;
              }

              .summary-row.balance {
                margin-top: 4px;
                padding-top: 6px;
                border-top: 1.5px solid #000;
                font-size: 12px;
                font-weight: 700;
              }

              .transactions-header {
                text-align: center;
                font-size: 10px;
                font-weight: 700;
                letter-spacing: 1.5px;
                text-transform: uppercase;
                margin: 12px 0 6px;
                padding: 5px 0;
                border-top: 1px dashed #999;
                border-bottom: 1px dashed #999;
              }

              .transaction-item {
                padding: 6px 0;
                border-bottom: 1px dotted #ccc;
              }

              .transaction-item:last-child {
                border-bottom: none;
              }

              .txn-top-row {
                display: flex;
                justify-content: space-between;
                align-items: center;
                margin-bottom: 2px;
              }

              .txn-type {
                font-size: 9px;
                font-weight: 700;
                padding: 1px 5px;
                border-radius: 2px;
                text-transform: uppercase;
                letter-spacing: 0.5px;
              }

              .txn-type.purchase {
                background: #f0f0f0;
                color: #000;
                border: 1px solid #aaa;
              }

              .txn-type.payment {
                background: #000;
                color: #fff;
                border: 1px solid #000;
              }

              .txn-amount {
                font-size: 11px;
                font-weight: 700;
                color: #000;
              }

              .txn-desc {
                font-size: 9px;
                color: #555;
                margin: 1px 0;
              }

              .txn-meta {
                font-size: 8px;
                color: #888;
                display: flex;
                justify-content: space-between;
              }

              .receipt-footer {
                margin-top: 12px;
                padding-top: 8px;
                border-top: 2px solid #000;
                text-align: center;
              }

              .footer-message {
                font-size: 10px;
                font-weight: 500;
                margin-bottom: 4px;
              }

              .footer-generated {
                font-size: 8px;
                color: #888;
                margin-top: 4px;
              }

              .divider-dots {
                text-align: center;
                letter-spacing: 3px;
                color: #ccc;
                font-size: 8px;
                margin: 4px 0;
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
                }
              }
            </style>
          </head>
          <body>
            <!-- Header -->
            <div class="receipt-header">
              <div class="store-name">${escapeHtml(settings.storeName)}</div>
              <div class="store-details">
                ${escapeHtml(settings.address)}<br/>
                Tel: ${escapeHtml(settings.phone)}
              </div>
            </div>

            <!-- Ledger Title -->
            <div class="ledger-title">Supplier Ledger</div>

            <!-- Supplier Info -->
            ${supplier ? `
              <div class="supplier-info">
                <div class="info-row">
                  <span class="label">Supplier:</span>
                  <span class="value">${escapeHtml(supplier.name)}</span>
                </div>
                <div class="info-row">
                  <span class="label">Phone:</span>
                  <span class="value">${escapeHtml(supplier.phone)}</span>
                </div>
                ${supplier.contactPerson ? `
                <div class="info-row">
                  <span class="label">Contact:</span>
                  <span class="value">${escapeHtml(supplier.contactPerson)}</span>
                </div>` : ''}
                <div class="info-row">
                  <span class="label">Address:</span>
                  <span class="value">${escapeHtml(supplier.address)}</span>
                </div>
              </div>
            ` : `
              <div class="all-suppliers-label">All Suppliers Summary</div>
            `}

            <!-- Date Range -->
            <div style="text-align:center; font-size:9px; color:#555; padding:4px 0; border-bottom:1px dashed #999; margin-bottom:8px;">
              <strong>Period:</strong> ${ledgerFromDate ? new Date(ledgerFromDate + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'All time'} — ${ledgerToDate ? new Date(ledgerToDate + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'Present'}
            </div>

            <!-- Transactions -->
            ${sortedPurchases.length > 0 ? `
              <div class="transactions-header">Transaction History</div>
              ${sortedPurchases.map((purchase) => {
                const date = new Date(purchase.purchaseDate).toLocaleDateString('en-US', {
                  month: 'short',
                  day: 'numeric',
                  year: 'numeric',
                });
                const isPayment = purchase.amount < 0;
                const supplierName = escapeHtml(getSupplierById(purchase.supplierId)?.name || 'Unknown');
                return `
                  <div class="transaction-item">
                    <div class="txn-top-row">
                      <span class="txn-type ${isPayment ? 'payment' : 'purchase'}">${isPayment ? '▼ Payment' : '▲ Purchase'}</span>
                      <span class="txn-amount">${isPayment ? '-' : '+'} Rs. ${Math.abs(purchase.amount).toLocaleString()}</span>
                    </div>
                    <div class="txn-desc">${escapeHtml(purchase.description)}</div>
                    <div class="txn-meta">
                      <span>${date}</span>
                      <span>${!supplier ? supplierName : ''}${purchase.invoiceNumber ? `${!supplier ? ' | ' : ''}Inv: ${escapeHtml(purchase.invoiceNumber)}` : ''}</span>
                    </div>
                  </div>
                `;
              }).join('')}
            ` : '<div style="text-align:center; padding:10px; color:#888; font-size:10px;">No transactions recorded</div>'}

            <!-- Summary (at bottom) -->
            ${supplier ? `
              <div class="summary-section">
                <div class="summary-title">Account Summary</div>
                <div class="summary-row">
                  <span>Total Purchased:</span>
                  <span>Rs. ${supplier.totalPurchased.toLocaleString()}</span>
                </div>
                <div class="summary-row">
                  <span>Total Paid:</span>
                  <span>Rs. ${supplier.totalPaid.toLocaleString()}</span>
                </div>
                <div class="summary-row balance">
                  <span>Balance Due:</span>
                  <span>Rs. ${supplier.balance.toLocaleString()}</span>
                </div>
              </div>
            ` : ''}
            <!-- Footer -->
            <div class="receipt-footer">
              <div class="footer-message">${settings.receiptFooterMessage}</div>
              <div class="divider-dots">• • • • • • • • • • •</div>
              <div class="footer-generated">Generated: ${new Date().toLocaleString()}</div>
            </div>
          </body>
        </html>
      `);
      printWindow.document.close();
      printWindow.print();
    }
  };

  return (
    <div className="p-4 md:p-6 space-y-6">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <Building2 className="h-6 w-6" />
            Suppliers
          </h1>
          <p className="text-sm text-muted-foreground">Supplier records, purchase entries, and payment schedules</p>
        </div>
        <Button onClick={openCreateSupplier}>
          <Plus className="h-4 w-4 mr-2" />
          Add Supplier
        </Button>
      </div>

      {dueSchedules.length > 0 && (
        <Card className="border-amber-500/30">
          <CardHeader className="pb-3">
            <CardTitle className="text-amber-600 flex items-center gap-2 text-lg">
              <CalendarClock className="h-5 w-5" />
              Due Supplier Payments
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {dueSchedules.map((schedule) => {
              const supplier = getSupplierById(schedule.supplierId);
              return (
                <div key={schedule.id} className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 p-3 border border-border/40 bg-muted/30 rounded-md">
                  <div>
                    <p className="font-medium text-foreground">{supplier?.name || 'Unknown Supplier'}</p>
                    <p className="text-xs text-muted-foreground">
                      {schedule.frequency.toUpperCase()} - Due {schedule.nextPaymentDate} - {formatPKR(schedule.amount)}
                    </p>
                  </div>
                  <Button size="sm" onClick={() => setPayingScheduleId(schedule.id)}>
                    Mark Paid
                  </Button>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="records">Supplier Records</TabsTrigger>
          <TabsTrigger value="purchases">Ledger</TabsTrigger>
          <TabsTrigger value="schedules">Payment Schedules</TabsTrigger>
          <TabsTrigger value="quality">Quality Checks</TabsTrigger>
        </TabsList>

        <TabsContent value="records" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Suppliers</CardTitle>
              <CardDescription>Manage supplier profiles and balances</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Input
                placeholder="Search suppliers by name, phone, or contact person"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />

              <div className="border rounded-md overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Phone</TableHead>
                      <TableHead>Contact</TableHead>
                      <TableHead className="text-right">Purchased</TableHead>
                      <TableHead className="text-right">Paid</TableHead>
                      <TableHead className="text-right">Balance</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredSuppliers.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">No suppliers found</TableCell>
                      </TableRow>
                    ) : (
                      filteredSuppliers.map((supplier) => (
                        <TableRow key={supplier.id}>
                          <TableCell>
                            <div>
                              <p className="font-medium">{supplier.name}</p>
                              <p className="text-xs text-muted-foreground truncate max-w-[220px]">{supplier.address}</p>
                            </div>
                          </TableCell>
                          <TableCell>{supplier.phone}</TableCell>
                          <TableCell>{supplier.contactPerson || '-'}</TableCell>
                          <TableCell className="text-right">{formatPKR(supplier.totalPurchased)}</TableCell>
                          <TableCell className="text-right">{formatPKR(supplier.totalPaid)}</TableCell>
                          <TableCell className="text-right">
                            <Badge variant={supplier.balance > 0 ? 'destructive' : 'secondary'}>
                              {formatPKR(supplier.balance)}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right space-x-2">
                            <Button size="sm" variant="outline" onClick={() => openEditSupplier(supplier)}>Edit</Button>
                            <Button size="sm" variant="destructive" onClick={() => setDeletingSupplierId(supplier.id)}>Delete</Button>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="purchases" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><ReceiptText className="h-5 w-5" /> Add Purchase or Payment</CardTitle>
              <CardDescription>
                A purchase adds to what you owe the supplier; a payment to the supplier takes it off. Stock is received
                from Inventory → Receive Supplier Stock.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Supplier</Label>
                <Select value={purchaseForm.supplierId} onValueChange={(value) => setPurchaseForm({ ...purchaseForm, supplierId: value })}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select supplier" />
                  </SelectTrigger>
                  <SelectContent>
                    {suppliers.map((supplier) => (
                      <SelectItem key={supplier.id} value={supplier.id}>{supplier.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Entry Type</Label>
                <Select
                  value={purchaseForm.entryType}
                  onValueChange={(value) => setPurchaseForm({ ...purchaseForm, entryType: value as 'purchase' | 'payment' })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="purchase">Purchase (invoice)</SelectItem>
                    <SelectItem value="payment">Payment to supplier</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Amount</Label>
                <Input type="number" min="0" step="0.01" value={purchaseForm.amount} onChange={(e) => setPurchaseForm({ ...purchaseForm, amount: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>{purchaseForm.entryType === 'payment' ? 'Payment Date' : 'Purchase Date'}</Label>
                <Input type="date" value={purchaseForm.purchaseDate} onChange={(e) => setPurchaseForm({ ...purchaseForm, purchaseDate: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>Description{purchaseForm.entryType === 'payment' ? ' (optional)' : ''}</Label>
                <Input
                  value={purchaseForm.description}
                  onChange={(e) => setPurchaseForm({ ...purchaseForm, description: e.target.value })}
                  placeholder={purchaseForm.entryType === 'payment' ? 'e.g., Cash paid to salesman' : 'e.g., Weekly grocery stock'}
                />
              </div>
              <div className="space-y-2">
                <Label>Invoice Number</Label>
                <Input value={purchaseForm.invoiceNumber} onChange={(e) => setPurchaseForm({ ...purchaseForm, invoiceNumber: e.target.value })} />
              </div>
              <div className="md:col-span-2">
                <Button onClick={submitPurchase}>{purchaseForm.entryType === 'payment' ? 'Save Payment' : 'Save Purchase'}</Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Ledger Entries</CardTitle>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={openPrintDateDialog}
                  className="gap-2"
                >
                  <Printer className="h-4 w-4" />
                  Print Ledger
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-2">
                <Label>Filter by Supplier</Label>
                <Select value={selectedSupplierId} onValueChange={setSelectedSupplierId}>
                  <SelectTrigger>
                    <SelectValue placeholder="All suppliers" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All suppliers</SelectItem>
                    {suppliers.map((supplier) => (
                      <SelectItem key={supplier.id} value={supplier.id}>{supplier.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="border rounded-md overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Supplier</TableHead>
                      <TableHead>Description</TableHead>
                      <TableHead>Invoice</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(selectedSupplierId && selectedSupplierId !== 'all'
                      ? getSupplierPurchases(selectedSupplierId)
                      : supplierPurchases
                    ).map((purchase) => (
                      <TableRow key={purchase.id}>
                        <TableCell>{purchase.purchaseDate}</TableCell>
                        <TableCell>
                          <Badge variant={purchase.amount < 0 ? 'secondary' : 'outline'}>
                            {purchase.amount < 0 ? 'Payment' : 'Invoice'}
                          </Badge>
                        </TableCell>
                        <TableCell>{getSupplierById(purchase.supplierId)?.name || '-'}</TableCell>
                        <TableCell>{purchase.description}</TableCell>
                        <TableCell>{purchase.invoiceNumber || '-'}</TableCell>
                        <TableCell className="text-right">{formatPKR(Math.abs(purchase.amount))}</TableCell>
                        <TableCell className="text-right space-x-2">
                          <Button size="icon" variant="ghost" className="h-8 w-8" title="Edit entry" onClick={() => openEditLedgerEntry(purchase)}>
                            <Edit2 className="h-4 w-4" />
                          </Button>
                          <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" title="Delete entry" onClick={() => setDeletingLedgerEntry(purchase)}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="schedules" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Add Payment Schedule</CardTitle>
              <CardDescription>Create daily, weekly, or monthly supplier payment plans</CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Supplier</Label>
                <Select value={scheduleForm.supplierId} onValueChange={(value) => setScheduleForm({ ...scheduleForm, supplierId: value })}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select supplier" />
                  </SelectTrigger>
                  <SelectContent>
                    {suppliers.map((supplier) => (
                      <SelectItem key={supplier.id} value={supplier.id}>{supplier.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Frequency</Label>
                <Select value={scheduleForm.frequency} onValueChange={(value) => setScheduleForm({ ...scheduleForm, frequency: value as ScheduleFrequency })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="daily">Daily</SelectItem>
                    <SelectItem value="weekly">Weekly</SelectItem>
                    <SelectItem value="monthly">Monthly</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Next Payment Date</Label>
                <Input type="date" value={scheduleForm.nextPaymentDate} onChange={(e) => setScheduleForm({ ...scheduleForm, nextPaymentDate: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>Amount</Label>
                <Input type="number" min="0" step="0.01" value={scheduleForm.amount} onChange={(e) => setScheduleForm({ ...scheduleForm, amount: e.target.value })} />
              </div>
              <div className="space-y-2 md:col-span-2">
                <Label>Note</Label>
                <Textarea value={scheduleForm.note} onChange={(e) => setScheduleForm({ ...scheduleForm, note: e.target.value })} rows={2} />
              </div>
              <div className="md:col-span-2">
                <Button onClick={submitSchedule}>Save Schedule</Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Payment Schedules</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
            {supplierPaymentSchedules.length === 0 ? (
                <p className="text-sm text-muted-foreground">No schedules yet.</p>
              ) : (
                supplierPaymentSchedules.map((schedule) => (
                  <div key={schedule.id} className="flex flex-col md:flex-row md:items-center md:justify-between gap-2 p-3 border border-border/40 bg-muted/20 rounded-md">
                    <div>
                      <p className="font-medium text-foreground">
                        {getSupplierById(schedule.supplierId)?.name || 'Unknown Supplier'}
                        {!schedule.isActive && <Badge variant="secondary" className="ml-2">Paused</Badge>}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {schedule.frequency.toUpperCase()} | Next: {schedule.nextPaymentDate} | Amount: {formatPKR(schedule.amount)}
                        {schedule.lastPaidAt ? ` | Last paid: ${new Date(schedule.lastPaidAt).toLocaleDateString()}` : ''}
                      </p>
                      {schedule.note && <p className="text-xs text-foreground/80 mt-1">{schedule.note}</p>}
                    </div>
                    <div className="flex gap-2">
                      <Button size="sm" onClick={() => setPayingScheduleId(schedule.id)}>Mark Paid</Button>
                      <Button size="sm" variant="outline" onClick={() => openEditSchedule(schedule)}>Edit</Button>
                      <Button size="sm" variant="destructive" onClick={() => setDeletingScheduleId(schedule.id)}>Delete</Button>
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="quality" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Wrench className="h-5 w-5" /> Final Testing and Performance Checks</CardTitle>
              <CardDescription>Run basic integrity and performance checks for supplier module stability</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Button onClick={runHealthCheck}>Run Checks</Button>

              {healthResult && (
                <div className="space-y-2 p-4 border rounded-md">
                  <p className="text-sm flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4" />
                    Checked at: {new Date(healthResult.checkedAt).toLocaleString()}
                  </p>
                  <p className="text-sm">Execution time: {healthResult.durationMs} ms</p>
                  <p className="text-sm">Orphan purchases: {healthResult.orphanPurchases}</p>
                  <p className="text-sm">Orphan schedules: {healthResult.orphanSchedules}</p>
                  <p className="text-sm">Due schedules: {healthResult.dueSchedules}</p>
                  <p className="text-sm">Suppliers with negative balance: {healthResult.suppliersWithNegativeBalance}</p>
                  <Badge variant={healthResult.ok ? 'secondary' : 'destructive'}>
                    {healthResult.ok ? 'PASS' : 'ATTENTION NEEDED'}
                  </Badge>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={supplierDialogOpen} onOpenChange={setSupplierDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingSupplier ? 'Edit Supplier' : 'Add Supplier'}</DialogTitle>
            <DialogDescription>Supplier record details</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-1 gap-3">
            <div className="space-y-1">
              <Label>Name</Label>
              <Input value={supplierForm.name} onChange={(e) => setSupplierForm({ ...supplierForm, name: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label>Phone</Label>
              <Input value={supplierForm.phone} onChange={(e) => setSupplierForm({ ...supplierForm, phone: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label>Address</Label>
              <Input value={supplierForm.address} onChange={(e) => setSupplierForm({ ...supplierForm, address: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label>Contact Person</Label>
              <Input value={supplierForm.contactPerson} onChange={(e) => setSupplierForm({ ...supplierForm, contactPerson: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label>Notes</Label>
              <Textarea value={supplierForm.notes} onChange={(e) => setSupplierForm({ ...supplierForm, notes: e.target.value })} rows={3} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSupplierDialogOpen(false)}>Cancel</Button>
            <Button onClick={saveSupplier}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Date Range Dialog for Ledger Print */}
      <Dialog open={showDateRangeDialog} onOpenChange={setShowDateRangeDialog}>
        <DialogContent className="bg-card border-border max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CalendarDays className="h-5 w-5" />
              Print Ledger - Date Range
            </DialogTitle>
            <DialogDescription>
              Select the date range for the supplier ledger. Leave "From" empty to include all past transactions.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>From Date</Label>
              <div className="relative">
                <CalendarDays className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  type="date"
                  value={ledgerFromDate}
                  onChange={(e) => setLedgerFromDate(e.target.value)}
                  className="pl-10 bg-muted/20 border-border/50"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>To Date</Label>
              <div className="relative">
                <CalendarDays className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  type="date"
                  value={ledgerToDate}
                  onChange={(e) => setLedgerToDate(e.target.value)}
                  className="pl-10 bg-muted/20 border-border/50"
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowDateRangeDialog(false)}
            >
              Cancel
            </Button>
            <Button
              onClick={() => {
                setShowDateRangeDialog(false);
                handlePrintSupplierLedger(selectedSupplierId);
              }}
              className="gap-2"
            >
              <Printer className="h-4 w-4" />
              Print
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!editingLedgerEntry} onOpenChange={(open) => !open && setEditingLedgerEntry(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Ledger Entry</DialogTitle>
            <DialogDescription>
              {editingEntrySupplier ? `${editingEntrySupplier.name}: ` : ''}update the type, amount, date, invoice number or description.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            {editingLedgerEntry && isStockIntakeEntry(editingLedgerEntry) && (
              <div className="p-3 rounded-md border border-amber-500/30 bg-amber-500/10 text-sm">
                This entry was made by Receive Supplier Stock. Changing it only changes the supplier's balance; the stock
                that was received stays as it is (adjust it in Inventory if needed).
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Entry Type</Label>
                <Select
                  value={ledgerEditForm.isPayment ? 'payment' : 'purchase'}
                  onValueChange={(value) => setLedgerEditForm({ ...ledgerEditForm, isPayment: value === 'payment' })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="purchase">Purchase (invoice)</SelectItem>
                    <SelectItem value="payment">Payment to supplier</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Amount</Label>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={ledgerEditForm.amount}
                  onChange={(e) => setLedgerEditForm({ ...ledgerEditForm, amount: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>Date</Label>
                <Input
                  type="date"
                  value={ledgerEditForm.purchaseDate}
                  onChange={(e) => setLedgerEditForm({ ...ledgerEditForm, purchaseDate: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>Invoice Number</Label>
                <Input
                  value={ledgerEditForm.invoiceNumber}
                  onChange={(e) => setLedgerEditForm({ ...ledgerEditForm, invoiceNumber: e.target.value })}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Description</Label>
              <Input
                value={ledgerEditForm.description}
                onChange={(e) => setLedgerEditForm({ ...ledgerEditForm, description: e.target.value })}
              />
            </div>
            {editingEntrySupplier && balanceAfterEntryEdit !== null && (
              <p className="text-sm text-muted-foreground">
                Balance with {editingEntrySupplier.name}: {formatPKR(editingEntrySupplier.balance)} →{' '}
                <span className="font-medium text-foreground">{formatPKR(balanceAfterEntryEdit)}</span>
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingLedgerEntry(null)}>Cancel</Button>
            <Button onClick={submitLedgerEdit}>Save Changes</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete ledger entry */}
      <AlertDialog open={!!deletingLedgerEntry} onOpenChange={(open) => !open && setDeletingLedgerEntry(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Ledger Entry</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                {deletingLedgerEntry && (
                  <p>
                    Delete the {deletingLedgerEntry.amount < 0 ? 'payment' : 'purchase'} of{' '}
                    <span className="font-medium text-foreground">{formatPKR(Math.abs(deletingLedgerEntry.amount))}</span>
                    {deletingLedgerEntry.invoiceNumber ? ` (invoice ${deletingLedgerEntry.invoiceNumber})` : ''}?
                  </p>
                )}
                {deletingEntrySupplier && balanceAfterEntryDelete !== null && (
                  <p>
                    Balance with {deletingEntrySupplier.name} goes from{' '}
                    <span className="font-medium text-foreground">{formatPKR(deletingEntrySupplier.balance)}</span> to{' '}
                    <span className="font-medium text-foreground">{formatPKR(balanceAfterEntryDelete)}</span>.
                  </p>
                )}
                {deletingLedgerEntry && isStockIntakeEntry(deletingLedgerEntry) && (
                  <p className="text-amber-600">
                    This entry was made by Receive Supplier Stock. Deleting it does not remove the stock that was
                    received; adjust stock in Inventory if needed.
                  </p>
                )}
                <p>This action cannot be undone.</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteLedgerEntry} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete supplier */}
      <AlertDialog open={!!deletingSupplier} onOpenChange={(open) => !open && setDeletingSupplierId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Supplier</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <p>Are you sure you want to delete "{deletingSupplier?.name}"?</p>
                {deletingSupplier && deletingSupplier.balance !== 0 && (
                  <p className="font-medium text-destructive">
                    {deletingSupplier.balance > 0
                      ? `You still owe this supplier ${formatPKR(deletingSupplier.balance)}. That balance will no longer be tracked anywhere.`
                      : `This supplier holds ${formatPKR(-deletingSupplier.balance)} paid in advance. That will no longer be tracked anywhere.`}
                  </p>
                )}
                {deletingSupplier && (
                  <p>
                    All their purchases and payments ({getSupplierPurchases(deletingSupplier.id).length} ledger entries)
                    and payment schedules ({getSupplierPaymentSchedules(deletingSupplier.id).length}) will be deleted too.
                    Stock already received stays in Inventory. This action cannot be undone.
                  </p>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDeleteSupplier} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Edit payment schedule */}
      <Dialog open={!!editingSchedule} onOpenChange={(open) => !open && setEditingSchedule(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Payment Schedule</DialogTitle>
            <DialogDescription>
              {editingSchedule ? getSupplierById(editingSchedule.supplierId)?.name || 'Unknown Supplier' : ''}
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3 py-2">
            <div className="space-y-2">
              <Label>Frequency</Label>
              <Select
                value={scheduleEditForm.frequency}
                onValueChange={(value) => setScheduleEditForm({ ...scheduleEditForm, frequency: value as ScheduleFrequency })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="daily">Daily</SelectItem>
                  <SelectItem value="weekly">Weekly</SelectItem>
                  <SelectItem value="monthly">Monthly</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Amount</Label>
              <Input
                type="number"
                min="0"
                step="0.01"
                value={scheduleEditForm.amount}
                onChange={(e) => setScheduleEditForm({ ...scheduleEditForm, amount: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>Next Payment Date</Label>
              <Input
                type="date"
                value={scheduleEditForm.nextPaymentDate}
                onChange={(e) => setScheduleEditForm({ ...scheduleEditForm, nextPaymentDate: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>Active</Label>
              <div className="flex items-center gap-2 h-10">
                <Switch
                  checked={scheduleEditForm.isActive}
                  onCheckedChange={(checked) => setScheduleEditForm({ ...scheduleEditForm, isActive: checked })}
                />
                <span className="text-sm text-muted-foreground">{scheduleEditForm.isActive ? 'Shows when due' : 'Paused'}</span>
              </div>
            </div>
            <div className="space-y-2 col-span-2">
              <Label>Note</Label>
              <Textarea
                value={scheduleEditForm.note}
                onChange={(e) => setScheduleEditForm({ ...scheduleEditForm, note: e.target.value })}
                rows={2}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingSchedule(null)}>Cancel</Button>
            <Button onClick={submitScheduleEdit}>Save Changes</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Mark scheduled payment as paid */}
      <AlertDialog open={!!payingSchedule} onOpenChange={(open) => !open && setPayingScheduleId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Record Scheduled Payment</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                {payingSchedule && (
                  <p>
                    Record a payment of <span className="font-medium text-foreground">{formatPKR(payingSchedule.amount)}</span> to{' '}
                    {payingSupplier?.name || 'this supplier'}, dated today. The next payment moves on from{' '}
                    {payingSchedule.nextPaymentDate} ({payingSchedule.frequency}).
                  </p>
                )}
                {payingSupplier && balanceAfterSchedulePayment !== null && (
                  <p>
                    Balance goes from <span className="font-medium text-foreground">{formatPKR(payingSupplier.balance)}</span> to{' '}
                    <span className="font-medium text-foreground">{formatPKR(balanceAfterSchedulePayment)}</span>
                    {balanceAfterSchedulePayment < 0 ? ' (more than you owe: the rest counts as paid in advance)' : ''}.
                  </p>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmSchedulePaid}>Record Payment</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete payment schedule */}
      <AlertDialog open={!!deletingSchedule} onOpenChange={(open) => !open && setDeletingScheduleId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Payment Schedule</AlertDialogTitle>
            <AlertDialogDescription>
              {deletingSchedule
                ? `Delete the ${deletingSchedule.frequency} schedule of ${formatPKR(deletingSchedule.amount)} for ${
                    getSupplierById(deletingSchedule.supplierId)?.name || 'this supplier'
                  }? Payments already recorded stay in the ledger.`
                : ''}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDeleteSchedule} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
