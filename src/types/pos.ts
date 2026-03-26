export type UserRole = 'admin' | 'cashier';

export interface User {
  id: string;
  email: string;
  fullName: string;
  role: UserRole;
}

export interface Category {
  id: string;
  name: string;
  description: string;
}

export interface Product {
  id: string;
  sku: string;
  name: string;
  description: string;
  categoryId: string;
  costPrice: number;
  sellingPrice: number;
  stockQuantity: number;
  lowStockThreshold: number;
  expiryDate?: string; // ISO date string (YYYY-MM-DD)
  barcode?: string; // Optional barcode/EAN
  barcodeEnabled: boolean; // Whether barcode scanning is enabled for this product
}

// Customer / Digi Khata
export interface Customer {
  id: string;
  name: string;
  phone: string;
  address: string;
  nic?: string; // National Identity Card - optional
  createdAt: string;
  totalCredit: number; // Total credit given
  totalPaid: number; // Total amount paid back
  balance: number; // Outstanding balance (credit - paid)
}

export interface CustomerTransaction {
  id: string;
  customerId: string;
  orderId?: string; // Link to order if it's a credit sale
  type: 'credit' | 'payment'; // credit = sale on credit, payment = customer paid back
  amount: number;
  description: string;
  createdAt: string;
}

export type PaymentMethod = 'cash' | 'card' | 'transfer' | 'credit';
export type TransferType = 'bank' | 'jazzcash' | 'easypaisa';
export type OrderStatus = 'completed' | 'refunded' | 'credit';

export interface Order {
  id: string;
  createdAt: string;
  cashierId: string;
  cashierName: string;
  subtotal: number;
  taxAmount: number;
  discountAmount: number;
  totalAmount: number;
  paymentMethod: PaymentMethod;
  status: OrderStatus;
  amountTendered?: number;
  changeGiven?: number;
  // Client and transfer fields
  clientName?: string;
  clientPhone?: string;
  transferType?: TransferType;
  transactionId?: string;
  customerId?: string; // Link to customer for credit sales
  // Card fee (if payment by card)
  cardFeeAmount?: number;
  cardFeeRate?: number;
}

export interface OrderItem {
  id: string;
  orderId: string;
  productId: string;
  productName: string;
  productSku: string;
  quantity: number;
  unitPriceAtSale: number;
  discountAmount: number;
}

export interface StoreSettings {
  storeName: string;
  address: string;
  phone: string;
  taxRate: number;
  cardFeePercent?: number;
  receiptFooterMessage: string;
  allowNegativeStock: boolean;
  logo?: string; // Base64 encoded logo image
}

export interface UserCredentials {
  email: string;
  password: string;
  fullName: string;
  role: UserRole;
}

export interface CartItem {
  product: Product;
  quantity: number;
  discountAmount: number;
  discountType: 'fixed' | 'percentage';
}

export interface HeldCart {
  id: string;
  items: CartItem[];
  globalDiscount: number;
  globalDiscountType: 'fixed' | 'percentage';
  heldAt: string;
  note?: string;
}
