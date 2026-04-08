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
  DialogTrigger,
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
import { toast } from 'sonner';
import { Plus, Trash2 } from 'lucide-react';
import { Unit } from '@/types/pos';

interface UnitsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function UnitsModal({ open, onOpenChange }: UnitsModalProps) {
  const { units, addUnit, deleteUnit } = useStore();
  const [unitForm, setUnitForm] = useState({ name: '', description: '' });
  const [deleteUnitId, setDeleteUnitId] = useState<string | null>(null);

  const handleAddUnit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!unitForm.name.trim()) {
      toast.error('Unit name is required');
      return;
    }

    await addUnit({
      name: unitForm.name.trim(),
      description: unitForm.description.trim(),
    });

    toast.success('Unit added successfully');
    setUnitForm({ name: '', description: '' });
  };

  const handleDeleteUnit = async (unitId: string) => {
    await deleteUnit(unitId);
    toast.success('Unit deleted successfully');
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
            {/* Add Unit Form */}
            <div className="border rounded-lg p-4 bg-gray-50 dark:bg-slate-900">
              <h3 className="font-medium mb-3">Add New Unit</h3>
              <form onSubmit={handleAddUnit} className="space-y-3">
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
                <Button type="submit" size="sm" className="w-full">
                  <Plus className="w-4 h-4 mr-2" />
                  Add Unit
                </Button>
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
                      className="flex items-center justify-between p-2 border rounded bg-slate-50 dark:bg-slate-800"
                    >
                      <div className="flex-1">
                        <p className="font-medium text-sm">{unit.name}</p>
                        {unit.description && (
                          <p className="text-xs text-muted-foreground">
                            {unit.description}
                          </p>
                        )}
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setDeleteUnitId(unit.id)}
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
              Are you sure you want to delete this unit? Products using this unit may be affected.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (deleteUnitId) handleDeleteUnit(deleteUnitId);
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
