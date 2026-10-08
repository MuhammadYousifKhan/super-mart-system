import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useStore } from '@/contexts/useStore';
import { Product } from '@/types/pos';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';

const productSchema = z.object({
  sku: z.string().min(1, 'SKU is required').max(50),
  name: z.string().min(1, 'Name is required').max(100),
  description: z.string().max(500).optional(),
  categoryId: z.string().min(1, 'Category is required'),
  unitId: z.string().min(1, 'Unit is required'),
  costPrice: z.coerce.number().min(0, 'Must be positive'),
  sellingPrice: z.coerce.number().min(0, 'Must be positive'),
  stockQuantity: z.coerce.number().int(),
  lowStockThreshold: z.coerce.number().int().min(1, 'Must be at least 1'),
  expiryDate: z.string().optional(),
  barcode: z.string().max(100).optional(),
  barcodeEnabled: z.boolean().default(false),
});

type ProductFormData = z.infer<typeof productSchema>;

// Receive Supplier Stock makes a separate product per expiry date ("SKU-EXP-YYYYMMDD") that keeps
// the original barcode, so those batches may share one barcode.
const baseSku = (sku: string) => sku.trim().replace(/(-(EXP-\d{8}|B\d{4}))+$/i, '').toLowerCase();

interface ProductFormProps {
  product?: Product;
  onSuccess: () => void;
}

