import { useState } from 'react';
import { useStore } from '@/contexts/StoreContext';
import { Customer, CustomerTransaction, ReminderFrequency } from '@/types/pos';
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
    addCustomerReminder,
    updateCustomerReminder,
    deleteCustomerReminder,
    getCustomerReminders,
    getDueCustomerReminders,
    markReminderTriggered,
  } = useStore();

  const [searchTerm, setSearchTerm] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [showLedgerModal, setShowLedgerModal] = useState(false);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [showReminderModal, setShowReminderModal] = useState(false);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);

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
  const [nextReminderDate, setNextReminderDate] = useState(new Date().toISOString().slice(0, 10));
  const [reminderNote, setReminderNote] = useState('');

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
    const amount = parseFloat(paymentAmount);
    if (isNaN(amount) || amount <= 0) {
      toast.error('Please enter a valid amount');
      return;
    }

    const cardFee = paymentMethod === 'card' ? (amount * 2) / 100 : 0;
    const totalCharged = amount + cardFee;

    addCustomerPayment(
      selectedCustomer.id,
      amount,
      paymentDescription.trim() || `${paymentMethod === 'card' ? 'Card' : 'Cash'} payment received`,
      paymentMethod
    );

    toast.success(
      paymentMethod === 'card'
        ? `Payment recorded. Card charge: Rs. ${cardFee.toLocaleString()} (Total charged: Rs. ${totalCharged.toLocaleString()})`
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

  const openReminderModal = (customer: Customer) => {
    setSelectedCustomer(customer);
    setReminderFrequency('weekly');
    setNextReminderDate(new Date().toISOString().slice(0, 10));
    setReminderNote('');
    setShowReminderModal(true);
  };

  const handleAddReminder = () => {
    if (!selectedCustomer) return;
    if (!nextReminderDate) {
      toast.error('Next reminder date is required');
      return;
    }

    addCustomerReminder(
      selectedCustomer.id,
      reminderFrequency,
      nextReminderDate,
      reminderNote.trim() || undefined
    );
    toast.success('Reminder scheduled successfully');
    setShowReminderModal(false);
  };

  const dueReminders = getDueCustomerReminders();

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
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
        <Card className="bg-gradient-to-br from-blue-500/10 to-cyan-500/10 border-blue-500/20">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-blue-200">
              Total Customers
            </CardTitle>
            <User className="h-4 w-4 text-blue-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-blue-100">{customers.length}</div>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-yellow-500/10 to-orange-500/10 border-yellow-500/20">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-yellow-200">
              Credit Customers
            </CardTitle>
            <CreditCard className="h-4 w-4 text-yellow-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-yellow-100">
              {customers.filter((c) => c.balance > 0).length}
            </div>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-red-500/10 to-pink-500/10 border-red-500/20">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-red-200">
              Total Outstanding
            </CardTitle>
            <Wallet className="h-4 w-4 text-red-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-100">
              Rs. {totalOutstanding.toLocaleString()}
            </div>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-green-500/10 to-emerald-500/10 border-green-500/20">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-green-200">
              Total Recovered
            </CardTitle>
            <DollarSign className="h-4 w-4 text-green-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-100">
              Rs. {customers.reduce((sum, c) => sum + c.totalPaid, 0).toLocaleString()}
            </div>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-indigo-500/10 to-blue-500/10 border-indigo-500/20">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-indigo-200">
              Due Reminders
            </CardTitle>
            <BellRing className="h-4 w-4 text-indigo-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-indigo-100">{dueReminders.length}</div>
          </CardContent>
        </Card>
      </div>

      {dueReminders.length > 0 && (
        <Card className="border-indigo-500/30 bg-indigo-500/5">
          <CardHeader>
            <CardTitle className="text-indigo-200 flex items-center gap-2">
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
                  className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 p-3 rounded-lg border border-indigo-500/20 bg-black/20"
                >
                  <div>
                    <p className="text-white font-medium">{customer?.name || 'Unknown Customer'}</p>
                    <p className="text-xs text-gray-400">
                      {reminder.frequency.toUpperCase()} reminder due on {reminder.nextReminderDate}
                    </p>
                    {reminder.note && <p className="text-xs text-gray-300 mt-1">{reminder.note}</p>}
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
      <Card className="border-white/10 bg-black/20 backdrop-blur-xl">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-xl text-white">Customer List</CardTitle>
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
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <Input
              placeholder="Search by name, phone, or NIC..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10 bg-white/5 border-white/10"
            />
          </div>

          {/* Customers Table */}
          <div className="rounded-lg border border-white/10 overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="border-white/10 hover:bg-white/5">
                  <TableHead className="text-gray-300 min-w-[180px]">Customer</TableHead>
                  <TableHead className="text-gray-300 min-w-[120px]">Phone</TableHead>
                  <TableHead className="text-gray-300 min-w-[150px]">Address</TableHead>
                  <TableHead className="text-gray-300 text-right min-w-[100px]">Total Credit</TableHead>
                  <TableHead className="text-gray-300 text-right min-w-[100px]">Paid</TableHead>
                  <TableHead className="text-gray-300 text-right min-w-[100px]">Balance</TableHead>
                  <TableHead className="text-gray-300 text-right min-w-[140px]">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {displayedCustomers.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center text-gray-400 py-8">
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
                      className="border-white/10 hover:bg-white/5"
                    >
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-500 to-purple-500 flex items-center justify-center">
                            <span className="text-white font-semibold">
                              {customer.name.charAt(0).toUpperCase()}
                            </span>
                          </div>
                          <div>
                            <p className="font-medium text-white">{customer.name}</p>
                            {customer.nic && (
                              <p className="text-xs text-gray-400">NIC: {customer.nic}</p>
                            )}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="text-gray-300">{customer.phone}</TableCell>
                      <TableCell className="text-gray-300 max-w-[200px] truncate">
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
                            <Edit className="h-4 w-4 text-gray-400" />
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
        <DialogContent className="bg-gray-900 border-white/10">
          <DialogHeader>
            <DialogTitle className="text-white">Add New Customer</DialogTitle>
            <DialogDescription>
              Add a new customer to your Digi Khata. Required fields are marked with *.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label className="text-gray-200">Name *</Label>
              <div className="relative">
                <User className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                <Input
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="Customer name"
                  className="pl-10 bg-white/5 border-white/10"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label className="text-gray-200">Phone *</Label>
              <div className="relative">
                <Phone className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                <Input
                  value={formData.phone}
                  onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                  placeholder="03XX-XXXXXXX"
                  className="pl-10 bg-white/5 border-white/10"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label className="text-gray-200">Address *</Label>
              <div className="relative">
                <MapPin className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
                <Input
                  value={formData.address}
                  onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                  placeholder="Full address"
                  className="pl-10 bg-white/5 border-white/10"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label className="text-gray-200">NIC (Optional)</Label>
              <div className="relative">
                <CreditCard className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                <Input
                  value={formData.nic}
                  onChange={(e) => setFormData({ ...formData, nic: e.target.value })}
                  placeholder="XXXXX-XXXXXXX-X"
                  className="pl-10 bg-white/5 border-white/10"
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
        <DialogContent className="bg-gray-900 border-white/10">
          <DialogHeader>
            <DialogTitle className="text-white">Edit Customer</DialogTitle>
            <DialogDescription>Update customer information.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label className="text-gray-200">Name *</Label>
              <div className="relative">
                <User className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                <Input
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="Customer name"
                  className="pl-10 bg-white/5 border-white/10"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label className="text-gray-200">Phone *</Label>
              <div className="relative">
                <Phone className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                <Input
                  value={formData.phone}
                  onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                  placeholder="03XX-XXXXXXX"
                  className="pl-10 bg-white/5 border-white/10"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label className="text-gray-200">Address *</Label>
              <div className="relative">
                <MapPin className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
                <Input
                  value={formData.address}
                  onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                  placeholder="Full address"
                  className="pl-10 bg-white/5 border-white/10"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label className="text-gray-200">NIC (Optional)</Label>
              <div className="relative">
                <CreditCard className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                <Input
                  value={formData.nic}
                  onChange={(e) => setFormData({ ...formData, nic: e.target.value })}
                  placeholder="XXXXX-XXXXXXX-X"
                  className="pl-10 bg-white/5 border-white/10"
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
        <AlertDialogContent className="bg-gray-900 border-white/10">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-white">Delete Customer</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{selectedCustomer?.name}"? This will also
              delete all associated transaction history. This action cannot be undone.
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
        <DialogContent className="bg-gray-900 border-white/10 max-w-2xl">
          <DialogHeader>
            <DialogTitle className="text-white flex items-center gap-2">
              <History className="h-5 w-5" />
              Ledger - {selectedCustomer?.name}
            </DialogTitle>
            <DialogDescription>
              Complete transaction history for this customer
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            {/* Summary Cards */}
            {selectedCustomer && (
              <div className="grid grid-cols-3 gap-3 mb-4">
                <div className="p-3 rounded-lg bg-yellow-500/10 border border-yellow-500/20">
                  <p className="text-xs text-yellow-300">Total Credit</p>
                  <p className="text-lg font-bold text-yellow-400">
                    Rs. {selectedCustomer.totalCredit.toLocaleString()}
                  </p>
                </div>
                <div className="p-3 rounded-lg bg-green-500/10 border border-green-500/20">
                  <p className="text-xs text-green-300">Total Paid</p>
                  <p className="text-lg font-bold text-green-400">
                    Rs. {selectedCustomer.totalPaid.toLocaleString()}
                  </p>
                </div>
                <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20">
                  <p className="text-xs text-red-300">Balance Due</p>
                  <p className="text-lg font-bold text-red-400">
                    Rs. {selectedCustomer.balance.toLocaleString()}
                  </p>
                </div>
              </div>
            )}

            {/* Transaction List */}
            <ScrollArea className="h-[300px] rounded-lg border border-white/10">
              {selectedCustomer && (
                <div className="p-4 space-y-3">
                  {getCustomerTransactions(selectedCustomer.id).length === 0 ? (
                    <div className="text-center text-gray-400 py-8">
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
                          className="flex items-center justify-between p-3 rounded-lg bg-white/5 border border-white/10"
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
                              <p className="text-sm font-medium text-white">
                                {transaction.description}
                              </p>
                              <p className="text-xs text-gray-400">
                                {formatDate(transaction.createdAt)}
                              </p>
                              {transaction.type === 'payment' && transaction.paymentMethod && (
                                <p className="text-xs text-gray-400 mt-1">
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
                        </div>
                      ))
                  )}
                </div>
              )}
            </ScrollArea>
          </div>
          <DialogFooter>
            {selectedCustomer && selectedCustomer.balance > 0 && (
              <Button
                onClick={() => {
                  setShowLedgerModal(false);
                  openPaymentModal(selectedCustomer);
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
        <DialogContent className="bg-gray-900 border-white/10">
          <DialogHeader>
            <DialogTitle className="text-white">Record Payment</DialogTitle>
            <DialogDescription>
              Record a payment from {selectedCustomer?.name}
              {selectedCustomer && (
                <span className="block mt-1 text-red-400">
                  Outstanding: Rs. {selectedCustomer.balance.toLocaleString()}
                </span>
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label className="text-gray-200">Amount *</Label>
              <div className="relative">
                <DollarSign className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                <Input
                  type="number"
                  value={paymentAmount}
                  onChange={(e) => setPaymentAmount(e.target.value)}
                  placeholder="Enter amount"
                  className="pl-10 bg-white/5 border-white/10"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label className="text-gray-200">Payment Method</Label>
              <Select
                value={paymentMethod}
                onValueChange={(value) => setPaymentMethod(value as 'cash' | 'card')}
              >
                <SelectTrigger className="bg-white/5 border-white/10">
                  <SelectValue placeholder="Select payment method" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="cash">Cash</SelectItem>
                  <SelectItem value="card">Card (2% charge)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {paymentMethod === 'card' && (parseFloat(paymentAmount) || 0) > 0 && (
              <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 text-sm">
                <p className="text-amber-300">
                  Card charge (2%): Rs. {(((parseFloat(paymentAmount) || 0) * 2) / 100).toLocaleString()}
                </p>
                <p className="text-amber-200 mt-1">
                  Total charged to customer: Rs. {((parseFloat(paymentAmount) || 0) * 1.02).toLocaleString()}
                </p>
              </div>
            )}
            <div className="space-y-2">
              <Label className="text-gray-200">Description (Optional)</Label>
              <Input
                value={paymentDescription}
                onChange={(e) => setPaymentDescription(e.target.value)}
                placeholder="e.g., Cash payment, Bank transfer..."
                className="bg-white/5 border-white/10"
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
        <DialogContent className="bg-gray-900 border-white/10">
          <DialogHeader>
            <DialogTitle className="text-white flex items-center gap-2">
              <Bell className="h-5 w-5" />
              Schedule Udhaar Reminder
            </DialogTitle>
            <DialogDescription>
              Set reminder frequency for {selectedCustomer?.name}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label className="text-gray-200">Frequency</Label>
              <Select
                value={reminderFrequency}
                onValueChange={(value) => setReminderFrequency(value as ReminderFrequency)}
              >
                <SelectTrigger className="bg-white/5 border-white/10">
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
              <Label className="text-gray-200">Next Reminder Date</Label>
              <div className="relative">
                <CalendarDays className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                <Input
                  type="date"
                  value={nextReminderDate}
                  onChange={(e) => setNextReminderDate(e.target.value)}
                  className="pl-10 bg-white/5 border-white/10"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label className="text-gray-200">Note (Optional)</Label>
              <Input
                value={reminderNote}
                onChange={(e) => setReminderNote(e.target.value)}
                placeholder="e.g., Call after salary date"
                className="bg-white/5 border-white/10"
              />
            </div>

            {selectedCustomer && getCustomerReminders(selectedCustomer.id).length > 0 && (
              <div className="space-y-2">
                <Label className="text-gray-200">Existing Reminders</Label>
                <div className="space-y-2 max-h-40 overflow-y-auto">
                  {getCustomerReminders(selectedCustomer.id).map((reminder) => (
                    <div
                      key={reminder.id}
                      className="p-2 rounded border border-white/10 bg-black/20 flex items-center justify-between"
                    >
                      <div>
                        <p className="text-sm text-white">
                          {reminder.frequency.toUpperCase()} - {reminder.nextReminderDate}
                        </p>
                        {reminder.note && <p className="text-xs text-gray-400">{reminder.note}</p>}
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => deleteCustomerReminder(reminder.id)}
                      >
                        Delete
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowReminderModal(false)}>
              Cancel
            </Button>
            <Button onClick={handleAddReminder}>Save Reminder</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
