import { useMemo, useState } from 'react';
import { format, startOfMonth, endOfMonth, subMonths, startOfYear, subDays } from 'date-fns';
import { AlertTriangle, FileBarChart } from 'lucide-react';
import { useStore } from '@/contexts/useStore';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ReportTable, StatCard } from '@/components/reports/ReportTable';
import { formatCell, formatMoney as money, type ReportColumn } from '@/lib/reportExport';
import { parseLocalDate, toLocalISODate, todayLocal } from '@/lib/dates';
import {
  buildCustomerLedger,
  buildCustomerOutstanding,
  buildCustomerPayments,
  buildSalesProfitReport,
  buildStockReport,
  buildSupplierLedger,
  buildSupplierPayables,
  buildSupplierPayments,
  type CustomerPaymentRow,
  type DateRange,
  type Ledger,
  type LedgerEntry,
  type OutstandingRow,
  type PayableRow,
  type PaymentRow,
  type ProfitRow,
  type StockRow,
  type SupplierPaymentRow,
} from '@/lib/reports';

type Preset = 'today' | 'yesterday' | 'last7' | 'thisMonth' | 'lastMonth' | 'thisYear' | 'custom';

function presetRange(preset: Preset): DateRange {
  const now = new Date();
  const d = toLocalISODate;
  switch (preset) {
    case 'today':
      return { from: d(now), to: d(now) };
    case 'yesterday':
      return { from: d(subDays(now, 1)), to: d(subDays(now, 1)) };
    case 'last7':
      return { from: d(subDays(now, 6)), to: d(now) };
    case 'lastMonth': {
      const m = subMonths(now, 1);
      return { from: d(startOfMonth(m)), to: d(endOfMonth(m)) };
    }
    case 'thisYear':
      return { from: d(startOfYear(now)), to: d(now) };
    case 'thisMonth':
    default:
      return { from: d(startOfMonth(now)), to: d(now) };
  }
}

const fmtDay = (day: string) => format(parseLocalDate(day), 'dd MMM yyyy');
const sum = <T,>(rows: T[], f: (r: T) => number) => rows.reduce((s, r) => s + f(r), 0);

const profitCell = (v: number) => (
  <span className={v < 0 ? 'text-destructive font-semibold' : 'font-semibold'}>{formatCell('money', v)}</span>
);

