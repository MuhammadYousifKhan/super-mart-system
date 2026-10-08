import { useState } from 'react';
import { useStore } from '@/contexts/useStore';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';
import { Edit, Plus, Trash2 } from 'lucide-react';
import { Unit } from '@/types/pos';

interface UnitsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function UnitsModal({ open, onOpenChange }: UnitsModalProps) {
  const { units, products, addUnit, updateUnit, deleteUnit } = useStore();
  const [unitForm, setUnitForm] = useState({ name: '', description: '' });
  const [editingUnit, setEditingUnit] = useState<Unit | null>(null);
  const [deleteUnitId, setDeleteUnitId] = useState<string | null>(null);
  const [replacementUnitId, setReplacementUnitId] = useState('');

  const unitName = (id: string) => units.find((u) => u.id === id)?.name || 'this unit';
  const productCount = (id: string) => products.filter((p) => p.unitId === id).length;

  const resetForm = () => {
    setEditingUnit(null);
    setUnitForm({ name: '', description: '' });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!unitForm.name.trim()) {
      toast.error('Unit name is required');
      return;
    }

    const unit = { name: unitForm.name.trim(), description: unitForm.description.trim() };
    if (editingUnit) {
      if (!updateUnit(editingUnit.id, unit)) return;
      toast.success('Unit updated successfully');
    } else {
      if (!addUnit(unit)) return;
      toast.success('Unit added successfully');
    }
    resetForm();
  };

  const startEdit = (unit: Unit) => {
    setEditingUnit(unit);
    setUnitForm({ name: unit.name, description: unit.description || '' });
  };

  const openDelete = (unitId: string) => {
    setReplacementUnitId('');
    setDeleteUnitId(unitId);
  };

  // Products still using the unit are moved to the chosen one before it is deleted (the database
  // refuses to delete a unit that products point at).
  const deleteCount = deleteUnitId ? productCount(deleteUnitId) : 0;

  const handleDeleteUnit = () => {
    if (!deleteUnitId) return;
    if (deleteCount > 0 && !replacementUnitId) {
      toast.error('Choose a unit to move the products to');
      return;
    }
    if (!deleteUnit(deleteUnitId, replacementUnitId || undefined)) return;
    toast.success(
      deleteCount > 0
        ? `Unit deleted. ${deleteCount} product${deleteCount === 1 ? '' : 's'} moved to ${unitName(replacementUnitId)}.`
        : 'Unit deleted successfully'
    );
    if (editingUnit?.id === deleteUnitId) resetForm();
    setDeleteUnitId(null);
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Manage Units</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            {/* Add / Edit Unit Form */}
            <div className="border rounded-lg p-4 bg-gray-50 dark:bg-slate-900">
              <h3 className="font-medium mb-3">{editingUnit ? `Edit Unit: ${editingUnit.name}` : 'Add New Unit'}</h3>
              <form onSubmit={handleSubmit} className="space-y-3">
                <div>
                  <Label htmlFor="unit-name">Unit Name *</Label>
                  <Input
                    id="unit-name"
                    placeholder="e.g., Pieces, Kilograms, Liters"
                    value={unitForm.name}
                    onChange={(e) =>
                      setUnitForm({ ...unitForm, name: e.target.value })
                    }
                  />
                </div>
                <div>
                  <Label htmlFor="unit-desc">Description</Label>
                  <Input
                    id="unit-desc"
                    placeholder="e.g., Individual pieces, Weight in kg"
                    value={unitForm.description}
                    onChange={(e) =>
                      setUnitForm({ ...unitForm, description: e.target.value })
                    }
                  />
                </div>
                <div className="flex gap-2">
                  <Button type="submit" size="sm" className="flex-1">
                    {editingUnit ? (
                      <>
                        <Edit className="w-4 h-4 mr-2" />
                        Update Unit
                      </>
                    ) : (
                      <>
                        <Plus className="w-4 h-4 mr-2" />
                        Add Unit
                      </>
                    )}
                  </Button>
                  {editingUnit && (
                    <Button type="button" size="sm" variant="outline" onClick={resetForm}>
                      Cancel
                    </Button>
                  )}
                </div>
              </form>
            </div>

            {/* Units List */}
            <div>
              <h3 className="font-medium mb-3">Existing Units</h3>
              <div className="space-y-2 max-h-96 overflow-y-auto">
                {units.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-4">
                    No units added yet
                  </p>
                ) : (
                  units.map((unit) => (
                    <div
                      key={unit.id}
                      className={`flex items-center justify-between p-2 border rounded bg-slate-50 dark:bg-slate-800 ${
                        editingUnit?.id === unit.id ? 'border-primary' : ''
                      }`}
                    >
                      <div className="flex-1">
                        <p className="font-medium text-sm">{unit.name}</p>
                        {unit.description && (
                          <p className="text-xs text-muted-foreground">
                            {unit.description}
                          </p>
                        )}
                      </div>
                      <span className="text-xs text-muted-foreground mr-2">
                        {productCount(unit.id)} product{productCount(unit.id) === 1 ? '' : 's'}
                      </span>
                      <Button variant="ghost" size="sm" onClick={() => startEdit(unit)} title="Edit unit">
                        <Edit className="w-4 h-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => openDelete(unit.id)}
                        title="Delete unit"
                        className="text-destructive hover:text-destructive hover:bg-destructive/10"
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteUnitId !== null} onOpenChange={(open) => {
        if (!open) setDeleteUnitId(null);
      }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Unit</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteCount > 0
                ? `${deleteCount} product${deleteCount === 1 ? '' : 's'} still use "${unitName(deleteUnitId || '')}". Choose a unit to move ${deleteCount === 1 ? 'it' : 'them'} to, then the unit is deleted.`
                : `Are you sure you want to delete "${unitName(deleteUnitId || '')}"? This action cannot be undone.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {deleteCount > 0 && (
            <div className="space-y-2">
              <Label>Move products to</Label>
              <Select value={replacementUnitId} onValueChange={setReplacementUnitId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select unit" />
                </SelectTrigger>
                <SelectContent>
                  {units
                    .filter((u) => u.id !== deleteUnitId)
                    .map((u) => (
                      <SelectItem key={u.id} value={u.id}>
                        {u.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
              {units.length < 2 && (
                <p className="text-xs text-muted-foreground">Add another unit first, then move the products to it.</p>
              )}
            </div>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteUnit}
              disabled={deleteCount > 0 && !replacementUnitId}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteCount > 0 ? 'Move Products & Delete' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
