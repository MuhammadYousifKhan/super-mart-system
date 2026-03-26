import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import {
  Product,
  Category,
  Order,
  OrderItem,
  StoreSettings,
  CartItem,
  HeldCart,
  PaymentMethod,
  TransferType,
  Customer,
  CustomerTransaction,
} from '@/types/pos';
import { useAuth } from './AuthContext';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';

interface CreateOrderOptions {
  items: CartItem[];
  paymentMethod: PaymentMethod;
  globalDiscount: number;
  globalDiscountType: 'fixed' | 'percentage';
  amountTendered?: number;
  clientName?: string;
  clientPhone?: string;
  transferType?: TransferType;
  transactionId?: string;
  customerId?: string;
}

interface StoreContextType {
  // Products
  products: Product[];
  addProduct: (product: Omit<Product, 'id'>) => void;
  updateProduct: (id: string, product: Partial<Product>) => void;
  deleteProducts: (ids: string[]) => void;
  getProductBySku: (sku: string) => Product | undefined;

  // Categories
  categories: Category[];
  addCategory: (category: Omit<Category, 'id'>) => void;
  updateCategory: (id: string, category: Partial<Category>) => void;
  deleteCategory: (id: string) => void;

  // Customers (Digi Khata)
  customers: Customer[];
  customerTransactions: CustomerTransaction[];
  addCustomer: (customer: Omit<Customer, 'id' | 'createdAt' | 'totalCredit' | 'totalPaid' | 'balance'>) => void;
  updateCustomer: (id: string, customer: Partial<Customer>) => void;
  deleteCustomer: (id: string) => void;
  getCustomerById: (id: string) => Customer | undefined;
  addCustomerPayment: (customerId: string, amount: number, description: string) => void;
  getCustomerTransactions: (customerId: string) => CustomerTransaction[];

  // Orders
  orders: Order[];
  orderItems: OrderItem[];
  createOrder: (options: CreateOrderOptions) => Promise<Order>;
  getOrderItems: (orderId: string) => OrderItem[];

  // Settings
  settings: StoreSettings;
  updateSettings: (settings: Partial<StoreSettings>) => void;

  // Cart
  cart: CartItem[];
  addToCart: (product: Product, quantity?: number) => void;
  updateCartItem: (productId: string, updates: Partial<CartItem>) => void;
  removeFromCart: (productId: string) => void;
  clearCart: () => void;
  globalDiscount: number;
  globalDiscountType: 'fixed' | 'percentage';
  setGlobalDiscount: (amount: number, type: 'fixed' | 'percentage') => void;

  // Held carts
  heldCarts: HeldCart[];
  holdCart: (note?: string) => void;
  recallCart: (id: string) => void;
  deleteHeldCart: (id: string) => void;

  // Calculations
  calculateSubtotal: () => number;
  calculateTax: () => number;
  calculateTotal: () => number;
  calculateItemDiscount: (item: CartItem) => number;
  calculateGlobalDiscountAmount: () => number;
}

const StoreContext = createContext<StoreContextType | undefined>(undefined);

const DEFAULT_SETTINGS: StoreSettings = {
  storeName: 'My Store',
  address: '123 Main Street, City',
  phone: '(555) 123-4567',
  taxRate: 10,
  cardFeePercent: 2,
  receiptFooterMessage: 'Thank you for your purchase!',
  allowNegativeStock: false,
};

const FIXED_CARD_FEE_PERCENT = 2;

const SAMPLE_CATEGORIES: Category[] = [
  { id: 'cat-1', name: 'Electronics', description: 'Electronic devices and accessories' },
  { id: 'cat-2', name: 'Groceries', description: 'Food and beverages' },
  { id: 'cat-3', name: 'Clothing', description: 'Apparel and accessories' },
  { id: 'cat-4', name: 'Home & Kitchen', description: 'Home appliances and kitchenware' },
  { id: 'cat-5', name: 'Health & Beauty', description: 'Personal care and cosmetics' },
  { id: 'cat-6', name: 'Sports & Outdoors', description: 'Sports equipment and outdoor gear' },
  { id: 'cat-7', name: 'Stationery', description: 'Office supplies and stationery' },
  { id: 'cat-8', name: 'Mobile Accessories', description: 'Phone cases, chargers and accessories' },
];

