import { todayLocal, toLocalISODate } from '@/lib/dates';
import { applyCustomerLedger, customerPaymentCharges, parseAmount } from '@/lib/ledger';
import { escapeHtml } from '@/lib/orderMath';
import { useState } from 'react';
import { useStore } from '@/contexts/useStore';
import { Customer, CustomerReminder, CustomerTransaction, ReminderFrequency } from '@/types/pos';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Plus,
  Search,
  Edit,
  Trash2,
  User,
  Phone,
  MapPin,
  CreditCard,
  DollarSign,
  ArrowUpCircle,
  ArrowDownCircle,
  History,
  Wallet,
  Bell,
  BellRing,
  CalendarDays,
  Printer,
  Pencil,
} from 'lucide-react';
import { toast } from 'sonner';

export default function Customers() {
  const {
    customers,
    customerTransactions,
    customerReminders,
    addCustomer,
    updateCustomer,
    deleteCustomer,
    getCustomerTransactions,
    addCustomerPayment,
    updateCustomerTransaction,
    deleteCustomerTransaction,
    addCustomerReminder,
    updateCustomerReminder,
    deleteCustomerReminder,
    getCustomerReminders,
    getDueCustomerReminders,
    markReminderTriggered,
    settings,
  } = useStore();

  const [searchTerm, setSearchTerm] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [showLedgerModal, setShowLedgerModal] = useState(false);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [showReminderModal, setShowReminderModal] = useState(false);
  const [showDateRangeDialog, setShowDateRangeDialog] = useState(false);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);

  // Date range for ledger print
  const [ledgerFromDate, setLedgerFromDate] = useState('');
  const [ledgerToDate, setLedgerToDate] = useState(todayLocal());

  // Form state
  const [formData, setFormData] = useState({
    name: '',
    phone: '',
    address: '',
    nic: '',
  });

  // Payment form state
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentDescription, setPaymentDescription] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'card'>('cash');

  // Reminder form state
  const [reminderFrequency, setReminderFrequency] = useState<ReminderFrequency>('weekly');
  const [nextReminderDate, setNextReminderDate] = useState(todayLocal());
  const [reminderNote, setReminderNote] = useState('');
  const [editingReminderId, setEditingReminderId] = useState<string | null>(null);

  // Edit / delete transaction dialog state
  const [editingTransaction, setEditingTransaction] = useState<CustomerTransaction | null>(null);
  const [editTransactionForm, setEditTransactionForm] = useState({
    amount: '',
    description: '',
    paymentMethod: 'cash' as 'cash' | 'card',
    date: '',
  });
  const [deletingTransaction, setDeletingTransaction] = useState<CustomerTransaction | null>(null);

  // Always derive the selected customer from the live customers state
  // so edits to transactions immediately reflect in the ledger modal & print
  const liveSelectedCustomer = selectedCustomer
    ? customers.find((c) => c.id === selectedCustomer.id) || selectedCustomer
    : null;

  const formatRs = (amount: number) => `Rs. ${amount.toLocaleString()}`;
  const billNumber = (orderId: string) => orderId.slice(-8).toUpperCase();

  const filteredCustomers = customers.filter(
    (customer) =>
      customer.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      customer.phone.includes(searchTerm) ||
      (customer.nic && customer.nic.includes(searchTerm))
  );

  const resetForm = () => {
    setFormData({ name: '', phone: '', address: '', nic: '' });
  };

  const handleAddCustomer = () => {
    if (!formData.name.trim()) {
      toast.error('Customer name is required');
      return;
    }
    if (!formData.phone.trim()) {
      toast.error('Phone number is required');
      return;
    }
    if (!formData.address.trim()) {
      toast.error('Address is required');
      return;
    }

    addCustomer({
      name: formData.name.trim(),
      phone: formData.phone.trim(),
      address: formData.address.trim(),
      nic: formData.nic.trim() || undefined,
    });

    toast.success('Customer added successfully');
    setShowAddModal(false);
    resetForm();
  };

  const handleEditCustomer = () => {
    if (!selectedCustomer) return;
    if (!formData.name.trim()) {
      toast.error('Customer name is required');
      return;
    }
    if (!formData.phone.trim()) {
      toast.error('Phone number is required');
      return;
    }
    if (!formData.address.trim()) {
      toast.error('Address is required');
      return;
    }

    updateCustomer(selectedCustomer.id, {
      name: formData.name.trim(),
      phone: formData.phone.trim(),
      address: formData.address.trim(),
      nic: formData.nic.trim() || undefined,
    });

    toast.success('Customer updated successfully');
    setShowEditModal(false);
    setSelectedCustomer(null);
    resetForm();
  };

  const handleDeleteCustomer = () => {
    if (!selectedCustomer) return;
    deleteCustomer(selectedCustomer.id);
    toast.success('Customer deleted successfully');
    setShowDeleteDialog(false);
    setSelectedCustomer(null);
  };

  const handleAddPayment = () => {
    if (!selectedCustomer) return;
    const amount = parseAmount(paymentAmount);
    if (amount === null) {
      toast.error('Enter an amount above 0 with at most 2 decimals');
      return;
    }

    const charges = customerPaymentCharges(amount, paymentMethod, settings.cardFeePercent ?? 0);
    if (!addCustomerPayment(selectedCustomer.id, amount, paymentDescription, paymentMethod)) return;

    toast.success(
      paymentMethod === 'card'
        ? `Payment recorded. Card charge: ${formatRs(charges.cardFeeAmount ?? 0)} (Total charged: ${formatRs(charges.totalCharged ?? amount)})`
        : 'Payment recorded successfully'
    );
    setShowPaymentModal(false);
    setPaymentAmount('');
    setPaymentDescription('');
    setPaymentMethod('cash');
  };

  const openEditModal = (customer: Customer) => {
    setSelectedCustomer(customer);
    setFormData({
      name: customer.name,
      phone: customer.phone,
      address: customer.address,
      nic: customer.nic || '',
    });
    setShowEditModal(true);
  };

  const openLedgerModal = (customer: Customer) => {
    setSelectedCustomer(customer);
    setShowLedgerModal(true);
  };

  const openPaymentModal = (customer: Customer) => {
    setSelectedCustomer(customer);
    setShowPaymentModal(true);
  };

  const resetReminderForm = () => {
    setEditingReminderId(null);
    setReminderFrequency('weekly');
    setNextReminderDate(todayLocal());
    setReminderNote('');
  };

  const openReminderModal = (customer: Customer) => {
    setSelectedCustomer(customer);
    resetReminderForm();
    setShowReminderModal(true);
  };

  const startEditReminder = (reminder: CustomerReminder) => {
    setEditingReminderId(reminder.id);
    setReminderFrequency(reminder.frequency);
    setNextReminderDate(reminder.nextReminderDate);
    setReminderNote(reminder.note || '');
  };

  const handleSaveReminder = () => {
    if (!selectedCustomer) return;
    if (!nextReminderDate) {
      toast.error('Next reminder date is required');
      return;
    }

    if (editingReminderId) {
      const saved = updateCustomerReminder(editingReminderId, {
        frequency: reminderFrequency,
        nextReminderDate,
        note: reminderNote.trim() || undefined,
      });
      if (!saved) return;
      toast.success('Reminder updated');
      resetReminderForm();
      return;
    }

    if (!addCustomerReminder(selectedCustomer.id, reminderFrequency, nextReminderDate, reminderNote.trim() || undefined)) return;
    toast.success('Reminder scheduled successfully');
    setShowReminderModal(false);
  };

  const handleDeleteReminder = (id: string) => {
    deleteCustomerReminder(id);
    if (editingReminderId === id) resetReminderForm();
    toast.success('Reminder deleted');
  };

  const dueReminders = getDueCustomerReminders();

  // Edit transaction handlers
  const openEditTransaction = (transaction: CustomerTransaction) => {
    setEditingTransaction(transaction);
    setEditTransactionForm({
      amount: String(transaction.amount),
      description: transaction.description,
      paymentMethod: transaction.paymentMethod === 'card' ? 'card' : 'cash',
      date: toLocalISODate(new Date(transaction.createdAt)),
    });
  };

  // Card fee shown while editing: a card payment keeps its own rate; switching to card uses today's.
  const editFeeRate =
    editingTransaction?.paymentMethod === 'card' ? editingTransaction.cardFeeRate ?? 0 : settings.cardFeePercent ?? 0;
  const editAmount = parseAmount(editTransactionForm.amount);
  const editCharges =
    editAmount !== null ? customerPaymentCharges(editAmount, editTransactionForm.paymentMethod, editFeeRate) : null;

  const handleEditTransaction = () => {
    if (!editingTransaction) return;
    let saved: boolean;
    if (editingTransaction.orderId) {
      // Tied to a bill: only the wording can change here.
      saved = updateCustomerTransaction(editingTransaction.id, { description: editTransactionForm.description });
    } else {
      if (editAmount === null) {
        toast.error('Enter an amount above 0 with at most 2 decimals');
        return;
      }
      if (!editTransactionForm.date) {
        toast.error('Choose a date');
        return;
      }
      saved = updateCustomerTransaction(editingTransaction.id, {
        amount: editAmount,
        description: editTransactionForm.description,
        date: editTransactionForm.date,
        ...(editingTransaction.type === 'payment' ? { paymentMethod: editTransactionForm.paymentMethod } : {}),
      });
    }
    if (!saved) return;

    toast.success('Transaction updated successfully');
    setEditingTransaction(null);
  };

  const handleDeleteTransaction = () => {
    if (!deletingTransaction) return;
    if (deleteCustomerTransaction(deletingTransaction.id)) toast.success('Transaction deleted successfully');
    setDeletingTransaction(null);
  };

  // The customer's balance once the entry being deleted is gone (same rules as the database).
  const balanceAfterDelete =
    deletingTransaction && liveSelectedCustomer && liveSelectedCustomer.id === deletingTransaction.customerId
      ? applyCustomerLedger(liveSelectedCustomer, { removed: [deletingTransaction] }).balance
      : null;

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };



  const openPrintDateDialog = (customer: Customer) => {
    setSelectedCustomer(customer);
    setLedgerFromDate('');
    setLedgerToDate(todayLocal());
    setShowDateRangeDialog(true);
  };

  const handlePrintCustomerLedger = (customer: Customer) => {
    const allTransactions = getCustomerTransactions(customer.id)
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

    // Filter by date range
    const transactions = allTransactions.filter((t) => {
      const txDate = new Date(t.createdAt);
      if (ledgerFromDate) {
        const from = new Date(ledgerFromDate);
        from.setHours(0, 0, 0, 0);
        if (txDate < from) return false;
      }
      if (ledgerToDate) {
        const to = new Date(ledgerToDate);
        to.setHours(23, 59, 59, 999);
        if (txDate > to) return false;
      }
      return true;
    });

    const printWindow = window.open('', '_blank');
    if (printWindow) {
      printWindow.document.write(`
        <html>
          <head>
            <title>Customer Ledger - ${escapeHtml(customer.name)}</title>
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

              .customer-info {
                padding: 8px 0;
                border-bottom: 1px dashed #999;
                margin-bottom: 8px;
              }

              .customer-info .info-row {
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

              .txn-type.credit {
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
            <div class="ledger-title">Customer Ledger</div>

            <!-- Customer Info -->
            <div class="customer-info">
              <div class="info-row">
                <span class="label">Name:</span>
                <span class="value">${escapeHtml(customer.name)}</span>
              </div>
              <div class="info-row">
                <span class="label">Phone:</span>
                <span class="value">${escapeHtml(customer.phone)}</span>
              </div>
              ${customer.nic ? `
              <div class="info-row">
                <span class="label">NIC:</span>
                <span class="value">${escapeHtml(customer.nic)}</span>
              </div>` : ''}
              <div class="info-row">
                <span class="label">Address:</span>
                <span class="value">${escapeHtml(customer.address)}</span>
              </div>
            </div>

            <!-- Date Range -->
            <div style="text-align:center; font-size:9px; color:#555; padding:4px 0; border-bottom:1px dashed #999; margin-bottom:8px;">
              <strong>Period:</strong> ${ledgerFromDate ? new Date(ledgerFromDate + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'All time'} — ${ledgerToDate ? new Date(ledgerToDate + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'Present'}
            </div>

            <!-- Transactions -->
            ${transactions.length > 0 ? `
              <div class="transactions-header">Transaction History</div>
              ${transactions.map((transaction) => {
                const date = new Date(transaction.createdAt).toLocaleDateString('en-US', {
                  month: 'short',
                  day: 'numeric',
                  year: 'numeric',
                });
                const time = new Date(transaction.createdAt).toLocaleTimeString('en-US', {
                  hour: '2-digit',
                  minute: '2-digit',
                });
                const isCredit = transaction.type === 'credit';
                return `
                  <div class="transaction-item">
                    <div class="txn-top-row">
                      <span class="txn-type ${isCredit ? 'credit' : 'payment'}">${isCredit ? '▲ Credit' : '▼ Payment'}</span>
                      <span class="txn-amount">${isCredit ? '+' : '-'} Rs. ${transaction.amount.toLocaleString()}</span>
                    </div>
                    <div class="txn-desc">${escapeHtml(transaction.description)}</div>
                    <div class="txn-meta">
                      <span>${date} ${time}</span>
                      ${transaction.type === 'payment' && transaction.paymentMethod ? `<span>${transaction.paymentMethod.toUpperCase()}${transaction.paymentMethod === 'card' && transaction.cardFeeAmount ? ` | Fee: Rs. ${transaction.cardFeeAmount.toLocaleString()}` : ''}</span>` : ''}
                    </div>
                  </div>
                `;
              }).join('')}
            ` : '<div style="text-align:center; padding:10px; color:#888; font-size:10px;">No transactions recorded</div>'}

            <!-- Summary -->
            <div class="summary-section">
              <div class="summary-title">Account Summary</div>
              <div class="summary-row">
                <span>Total Credit:</span>
                <span>Rs. ${customer.totalCredit.toLocaleString()}</span>
              </div>
              <div class="summary-row">
                <span>Total Paid:</span>
                <span>Rs. ${customer.totalPaid.toLocaleString()}</span>
              </div>
              <div class="summary-row balance">
                <span>Balance Due:</span>
                <span>Rs. ${customer.balance.toLocaleString()}</span>
              </div>
            </div>

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

  const totalOutstanding = customers.reduce((sum, c) => sum + c.balance, 0);

  // Filter for tabs
  const [activeTab, setActiveTab] = useState('all');
  
  const displayedCustomers = filteredCustomers.filter((customer) => {
    if (activeTab === 'credit') return customer.balance > 0;
    if (activeTab === 'cleared') return customer.balance === 0 && customer.totalCredit > 0;
    return true; // 'all'
  });

  return (
    <div className="p-4 md:p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Customers (Digi Khata)</h1>
          <p className="text-sm text-muted-foreground">Manage your customers and track credit/payments</p>
        </div>
        <Button onClick={() => setShowAddModal(true)} className="gap-2">
          <Plus className="h-4 w-4" />
          Add Customer
        </Button>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="bg-muted/50">
          <TabsTrigger value="all">All Customers</TabsTrigger>
          <TabsTrigger value="credit">Credit Due</TabsTrigger>
          <TabsTrigger value="cleared">Cleared</TabsTrigger>
        </TabsList>
      </Tabs>

      {/* Header Stats */}
      <div className="grid gap-4 md:grid-cols-5">
        <Card className="bg-blue-500/10 border-blue-500/20">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-blue-600 dark:text-blue-200">
              Total Customers
            </CardTitle>
            <User className="h-4 w-4 text-blue-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-blue-700 dark:text-blue-300">{customers.length}</div>
          </CardContent>
        </Card>

        <Card className="bg-yellow-500/10 border-yellow-500/20">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-yellow-600 dark:text-yellow-200">
              Credit Customers
            </CardTitle>
            <CreditCard className="h-4 w-4 text-yellow-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-yellow-700 dark:text-yellow-300">
              {customers.filter((c) => c.balance > 0).length}
            </div>
          </CardContent>
        </Card>

        <Card className="bg-red-500/10 border-red-500/20">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-red-600 dark:text-red-200">
              Total Outstanding
            </CardTitle>
            <Wallet className="h-4 w-4 text-red-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-600 dark:text-red-400">
              Rs. {totalOutstanding.toLocaleString()}
            </div>
          </CardContent>
        </Card>

        <Card className="bg-green-500/10 border-green-500/20">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-green-600 dark:text-green-200">
              Total Recovered
            </CardTitle>
            <DollarSign className="h-4 w-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600 dark:text-green-400">
              Rs. {customers.reduce((sum, c) => sum + c.totalPaid, 0).toLocaleString()}
            </div>
          </CardContent>
        </Card>

        <Card className="bg-indigo-500/10 border-indigo-500/20">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-indigo-600 dark:text-indigo-200">
              Due Reminders
            </CardTitle>
            <BellRing className="h-4 w-4 text-indigo-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-indigo-700 dark:text-indigo-300">{dueReminders.length}</div>
          </CardContent>
        </Card>
      </div>

      {dueReminders.length > 0 && (
        <Card className="border-indigo-500/30 bg-indigo-500/5">
          <CardHeader>
            <CardTitle className="text-indigo-700 dark:text-indigo-300 flex items-center gap-2">
              <BellRing className="h-5 w-5" />
              Due Udhaar Reminders
            </CardTitle>
            <CardDescription>Send reminders and move to the next schedule.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {dueReminders.map((reminder) => {
              const customer = customers.find((c) => c.id === reminder.customerId);
              return (
                <div
                  key={reminder.id}
                  className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 p-3 rounded-lg border border-indigo-500/20 bg-muted/40"
                >
                  <div>
                    <p className="font-medium">{customer?.name || 'Unknown Customer'}</p>
                    <p className="text-xs text-muted-foreground">
                      {reminder.frequency.toUpperCase()} reminder due on {reminder.nextReminderDate}
                    </p>
                    {reminder.note && <p className="text-xs text-foreground/80 mt-1">{reminder.note}</p>}
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" onClick={() => markReminderTriggered(reminder.id)}>
                      Mark Sent
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => deleteCustomerReminder(reminder.id)}
                    >
                      Delete
                    </Button>
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      {/* Main Content */}
      <Card className="glass-card">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-xl">Customer List</CardTitle>
              <CardDescription>
                {activeTab === 'all' && `${displayedCustomers.length} total customers`}
                {activeTab === 'credit' && `${displayedCustomers.length} customers with outstanding balance`}
                {activeTab === 'cleared' && `${displayedCustomers.length} customers with cleared balance`}
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {/* Search */}
          <div className="mb-4 relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search by name, phone, or NIC..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10 bg-muted/30 border-border/50"
            />
          </div>

          {/* Customers Table */}
          <div className="rounded-lg border border-border/50 overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="border-border/40 hover:bg-muted/30">
                  <TableHead className="min-w-[180px]">Customer</TableHead>
                  <TableHead className="text-muted-foreground min-w-[120px]">Phone</TableHead>
                  <TableHead className="text-muted-foreground min-w-[150px]">Address</TableHead>
                  <TableHead className="text-muted-foreground text-right min-w-[100px]">Total Credit</TableHead>
                  <TableHead className="text-muted-foreground text-right min-w-[100px]">Paid</TableHead>
                  <TableHead className="text-muted-foreground text-right min-w-[100px]">Balance</TableHead>
                  <TableHead className="text-muted-foreground text-right min-w-[140px]">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {displayedCustomers.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                      {searchTerm
                        ? 'No customers found matching your search'
                        : activeTab === 'credit' 
                          ? 'No customers with outstanding balance'
                          : activeTab === 'cleared'
                            ? 'No customers with cleared balance'
                            : 'No customers yet. Add your first customer!'}
                    </TableCell>
                  </TableRow>
                ) : (
                  displayedCustomers.map((customer) => (
                    <TableRow
                      key={customer.id}
                      className="border-border/40 hover:bg-muted/40"
                    >
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-500 to-purple-500 flex items-center justify-center">
                            <span className="text-white font-semibold">
                              {customer.name.charAt(0).toUpperCase()}
                            </span>
                          </div>
                          <div>
                            <p className="font-medium text-foreground">{customer.name}</p>
                            {customer.nic && (
                              <p className="text-xs text-muted-foreground">NIC: {customer.nic}</p>
                            )}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="text-muted-foreground">{customer.phone}</TableCell>
                      <TableCell className="text-muted-foreground max-w-[200px] truncate">
                        {customer.address}
                      </TableCell>
                      <TableCell className="text-yellow-400 font-medium text-right">
                        Rs. {customer.totalCredit.toLocaleString()}
                      </TableCell>
                      <TableCell className="text-green-400 font-medium text-right">
                        Rs. {customer.totalPaid.toLocaleString()}
                      </TableCell>
                      <TableCell className="text-right">
                        <Badge
                          variant={customer.balance > 0 ? 'destructive' : 'secondary'}
                          className={
                            customer.balance > 0
                              ? 'bg-red-500/20 text-red-400 border-red-500/30'
                              : 'bg-green-500/20 text-green-400 border-green-500/30'
                          }
                        >
                          Rs. {customer.balance.toLocaleString()}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => openLedgerModal(customer)}
                            title="View Ledger"
                          >
                            <History className="h-4 w-4 text-blue-400" />
                          </Button>
                          {customer.balance > 0 && (
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => openPaymentModal(customer)}
                              title="Add Payment"
                            >
                              <DollarSign className="h-4 w-4 text-green-400" />
                            </Button>
                          )}
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => openReminderModal(customer)}
                            title="Schedule Reminder"
                          >
                            <Bell className="h-4 w-4 text-indigo-400" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => openEditModal(customer)}
                            title="Edit Customer"
                          >
                            <Edit className="h-4 w-4 text-muted-foreground" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => {
                              setSelectedCustomer(customer);
                              setShowDeleteDialog(true);
                            }}
                            title="Delete Customer"
                          >
                            <Trash2 className="h-4 w-4 text-red-400" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Add Customer Modal */}
      <Dialog open={showAddModal} onOpenChange={setShowAddModal}>
        <DialogContent className="bg-card border-border">
          <DialogHeader>
            <DialogTitle className="text-foreground">Add New Customer</DialogTitle>
            <DialogDescription>
              Add a new customer to your Digi Khata. Required fields are marked with *.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label className="text-foreground">Name *</Label>
              <div className="relative">
                <User className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="Customer name"
                  className="pl-10 bg-muted/20 border-border/50"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label className="text-foreground">Phone *</Label>
              <div className="relative">
                <Phone className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={formData.phone}
                  onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                  placeholder="03XX-XXXXXXX"
                  className="pl-10 bg-muted/20 border-border/50"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label className="text-foreground">Address *</Label>
              <div className="relative">
                <MapPin className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                <Input
                  value={formData.address}
                  onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                  placeholder="Full address"
                  className="pl-10 bg-muted/20 border-border/50"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label className="text-foreground">NIC (Optional)</Label>
              <div className="relative">
                <CreditCard className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={formData.nic}
                  onChange={(e) => setFormData({ ...formData, nic: e.target.value })}
                  placeholder="XXXXX-XXXXXXX-X"
                  className="pl-10 bg-muted/20 border-border/50"
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setShowAddModal(false);
                resetForm();
              }}
            >
              Cancel
            </Button>
            <Button onClick={handleAddCustomer}>Add Customer</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Customer Modal */}
      <Dialog open={showEditModal} onOpenChange={setShowEditModal}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Customer</DialogTitle>
            <DialogDescription>Update customer information.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label className="text-foreground">Name *</Label>
              <div className="relative">
                <User className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="Customer name"
                  className="pl-10 bg-muted/40 border-border/50"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label className="text-foreground">Phone *</Label>
              <div className="relative">
                <Phone className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={formData.phone}
                  onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                  placeholder="03XX-XXXXXXX"
                  className="pl-10 bg-muted/40 border-border/50"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label className="text-foreground">Address *</Label>
              <div className="relative">
                <MapPin className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                <Input
                  value={formData.address}
                  onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                  placeholder="Full address"
                  className="pl-10 bg-muted/40 border-border/50"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label className="text-foreground">NIC (Optional)</Label>
              <div className="relative">
                <CreditCard className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={formData.nic}
                  onChange={(e) => setFormData({ ...formData, nic: e.target.value })}
                  placeholder="XXXXX-XXXXXXX-X"
                  className="pl-10 bg-muted/40 border-border/50"
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setShowEditModal(false);
                setSelectedCustomer(null);
                resetForm();
              }}
            >
              Cancel
            </Button>
            <Button onClick={handleEditCustomer}>Save Changes</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Customer</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <p>Are you sure you want to delete "{liveSelectedCustomer?.name}"?</p>
                {liveSelectedCustomer && liveSelectedCustomer.balance !== 0 && (
                  <p className="font-medium text-red-600 dark:text-red-400">
                    {liveSelectedCustomer.balance > 0
                      ? `This customer still owes ${formatRs(liveSelectedCustomer.balance)}. That balance will no longer be tracked anywhere.`
                      : `This customer has ${formatRs(-liveSelectedCustomer.balance)} paid in advance. That will no longer be tracked anywhere.`}
                  </p>
                )}
                {liveSelectedCustomer && (
                  <p>
                    Their ledger history ({getCustomerTransactions(liveSelectedCustomer.id).length} entries) and
                    reminders ({getCustomerReminders(liveSelectedCustomer.id).length}) will be deleted too. Past bills
                    keep the customer name printed on them. This action cannot be undone.
                  </p>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteCustomer}
              className="bg-red-600 hover:bg-red-700"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Ledger Modal (Digi Khata) */}
      <Dialog open={showLedgerModal} onOpenChange={setShowLedgerModal}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <History className="h-5 w-5" />
              Ledger - {selectedCustomer?.name}
            </DialogTitle>
            <DialogDescription>
              Complete transaction history for this customer
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            {/* Summary Cards */}
            {liveSelectedCustomer && (
              <div className="grid grid-cols-3 gap-3 mb-4">
                <div className="p-3 rounded-lg bg-yellow-500/10 border border-yellow-500/20">
                  <p className="text-xs text-yellow-700 dark:text-yellow-300">Total Credit</p>
                  <p className="text-lg font-bold text-yellow-600 dark:text-yellow-400">
                    Rs. {liveSelectedCustomer.totalCredit.toLocaleString()}
                  </p>
                </div>
                <div className="p-3 rounded-lg bg-green-500/10 border border-green-500/20">
                  <p className="text-xs text-green-700 dark:text-green-300">Total Paid</p>
                  <p className="text-lg font-bold text-green-600 dark:text-green-400">
                    Rs. {liveSelectedCustomer.totalPaid.toLocaleString()}
                  </p>
                </div>
                <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20">
                  <p className="text-xs text-red-700 dark:text-red-300">Balance Due</p>
                  <p className="text-lg font-bold text-red-600 dark:text-red-400">
                    Rs. {liveSelectedCustomer.balance.toLocaleString()}
                  </p>
                </div>
              </div>
            )}

            {/* Transaction List */}
            <ScrollArea className="h-[300px] rounded-lg border border-border/50">
              {selectedCustomer && (
                <div className="p-4 space-y-3">
                  {getCustomerTransactions(selectedCustomer.id).length === 0 ? (
                    <div className="text-center text-muted-foreground py-8">
                      No transactions yet
                    </div>
                  ) : (
                    getCustomerTransactions(selectedCustomer.id)
                      .sort(
                        (a, b) =>
                          new Date(b.createdAt).getTime() -
                          new Date(a.createdAt).getTime()
                      )
                      .map((transaction) => (
                        <div
                          key={transaction.id}
                          className="flex items-center justify-between p-3 rounded-lg bg-muted/20 border border-border/50"
                        >
                          <div className="flex items-center gap-3">
                            <div
                              className={`w-10 h-10 rounded-full flex items-center justify-center ${
                                transaction.type === 'credit'
                                  ? 'bg-red-500/20'
                                  : 'bg-green-500/20'
                              }`}
                            >
                              {transaction.type === 'credit' ? (
                                <ArrowUpCircle className="h-5 w-5 text-red-400" />
                              ) : (
                                <ArrowDownCircle className="h-5 w-5 text-green-400" />
                              )}
                            </div>
                            <div>
                              <p className="text-sm font-medium">
                                {transaction.description}
                                {transaction.orderId && (
                                  <Badge
                                    variant="outline"
                                    className="ml-2 px-1.5 py-0 text-[10px] font-mono align-middle"
                                    title="Edit or cancel the bill from POS → Manage Bills"
                                  >
                                    Bill #{billNumber(transaction.orderId)}
                                  </Badge>
                                )}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                {formatDate(transaction.createdAt)}
                              </p>
                              {transaction.type === 'payment' && transaction.paymentMethod && (
                                <p className="text-xs text-muted-foreground mt-1">
                                  Method: {transaction.paymentMethod.toUpperCase()}
                                  {transaction.paymentMethod === 'card' && transaction.cardFeeAmount
                                    ? ` | Card fee: Rs. ${transaction.cardFeeAmount.toLocaleString()}`
                                    : ''}
                                </p>
                              )}
                            </div>
                          </div>
                          <span
                            className={`font-bold ${
                              transaction.type === 'credit'
                                ? 'text-red-400'
                                : 'text-green-400'
                            }`}
                          >
                            {transaction.type === 'credit' ? '+' : '-'} Rs.{' '}
                            {transaction.amount.toLocaleString()}
                          </span>
                          <div className="flex items-center gap-1 ml-2">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7"
                              onClick={() => openEditTransaction(transaction)}
                              title={transaction.orderId ? 'Edit description' : 'Edit transaction'}
                            >
                              <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
                            </Button>
                            {/* Bill entries follow the bill: they change when the bill is edited or cancelled. */}
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7"
                              onClick={() => setDeletingTransaction(transaction)}
                              disabled={!!transaction.orderId}
                              title={
                                transaction.orderId
                                  ? 'Part of a bill: edit or cancel the bill from POS → Manage Bills'
                                  : 'Delete transaction'
                              }
                            >
                              <Trash2 className="h-3.5 w-3.5 text-red-400" />
                            </Button>
                          </div>
                        </div>
                      ))
                  )}
                </div>
              )}
            </ScrollArea>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => liveSelectedCustomer && openPrintDateDialog(liveSelectedCustomer)}
              className="gap-2"
            >
              <Printer className="h-4 w-4" />
              Print Ledger
            </Button>
            {liveSelectedCustomer && liveSelectedCustomer.balance > 0 && (
              <Button
                onClick={() => {
                  setShowLedgerModal(false);
                  openPaymentModal(liveSelectedCustomer);
                }}
                className="gap-2"
              >
                <DollarSign className="h-4 w-4" />
                Add Payment
              </Button>
            )}
            <Button variant="outline" onClick={() => setShowLedgerModal(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Payment Modal */}
      <Dialog open={showPaymentModal} onOpenChange={setShowPaymentModal}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Record Payment</DialogTitle>
            <DialogDescription>
              Record a payment from {liveSelectedCustomer?.name}
              {liveSelectedCustomer && (
                <span className="block mt-1 text-red-500 font-medium">
                  Outstanding: Rs. {liveSelectedCustomer.balance.toLocaleString()}
                </span>
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Amount *</Label>
              <div className="relative">
                <DollarSign className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={paymentAmount}
                  onChange={(e) => setPaymentAmount(e.target.value)}
                  placeholder="Enter amount"
                  className="pl-10 bg-muted/40 border-border/50"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Payment Method</Label>
              <Select
                value={paymentMethod}
                onValueChange={(value) => setPaymentMethod(value as 'cash' | 'card')}
              >
                <SelectTrigger className="bg-muted/40 border-border/50">
                  <SelectValue placeholder="Select payment method" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="cash">Cash</SelectItem>
                  <SelectItem value="card">Card ({settings.cardFeePercent}% charge)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {(() => {
              const amount = parseAmount(paymentAmount);
              if (amount === null) return null;
              const charges = customerPaymentCharges(amount, paymentMethod, settings.cardFeePercent ?? 0);
              const balanceAfter = liveSelectedCustomer
                ? applyCustomerLedger(liveSelectedCustomer, { added: [{ type: 'payment', amount, description: '' }] }).balance
                : null;
              return (
                <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 text-sm space-y-1">
                  {paymentMethod === 'card' && (
                    <>
                      <p className="text-amber-600 font-medium">
                        Card charge ({settings.cardFeePercent ?? 0}%): {formatRs(charges.cardFeeAmount ?? 0)}
                      </p>
                      <p className="text-amber-700">Total charged to customer: {formatRs(charges.totalCharged ?? amount)}</p>
                    </>
                  )}
                  {balanceAfter !== null && (
                    <p className="text-foreground">
                      Balance after this payment: <span className="font-medium">{formatRs(balanceAfter)}</span>
                      {balanceAfter < 0 && ' (paid in advance)'}
                    </p>
                  )}
                </div>
              );
            })()}
            <div className="space-y-2">
              <Label>Description (Optional)</Label>
              <Input
                value={paymentDescription}
                onChange={(e) => setPaymentDescription(e.target.value)}
                placeholder="e.g., Cash payment, Bank transfer..."
                className="bg-muted/40 border-border/50"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setShowPaymentModal(false);
                setPaymentAmount('');
                setPaymentDescription('');
                setPaymentMethod('cash');
              }}
            >
              Cancel
            </Button>
            <Button onClick={handleAddPayment} className="bg-green-600 hover:bg-green-700">
              Record Payment
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reminder Modal */}
      <Dialog open={showReminderModal} onOpenChange={setShowReminderModal}>
        <DialogContent className="bg-card border-border">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Bell className="h-5 w-5" />
              {editingReminderId ? 'Edit Udhaar Reminder' : 'Schedule Udhaar Reminder'}
            </DialogTitle>
            <DialogDescription>
              Set reminder frequency for {selectedCustomer?.name}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Frequency</Label>
              <Select
                value={reminderFrequency}
                onValueChange={(value) => setReminderFrequency(value as ReminderFrequency)}
              >
                <SelectTrigger className="bg-muted/40 border-border/50">
                  <SelectValue placeholder="Select frequency" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="daily">Daily</SelectItem>
                  <SelectItem value="weekly">Weekly</SelectItem>
                  <SelectItem value="monthly">Monthly</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Next Reminder Date</Label>
              <div className="relative">
                <CalendarDays className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  type="date"
                  value={nextReminderDate}
                  onChange={(e) => setNextReminderDate(e.target.value)}
                  className="pl-10 bg-muted/40 border-border/50"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Note (Optional)</Label>
              <Input
                value={reminderNote}
                onChange={(e) => setReminderNote(e.target.value)}
                placeholder="e.g., Call after salary date"
                className="bg-muted/40 border-border/50"
              />
            </div>

            {selectedCustomer && getCustomerReminders(selectedCustomer.id).length > 0 && (
              <div className="space-y-2">
                <Label>Existing Reminders</Label>
                <div className="space-y-2 max-h-40 overflow-y-auto">
                  {getCustomerReminders(selectedCustomer.id).map((reminder) => (
                    <div
                      key={reminder.id}
                      className={`p-2 rounded border bg-muted/30 flex items-center justify-between gap-2 ${
                        editingReminderId === reminder.id ? 'border-primary' : 'border-border/50'
                      }`}
                    >
                      <div>
                        <p className="text-sm font-medium">
                          {reminder.frequency.toUpperCase()} - {reminder.nextReminderDate}
                          {!reminder.isActive && (
                            <Badge variant="secondary" className="ml-2 text-[10px]">
                              Paused
                            </Badge>
                          )}
                        </p>
                        {reminder.note && <p className="text-xs text-muted-foreground">{reminder.note}</p>}
                      </div>
                      <div className="flex gap-1">
                        <Button size="sm" variant="ghost" onClick={() => startEditReminder(reminder)}>
                          Edit
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => updateCustomerReminder(reminder.id, { isActive: !reminder.isActive })}
                        >
                          {reminder.isActive ? 'Pause' : 'Resume'}
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => handleDeleteReminder(reminder.id)}>
                          Delete
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            {editingReminderId ? (
              <Button variant="outline" onClick={resetReminderForm}>
                Cancel Edit
              </Button>
            ) : (
              <Button variant="outline" onClick={() => setShowReminderModal(false)}>
                Cancel
              </Button>
            )}
            <Button onClick={handleSaveReminder}>{editingReminderId ? 'Update Reminder' : 'Save Reminder'}</Button>
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
              Select the date range for {selectedCustomer?.name}'s ledger. Leave "From" empty to include all past transactions.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label className="text-foreground">From Date</Label>
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
              <Label className="text-foreground">To Date</Label>
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
                if (liveSelectedCustomer) {
                  setShowDateRangeDialog(false);
                  handlePrintCustomerLedger(liveSelectedCustomer);
                }
              }}
              className="gap-2"
            >
              <Printer className="h-4 w-4" />
              Print
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Transaction Modal */}
      <Dialog open={!!editingTransaction} onOpenChange={(open) => !open && setEditingTransaction(null)}>
        <DialogContent className="bg-card border-border">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Pencil className="h-5 w-5" />
              Edit Transaction
            </DialogTitle>
            <DialogDescription>
              {editingTransaction?.orderId
                ? 'Only the description can be changed here.'
                : 'Update the amount, payment method, date or description'}
            </DialogDescription>
          </DialogHeader>
          {editingTransaction && (
            <div className="space-y-4 py-4">
              {editingTransaction.orderId && (
                <div className="p-3 rounded-lg bg-blue-500/10 border border-blue-500/20 text-sm">
                  <p className="font-medium">
                    {editingTransaction.type === 'credit' ? 'Credit sale' : 'Credit reversal'} of{' '}
                    <span className="font-mono">Bill #{billNumber(editingTransaction.orderId)}</span>:{' '}
                    {formatRs(editingTransaction.amount)}
                  </p>
                  <p className="text-muted-foreground mt-1">
                    The amount follows the bill. To change it, edit or cancel the bill from POS → Manage Bills.
                  </p>
                </div>
              )}
              {!editingTransaction.orderId && (
                <>
                  <div className="space-y-2">
                    <Label>Amount (Rs.) *</Label>
                    <div className="relative">
                      <DollarSign className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        type="number"
                        min="0"
                        step="0.01"
                        value={editTransactionForm.amount}
                        onChange={(e) => setEditTransactionForm({ ...editTransactionForm, amount: e.target.value })}
                        placeholder="Enter amount"
                        className="pl-10 bg-muted/40 border-border/50"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    {editingTransaction.type === 'payment' && (
                      <div className="space-y-2">
                        <Label>Payment Method</Label>
                        <Select
                          value={editTransactionForm.paymentMethod}
                          onValueChange={(value) =>
                            setEditTransactionForm({ ...editTransactionForm, paymentMethod: value as 'cash' | 'card' })
                          }
                        >
                          <SelectTrigger className="bg-muted/40 border-border/50">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="cash">Cash</SelectItem>
                            <SelectItem value="card">Card ({editFeeRate}% charge)</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    )}
                    <div className="space-y-2">
                      <Label>Date</Label>
                      <Input
                        type="date"
                        max={todayLocal()}
                        value={editTransactionForm.date}
                        onChange={(e) => setEditTransactionForm({ ...editTransactionForm, date: e.target.value })}
                        className="bg-muted/40 border-border/50"
                      />
                    </div>
                  </div>
                  {editingTransaction.type === 'payment' && editTransactionForm.paymentMethod === 'card' && editCharges && (
                    <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 text-sm">
                      <p className="text-amber-600 font-medium">
                        Card charge ({editFeeRate}%): {formatRs(editCharges.cardFeeAmount ?? 0)}
                      </p>
                      <p className="text-amber-700 mt-1">
                        Total charged to customer: {formatRs(editCharges.totalCharged ?? editAmount ?? 0)}
                      </p>
                    </div>
                  )}
                </>
              )}
              <div className="space-y-2">
                <Label>Description</Label>
                <Input
                  value={editTransactionForm.description}
                  onChange={(e) => setEditTransactionForm({ ...editTransactionForm, description: e.target.value })}
                  placeholder="Payment description"
                  className="bg-muted/40 border-border/50"
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingTransaction(null)}>
              Cancel
            </Button>
            <Button onClick={handleEditTransaction}>Save Changes</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Transaction Confirmation */}
      <AlertDialog open={!!deletingTransaction} onOpenChange={(open) => !open && setDeletingTransaction(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Transaction</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                {deletingTransaction && (
                  <p>
                    Delete the {deletingTransaction.type === 'credit' ? 'credit entry' : 'payment'} of{' '}
                    <span className="font-medium text-foreground">{formatRs(deletingTransaction.amount)}</span>
                    {deletingTransaction.description ? ` ("${deletingTransaction.description}")` : ''}?
                  </p>
                )}
                {liveSelectedCustomer && balanceAfterDelete !== null && (
                  <p>
                    {liveSelectedCustomer.name}'s balance goes from{' '}
                    <span className="font-medium text-foreground">{formatRs(liveSelectedCustomer.balance)}</span> to{' '}
                    <span className="font-medium text-foreground">{formatRs(balanceAfterDelete)}</span>.
                  </p>
                )}
                <p>This action cannot be undone.</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteTransaction} className="bg-red-600 hover:bg-red-700">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
