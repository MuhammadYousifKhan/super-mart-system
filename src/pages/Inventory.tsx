import { useState, useMemo } from 'react';
import {
  useReactTable,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  getPaginationRowModel,
  flexRender,
  ColumnDef,
  SortingState,
  RowSelectionState,
} from '@tanstack/react-table';
import { useStore } from '@/contexts/useStore';
import { Product, Category } from '@/types/pos';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
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
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
  DialogDescription,
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Plus, Trash2, Search, ArrowUpDown, Package, FolderOpen, Edit, X } from 'lucide-react';
import { ProductForm } from '@/components/inventory/ProductForm';
import { QuickAddModal } from '@/components/inventory/QuickAddModal';
import { ReceiveSupplierStockModal } from '@/components/inventory/ReceiveSupplierStockModal';
import { UnitsModal } from '@/components/inventory/UnitsModal';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { formatPKR } from '@/pages/Analytics';

export default function Inventory() {
  const { products, units, categories, suppliers, cart, heldCarts, deleteProducts, addCategory, updateCategory, deleteCategory } =
    useStore();
  const [sorting, setSorting] = useState<SortingState>([]);
  const [globalFilter, setGlobalFilter] = useState('');
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [isQuickAddOpen, setIsQuickAddOpen] = useState(false);
  const [isReceiveSupplierStockOpen, setIsReceiveSupplierStockOpen] = useState(false);
  const [isUnitsModalOpen, setIsUnitsModalOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  
  // Category management state
  const [isCategoryDialogOpen, setIsCategoryDialogOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState<Category | null>(null);
  const [categoryForm, setCategoryForm] = useState({ name: '', description: '' });
  const [deleteCategoryId, setDeleteCategoryId] = useState<string | null>(null);
  const [replacementCategoryId, setReplacementCategoryId] = useState('');
  const [bulkDeleteIds, setBulkDeleteIds] = useState<string[] | null>(null);

  const getCategoryName = (categoryId: string) => {
    return categories.find((c) => c.id === categoryId)?.name || 'Unknown';
  };

  const getUnitName = (unitId: string) => {
    return units.find((u) => u.id === unitId)?.name || 'Unknown';
  };

  const getStockStatus = (product: Product) => {
    if (product.stockQuantity <= 0) return 'critical';
    if (product.stockQuantity < product.lowStockThreshold) return 'low';
    return 'ok';
  };

  const getExpiryStatus = (expiryDate?: string) => {
    if (!expiryDate) return null;
    const expiry = new Date(expiryDate);
    const now = new Date();
    const daysUntilExpiry = (expiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
    
    if (daysUntilExpiry < 0) return 'expired';
    if (daysUntilExpiry < 14) return 'critical';
    if (daysUntilExpiry < 30) return 'warning';
    return 'ok';
  };

  const columns: ColumnDef<Product>[] = useMemo(
    () => [
      {
        id: 'select',
        header: ({ table }) => (
          <Checkbox
            checked={table.getIsAllPageRowsSelected()}
            onCheckedChange={(value) => table.toggleAllPageRowsSelected(!!value)}
            aria-label="Select all"
          />
        ),
        cell: ({ row }) => (
          <Checkbox
            checked={row.getIsSelected()}
            onCheckedChange={(value) => row.toggleSelected(!!value)}
            aria-label="Select row"
          />
        ),
        enableSorting: false,
      },
      {
        accessorKey: 'sku',
        header: ({ column }) => (
          <Button
            variant="ghost"
            size="sm"
            className="-ml-3"
            onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
          >
            SKU
            <ArrowUpDown className="ml-2 h-3 w-3" />
          </Button>
        ),
        cell: ({ row }) => (
          <span className="font-mono text-xs">{row.getValue('sku')}</span>
        ),
      },
      {
        accessorKey: 'name',
        header: ({ column }) => (
          <Button
            variant="ghost"
            size="sm"
            className="-ml-3"
            onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
          >
            Name
            <ArrowUpDown className="ml-2 h-3 w-3" />
          </Button>
        ),
      },
      {
        accessorKey: 'categoryId',
        header: 'Category',
        cell: ({ row }) => (
          <Badge variant="secondary">{getCategoryName(row.getValue('categoryId'))}</Badge>
        ),
      },
      {
        accessorKey: 'unitId',
        header: 'Unit',
        cell: ({ row }) => (
          <Badge variant="outline">{getUnitName(row.getValue('unitId'))}</Badge>
        ),
      },
      {
        accessorKey: 'stockQuantity',
        header: ({ column }) => (
          <Button
            variant="ghost"
            size="sm"
            className="-ml-3"
            onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
          >
            Stock
            <ArrowUpDown className="ml-2 h-3 w-3" />
          </Button>
        ),
        cell: ({ row }) => {
          const product = row.original;
          const status = getStockStatus(product);
          return (
            <span
              className={cn(
                status === 'critical' && 'stock-critical',
                status === 'low' && 'stock-low',
                status === 'ok' && 'stock-ok'
              )}
            >
              {product.stockQuantity}
            </span>
          );
        },
      },
      {
        accessorKey: 'costPrice',
        header: 'Cost',
        cell: ({ row }) => formatPKR(row.getValue('costPrice') as number),
      },
      {
        accessorKey: 'sellingPrice',
        header: 'Price',
        cell: ({ row }) => formatPKR(row.getValue('sellingPrice') as number),
      },
      {
        accessorKey: 'expiryDate',
        header: 'Expiry Date',
        cell: ({ row }) => {
          const expiryDate = row.getValue('expiryDate') as string | undefined;
          if (!expiryDate) return <span className="text-muted-foreground italic">No expiry</span>;
          const status = getExpiryStatus(expiryDate);
          const displayDate = new Date(expiryDate).toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            year: '2-digit',
          });
          return (
            <Badge
              variant={
                status === 'expired'
                  ? 'destructive'
                  : status === 'critical'
                    ? 'destructive'
                    : status === 'warning'
                      ? 'secondary'
                      : 'outline'
              }
            >
              {displayDate}
            </Badge>
          );
        },
      },
      {
        accessorKey: 'barcode',
        header: 'Barcode',
        cell: ({ row }) => {
          const product = row.original;
          if (!product.barcode) return <span className="text-muted-foreground">-</span>;
          return (
            <div className="flex items-center gap-2">
              <code className="text-xs bg-muted px-2 py-1 rounded">{product.barcode}</code>
              {product.barcodeEnabled && <Badge variant="outline">✓ Active</Badge>}
            </div>
          );
        },
      },
      {
        id: 'actions',
        cell: ({ row }) => (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setEditingProduct(row.original)}
          >
            Edit
          </Button>
        ),
      },
    ],
    [categories, units]
  );

  const table = useReactTable({
    data: products,
    columns,
    getRowId: (row) => row.id,
    state: {
      sorting,
      globalFilter,
      rowSelection,
    },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    onRowSelectionChange: setRowSelection,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: {
      pagination: { pageSize: 20 },
    },
  });

  const selectedCount = Object.keys(rowSelection).length;

  const handleBulkDelete = () => {
    // Only rows currently visible (after search) are deleted, never ones hidden by the filter.
    const selectedIds = table
      .getFilteredSelectedRowModel()
      .rows.map((row) => row.original.id);
    if (selectedIds.length === 0) return;
    setBulkDeleteIds(selectedIds);
  };

  const confirmBulkDelete = () => {
    if (!bulkDeleteIds) return;
    deleteProducts(bulkDeleteIds);
    setRowSelection({});
    toast.success(`Deleted ${bulkDeleteIds.length} product${bulkDeleteIds.length === 1 ? '' : 's'}`);
    setBulkDeleteIds(null);
  };

  // What the bulk delete confirmation mentions: stock still on hand and products waiting in a sale.
  const bulkDeleteSet = new Set(bulkDeleteIds || []);
  const bulkDeleteWithStock = products.filter((p) => bulkDeleteSet.has(p.id) && p.stockQuantity > 0).length;
  const bulkDeleteInSale =
    cart.some((item) => bulkDeleteSet.has(item.product.id)) ||
    heldCarts.some((held) => held.items.some((item) => bulkDeleteSet.has(item.product.id)));

  // Category handlers
  const handleAddCategory = () => {
    if (!categoryForm.name.trim()) {
      toast.error('Category name is required');
      return;
    }
    const saved = addCategory({
      name: categoryForm.name.trim(),
      description: categoryForm.description.trim(),
    });
    if (!saved) return;
    toast.success('Category added successfully');
    setCategoryForm({ name: '', description: '' });
  };

  const handleUpdateCategory = () => {
    if (!editingCategory) return;
    if (!categoryForm.name.trim()) {
      toast.error('Category name is required');
      return;
    }
    const saved = updateCategory(editingCategory.id, {
      name: categoryForm.name.trim(),
      description: categoryForm.description.trim(),
    });
    if (!saved) return;
    toast.success('Category updated successfully');
    setEditingCategory(null);
    setCategoryForm({ name: '', description: '' });
  };

  // Products still in a category are moved to the chosen one before it is deleted (the database
  // refuses to delete a category that products point at).
  const deleteCategoryProductCount = deleteCategoryId ? products.filter((p) => p.categoryId === deleteCategoryId).length : 0;

  const openDeleteCategory = (categoryId: string) => {
    setReplacementCategoryId('');
    setDeleteCategoryId(categoryId);
  };

  const handleDeleteCategory = () => {
    if (!deleteCategoryId) return;
    if (deleteCategoryProductCount > 0 && !replacementCategoryId) {
      toast.error('Choose a category to move the products to');
      return;
    }
    if (!deleteCategory(deleteCategoryId, replacementCategoryId || undefined)) return;
    toast.success(
      deleteCategoryProductCount > 0
        ? `Category deleted. ${deleteCategoryProductCount} product${deleteCategoryProductCount === 1 ? '' : 's'} moved to ${getCategoryName(replacementCategoryId)}.`
        : 'Category deleted successfully'
    );
    if (editingCategory?.id === deleteCategoryId) cancelEditCategory();
    setDeleteCategoryId(null);
  };

  const startEditCategory = (category: Category) => {
    setEditingCategory(category);
    setCategoryForm({ name: category.name, description: category.description });
  };

  const cancelEditCategory = () => {
    setEditingCategory(null);
    setCategoryForm({ name: '', description: '' });
  };

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Inventory</h1>
          <p className="text-sm text-muted-foreground">
            Manage your product catalog and stock levels
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setIsCategoryDialogOpen(true)}>
            <FolderOpen className="w-4 h-4 mr-2" />
            Categories
          </Button>
          <Button variant="outline" onClick={() => setIsQuickAddOpen(true)}>
            <Package className="w-4 h-4 mr-2" />
            Quick Add Stock
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              if (suppliers.length === 0) {
                toast.error('Please add at least one supplier first');
                return;
              }
              setIsReceiveSupplierStockOpen(true);
            }}
          >
            <Package className="w-4 h-4 mr-2" />
            Receive Supplier Stock
          </Button>
           <Button
             variant="outline"
             onClick={() => setIsUnitsModalOpen(true)}
           >
             <FolderOpen className="w-4 h-4 mr-2" />
             Manage Units
           </Button>
           <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="w-4 h-4 mr-2" />
                Add Product
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader>
                <DialogTitle>Add New Product</DialogTitle>
              </DialogHeader>
              <ProductForm onSuccess={() => setIsAddDialogOpen(false)} />
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <div className="flex items-center gap-4 mb-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search by SKU or name..."
            value={globalFilter}
            onChange={(e) => setGlobalFilter(e.target.value)}
            className="pl-10"
          />
        </div>
        {selectedCount > 0 && (
          <Button variant="destructive" size="sm" onClick={handleBulkDelete}>
            <Trash2 className="w-4 h-4 mr-2" />
            Delete {selectedCount} selected
          </Button>
        )}
        <span className="text-sm text-muted-foreground ml-auto">
          {table.getFilteredRowModel().rows.length} products
        </span>
      </div>

      <div className="border rounded-lg bg-card">
        <Table className="data-table">
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <TableHead key={header.id}>
                    {header.isPlaceholder
                      ? null
                      : flexRender(header.column.columnDef.header, header.getContext())}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.length ? (
              table.getRowModel().rows.map((row) => (
                <TableRow key={row.id} data-state={row.getIsSelected() && 'selected'}>
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={columns.length} className="h-24 text-center">
                  No products found.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <div className="flex items-center justify-between mt-4">
        <div className="text-sm text-muted-foreground">
          Page {table.getState().pagination.pageIndex + 1} of {table.getPageCount()}
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => table.previousPage()}
            disabled={!table.getCanPreviousPage()}
          >
            Previous
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => table.nextPage()}
            disabled={!table.getCanNextPage()}
          >
            Next
          </Button>
        </div>
      </div>

      {/* Edit Product Dialog */}
      <Dialog open={!!editingProduct} onOpenChange={() => setEditingProduct(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit Product</DialogTitle>
          </DialogHeader>
          {editingProduct && (
            <ProductForm
              product={editingProduct}
              onSuccess={() => setEditingProduct(null)}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* Quick Add Stock Modal */}
      <QuickAddModal open={isQuickAddOpen} onOpenChange={setIsQuickAddOpen} />

      {/* Receive Stock from Supplier Modal */}
      <ReceiveSupplierStockModal
        open={isReceiveSupplierStockOpen}
        onOpenChange={setIsReceiveSupplierStockOpen}
      />

       {/* Units Management Modal */}
       <UnitsModal
         open={isUnitsModalOpen}
         onOpenChange={setIsUnitsModalOpen}
       />

      {/* Category Management Dialog */}
      <Dialog open={isCategoryDialogOpen} onOpenChange={setIsCategoryDialogOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Manage Categories</DialogTitle>
            <DialogDescription>
              Add, edit, or delete product categories
            </DialogDescription>
          </DialogHeader>
          
          {/* Add/Edit Category Form */}
          <div className="space-y-4 py-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Category Name *</Label>
                <Input
                  value={categoryForm.name}
                  onChange={(e) => setCategoryForm({ ...categoryForm, name: e.target.value })}
                  placeholder="Enter category name"
                />
              </div>
              <div className="space-y-2">
                <Label>Description</Label>
                <Input
                  value={categoryForm.description}
                  onChange={(e) => setCategoryForm({ ...categoryForm, description: e.target.value })}
                  placeholder="Brief description"
                />
              </div>
            </div>
            <div className="flex gap-2">
              {editingCategory ? (
                <>
                  <Button onClick={handleUpdateCategory}>
                    <Edit className="w-4 h-4 mr-2" />
                    Update Category
                  </Button>
                  <Button variant="outline" onClick={cancelEditCategory}>
                    Cancel
                  </Button>
                </>
              ) : (
                <Button onClick={handleAddCategory}>
                  <Plus className="w-4 h-4 mr-2" />
                  Add Category
                </Button>
              )}
            </div>
          </div>

          {/* Categories List */}
          <div className="border rounded-lg max-h-[300px] overflow-y-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead className="text-center">Products</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {categories.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center text-muted-foreground py-8">
                      No categories yet. Add your first category above.
                    </TableCell>
                  </TableRow>
                ) : (
                  categories.map((category) => {
                    const productCount = products.filter(p => p.categoryId === category.id).length;
                    return (
                      <TableRow key={category.id}>
                        <TableCell className="font-medium">{category.name}</TableCell>
                        <TableCell className="text-muted-foreground">{category.description || '-'}</TableCell>
                        <TableCell className="text-center">
                          <Badge variant="secondary">{productCount}</Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => startEditCategory(category)}
                            >
                              <Edit className="w-4 h-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => openDeleteCategory(category.id)}
                              title="Delete category"
                            >
                              <Trash2 className="w-4 h-4 text-destructive" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete Category Confirmation */}
      <AlertDialog open={!!deleteCategoryId} onOpenChange={(open) => !open && setDeleteCategoryId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Category</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteCategoryProductCount > 0
                ? `${deleteCategoryProductCount} product${deleteCategoryProductCount === 1 ? '' : 's'} still use "${getCategoryName(deleteCategoryId || '')}". Choose a category to move ${deleteCategoryProductCount === 1 ? 'it' : 'them'} to, then the category is deleted.`
                : `Are you sure you want to delete "${getCategoryName(deleteCategoryId || '')}"? This action cannot be undone.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {deleteCategoryProductCount > 0 && (
            <div className="space-y-2">
              <Label>Move products to</Label>
              <Select value={replacementCategoryId} onValueChange={setReplacementCategoryId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select category" />
                </SelectTrigger>
                <SelectContent>
                  {categories
                    .filter((c) => c.id !== deleteCategoryId)
                    .map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
              {categories.length < 2 && (
                <p className="text-xs text-muted-foreground">Add another category first, then move the products to it.</p>
              )}
            </div>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteCategory}
              disabled={deleteCategoryProductCount > 0 && !replacementCategoryId}
              className="bg-destructive hover:bg-destructive/90"
            >
              {deleteCategoryProductCount > 0 ? 'Move Products & Delete' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Bulk delete confirmation */}
      <AlertDialog open={!!bulkDeleteIds} onOpenChange={(open) => !open && setBulkDeleteIds(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete {bulkDeleteIds?.length ?? 0} product{bulkDeleteIds?.length === 1 ? '' : 's'}?
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <p>
                  Sales history is kept: past bills and reports still show the product name and SKU.
                </p>
                {bulkDeleteWithStock > 0 && (
                  <p className="text-amber-600">
                    {bulkDeleteWithStock} of them still {bulkDeleteWithStock === 1 ? 'has' : 'have'} stock on hand.
                  </p>
                )}
                {bulkDeleteInSale && (
                  <p className="text-amber-600">Some are in the open sale or a held bill and will be removed from it.</p>
                )}
                <p>This action cannot be undone.</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmBulkDelete} className="bg-destructive hover:bg-destructive/90">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
