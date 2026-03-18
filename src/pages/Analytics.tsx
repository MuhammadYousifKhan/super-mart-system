import { useMemo, useState } from 'react';
import { useStore } from '@/contexts/StoreContext';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  LineChart,
  Line,
} from 'recharts';
import { 
  DollarSign, 
  TrendingUp, 
  ShoppingCart, 
  Receipt, 
  Eye, 
  Download, 
  FileText, 
  Calendar,
  Search,
  Printer,
  Share2,
  CreditCard,
  Banknote,
  ArrowLeftRight,
  UserCheck,
} from 'lucide-react';
import { 
  format, 
  isToday, 
  isThisWeek, 
  isThisMonth, 
  isThisYear, 
  parseISO, 
  startOfWeek, 
  startOfMonth, 
  startOfYear,
  endOfWeek,
  endOfMonth,
  endOfYear,
  getHours,
  eachDayOfInterval,
  eachWeekOfInterval,
  eachMonthOfInterval,
  isSameDay,
  isSameWeek,
  isSameMonth,
} from 'date-fns';
import { Order } from '@/types/pos';
import { Receipt as ReceiptComponent } from '@/components/pos/Receipt';

const COLORS = ['hsl(217, 91%, 50%)', 'hsl(142, 76%, 36%)', 'hsl(38, 92%, 50%)', 'hsl(280, 65%, 60%)', 'hsl(0, 72%, 51%)'];

type FilterPeriod = 'today' | 'week' | 'month' | 'year' | 'custom';