export default function Reports() {
  const { orders, orderItems, products, categories, customers, customerTransactions, suppliers, supplierPurchases } =
    useStore();

  const [preset, setPreset] = useState<Preset>('thisMonth');
  const [custom, setCustom] = useState<DateRange>(() => presetRange('thisMonth'));
  const range = preset === 'custom' ? custom : presetRange(preset);
  const validRange = range.from && range.to && range.from <= range.to;
  const period = validRange
    ? range.from === range.to
      ? fmtDay(range.from)
      : `${fmtDay(range.from)} to ${fmtDay(range.to)}`
    : '';
  const asOfToday = `As of ${fmtDay(todayLocal())}`;

  const [tab, setTab] = useState('sales');
  const [customerId, setCustomerId] = useState('');
  const [supplierId, setSupplierId] = useState('');

  const openCustomerLedger = (id: string) => {
    setCustomerId(id);
    setTab('customer-ledger');
  };
  const openSupplierLedger = (id: string) => {
    setSupplierId(id);
    setTab('supplier-ledger');
  };

  return (
    <div className="p-4 sm:p-6 space-y-6 overflow-y-auto h-full">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <FileBarChart className="w-6 h-6 text-primary" />
            Reports
          </h1>
          <p className="text-sm text-muted-foreground">Profit, customer credit (bakaya), suppliers and stock</p>
        </div>

        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1">
            <Label className="text-xs">Period</Label>
            <Select
              value={preset}
              onValueChange={(v) => {
                const p = v as Preset;
                if (p === 'custom') setCustom(range);
                setPreset(p);
              }}
            >
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="today">Today</SelectItem>
                <SelectItem value="yesterday">Yesterday</SelectItem>
                <SelectItem value="last7">Last 7 days</SelectItem>
                <SelectItem value="thisMonth">This month</SelectItem>
                <SelectItem value="lastMonth">Last month</SelectItem>
                <SelectItem value="thisYear">This year</SelectItem>
                <SelectItem value="custom">Custom dates</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {preset === 'custom' && (
            <>
              <div className="space-y-1">
                <Label className="text-xs">From</Label>
                <Input
                  type="date"
                  className="w-40"
                  value={custom.from}
                  max={custom.to || undefined}
                  onChange={(e) => setCustom({ ...custom, from: e.target.value })}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">To</Label>
                <Input
                  type="date"
                  className="w-40"
                  value={custom.to}
                  min={custom.from || undefined}
                  onChange={(e) => setCustom({ ...custom, to: e.target.value })}
                />
              </div>
            </>
          )}
        </div>
      </div>

      {!validRange ? (
        <p className="text-sm text-destructive">Choose a valid date range (From must be on or before To).</p>
      ) : (
        <Tabs value={tab} onValueChange={setTab} className="space-y-4">
          <TabsList className="flex h-auto flex-wrap justify-start">
            <TabsTrigger value="sales">Sales &amp; Profit</TabsTrigger>
            <TabsTrigger value="outstanding">Customer Bakaya</TabsTrigger>
            <TabsTrigger value="customer-ledger">Customer Ledger</TabsTrigger>
            <TabsTrigger value="suppliers">Supplier Payables</TabsTrigger>
            <TabsTrigger value="supplier-ledger">Supplier Ledger</TabsTrigger>
            <TabsTrigger value="stock">Stock</TabsTrigger>
          </TabsList>

          <TabsContent value="sales">
            <SalesProfitTab
              range={range}
              period={period}
              data={{ orders, orderItems, products, categories, customerTransactions }}
            />
          </TabsContent>

          <TabsContent value="outstanding">
            <OutstandingTab
              range={range}
              period={period}
              asOf={asOfToday}
              customers={customers}
              transactions={customerTransactions}
              onOpenLedger={openCustomerLedger}
            />
          </TabsContent>

          <TabsContent value="customer-ledger">
            <LedgerTab
              kind="Customer"
              parties={customers.map((c) => ({ id: c.id, name: c.name, phone: c.phone, balance: c.balance }))}
              selectedId={customerId}
              onSelect={setCustomerId}
              period={period}
              ledger={customerId ? buildCustomerLedger(customerId, customerTransactions, range) : null}
              debitLabel="Credit given"
              creditLabel="Received"
              balanceLabel="Balance due"
            />
          </TabsContent>

          <TabsContent value="suppliers">
            <SuppliersTab
              range={range}
              period={period}
              suppliers={suppliers}
              purchases={supplierPurchases}
              onOpenLedger={openSupplierLedger}
            />
          </TabsContent>

          <TabsContent value="supplier-ledger">
            <LedgerTab
              kind="Supplier"
              parties={suppliers.map((s) => ({ id: s.id, name: s.name, phone: s.phone, balance: s.balance }))}
              selectedId={supplierId}
              onSelect={setSupplierId}
              period={period}
              ledger={supplierId ? buildSupplierLedger(supplierId, supplierPurchases, range) : null}
              debitLabel="Purchased"
              creditLabel="Paid"
              balanceLabel="Balance payable"
            />
          </TabsContent>

          <TabsContent value="stock">
            <StockTab asOf={asOfToday} data={{ products, categories, orders, orderItems }} />
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

type SalesView = 'day' | 'product' | 'category' | 'cashier' | 'payment';

function SalesProfitTab({
  range,
  period,
  data,
}: {
  range: DateRange;
  period: string;
  data: Omit<Parameters<typeof buildSalesProfitReport>[0], 'range'>;
}) {
  const [view, setView] = useState<SalesView>('day');
  const report = useMemo(() => buildSalesProfitReport({ range, ...data }), [range.from, range.to, data.orders, data.orderItems, data.products, data.categories, data.customerTransactions]); // eslint-disable-line react-hooks/exhaustive-deps

  const labelHeader: Record<Exclude<SalesView, 'payment'>, string> = {
    day: 'Date',
    product: 'Product',
    category: 'Category',
    cashier: 'Cashier',
  };

  const profitColumns: ReportColumn<ProfitRow>[] = [
    view === 'day'
      ? { header: 'Date', value: (r) => r.key, format: 'date' }
      : { header: labelHeader[view as Exclude<SalesView, 'payment'>], value: (r) => r.label },
    view === 'product' || view === 'category'
      ? { header: 'Qty sold', value: (r) => r.quantity, format: 'number' }
      : { header: 'Bills', value: (r) => r.orders, format: 'number' },
    { header: 'Sales', value: (r) => r.sales, format: 'money' },
    { header: 'Cost', value: (r) => r.cost, format: 'money' },
    { header: 'Profit', value: (r) => r.profit, format: 'money', render: (r) => profitCell(r.profit) },
    { header: 'Margin', value: (r) => r.margin, format: 'percent' },
  ];
  const paymentColumns: ReportColumn<PaymentRow>[] = [
    { header: 'Payment method', value: (r) => r.method },
    { header: 'Bills', value: (r) => r.orders, format: 'number' },
    { header: 'Amount', value: (r) => r.amount, format: 'money' },
  ];

  const rows: ProfitRow[] =
    view === 'day' ? report.byDay : view === 'product' ? report.byProduct : view === 'category' ? report.byCategory : report.byCashier;

  const summary: [string, string][] = [
    ['Net sales', money(report.netSales)],
    ['Cost of goods', money(report.cost)],
    ['Gross profit', `${money(report.profit)} (${report.margin}%)`],
    ['Bills', String(report.orders)],
    // Returns are already inside the figures above; listed so the printout shows them.
    ...(report.exchanges > 0
      ? ([
          ['Exchanges / returns', String(report.exchanges)],
          ['Returns (before tax)', money(report.returnsNet)],
        ] as [string, string][])
      : []),
  ];
  // Shown under each table so the reader knows returns are already counted.
  const exchangeNote = report.exchanges > 0 ? ' Exchanges/returns are included on the day they happened but are not counted as bills.' : '';

  const viewSelect = (
    <Select value={view} onValueChange={(v) => setView(v as SalesView)}>
      <SelectTrigger className="h-9 w-44">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="day">Day by day</SelectItem>
        <SelectItem value="product">By product</SelectItem>
        <SelectItem value="category">By category</SelectItem>
        <SelectItem value="cashier">By cashier</SelectItem>
        <SelectItem value="payment">By payment method</SelectItem>
      </SelectContent>
    </Select>
  );

  const viewTitle: Record<SalesView, string> = {
    day: 'Daily sales & profit',
    product: 'Profit by product',
    category: 'Profit by category',
    cashier: 'Sales by cashier',
    payment: 'Sales by payment method',
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="Net sales (after discounts)" value={money(report.netSales)} hint={`${report.orders} bills - avg ${money(report.averageBill)}`} />
        <StatCard label="Cost of goods sold" value={money(report.cost)} hint={`${report.itemsSold.toLocaleString()} items sold`} />
        <StatCard
          label="Gross profit"
          value={money(report.profit)}
          hint={`${report.margin}% margin`}
          tone={report.profit < 0 ? 'bad' : 'good'}
        />
        <StatCard label="Discounts given" value={money(report.discounts)} hint={`Gross sales ${money(report.grossSales)}`} />
        <StatCard label="Tax collected" value={money(report.tax)} hint={report.cardFees > 0 ? `Card fees ${money(report.cardFees)}` : undefined} />
        <StatCard label="Credit sales (bakaya given)" value={money(report.creditSales)} />
        <StatCard
          label="Credit recovered"
          value={money(report.creditRecovered)}
          hint={report.creditRecoveredByMethod.map((r) => `${r.method} ${money(r.amount)}`).join(' - ') || undefined}
        />
        <StatCard
          label="Cancelled bills"
          value={String(report.cancelledOrders)}
          hint={report.cancelledOrders ? money(report.cancelledAmount) : undefined}
        />
        {report.exchanges > 0 && (
          <StatCard
            label="Returns (before tax)"
            value={money(report.returnsNet)}
            hint={`${report.exchanges} exchange(s) - ${report.returnedItems.toLocaleString()} item(s) back. Already taken off net sales.`}
          />
        )}
      </div>

      {(report.estimatedCostLines > 0 || report.missingCostLines > 0) && (
        <div className="flex gap-2 rounded-md border border-warning/40 bg-warning/10 p-3 text-sm">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0 text-warning" />
          <p>
            {report.estimatedCostLines > 0 &&
              `${report.estimatedCostLines} sale line(s) are from before cost tracking started, so today's cost price is used and their profit is an estimate. `}
            {report.missingCostLines > 0 &&
              `${report.missingCostLines} sale line(s) are for deleted products with no known cost (counted as zero cost).`}
          </p>
        </div>
      )}

      {view === 'payment' ? (
        <ReportTable
          title={viewTitle.payment}
          subtitle={period}
          description={`${period}. Amount billed including tax and card fees, less money refunded on exchanges.${exchangeNote}`}
          columns={paymentColumns}
          rows={report.byPayment}
          rowKey={(r) => r.method}
          footer={['Total', report.orders, report.billed]}
          summary={summary}
          fileName={`sales-by-payment_${range.from}_${range.to}`}
          toolbar={viewSelect}
        />
      ) : (
        <ReportTable
          title={viewTitle[view]}
          subtitle={period}
          description={`${period}. Sales are after discounts and returns, before tax.${exchangeNote}`}
          columns={profitColumns}
          rows={rows}
          rowKey={(r) => r.key}
          footer={[
            'Total',
            view === 'product' || view === 'category' ? report.itemsSold : report.orders,
            report.netSales,
            report.cost,
            report.profit,
            report.margin,
          ]}
          summary={summary}
          fileName={`${viewTitle[view].toLowerCase().replace(/[^a-z]+/g, '-')}_${range.from}_${range.to}`}
          toolbar={viewSelect}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function OutstandingTab({
  range,
  period,
  asOf,
  customers,
  transactions,
  onOpenLedger,
}: {
  range: DateRange;
  period: string;
  asOf: string;
  customers: Parameters<typeof buildCustomerOutstanding>[0];
  transactions: Parameters<typeof buildCustomerOutstanding>[1];
  onOpenLedger: (id: string) => void;
}) {
  const rows = useMemo(() => buildCustomerOutstanding(customers, transactions), [customers, transactions]);
  const payments = useMemo(
    () => buildCustomerPayments(customers, transactions, range),
    [customers, transactions, range.from, range.to] // eslint-disable-line react-hooks/exhaustive-deps
  );

  const total = sum(rows, (r) => r.balance);
  const over90 = sum(rows, (r) => r.age90plus);
  const collected = sum(payments, (r) => r.amount);

  const columns: ReportColumn<OutstandingRow>[] = [
    {
      header: 'Customer',
      value: (r) => r.name,
      render: (r) => (
        <button className="text-left font-medium text-primary hover:underline" onClick={() => onOpenLedger(r.id)}>
          {r.name}
        </button>
      ),
    },
    { header: 'Phone', value: (r) => r.phone },
    { header: 'Balance due', value: (r) => r.balance, format: 'money', render: (r) => <span className="font-bold">{money(r.balance)}</span> },
    { header: '0-30 days', value: (r) => r.age0to30, format: 'money' },
    { header: '31-60 days', value: (r) => r.age31to60, format: 'money' },
    { header: '61-90 days', value: (r) => r.age61to90, format: 'money' },
    {
      header: '90+ days',
      value: (r) => r.age90plus,
      format: 'money',
      render: (r) => <span className={r.age90plus > 0 ? 'text-destructive font-semibold' : ''}>{money(r.age90plus)}</span>,
    },
    { header: 'Last payment', value: (r) => r.lastPaymentDate, format: 'date' },
    {
      header: 'Days since paid',
      value: (r) => r.daysSincePayment,
      format: 'number',
    },
  ];

  const paymentColumns: ReportColumn<CustomerPaymentRow>[] = [
    { header: 'Date', value: (r) => r.date, format: 'date' },
    { header: 'Customer', value: (r) => r.customer },
    { header: 'Method', value: (r) => r.method },
    { header: 'Note', value: (r) => r.description },
    { header: 'Amount', value: (r) => r.amount, format: 'money' },
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="Total bakaya (outstanding)" value={money(total)} hint={asOf} tone={total > 0 ? 'bad' : undefined} />
        <StatCard label="Customers who owe" value={String(rows.length)} />
        <StatCard label="Older than 90 days" value={money(over90)} tone={over90 > 0 ? 'bad' : undefined} />
        <StatCard label="Recovered in period" value={money(collected)} hint={`${payments.length} payment(s)`} tone="good" />
      </div>

      <ReportTable
        title="Customer outstanding (bakaya)"
        subtitle={asOf}
        description={`${asOf}. Ageing pays off the oldest credit first. Click a name to open the ledger.`}
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        footer={[
          'Total',
          '',
          total,
          sum(rows, (r) => r.age0to30),
          sum(rows, (r) => r.age31to60),
          sum(rows, (r) => r.age61to90),
          over90,
          '',
          '',
        ]}
        summary={[
          ['Total outstanding', money(total)],
          ['Customers', String(rows.length)],
          ['Over 90 days', money(over90)],
        ]}
        fileName={`customer-outstanding_${todayLocal()}`}
        emptyText="No customer owes money"
      />

      <ReportTable
        title="Credit recovery (payments received)"
        subtitle={period}
        description={period}
        columns={paymentColumns}
        rows={payments}
        rowKey={(r) => r.id}
        footer={['Total', '', '', '', collected]}
        fileName={`credit-recovery_${range.from}_${range.to}`}
        emptyText="No payments received in this period"
      />
    </div>
  );
}

// ---------------------------------------------------------------------------

function SuppliersTab({
  range,
  period,
  suppliers,
  purchases,
  onOpenLedger,
}: {
  range: DateRange;
  period: string;
  suppliers: Parameters<typeof buildSupplierPayables>[0];
  purchases: Parameters<typeof buildSupplierPayables>[1];
  onOpenLedger: (id: string) => void;
}) {
  const rows = useMemo(
    () => buildSupplierPayables(suppliers, purchases, range),
    [suppliers, purchases, range.from, range.to] // eslint-disable-line react-hooks/exhaustive-deps
  );
  const payments = useMemo(
    () => buildSupplierPayments(suppliers, purchases, range),
    [suppliers, purchases, range.from, range.to] // eslint-disable-line react-hooks/exhaustive-deps
  );

  const payable = sum(rows, (r) => Math.max(r.balance, 0));
  const purchased = sum(rows, (r) => r.purchasedInPeriod);
  const paid = sum(rows, (r) => r.paidInPeriod);

  const columns: ReportColumn<PayableRow>[] = [
    {
      header: 'Supplier',
      value: (r) => r.name,
      render: (r) => (
        <button className="text-left font-medium text-primary hover:underline" onClick={() => onOpenLedger(r.id)}>
          {r.name}
        </button>
      ),
    },
    { header: 'Phone', value: (r) => r.phone },
    { header: 'Purchased (period)', value: (r) => r.purchasedInPeriod, format: 'money' },
    { header: 'Paid (period)', value: (r) => r.paidInPeriod, format: 'money' },
    { header: 'Total purchased', value: (r) => r.totalPurchased, format: 'money' },
    { header: 'Total paid', value: (r) => r.totalPaid, format: 'money' },
    {
      header: 'Balance payable',
      value: (r) => r.balance,
      format: 'money',
      render: (r) => <span className={r.balance > 0 ? 'font-bold text-destructive' : 'font-bold'}>{money(r.balance)}</span>,
    },
    { header: 'Last purchase', value: (r) => r.lastPurchaseDate, format: 'date' },
    { header: 'Last payment', value: (r) => r.lastPaymentDate, format: 'date' },
  ];

  const paymentColumns: ReportColumn<SupplierPaymentRow>[] = [
    { header: 'Date', value: (r) => r.date, format: 'date' },
    { header: 'Supplier', value: (r) => r.supplier },
    { header: 'Invoice', value: (r) => r.invoice },
    { header: 'Note', value: (r) => r.description },
    { header: 'Amount paid', value: (r) => r.amount, format: 'money' },
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="Total payable to suppliers" value={money(payable)} tone={payable > 0 ? 'bad' : undefined} />
        <StatCard label="Suppliers owed" value={String(rows.filter((r) => r.balance > 0.5).length)} />
        <StatCard label="Purchased in period" value={money(purchased)} />
        <StatCard label="Paid in period" value={money(paid)} hint={`${payments.length} payment(s)`} />
      </div>

      <ReportTable
        title="Supplier payables"
        subtitle={period}
        description={`Period columns cover ${period}. Totals and balance are all-time. Click a name to open the ledger.`}
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        footer={[
          'Total',
          '',
          purchased,
          paid,
          sum(rows, (r) => r.totalPurchased),
          sum(rows, (r) => r.totalPaid),
          sum(rows, (r) => r.balance),
          '',
          '',
        ]}
        summary={[
          ['Total payable', money(payable)],
          ['Purchased in period', money(purchased)],
          ['Paid in period', money(paid)],
        ]}
        fileName={`supplier-payables_${range.from}_${range.to}`}
        emptyText="No suppliers yet"
      />

      <ReportTable
        title="Supplier payments"
        subtitle={period}
        description={period}
        columns={paymentColumns}
        rows={payments}
        rowKey={(r) => r.id}
        footer={['Total', '', '', '', paid]}
        fileName={`supplier-payments_${range.from}_${range.to}`}
        emptyText="No supplier payments in this period"
      />
    </div>
  );
}

// ---------------------------------------------------------------------------

function LedgerTab({
  kind,
  parties,
  selectedId,
  onSelect,
  period,
  ledger,
  debitLabel,
  creditLabel,
  balanceLabel,
}: {
  kind: 'Customer' | 'Supplier';
  parties: { id: string; name: string; phone?: string; balance: number }[];
  selectedId: string;
  onSelect: (id: string) => void;
  period: string;
  ledger: Ledger | null;
  debitLabel: string;
  creditLabel: string;
  balanceLabel: string;
}) {
  const [search, setSearch] = useState('');
  const party = parties.find((p) => p.id === selectedId);
  const q = search.trim().toLowerCase();
  const sorted = [...parties]
    .filter((p) => !q || p.name.toLowerCase().includes(q) || (p.phone || '').includes(q) || p.id === selectedId)
    .sort((a, b) => a.name.localeCompare(b.name));

  const columns: ReportColumn<LedgerEntry>[] = [
    { header: 'Date', value: (r) => r.date, format: 'date' },
    { header: 'Type', value: (r) => r.kind },
    { header: 'Details', value: (r) => r.description },
    { header: debitLabel, value: (r) => r.debit || null, format: 'money' },
    { header: creditLabel, value: (r) => r.credit || null, format: 'money' },
    { header: 'Balance', value: (r) => r.balance, format: 'money', render: (r) => <span className="font-semibold">{money(r.balance)}</span> },
  ];

  const openingRow: LedgerEntry | null = ledger
    ? { id: 'opening', date: '', timestamp: '', kind: 'Opening balance', description: '', debit: 0, credit: 0, balance: ledger.opening }
    : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label className="text-xs">Search {kind.toLowerCase()}</Label>
          <Input className="w-56" placeholder="Name or phone" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">{kind}</Label>
          <Select value={selectedId} onValueChange={onSelect}>
            <SelectTrigger className="w-72">
              <SelectValue placeholder={`Choose a ${kind.toLowerCase()}`} />
            </SelectTrigger>
            <SelectContent>
              {sorted.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                  {p.balance > 0.5 ? ` - ${money(p.balance)}` : ''}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {!ledger || !party ? (
        <p className="text-sm text-muted-foreground py-8 text-center">
          Choose a {kind.toLowerCase()} to see their ledger for {period}.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <StatCard label="Opening balance" value={money(ledger.opening)} />
            <StatCard label={`${debitLabel} (period)`} value={money(ledger.totalDebit)} />
            <StatCard label={`${creditLabel} (period)`} value={money(ledger.totalCredit)} />
            <StatCard label={`${balanceLabel} (closing)`} value={money(ledger.closing)} tone={ledger.closing > 0 ? 'bad' : undefined} />
          </div>
          <ReportTable
            title={`${kind} ledger - ${party.name}`}
            subtitle={`${party.phone ? `${party.phone} - ` : ''}${period}`}
            description={
              <>
                {period}. Current {balanceLabel.toLowerCase()}: <Badge variant="outline">{money(party.balance)}</Badge>
              </>
            }
            columns={columns}
            rows={openingRow ? [openingRow, ...ledger.entries] : ledger.entries}
            rowKey={(r) => r.id}
            footer={['Closing balance', '', '', ledger.totalDebit, ledger.totalCredit, ledger.closing]}
            summary={[
              ['Opening balance', money(ledger.opening)],
              [debitLabel, money(ledger.totalDebit)],
              [creditLabel, money(ledger.totalCredit)],
              ['Closing balance', money(ledger.closing)],
            ]}
            fileName={`${kind.toLowerCase()}-ledger_${party.name.replace(/[^a-z0-9]+/gi, '-')}`}
          />
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

type StockFilter = 'all' | 'low' | 'out' | 'expiring' | 'expired' | 'slow';

function StockTab({ asOf, data }: { asOf: string; data: Omit<Parameters<typeof buildStockReport>[0], 'slowDays' | 'expiryDays'> }) {
  const [filter, setFilter] = useState<StockFilter>('all');
  const [slowDays, setSlowDays] = useState(30);
  const [expiryDays, setExpiryDays] = useState(30);
  const report = useMemo(
    () => buildStockReport({ ...data, slowDays, expiryDays }),
    [data.products, data.categories, data.orders, data.orderItems, slowDays, expiryDays] // eslint-disable-line react-hooks/exhaustive-deps
  );

  const rows = report.rows.filter((r) => {
    switch (filter) {
      case 'low':
        return r.status === 'low';
      case 'out':
        return r.status === 'out';
      case 'expiring':
        return r.expiry === 'expiring';
      case 'expired':
        return r.expiry === 'expired';
      case 'slow':
        return r.stock > 0 && r.soldRecently === 0;
      default:
        return true;
    }
  });

  const statusBadge = (r: StockRow) => (
    <div className="flex flex-wrap gap-1">
      {r.status === 'out' && <Badge variant="destructive">Out</Badge>}
      {r.status === 'low' && <Badge className="bg-warning text-warning-foreground">Low</Badge>}
      {r.expiry === 'expired' && <Badge variant="destructive">Expired</Badge>}
      {r.expiry === 'expiring' && <Badge variant="outline">Expires in {r.daysToExpiry}d</Badge>}
      {r.status === 'ok' && !r.expiry && <span className="text-muted-foreground">OK</span>}
    </div>
  );

  const statusText = (r: StockRow) =>
    [r.status === 'out' ? 'Out' : r.status === 'low' ? 'Low' : 'OK', r.expiry === 'expired' ? 'Expired' : r.expiry === 'expiring' ? `Expires in ${r.daysToExpiry}d` : '']
      .filter(Boolean)
      .join(', ');

  const columns: ReportColumn<StockRow>[] = [
    { header: 'Product', value: (r) => r.name },
    { header: 'SKU', value: (r) => r.sku },
    { header: 'Category', value: (r) => r.category },
    { header: 'Stock', value: (r) => r.stock, format: 'number' },
    { header: 'Cost price', value: (r) => r.costPrice, format: 'money' },
    { header: 'Sale price', value: (r) => r.sellingPrice, format: 'money' },
    { header: 'Stock value (cost)', value: (r) => r.costValue, format: 'money' },
    { header: 'Stock value (sale)', value: (r) => r.retailValue, format: 'money' },
    { header: `Sold (${slowDays}d)`, value: (r) => r.soldRecently, format: 'number' },
    { header: 'Last sold', value: (r) => r.lastSoldDate, format: 'date' },
    { header: 'Expiry', value: (r) => r.expiryDate, format: 'date' },
    { header: 'Status', value: statusText, render: statusBadge },
  ];

  const filterLabels: Record<StockFilter, string> = {
    all: `All products (${report.rows.length})`,
    low: `Low stock (${report.lowCount})`,
    out: `Out of stock (${report.outCount})`,
    expiring: `Expiring soon (${report.expiringCount})`,
    expired: `Expired (${report.expiredCount})`,
    slow: `Slow moving (${report.slowCount})`,
  };

  const toolbar = (
    <>
      <Select value={filter} onValueChange={(v) => setFilter(v as StockFilter)}>
        <SelectTrigger className="h-9 w-52">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {(Object.keys(filterLabels) as StockFilter[]).map((k) => (
            <SelectItem key={k} value={k}>
              {filterLabels[k]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {filter === 'slow' && (
        <Select value={String(slowDays)} onValueChange={(v) => setSlowDays(Number(v))}>
          <SelectTrigger className="h-9 w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="30">No sale in 30 days</SelectItem>
            <SelectItem value="60">No sale in 60 days</SelectItem>
            <SelectItem value="90">No sale in 90 days</SelectItem>
          </SelectContent>
        </Select>
      )}
      {filter === 'expiring' && (
        <Select value={String(expiryDays)} onValueChange={(v) => setExpiryDays(Number(v))}>
          <SelectTrigger className="h-9 w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="15">Within 15 days</SelectItem>
            <SelectItem value="30">Within 30 days</SelectItem>
            <SelectItem value="60">Within 60 days</SelectItem>
            <SelectItem value="90">Within 90 days</SelectItem>
          </SelectContent>
        </Select>
      )}
    </>
  );

  const costValue = sum(rows, (r) => r.costValue);
  const retailValue = sum(rows, (r) => r.retailValue);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="Stock value at cost" value={money(report.costValue)} hint={asOf} />
        <StatCard label="Stock value at sale price" value={money(report.retailValue)} hint={`Potential profit ${money(report.retailValue - report.costValue)}`} />
        <StatCard label="Low / out of stock" value={`${report.lowCount} / ${report.outCount}`} tone={report.outCount > 0 ? 'bad' : undefined} />
        <StatCard
          label="Expired / expiring"
          value={`${report.expiredCount} / ${report.expiringCount}`}
          hint={`Expiring = within ${expiryDays} days`}
          tone={report.expiredCount > 0 ? 'bad' : undefined}
        />
      </div>

      <ReportTable
        title={`Stock report - ${filterLabels[filter].replace(/ \(\d+\)$/, '')}`}
        subtitle={asOf}
        description={`${asOf}. Negative stock counts as zero in stock value.`}
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        footer={['Total', '', '', sum(rows, (r) => r.stock), '', '', costValue, retailValue, '', '', '', '']}
        summary={[
          ['Products', String(rows.length)],
          ['Value at cost', money(costValue)],
          ['Value at sale price', money(retailValue)],
        ]}
        fileName={`stock-${filter}_${todayLocal()}`}
        toolbar={toolbar}
        emptyText="No products match this filter"
      />
    </div>
  );
}