export function ProductForm({ product, onSuccess }: ProductFormProps) {
  const { categories, units, products, addProduct, updateProduct } = useStore();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const form = useForm<ProductFormData>({
    resolver: zodResolver(productSchema),
    defaultValues: product
      ? {
          sku: product.sku,
          name: product.name,
          description: product.description,
          categoryId: product.categoryId,
          unitId: product.unitId,
          costPrice: product.costPrice,
          sellingPrice: product.sellingPrice,
          stockQuantity: product.stockQuantity,
          lowStockThreshold: product.lowStockThreshold,
          expiryDate: product.expiryDate || '',
          barcode: product.barcode || '',
          barcodeEnabled: product.barcodeEnabled || false,
        }
      : {
          sku: '',
          name: '',
          description: '',
          categoryId: '',
          unitId: '',
          costPrice: 0,
          sellingPrice: 0,
          stockQuantity: 0,
          lowStockThreshold: 10,
          expiryDate: '',
          barcode: '',
          barcodeEnabled: false,
        },
  });

  const onSubmit = (raw: ProductFormData) => {
    const data = { ...raw, sku: raw.sku.trim(), name: raw.name.trim(), barcode: raw.barcode?.trim() || '' };
    const fail = (field: keyof ProductFormData, message: string) => {
      form.setError(field, { message });
      setIsSubmitting(false);
    };
    setIsSubmitting(true);

    if (!data.sku) return fail('sku', 'SKU is required');
    if (!data.name) return fail('name', 'Name is required');

    // Check for duplicate SKU (the SKU finds the product when typed or scanned)
    const existingSku = products.find(
      (p) => p.sku.trim().toLowerCase() === data.sku.toLowerCase() && p.id !== product?.id
    );
    if (existingSku) return fail('sku', `SKU already used by ${existingSku.name}`);

    // A scanned barcode adds the first product that has it, so two different products must never
    // share one. Batches of the same product (see baseSku) may.
    const barcode = data.barcode.toLowerCase();
    if (barcode) {
      const sameBarcode = products.find(
        (p) => p.barcode?.trim().toLowerCase() === barcode && p.id !== product?.id && baseSku(p.sku) !== baseSku(data.sku)
      );
      if (sameBarcode) return fail('barcode', `Barcode already used by ${sameBarcode.name} (${sameBarcode.sku})`);
    }

    // The database rejects a product whose category or unit no longer exists.
    if (!categories.some((c) => c.id === data.categoryId)) return fail('categoryId', 'Choose a category');
    if (!units.some((u) => u.id === data.unitId)) return fail('unitId', 'Choose a unit');

    if (product) {
      // Stock is only sent when it was changed in this form; otherwise sales made while the
      // form was open would be overwritten with the value it was opened with.
      const { stockQuantity, ...otherFields } = data;
      const saved = updateProduct(
        product.id,
        form.formState.dirtyFields.stockQuantity ? { ...otherFields, stockQuantity } : otherFields
      );
      if (!saved) {
        setIsSubmitting(false);
        return;
      }
      toast.success('Product updated');
    } else {
      if (data.stockQuantity < 0) return fail('stockQuantity', 'Must be non-negative');
      const saved = addProduct({
        sku: data.sku,
        name: data.name,
        description: data.description || '',
        categoryId: data.categoryId,
        unitId: data.unitId,
        costPrice: data.costPrice,
        sellingPrice: data.sellingPrice,
        stockQuantity: data.stockQuantity,
        lowStockThreshold: data.lowStockThreshold,
        expiryDate: data.expiryDate || undefined,
        barcode: data.barcode || undefined,
        barcodeEnabled: data.barcodeEnabled || false,
      });
      if (!saved) {
        setIsSubmitting(false);
        return;
      }
      toast.success('Product created');
    }

    setIsSubmitting(false);
    onSuccess();
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <FormField
            control={form.control}
            name="sku"
            render={({ field }) => (
              <FormItem>
                <FormLabel>SKU</FormLabel>
                <FormControl>
                  <Input {...field} placeholder="PROD-001" className="font-mono" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="name"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Product Name</FormLabel>
                <FormControl>
                  <Input {...field} placeholder="Product name" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <FormField
            control={form.control}
            name="categoryId"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Category</FormLabel>
                <Select onValueChange={field.onChange} defaultValue={field.value}>
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue placeholder="Select category" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {categories.map((cat) => (
                      <SelectItem key={cat.id} value={cat.id}>
                        {cat.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="unitId"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Unit</FormLabel>
                <Select onValueChange={field.onChange} defaultValue={field.value}>
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue placeholder="Select unit" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {units.map((unit) => (
                      <SelectItem key={unit.id} value={unit.id}>
                        {unit.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <FormField
          control={form.control}
          name="description"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Description</FormLabel>
              <FormControl>
                <Textarea {...field} placeholder="Optional description" rows={2} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="grid grid-cols-2 gap-4">
          <FormField
            control={form.control}
            name="costPrice"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Cost Price (Rs.)</FormLabel>
                <FormControl>
                  <Input {...field} type="number" step="0.01" min="0" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="sellingPrice"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Selling Price (Rs.)</FormLabel>
                <FormControl>
                  <Input {...field} type="number" step="0.01" min="0" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <FormField
            control={form.control}
            name="stockQuantity"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Stock Quantity</FormLabel>
                <FormControl>
                  <Input {...field} type="number" min="0" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="lowStockThreshold"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Low Stock Alert</FormLabel>
                <FormControl>
                  <Input {...field} type="number" min="1" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <FormField
            control={form.control}
            name="expiryDate"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Expiry Date</FormLabel>
                <FormControl>
                  <Input {...field} type="date" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="barcode"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Barcode / EAN</FormLabel>
                <FormControl>
                  <Input {...field} placeholder="e.g., 9780201379624" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <FormField
          control={form.control}
          name="barcodeEnabled"
          render={({ field }) => (
            <FormItem className="flex flex-row items-center space-x-3 space-y-0">
              <FormControl>
                <Checkbox
                  checked={field.value}
                  onCheckedChange={field.onChange}
                />
              </FormControl>
              <FormLabel className="font-normal cursor-pointer">
                Enable barcode scanning for this product
              </FormLabel>
            </FormItem>
          )}
        />

        <div className="flex justify-end gap-2 pt-4">
          <Button type="submit" disabled={isSubmitting}>
            {product ? 'Update Product' : 'Create Product'}
          </Button>
        </div>
      </form>
    </Form>
  );
}
