import { useMemo, useState } from 'react';
import { useStore } from '@/contexts/useStore';
import { Supplier, ScheduleFrequency } from '@/types/pos';
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
import { toast } from 'sonner';
import { Building2, Plus, ReceiptText, CalendarClock, Wrench, CheckCircle2 } from 'lucide-react';

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
    getSupplierPurchases,
    addSupplierPaymentSchedule,
    deleteSupplierPaymentSchedule,
    getDueSupplierPaymentSchedules,
    markSupplierSchedulePaid,
  } = useStore();

  const [activeTab, setActiveTab] = useState('records');
  const [search, setSearch] = useState('');
  const [selectedSupplierId, setSelectedSupplierId] = useState('');

  const [supplierDialogOpen, setSupplierDialogOpen] = useState(false);
  const [editingSupplier, setEditingSupplier] = useState<Supplier | null>(null);

  const [supplierForm, setSupplierForm] = useState({
    name: '',
    phone: '',
    address: '',
    contactPerson: '',
    notes: '',
  });

  const [purchaseForm, setPurchaseForm] = useState({
    supplierId: '',
    description: '',
    amount: '',
    purchaseDate: new Date().toISOString().slice(0, 10),
    invoiceNumber: '',
  });

  const [scheduleForm, setScheduleForm] = useState({
    supplierId: '',
    frequency: 'monthly' as ScheduleFrequency,
    nextPaymentDate: new Date().toISOString().slice(0, 10),
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
    const amount = parseFloat(purchaseForm.amount);
    if (!purchaseForm.supplierId || !purchaseForm.description.trim() || isNaN(amount) || amount <= 0) {
      toast.error('Supplier, description and valid amount are required');
      return;
    }

    addSupplierPurchase({
      supplierId: purchaseForm.supplierId,
      description: purchaseForm.description.trim(),
      amount,
      purchaseDate: purchaseForm.purchaseDate,
      invoiceNumber: purchaseForm.invoiceNumber.trim() || undefined,
    });

    toast.success('Purchase entry recorded');
    setPurchaseForm({
      supplierId: purchaseForm.supplierId,
      description: '',
      amount: '',
      purchaseDate: new Date().toISOString().slice(0, 10),
      invoiceNumber: '',
    });
  };

  const submitSchedule = () => {
    const amount = parseFloat(scheduleForm.amount);
    if (!scheduleForm.supplierId || isNaN(amount) || amount <= 0) {
      toast.error('Supplier and valid schedule amount are required');
      return;
    }

    addSupplierPaymentSchedule({
      supplierId: scheduleForm.supplierId,
      frequency: scheduleForm.frequency,
      nextPaymentDate: scheduleForm.nextPaymentDate,
      amount,
      note: scheduleForm.note.trim() || undefined,
    });

    toast.success('Payment schedule added');
    setScheduleForm({
      supplierId: scheduleForm.supplierId,
      frequency: scheduleForm.frequency,
      nextPaymentDate: new Date().toISOString().slice(0, 10),
      amount: '',
      note: '',
    });
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
                  <Button size="sm" onClick={() => markSupplierSchedulePaid(schedule.id)}>
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
                            <Button size="sm" variant="destructive" onClick={() => deleteSupplier(supplier.id)}>Delete</Button>
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
              <CardTitle className="flex items-center gap-2"><ReceiptText className="h-5 w-5" /> Add Purchase Entry</CardTitle>
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
                <Label>Amount</Label>
                <Input type="number" value={purchaseForm.amount} onChange={(e) => setPurchaseForm({ ...purchaseForm, amount: e.target.value })} />
              </div>
              <div className="space-y-2 md:col-span-2">
                <Label>Description</Label>
                <Input value={purchaseForm.description} onChange={(e) => setPurchaseForm({ ...purchaseForm, description: e.target.value })} placeholder="e.g., Weekly grocery stock" />
              </div>
              <div className="space-y-2">
                <Label>Purchase Date</Label>
                <Input type="date" value={purchaseForm.purchaseDate} onChange={(e) => setPurchaseForm({ ...purchaseForm, purchaseDate: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>Invoice Number</Label>
                <Input value={purchaseForm.invoiceNumber} onChange={(e) => setPurchaseForm({ ...purchaseForm, invoiceNumber: e.target.value })} />
              </div>
              <div className="md:col-span-2">
                <Button onClick={submitPurchase}>Save Purchase</Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Ledger Entries</CardTitle>
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
                <Input type="number" value={scheduleForm.amount} onChange={(e) => setScheduleForm({ ...scheduleForm, amount: e.target.value })} />
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
              <CardTitle>Active Schedules</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
            {supplierPaymentSchedules.length === 0 ? (
                <p className="text-sm text-muted-foreground">No schedules yet.</p>
              ) : (
                supplierPaymentSchedules.map((schedule) => (
                  <div key={schedule.id} className="flex flex-col md:flex-row md:items-center md:justify-between gap-2 p-3 border border-border/40 bg-muted/20 rounded-md">
                    <div>
                      <p className="font-medium text-foreground">{getSupplierById(schedule.supplierId)?.name || 'Unknown Supplier'}</p>
                      <p className="text-xs text-muted-foreground">
                        {schedule.frequency.toUpperCase()} | Next: {schedule.nextPaymentDate} | Amount: {formatPKR(schedule.amount)}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <Button size="sm" onClick={() => markSupplierSchedulePaid(schedule.id)}>Mark Paid</Button>
                      <Button size="sm" variant="destructive" onClick={() => deleteSupplierPaymentSchedule(schedule.id)}>Delete</Button>
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
    </div>
  );
}