const SAMPLE_PRODUCTS: Product[] = [
  { id: 'prod-1', sku: 'ELEC-001', name: 'Wireless Mouse', description: 'Ergonomic wireless mouse', categoryId: 'cat-1', costPrice: 2500, sellingPrice: 4500, stockQuantity: 45, lowStockThreshold: 10 },
  { id: 'prod-2', sku: 'ELEC-002', name: 'USB-C Cable', description: '2m braided cable', categoryId: 'cat-1', costPrice: 800, sellingPrice: 1500, stockQuantity: 120, lowStockThreshold: 20 },
  { id: 'prod-3', sku: 'ELEC-003', name: 'Bluetooth Headphones', description: 'Over-ear wireless headphones', categoryId: 'cat-1', costPrice: 8000, sellingPrice: 15000, stockQuantity: 8, lowStockThreshold: 10 },
  { id: 'prod-4', sku: 'GROC-001', name: 'Organic Coffee', description: '500g ground coffee', categoryId: 'cat-2', costPrice: 1200, sellingPrice: 2200, stockQuantity: 65, lowStockThreshold: 15 },
  { id: 'prod-5', sku: 'GROC-002', name: 'Green Tea Pack', description: '50 tea bags', categoryId: 'cat-2', costPrice: 600, sellingPrice: 1100, stockQuantity: 3, lowStockThreshold: 10 },
  { id: 'prod-6', sku: 'CLTH-001', name: 'Cotton T-Shirt', description: '100% cotton, various sizes', categoryId: 'cat-3', costPrice: 1500, sellingPrice: 3500, stockQuantity: 55, lowStockThreshold: 10 },
];

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();

  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [orderItems, setOrderItems] = useState<OrderItem[]>([]);
  const [settings, setSettings] = useState<StoreSettings>(DEFAULT_SETTINGS);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [globalDiscount, setGlobalDiscountState] = useState(0);
  const [globalDiscountType, setGlobalDiscountType] = useState<'fixed' | 'percentage'>('fixed');
  const [heldCarts, setHeldCarts] = useState<HeldCart[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [customerTransactions, setCustomerTransactions] = useState<CustomerTransaction[]>([]);
  const [loading, setLoading] = useState(true);

  // Load data from Supabase
  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        
        // Check if Supabase is configured
        if (!import.meta.env.VITE_SUPABASE_URL) {
          console.warn('Supabase not configured, using local storage fallback');
          loadFromLocalStorage();
          setLoading(false);
          return;
        }

        // Fetch Categories
        const { data: categoriesData, error: categoriesError } = await supabase
          .from('categories')
          .select('*');
        
        if (categoriesError) throw categoriesError;
        if (categoriesData) setCategories(categoriesData);

        // Fetch Products
        const { data: productsData, error: productsError } = await supabase
          .from('products')
          .select('*');
        
        if (productsError) throw productsError;
        if (productsData) {
          setProducts(productsData.map((p: any) => ({
            id: p.id,
            sku: p.sku,
            name: p.name,
            description: p.description,
            categoryId: p.category_id,
            costPrice: p.cost_price,
            sellingPrice: p.selling_price,
            stockQuantity: p.stock_quantity,
            lowStockThreshold: p.low_stock_threshold,
          })));
        }

        // Fetch Orders
        const { data: ordersData, error: ordersError } = await supabase
          .from('orders')
          .select('*')
          .order('created_at', { ascending: false });
        
        if (ordersError) throw ordersError;
        if (ordersData) {
          setOrders(ordersData.map((o: any) => ({
            id: o.id,
            createdAt: o.created_at,
            cashierId: o.cashier_id,
            cashierName: o.cashier_name,
            subtotal: o.subtotal,
            taxAmount: o.tax_amount,
            discountAmount: o.discount_amount,
            totalAmount: o.total_amount,
            paymentMethod: o.payment_method,
            status: o.status,
            amountTendered: o.amount_tendered,
            changeGiven: o.change_given,
            clientName: o.client_name,
            clientPhone: o.client_phone,
            transferType: o.transfer_type,
            transactionId: o.transaction_id,
            customerId: o.customer_id,
            cardFeeAmount: o.card_fee_amount,
            cardFeeRate: o.card_fee_rate,
          })));
        }

        // Fetch Order Items
        const { data: orderItemsData, error: orderItemsError } = await supabase
          .from('order_items')
          .select('*');
        
        if (orderItemsError) throw orderItemsError;
        if (orderItemsData) {
          setOrderItems(orderItemsData.map((i: any) => ({
            id: i.id,
            orderId: i.order_id,
            productId: i.product_id,
            productName: i.product_name,
            productSku: i.product_sku,
            quantity: i.quantity,
            unitPriceAtSale: i.unit_price_at_sale,
            discountAmount: i.discount_amount,
          })));
        }

        // Fetch Settings
        const { data: settingsData, error: settingsError } = await supabase
          .from('store_settings')
          .select('*')
          .single();
        
        if (!settingsError && settingsData) {
          setSettings({
            storeName: settingsData.store_name,
            address: settingsData.address,
            phone: settingsData.phone,
            taxRate: settingsData.tax_rate,
            cardFeePercent: FIXED_CARD_FEE_PERCENT,
            receiptFooterMessage: settingsData.receipt_footer_message,
            allowNegativeStock: settingsData.allow_negative_stock,
            logo: settingsData.logo,
          });
        }

        // Fetch Customers
        const { data: customersData, error: customersError } = await supabase
          .from('customers')
          .select('*')
          .order('created_at', { ascending: false });

        if (customersError) throw customersError;
        if (customersData) {
          setCustomers(customersData.map((c: any) => ({
            id: c.id,
            name: c.name,
            phone: c.phone,
            address: c.address,
            nic: c.nic,
            createdAt: c.created_at,
            totalCredit: c.total_credit,
            totalPaid: c.total_paid,
            balance: c.balance,
          })));
        }

        // Fetch Customer Transactions
        const { data: transactionsData, error: transactionsError } = await supabase
          .from('customer_transactions')
          .select('*')
          .order('created_at', { ascending: false });

        if (transactionsError) throw transactionsError;
        if (transactionsData) {
          setCustomerTransactions(transactionsData.map((t: any) => ({
            id: t.id,
            customerId: t.customer_id,
            orderId: t.order_id,
            type: t.type,
            amount: t.amount,
            description: t.description,
            createdAt: t.created_at,
          })));
        }

      } catch (error) {
        console.error('Error fetching data from Supabase:', error);
        toast.error('Failed to load data from database');
        loadFromLocalStorage();
      } finally {
        setLoading(false);
      }
    };

    const loadFromLocalStorage = () => {
      const loadData = <T,>(key: string, defaultValue: T): T => {
        const saved = localStorage.getItem(key);
        if (saved) {
          try {
            return JSON.parse(saved);
          } catch {
            return defaultValue;
          }
        }
        return defaultValue;
      };

      setProducts(loadData('pos_products', SAMPLE_PRODUCTS));
      setCategories(loadData('pos_categories', SAMPLE_CATEGORIES));
      setOrders(loadData('pos_orders', []));
      setOrderItems(loadData('pos_order_items', []));
      setSettings(loadData('pos_settings', DEFAULT_SETTINGS));
      setHeldCarts(loadData('pos_held_carts', []));
      setCustomers(loadData('pos_customers', []));
      setCustomerTransactions(loadData('pos_customer_transactions', []));
    };

    fetchData();
  }, []);

  // Save held carts to localStorage (keep local)
  useEffect(() => {
    localStorage.setItem('pos_held_carts', JSON.stringify(heldCarts));
  }, [heldCarts]);

  // Save customers to localStorage
  useEffect(() => {
    localStorage.setItem('pos_customers', JSON.stringify(customers));
  }, [customers]);

  // Save customer transactions to localStorage
  useEffect(() => {
    localStorage.setItem('pos_customer_transactions', JSON.stringify(customerTransactions));
  }, [customerTransactions]);

  // Product functions
  const addProduct = async (product: Omit<Product, 'id'>) => {
    const newProduct = { ...product, id: generateId() };
    
    // Optimistic update
    setProducts((prev) => [...prev, newProduct]);

    if (import.meta.env.VITE_SUPABASE_URL) {
      const { error } = await supabase.from('products').insert({
        id: newProduct.id,
        sku: newProduct.sku,
        name: newProduct.name,
        description: newProduct.description,
        category_id: newProduct.categoryId,
        cost_price: newProduct.costPrice,
        selling_price: newProduct.sellingPrice,
        stock_quantity: newProduct.stockQuantity,
        low_stock_threshold: newProduct.lowStockThreshold,
      });

      if (error) {
        console.error('Error adding product:', error);
        toast.error('Failed to save product to database');
        // Revert optimistic update? Or just let it be local for now.
      }
    } else {
      localStorage.setItem('pos_products', JSON.stringify([...products, newProduct]));
    }
  };

  const updateProduct = async (id: string, updates: Partial<Product>) => {
    // Optimistic update
    setProducts((prev) =>
      prev.map((p) => (p.id === id ? { ...p, ...updates } : p))
    );

    if (import.meta.env.VITE_SUPABASE_URL) {
      const dbUpdates: any = {};
      if (updates.sku) dbUpdates.sku = updates.sku;
      if (updates.name) dbUpdates.name = updates.name;
      if (updates.description) dbUpdates.description = updates.description;
      if (updates.categoryId) dbUpdates.category_id = updates.categoryId;
      if (updates.costPrice !== undefined) dbUpdates.cost_price = updates.costPrice;
      if (updates.sellingPrice !== undefined) dbUpdates.selling_price = updates.sellingPrice;
      if (updates.stockQuantity !== undefined) dbUpdates.stock_quantity = updates.stockQuantity;
      if (updates.lowStockThreshold !== undefined) dbUpdates.low_stock_threshold = updates.lowStockThreshold;

      const { error } = await supabase
        .from('products')
        .update(dbUpdates)
        .eq('id', id);

      if (error) {
        console.error('Error updating product:', error);
        toast.error('Failed to update product in database');
      }
    } else {
      const updatedProducts = products.map((p) => (p.id === id ? { ...p, ...updates } : p));
      localStorage.setItem('pos_products', JSON.stringify(updatedProducts));
    }
  };

  const deleteProducts = async (ids: string[]) => {
    // Optimistic update
    setProducts((prev) => prev.filter((p) => !ids.includes(p.id)));

    if (import.meta.env.VITE_SUPABASE_URL) {
      const { error } = await supabase
        .from('products')
        .delete()
        .in('id', ids);

      if (error) {
        console.error('Error deleting products:', error);
        toast.error('Failed to delete products from database');
      }
    } else {
      const remainingProducts = products.filter((p) => !ids.includes(p.id));
      localStorage.setItem('pos_products', JSON.stringify(remainingProducts));
    }
  };

  const getProductBySku = (sku: string) => {
    return products.find((p) => p.sku.toLowerCase() === sku.toLowerCase());
  };

  // Category functions
  const addCategory = async (category: Omit<Category, 'id'>) => {
    const newCategory = { ...category, id: generateId() };
    setCategories((prev) => [...prev, newCategory]);

    if (import.meta.env.VITE_SUPABASE_URL) {
      const { error } = await supabase.from('categories').insert(newCategory);
      if (error) {
        console.error('Error adding category:', error);
        toast.error('Failed to save category');
      }
    } else {
      localStorage.setItem('pos_categories', JSON.stringify([...categories, newCategory]));
    }
  };

  const updateCategory = async (id: string, updates: Partial<Category>) => {
    setCategories((prev) =>
      prev.map((c) => (c.id === id ? { ...c, ...updates } : c))
    );

    if (import.meta.env.VITE_SUPABASE_URL) {
      const { error } = await supabase.from('categories').update(updates).eq('id', id);
      if (error) {
        console.error('Error updating category:', error);
        toast.error('Failed to update category');
      }
    } else {
      const updatedCategories = categories.map((c) => (c.id === id ? { ...c, ...updates } : c));
      localStorage.setItem('pos_categories', JSON.stringify(updatedCategories));
    }
  };

  const deleteCategory = async (id: string) => {
    setCategories((prev) => prev.filter((c) => c.id !== id));

    if (import.meta.env.VITE_SUPABASE_URL) {
      const { error } = await supabase.from('categories').delete().eq('id', id);
      if (error) {
        console.error('Error deleting category:', error);
        toast.error('Failed to delete category');
      }
    } else {
      const remainingCategories = categories.filter((c) => c.id !== id);
      localStorage.setItem('pos_categories', JSON.stringify(remainingCategories));
    }
  };

  // Cart calculations
  const calculateItemDiscount = (item: CartItem): number => {
    if (item.discountType === 'percentage') {
      return (item.product.sellingPrice * item.quantity * item.discountAmount) / 100;
    }
    return item.discountAmount * item.quantity;
  };

  const calculateSubtotal = (): number => {
    return cart.reduce((sum, item) => {
      const itemTotal = item.product.sellingPrice * item.quantity;
      const discount = calculateItemDiscount(item);
      return sum + itemTotal - discount;
    }, 0);
  };

  const calculateGlobalDiscountAmount = (): number => {
    const subtotal = calculateSubtotal();
    if (globalDiscountType === 'percentage') {
      return (subtotal * globalDiscount) / 100;
    }
    return globalDiscount;
  };

  const calculateTax = (): number => {
    const subtotalAfterDiscount = calculateSubtotal() - calculateGlobalDiscountAmount();
    return (subtotalAfterDiscount * settings.taxRate) / 100;
  };

  const calculateTotal = (): number => {
    return calculateSubtotal() - calculateGlobalDiscountAmount() + calculateTax();
  };

  // Cart functions
  const addToCart = (product: Product, quantity = 1) => {
    setCart((prev) => {
      const existing = prev.find((item) => item.product.id === product.id);
      if (existing) {
        return prev.map((item) =>
          item.product.id === product.id
            ? { ...item, quantity: item.quantity + quantity }
            : item
        );
      }
      return [...prev, { product, quantity, discountAmount: 0, discountType: 'fixed' }];
    });
  };

  const updateCartItem = (productId: string, updates: Partial<CartItem>) => {
    setCart((prev) =>
      prev.map((item) =>
        item.product.id === productId ? { ...item, ...updates } : item
      )
    );
  };

  const removeFromCart = (productId: string) => {
    setCart((prev) => prev.filter((item) => item.product.id !== productId));
  };

  const clearCart = () => {
    setCart([]);
    setGlobalDiscountState(0);
    setGlobalDiscountType('fixed');
  };

  const setGlobalDiscount = (amount: number, type: 'fixed' | 'percentage') => {
    setGlobalDiscountState(amount);
    setGlobalDiscountType(type);
  };

  // Held cart functions
  const holdCart = (note?: string) => {
    if (cart.length === 0) return;
    const held: HeldCart = {
      id: generateId(),
      items: [...cart],
      globalDiscount,
      globalDiscountType,
      heldAt: new Date().toISOString(),
      note,
    };
    setHeldCarts((prev) => [...prev, held]);
    clearCart();
  };

  const recallCart = (id: string) => {
    const held = heldCarts.find((h) => h.id === id);
    if (held) {
      setCart(held.items);
      setGlobalDiscountState(held.globalDiscount);
      setGlobalDiscountType(held.globalDiscountType);
      setHeldCarts((prev) => prev.filter((h) => h.id !== id));
    }
  };

  const deleteHeldCart = (id: string) => {
    setHeldCarts((prev) => prev.filter((h) => h.id !== id));
  };

  // Order functions
  const createOrder = async (options: CreateOrderOptions): Promise<Order> => {
    const {
      items,
      paymentMethod,
      globalDiscount: orderGlobalDiscount,
      globalDiscountType: orderGlobalDiscountType,
      amountTendered,
      clientName,
      clientPhone,
      transferType,
      transactionId,
      customerId,
    } = options;

    const subtotal = items.reduce((sum, item) => {
      const itemTotal = item.product.sellingPrice * item.quantity;
      const discount =
        item.discountType === 'percentage'
          ? (itemTotal * item.discountAmount) / 100
          : item.discountAmount * item.quantity;
      return sum + itemTotal - discount;
    }, 0);

    const globalDiscountAmt =
      orderGlobalDiscountType === 'percentage'
        ? (subtotal * orderGlobalDiscount) / 100
        : orderGlobalDiscount;

    const taxAmount = ((subtotal - globalDiscountAmt) * settings.taxRate) / 100;

    // Card fee (if payment by card) - applied on post-tax amount
    const baseTotal = subtotal - globalDiscountAmt + taxAmount;
    const cardFeeRate = paymentMethod === 'card' ? FIXED_CARD_FEE_PERCENT : 0;
    const cardFeeAmount = paymentMethod === 'card' && cardFeeRate > 0 ? (baseTotal * cardFeeRate) / 100 : 0;

    const totalAmount = baseTotal + cardFeeAmount;
    const changeGiven = amountTendered ? amountTendered - totalAmount : undefined;

    const order: Order = {
      id: generateId(),
      createdAt: new Date().toISOString(),
      cashierId: user?.id || 'unknown',
      cashierName: user?.fullName || 'Unknown',
      subtotal,
      taxAmount,
      discountAmount: globalDiscountAmt + items.reduce((sum, item) => {
        return sum + (item.discountType === 'percentage'
          ? (item.product.sellingPrice * item.quantity * item.discountAmount) / 100
          : item.discountAmount * item.quantity);
      }, 0),
      totalAmount,
      cardFeeAmount: cardFeeAmount || undefined,
      cardFeeRate: cardFeeRate || undefined,
      paymentMethod,
      status: paymentMethod === 'credit' ? 'credit' : 'completed',
      amountTendered,
      changeGiven,
      clientName,
      clientPhone,
      transferType,
      transactionId,
      customerId,
    };

    const newOrderItems: OrderItem[] = items.map((item) => ({
      id: generateId(),
      orderId: order.id,
      productId: item.product.id,
      productName: item.product.name,
      productSku: item.product.sku,
      quantity: item.quantity,
      unitPriceAtSale: item.product.sellingPrice,
      discountAmount:
        item.discountType === 'percentage'
          ? (item.product.sellingPrice * item.quantity * item.discountAmount) / 100
          : item.discountAmount * item.quantity,
    }));

    // Optimistic update
    setOrders((prev) => [order, ...prev]);
    setOrderItems((prev) => [...prev, ...newOrderItems]);

    // Update stock locally
    items.forEach((item) => {
      updateProduct(item.product.id, {
        stockQuantity: item.product.stockQuantity - item.quantity,
      });
    });

    // If credit sale with customer, add credit transaction (Digi Khata)
    if (paymentMethod === 'credit' && customerId) {
      await addCreditTransaction(customerId, order.id, totalAmount);
    }

    if (import.meta.env.VITE_SUPABASE_URL) {
      // Insert Order
      const { error: orderError } = await supabase.from('orders').insert({
        id: order.id,
        created_at: order.createdAt,
        cashier_id: order.cashierId,
        cashier_name: order.cashierName,
        subtotal: order.subtotal,
        tax_amount: order.taxAmount,
        discount_amount: order.discountAmount,
        total_amount: order.totalAmount,
        card_fee_amount: order.cardFeeAmount,
        card_fee_rate: order.cardFeeRate,
        payment_method: order.paymentMethod,
        status: order.status,
        amount_tendered: order.amountTendered,
        change_given: order.changeGiven,
        client_name: order.clientName,
        client_phone: order.clientPhone,
        transfer_type: order.transferType,
        transaction_id: order.transactionId,
        customer_id: order.customerId,
      });

      if (orderError) {
        console.error('Error creating order:', orderError);
        toast.error('Failed to save order to database');
      }

      // Insert Order Items
      const { error: itemsError } = await supabase.from('order_items').insert(
        newOrderItems.map((item) => ({
          id: item.id,
          order_id: item.orderId,
          product_id: item.productId,
          product_name: item.productName,
          product_sku: item.productSku,
          quantity: item.quantity,
          unit_price_at_sale: item.unitPriceAtSale,
          discount_amount: item.discountAmount,
        }))
      );

      if (itemsError) {
        console.error('Error creating order items:', itemsError);
      }
    } else {
      localStorage.setItem('pos_orders', JSON.stringify([order, ...orders]));
      localStorage.setItem('pos_order_items', JSON.stringify([...orderItems, ...newOrderItems]));
    }

    return order;
  };

  const getOrderItems = (orderId: string) => {
    return orderItems.filter((item) => item.orderId === orderId);
  };

  const updateSettings = async (updates: Partial<StoreSettings>) => {
    setSettings((prev) => ({ ...prev, ...updates }));

    if (import.meta.env.VITE_SUPABASE_URL) {
      const dbUpdates: any = {};
      if (updates.storeName) dbUpdates.store_name = updates.storeName;
      if (updates.address) dbUpdates.address = updates.address;
      if (updates.phone) dbUpdates.phone = updates.phone;
      if (updates.taxRate !== undefined) dbUpdates.tax_rate = updates.taxRate;
      if (updates.cardFeePercent !== undefined) dbUpdates.card_fee_percent = updates.cardFeePercent;
      if (updates.receiptFooterMessage) dbUpdates.receipt_footer_message = updates.receiptFooterMessage;
      if (updates.allowNegativeStock !== undefined) dbUpdates.allow_negative_stock = updates.allowNegativeStock;
      if (updates.logo) dbUpdates.logo = updates.logo;

      // Upsert settings (assuming ID 1 for single row settings)
      const { error } = await supabase
        .from('store_settings')
        .upsert({ id: 1, ...dbUpdates });

      if (error) {
        console.error('Error updating settings:', error);
        toast.error('Failed to save settings');
      }
    } else {
      const newSettings = { ...settings, ...updates };
      localStorage.setItem('pos_settings', JSON.stringify(newSettings));
    }
  };

  // Customer functions (Digi Khata)
  const addCustomer = (customer: Omit<Customer, 'id' | 'createdAt' | 'totalCredit' | 'totalPaid' | 'balance'>) => {
    const newCustomer: Customer = {
      ...customer,
      id: generateId(),
      createdAt: new Date().toISOString(),
      totalCredit: 0,
      totalPaid: 0,
      balance: 0,
    };
    setCustomers((prev) => [...prev, newCustomer]);

    if (import.meta.env.VITE_SUPABASE_URL) {
      void supabase.from('customers').insert({
        id: newCustomer.id,
        name: newCustomer.name,
        phone: newCustomer.phone,
        address: newCustomer.address,
        nic: newCustomer.nic,
        created_at: newCustomer.createdAt,
        total_credit: newCustomer.totalCredit,
        total_paid: newCustomer.totalPaid,
        balance: newCustomer.balance,
      }).then(({ error }) => {
        if (error) {
          console.error('Error adding customer:', error);
          toast.error('Failed to save customer to database');
        }
      });
    }
  };

  const updateCustomer = (id: string, updates: Partial<Customer>) => {
    setCustomers((prev) =>
      prev.map((c) => (c.id === id ? { ...c, ...updates } : c))
    );

    if (import.meta.env.VITE_SUPABASE_URL) {
      const dbUpdates: any = {};
      if (updates.name !== undefined) dbUpdates.name = updates.name;
      if (updates.phone !== undefined) dbUpdates.phone = updates.phone;
      if (updates.address !== undefined) dbUpdates.address = updates.address;
      if (updates.nic !== undefined) dbUpdates.nic = updates.nic;
      if (updates.totalCredit !== undefined) dbUpdates.total_credit = updates.totalCredit;
      if (updates.totalPaid !== undefined) dbUpdates.total_paid = updates.totalPaid;
      if (updates.balance !== undefined) dbUpdates.balance = updates.balance;

      void supabase
        .from('customers')
        .update(dbUpdates)
        .eq('id', id)
        .then(({ error }) => {
          if (error) {
            console.error('Error updating customer:', error);
            toast.error('Failed to update customer in database');
          }
        });
    }
  };

  const deleteCustomer = (id: string) => {
    setCustomers((prev) => prev.filter((c) => c.id !== id));
    // Also delete related transactions
    setCustomerTransactions((prev) => prev.filter((t) => t.customerId !== id));

    if (import.meta.env.VITE_SUPABASE_URL) {
      void supabase
        .from('customers')
        .delete()
        .eq('id', id)
        .then(({ error }) => {
          if (error) {
            console.error('Error deleting customer:', error);
            toast.error('Failed to delete customer from database');
          }
        });
    }
  };

  const getCustomerById = (id: string) => {
    return customers.find((c) => c.id === id);
  };

  const addCustomerPayment = (customerId: string, amount: number, description: string) => {
    const createdAt = new Date().toISOString();
    const transaction: CustomerTransaction = {
      id: generateId(),
      customerId,
      type: 'payment',
      amount,
      description,
      createdAt,
    };
    setCustomerTransactions((prev) => [...prev, transaction]);
    
    // Update customer balance
    setCustomers((prev) =>
      prev.map((c) => {
        if (c.id === customerId) {
          const newTotalPaid = c.totalPaid + amount;
          return {
            ...c,
            totalPaid: newTotalPaid,
            balance: c.totalCredit - newTotalPaid,
          };
        }
        return c;
      })
    );

    if (import.meta.env.VITE_SUPABASE_URL) {
      const customer = customers.find((c) => c.id === customerId);
      if (customer) {
        const newTotalPaid = customer.totalPaid + amount;
        const newBalance = customer.totalCredit - newTotalPaid;

        void Promise.all([
          supabase.from('customer_transactions').insert({
            id: transaction.id,
            customer_id: transaction.customerId,
            order_id: transaction.orderId,
            type: transaction.type,
            amount: transaction.amount,
            description: transaction.description,
            created_at: createdAt,
          }),
          supabase
            .from('customers')
            .update({ total_paid: newTotalPaid, balance: newBalance })
            .eq('id', customerId),
        ]).then(([transactionResult, customerResult]) => {
          if (transactionResult.error || customerResult.error) {
            console.error('Error adding customer payment:', transactionResult.error || customerResult.error);
            toast.error('Failed to record payment in database');
          }
        });
      }
    }
  };

  const getCustomerTransactions = (customerId: string) => {
    return customerTransactions.filter((t) => t.customerId === customerId);
  };

  // Helper to add credit transaction when creating credit order
  const addCreditTransaction = async (customerId: string, orderId: string, amount: number) => {
    const createdAt = new Date().toISOString();
    const transaction: CustomerTransaction = {
      id: generateId(),
      customerId,
      orderId,
      type: 'credit',
      amount,
      description: `Credit sale - Order #${orderId.slice(-8).toUpperCase()}`,
      createdAt,
    };
    setCustomerTransactions((prev) => [...prev, transaction]);
    
    // Update customer balance
    setCustomers((prev) =>
      prev.map((c) => {
        if (c.id === customerId) {
          const newTotalCredit = c.totalCredit + amount;
          return {
            ...c,
            totalCredit: newTotalCredit,
            balance: newTotalCredit - c.totalPaid,
          };
        }
        return c;
      })
    );

    if (import.meta.env.VITE_SUPABASE_URL) {
      const customer = customers.find((c) => c.id === customerId);
      if (!customer) return;

      const newTotalCredit = customer.totalCredit + amount;
      const newBalance = newTotalCredit - customer.totalPaid;

      const [transactionResult, customerResult] = await Promise.all([
        supabase.from('customer_transactions').insert({
          id: transaction.id,
          customer_id: transaction.customerId,
          order_id: transaction.orderId,
          type: transaction.type,
          amount: transaction.amount,
          description: transaction.description,
          created_at: createdAt,
        }),
        supabase
          .from('customers')
          .update({ total_credit: newTotalCredit, balance: newBalance })
          .eq('id', customerId),
      ]);

      if (transactionResult.error || customerResult.error) {
        console.error('Error adding credit transaction:', transactionResult.error || customerResult.error);
        toast.error('Failed to save credit transaction to database');
      }
    }
  };

  return (
    <StoreContext.Provider
      value={{
        products,
        addProduct,
        updateProduct,
        deleteProducts,
        getProductBySku,
        categories,
        addCategory,
        updateCategory,
        deleteCategory,
        customers,
        customerTransactions,
        addCustomer,
        updateCustomer,
        deleteCustomer,
        getCustomerById,
        addCustomerPayment,
        getCustomerTransactions,
        orders,
        orderItems,
        createOrder,
        getOrderItems,
        settings,
        updateSettings,
        cart,
        addToCart,
        updateCartItem,
        removeFromCart,
        clearCart,
        globalDiscount,
        globalDiscountType,
        setGlobalDiscount,
        heldCarts,
        holdCart,
        recallCart,
        deleteHeldCart,
        calculateSubtotal,
        calculateTax,
        calculateTotal,
        calculateItemDiscount,
        calculateGlobalDiscountAmount,
      }}
    >
      {children}
    </StoreContext.Provider>
  );
}

export function useStore() {
  const context = useContext(StoreContext);
  if (!context) {
    throw new Error('useStore must be used within StoreProvider');
  }
  return context;
}