export function formatPKR(amount: number): string {
  return `PKR ${amount.toLocaleString('en-PK', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

export default function Analytics() {
  const { orders, orderItems, products, categories, settings, getOrderItems, customers, getCustomerById } = useStore();
  const [filterPeriod, setFilterPeriod] = useState<FilterPeriod>('month');
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [showBillModal, setShowBillModal] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState('overview');

  // Custom date range
  const [customStartDate, setCustomStartDate] = useState('');
  const [customEndDate, setCustomEndDate] = useState('');

  const filteredOrders = useMemo(() => {
    let filtered = orders.filter((o) => {
      const date = parseISO(o.createdAt);
      switch (filterPeriod) {
        case 'today': return isToday(date);
        case 'week': return isThisWeek(date, { weekStartsOn: 1 });
        case 'month': return isThisMonth(date);
        case 'year': return isThisYear(date);
        case 'custom':
          if (!customStartDate || !customEndDate) return true;
          const start = new Date(customStartDate);
          const end = new Date(customEndDate);
          end.setHours(23, 59, 59);
          return date >= start && date <= end;
        default: return true;
      }
    });

    // Apply search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter((o) =>
        o.id.toLowerCase().includes(query) ||
        o.cashierName.toLowerCase().includes(query) ||
        o.clientName?.toLowerCase().includes(query) ||
        o.paymentMethod.toLowerCase().includes(query)
      );
    }

    return filtered.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [orders, filterPeriod, customStartDate, customEndDate, searchQuery]);

  const stats = useMemo(() => {
    const revenue = filteredOrders.reduce((s, o) => s + o.totalAmount, 0);
    
    const filteredOrderIds = new Set(filteredOrders.map(o => o.id));
    const filteredItems = orderItems.filter(item => filteredOrderIds.has(item.orderId));
    
    const totalCost = filteredItems.reduce((sum, item) => {
      const product = products.find((p) => p.id === item.productId);
      return sum + (product?.costPrice || 0) * item.quantity;
    }, 0);

    const netProfit = revenue - totalCost;
    const avgBasket = filteredOrders.length > 0 ? revenue / filteredOrders.length : 0;
    
    // Payment method breakdown
    const cashSales = filteredOrders.filter(o => o.paymentMethod === 'cash').reduce((s, o) => s + o.totalAmount, 0);
    const cardSales = filteredOrders.filter(o => o.paymentMethod === 'card').reduce((s, o) => s + o.totalAmount, 0);
    const transferSales = filteredOrders.filter(o => o.paymentMethod === 'transfer').reduce((s, o) => s + o.totalAmount, 0);
    const creditSales = filteredOrders.filter(o => o.paymentMethod === 'credit').reduce((s, o) => s + o.totalAmount, 0);
    
    // Credit status breakdown - check customer balances
    const creditOrders = filteredOrders.filter(o => o.paymentMethod === 'credit');
    let creditDue = 0;
    let creditPaid = 0;
    creditOrders.forEach(order => {
      if (order.customerId) {
        const customer = getCustomerById(order.customerId);
        if (customer && customer.balance <= 0) {
          creditPaid += order.totalAmount;
        } else {
          creditDue += order.totalAmount;
        }
      } else {
        creditDue += order.totalAmount; // No customer linked, assume still due
      }
    });

    return { 
      revenue, 
      netProfit, 
      totalCost,
      totalTransactions: filteredOrders.length, 
      avgBasket,
      cashSales,
      cardSales,
      transferSales,
      creditSales,
      creditDue,
      creditPaid,
    };
  }, [filteredOrders, orderItems, products, getCustomerById]);

  const salesByHour = useMemo(() => {
    const hours: Record<number, number> = {};
    for (let i = 0; i <= 23; i++) hours[i] = 0;

    filteredOrders.forEach((order) => {
      const hour = getHours(parseISO(order.createdAt));
      hours[hour] += order.totalAmount;
    });

    return Object.entries(hours)
      .filter(([h, sales]) => sales > 0 || (parseInt(h) >= 8 && parseInt(h) <= 20))
      .map(([hour, sales]) => ({
        hour: `${hour}:00`,
        sales,
      }));
  }, [filteredOrders]);

  const salesByCategory = useMemo(() => {
    const catSales: Record<string, number> = {};
    const filteredOrderIds = new Set(filteredOrders.map(o => o.id));

    orderItems.filter(item => filteredOrderIds.has(item.orderId)).forEach((item) => {
      const product = products.find((p) => p.id === item.productId);
      if (product) {
        const catName = categories.find((c) => c.id === product.categoryId)?.name || 'Other';
        catSales[catName] = (catSales[catName] || 0) + item.unitPriceAtSale * item.quantity;
      }
    });

    return Object.entries(catSales).map(([name, value]) => ({ name, value }));
  }, [filteredOrders, orderItems, products, categories]);

  const salesTrend = useMemo(() => {
    const now = new Date();
    let intervals: Date[] = [];
    let formatStr = 'MMM dd';

    if (filterPeriod === 'week') {
      intervals = eachDayOfInterval({
        start: startOfWeek(now, { weekStartsOn: 1 }),
        end: endOfWeek(now, { weekStartsOn: 1 }),
      });
      formatStr = 'EEE';
    } else if (filterPeriod === 'month') {
      intervals = eachDayOfInterval({
        start: startOfMonth(now),
        end: now,
      });
      formatStr = 'dd';
    } else if (filterPeriod === 'year') {
      intervals = eachMonthOfInterval({
        start: startOfYear(now),
        end: now,
      });
      formatStr = 'MMM';
    } else {
      return [];
    }

    return intervals.map((date) => {
      const sales = filteredOrders
        .filter((o) => {
          const orderDate = parseISO(o.createdAt);
          if (filterPeriod === 'year') {
            return isSameMonth(orderDate, date);
          }
          return isSameDay(orderDate, date);
        })
        .reduce((sum, o) => sum + o.totalAmount, 0);

      return {
        date: format(date, formatStr),
        sales,
      };
    });
  }, [filteredOrders, filterPeriod]);

  const periodLabel = {
    today: "Today's",
    week: "This Week's",
    month: "This Month's",
    year: "This Year's",
    custom: "Custom Period",
  }[filterPeriod];

  const handleViewBill = (order: Order) => {
    setSelectedOrder(order);
    setShowBillModal(true);
  };

  const handlePrintBill = () => {
    window.print();
  };

  const handleWhatsAppShare = (order: Order) => {
    const items = getOrderItems(order.id);
    let text = `*${settings.storeName}*\n`;
    text += `Invoice: #${order.id.slice(-8).toUpperCase()}\n`;
    text += `Date: ${format(new Date(order.createdAt), 'dd/MM/yyyy HH:mm')}\n`;
    if (order.clientName) text += `Customer: ${order.clientName}\n`;
    text += `\n*Items:*\n`;
    items.forEach((item) => {
      text += `${item.quantity}x ${item.productName} - ${formatPKR(item.unitPriceAtSale * item.quantity)}\n`;
    });
    text += `\n*Total: ${formatPKR(order.totalAmount)}*\n`;
    text += `Payment: ${order.paymentMethod.toUpperCase()}\n`;
    text += `\n${settings.receiptFooterMessage}`;
    
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank');
  };

  const generateReport = () => {
    const reportData = {
      period: periodLabel,
      generatedAt: format(new Date(), 'dd MMMM yyyy HH:mm'),
      stats: {
        totalRevenue: formatPKR(stats.revenue),
        netProfit: formatPKR(stats.netProfit),
        totalTransactions: stats.totalTransactions,
        averageBasket: formatPKR(stats.avgBasket),
      },
      paymentBreakdown: {
        cash: formatPKR(stats.cashSales),
        card: formatPKR(stats.cardSales),
        transfer: formatPKR(stats.transferSales),
        credit: formatPKR(stats.creditSales),
      },
      transactions: filteredOrders.map((o) => ({
        id: o.id.slice(-8).toUpperCase(),
        date: format(parseISO(o.createdAt), 'dd/MM/yyyy HH:mm'),
        cashier: o.cashierName,
        customer: o.clientName || '-',
        payment: o.paymentMethod,
        total: formatPKR(o.totalAmount),
      })),
    };

    const blob = new Blob([JSON.stringify(reportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `sales-report-${format(new Date(), 'yyyy-MM-dd')}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const generateCSVReport = () => {
    let csv = 'Invoice ID,Date,Time,Cashier,Customer,Payment Method,Total Amount\n';
    filteredOrders.forEach((o) => {
      csv += `${o.id.slice(-8).toUpperCase()},${format(parseISO(o.createdAt), 'dd/MM/yyyy')},${format(parseISO(o.createdAt), 'HH:mm')},${o.cashierName},${o.clientName || '-'},${o.paymentMethod},${o.totalAmount}\n`;
    });

    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `sales-report-${format(new Date(), 'yyyy-MM-dd')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const getPaymentIcon = (method: string) => {
    switch (method) {
      case 'cash': return <Banknote className="w-4 h-4" />;
      case 'card': return <CreditCard className="w-4 h-4" />;
      case 'transfer': return <ArrowLeftRight className="w-4 h-4" />;
      case 'credit': return <UserCheck className="w-4 h-4" />;
      default: return <Receipt className="w-4 h-4" />;
    }
  };

  // Check if a credit order's customer has cleared their balance
  const getCreditStatus = (order: Order) => {
    if (order.status !== 'credit') return null;
    if (!order.customerId) return 'due'; // No linked customer, can't track
    
    const customer = getCustomerById(order.customerId);
    if (!customer) return 'due';
    
    // If customer balance is 0, they've paid everything
    if (customer.balance <= 0) return 'paid';
    return 'due';
  };

  return (
    <div className="p-4 md:p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Analytics & Reports</h1>
          <p className="text-sm text-muted-foreground">Sales performance, transactions & reports</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select value={filterPeriod} onValueChange={(v) => setFilterPeriod(v as FilterPeriod)}>
            <SelectTrigger className="w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="today">Today</SelectItem>
              <SelectItem value="week">This Week</SelectItem>
              <SelectItem value="month">This Month</SelectItem>
              <SelectItem value="year">This Year</SelectItem>
              <SelectItem value="custom">Custom Range</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={generateCSVReport}>
            <Download className="w-4 h-4 mr-2" />
            CSV
          </Button>
          <Button variant="outline" size="sm" onClick={generateReport}>
            <FileText className="w-4 h-4 mr-2" />
            JSON
          </Button>
        </div>
      </div>

      {/* Custom Date Range */}
      {filterPeriod === 'custom' && (
        <Card className="p-4">
          <div className="flex flex-wrap items-end gap-4">
            <div className="space-y-2">
              <Label>Start Date</Label>
              <Input
                type="date"
                value={customStartDate}
                onChange={(e) => setCustomStartDate(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>End Date</Label>
              <Input
                type="date"
                value={customEndDate}
                onChange={(e) => setCustomEndDate(e.target.value)}
              />
            </div>
          </div>
        </Card>
      )}

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-3 max-w-md">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="transactions">Transactions</TabsTrigger>
          <TabsTrigger value="reports">Reports</TabsTrigger>
        </TabsList>

        {/* Overview Tab */}
        <TabsContent value="overview" className="space-y-6 mt-6">
          {/* Stats Cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">{periodLabel} Revenue</CardTitle>
                <DollarSign className="w-4 h-4 text-primary" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{formatPKR(stats.revenue)}</div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Net Profit</CardTitle>
                <TrendingUp className="w-4 h-4 text-success" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-success">{formatPKR(stats.netProfit)}</div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Transactions</CardTitle>
                <ShoppingCart className="w-4 h-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{stats.totalTransactions}</div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Avg. Basket</CardTitle>
                <Receipt className="w-4 h-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{formatPKR(stats.avgBasket)}</div>
              </CardContent>
            </Card>
          </div>

          {/* Payment Breakdown */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Card className="bg-green-500/10 border-green-500/20">
              <CardContent className="pt-4">
                <div className="flex items-center gap-2 text-green-500 mb-2">
                  <Banknote className="w-5 h-5" />
                  <span className="text-sm font-medium">Cash</span>
                </div>
                <div className="text-xl font-bold">{formatPKR(stats.cashSales)}</div>
              </CardContent>
            </Card>
            <Card className="bg-blue-500/10 border-blue-500/20">
              <CardContent className="pt-4">
                <div className="flex items-center gap-2 text-blue-500 mb-2">
                  <CreditCard className="w-5 h-5" />
                  <span className="text-sm font-medium">Card</span>
                </div>
                <div className="text-xl font-bold">{formatPKR(stats.cardSales)}</div>
              </CardContent>
            </Card>
            <Card className="bg-purple-500/10 border-purple-500/20">
              <CardContent className="pt-4">
                <div className="flex items-center gap-2 text-purple-500 mb-2">
                  <ArrowLeftRight className="w-5 h-5" />
                  <span className="text-sm font-medium">Transfer</span>
                </div>
                <div className="text-xl font-bold">{formatPKR(stats.transferSales)}</div>
              </CardContent>
            </Card>
            <Card className="bg-warning/10 border-warning/20">
              <CardContent className="pt-4">
                <div className="flex items-center gap-2 text-warning mb-2">
                  <UserCheck className="w-5 h-5" />
                  <span className="text-sm font-medium">Credit</span>
                </div>
                <div className="text-xl font-bold">{formatPKR(stats.creditSales)}</div>
                {stats.creditSales > 0 && (
                  <div className="mt-2 flex gap-2 text-xs">
                    <span className="text-red-400">Due: {formatPKR(stats.creditDue)}</span>
                    <span className="text-green-400">Paid: {formatPKR(stats.creditPaid)}</span>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Charts */}
          <div className="grid lg:grid-cols-2 gap-6">
            {filterPeriod !== 'today' && salesTrend.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle>Sales Trend</CardTitle>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={250}>
                    <LineChart data={salesTrend}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                      <XAxis dataKey="date" className="text-xs" />
                      <YAxis className="text-xs" tickFormatter={(v) => `${(v/1000).toFixed(0)}k`} />
                      <Tooltip formatter={(value: number) => formatPKR(value)} />
                      <Line type="monotone" dataKey="sales" stroke="hsl(217, 91%, 50%)" strokeWidth={2} dot={{ fill: 'hsl(217, 91%, 50%)' }} />
                    </LineChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            )}

            <Card>
              <CardHeader>
                <CardTitle>Sales by Hour</CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={250}>
                  <BarChart data={salesByHour}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                    <XAxis dataKey="hour" className="text-xs" />
                    <YAxis className="text-xs" tickFormatter={(v) => `${(v/1000).toFixed(0)}k`} />
                    <Tooltip formatter={(value: number) => formatPKR(value)} />
                    <Bar dataKey="sales" fill="hsl(217, 91%, 50%)" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Sales by Category</CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={250}>
                  <PieChart>
                    <Pie data={salesByCategory} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label={({ name }) => name}>
                      {salesByCategory.map((_, index) => (
                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(value: number) => formatPKR(value)} />
                  </PieChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Transactions Tab */}
        <TabsContent value="transactions" className="space-y-4 mt-6">
          {/* Search */}
          <div className="flex items-center gap-4">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search by ID, cashier, customer..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
              />
            </div>
            <Badge variant="secondary">{filteredOrders.length} transactions</Badge>
          </div>

          {/* Transactions Table */}
          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Invoice</TableHead>
                      <TableHead>Date & Time</TableHead>
                      <TableHead>Cashier</TableHead>
                      <TableHead>Customer</TableHead>
                      <TableHead>Payment</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                      <TableHead className="text-center">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredOrders.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                          No transactions found
                        </TableCell>
                      </TableRow>
                    ) : (
                      filteredOrders.map((order) => (
                        <TableRow 
                          key={order.id} 
                          className="cursor-pointer hover:bg-muted/50"
                          onClick={() => handleViewBill(order)}
                        >
                          <TableCell className="font-mono text-xs font-medium">
                            #{order.id.slice(-8).toUpperCase()}
                          </TableCell>
                          <TableCell>
                            <div className="flex flex-col">
                              <span className="font-medium">{format(parseISO(order.createdAt), 'dd MMM yyyy')}</span>
                              <span className="text-xs text-muted-foreground">{format(parseISO(order.createdAt), 'HH:mm')}</span>
                            </div>
                          </TableCell>
                          <TableCell>{order.cashierName}</TableCell>
                          <TableCell>
                            {order.clientName || <span className="text-muted-foreground">-</span>}
                          </TableCell>
                          <TableCell>
                            <Badge variant="secondary" className="capitalize gap-1">
                              {getPaymentIcon(order.paymentMethod)}
                              {order.paymentMethod}
                              {order.transferType && <span className="text-[10px]">({order.transferType})</span>}
                            </Badge>
                            {order.status === 'credit' && (
                              getCreditStatus(order) === 'paid' ? (
                                <Badge variant="outline" className="ml-1 text-green-500 border-green-500">Paid</Badge>
                              ) : (
                                <Badge variant="outline" className="ml-1 text-warning border-warning">Due</Badge>
                              )
                            )}
                          </TableCell>
                          <TableCell className="text-right font-medium">{formatPKR(order.totalAmount)}</TableCell>
                          <TableCell>
                            <div className="flex items-center justify-center gap-1" onClick={(e) => e.stopPropagation()}>
                              <Button 
                                variant="ghost" 
                                size="icon" 
                                className="h-8 w-8"
                                onClick={() => handleViewBill(order)}
                              >
                                <Eye className="w-4 h-4" />
                              </Button>
                              <Button 
                                variant="ghost" 
                                size="icon" 
                                className="h-8 w-8 text-green-500 hover:text-green-600"
                                onClick={() => handleWhatsAppShare(order)}
                              >
                                <Share2 className="w-4 h-4" />
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
        </TabsContent>

        {/* Reports Tab */}
        <TabsContent value="reports" className="space-y-6 mt-6">
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            {/* Summary Report Card */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <FileText className="w-5 h-5 text-primary" />
                  Sales Summary
                </CardTitle>
                <CardDescription>{periodLabel} performance overview</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Total Revenue</span>
                    <span className="font-medium">{formatPKR(stats.revenue)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Total Cost</span>
                    <span className="font-medium">{formatPKR(stats.totalCost)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Net Profit</span>
                    <span className="font-medium text-success">{formatPKR(stats.netProfit)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Profit Margin</span>
                    <span className="font-medium">
                      {stats.revenue > 0 ? ((stats.netProfit / stats.revenue) * 100).toFixed(1) : 0}%
                    </span>
                  </div>
                </div>
                <Button className="w-full" onClick={generateCSVReport}>
                  <Download className="w-4 h-4 mr-2" />
                  Download CSV Report
                </Button>
              </CardContent>
            </Card>

            {/* Transaction Report Card */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Receipt className="w-5 h-5 text-primary" />
                  Transaction Report
                </CardTitle>
                <CardDescription>{stats.totalTransactions} transactions in period</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Cash Sales</span>
                    <span className="font-medium">{formatPKR(stats.cashSales)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Card Sales</span>
                    <span className="font-medium">{formatPKR(stats.cardSales)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Transfer Sales</span>
                    <span className="font-medium">{formatPKR(stats.transferSales)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Credit Sales</span>
                    <span className="font-medium text-warning">{formatPKR(stats.creditSales)}</span>
                  </div>
                  {stats.creditSales > 0 && (
                    <div className="pl-4 space-y-1 border-l-2 border-muted">
                      <div className="flex justify-between text-sm">
                        <span className="text-red-400">Still Due</span>
                        <span className="text-red-400">{formatPKR(stats.creditDue)}</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-green-400">Recovered</span>
                        <span className="text-green-400">{formatPKR(stats.creditPaid)}</span>
                      </div>
                    </div>
                  )}
                </div>
                <Button className="w-full" variant="outline" onClick={generateReport}>
                  <FileText className="w-4 h-4 mr-2" />
                  Download JSON Report
                </Button>
              </CardContent>
            </Card>

            {/* Quick Stats Card */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <TrendingUp className="w-5 h-5 text-primary" />
                  Quick Stats
                </CardTitle>
                <CardDescription>Key performance indicators</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Average Basket</span>
                    <span className="font-medium">{formatPKR(stats.avgBasket)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Items Sold</span>
                    <span className="font-medium">
                      {orderItems.filter(item => 
                        filteredOrders.some(o => o.id === item.orderId)
                      ).reduce((sum, item) => sum + item.quantity, 0)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Unique Customers</span>
                    <span className="font-medium">
                      {new Set(filteredOrders.filter(o => o.clientName).map(o => o.clientName)).size}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Credit Pending</span>
                    <span className="font-medium text-warning">
                      {filteredOrders.filter(o => o.status === 'credit').length} orders
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>

      {/* Bill View Modal */}
      <Dialog open={showBillModal} onOpenChange={setShowBillModal}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Receipt className="w-5 h-5" />
              Invoice #{selectedOrder?.id.slice(-8).toUpperCase()}
            </DialogTitle>
            <DialogDescription>
              {selectedOrder && format(parseISO(selectedOrder.createdAt), 'dd MMMM yyyy, HH:mm')}
            </DialogDescription>
          </DialogHeader>
          
          {selectedOrder && (
            <div className="space-y-4">
              {/* Order Details */}
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-muted-foreground">Cashier</p>
                  <p className="font-medium">{selectedOrder.cashierName}</p>
                </div>
                {selectedOrder.clientName && (
                  <div>
                    <p className="text-muted-foreground">Customer</p>
                    <p className="font-medium">{selectedOrder.clientName}</p>
                    {selectedOrder.clientPhone && (
                      <p className="text-xs text-muted-foreground">{selectedOrder.clientPhone}</p>
                    )}
                  </div>
                )}
                <div>
                  <p className="text-muted-foreground">Payment Method</p>
                  <p className="font-medium capitalize">
                    {selectedOrder.paymentMethod}
                    {selectedOrder.transferType && ` (${selectedOrder.transferType})`}
                  </p>
                  {selectedOrder.transactionId && (
                    <p className="text-xs text-muted-foreground">TID: {selectedOrder.transactionId}</p>
                  )}
                </div>
                <div>
                  <p className="text-muted-foreground">Status</p>
                  <Badge variant={selectedOrder.status === 'credit' ? 'outline' : 'secondary'} className={selectedOrder.status === 'credit' ? 'text-warning border-warning' : ''}>
                    {selectedOrder.status}
                  </Badge>
                </div>
              </div>

              {/* Items */}
              <div className="border rounded-lg overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Item</TableHead>
                      <TableHead className="text-center">Qty</TableHead>
                      <TableHead className="text-right">Price</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {getOrderItems(selectedOrder.id).map((item) => (
                      <TableRow key={item.id}>
                        <TableCell>
                          <div>
                            <p className="font-medium">{item.productName}</p>
                            <p className="text-xs text-muted-foreground">{item.productSku}</p>
                          </div>
                        </TableCell>
                        <TableCell className="text-center">{item.quantity}</TableCell>
                        <TableCell className="text-right">{formatPKR(item.unitPriceAtSale)}</TableCell>
                        <TableCell className="text-right font-medium">
                          {formatPKR(item.unitPriceAtSale * item.quantity)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {/* Totals */}
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Subtotal</span>
                  <span>{formatPKR(selectedOrder.subtotal)}</span>
                </div>
                {selectedOrder.discountAmount > 0 && (
                  <div className="flex justify-between text-success">
                    <span>Discount</span>
                    <span>-{formatPKR(selectedOrder.discountAmount)}</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Tax ({settings.taxRate}%)</span>
                  <span>{formatPKR(selectedOrder.taxAmount)}</span>
                </div>
                <div className="flex justify-between text-lg font-bold border-t pt-2">
                  <span>Total</span>
                  <span>{formatPKR(selectedOrder.totalAmount)}</span>
                </div>
                {selectedOrder.paymentMethod === 'cash' && selectedOrder.amountTendered && (
                  <>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Cash Tendered</span>
                      <span>{formatPKR(selectedOrder.amountTendered)}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Change</span>
                      <span>{formatPKR(selectedOrder.changeGiven || 0)}</span>
                    </div>
                  </>
                )}
              </div>

              {/* Actions */}
              <div className="flex gap-2 pt-4">
                <Button variant="outline" className="flex-1" onClick={handlePrintBill}>
                  <Printer className="w-4 h-4 mr-2" />
                  Print
                </Button>
                <Button 
                  className="flex-1 bg-green-600 hover:bg-green-700"
                  onClick={() => handleWhatsAppShare(selectedOrder)}
                >
                  <Share2 className="w-4 h-4 mr-2" />
                  WhatsApp
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Hidden Receipt for Printing - Only visible in print */}
      <div className="hidden print:block">
        {selectedOrder && <ReceiptComponent order={selectedOrder} showActions={false} />}
      </div>
    </div>
  );
}
