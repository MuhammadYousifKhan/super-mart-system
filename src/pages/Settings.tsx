import { useStore } from '@/contexts/useStore';
import { useAuth } from '@/contexts/useAuth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
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
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { toast } from 'sonner';
import { ThermalPrinterSettings } from '@/components/settings/ThermalPrinterSettings';
import { useState, useRef, useEffect } from 'react';
import type { UserCredentials, UserRole } from '@/types/pos';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Upload, X, Store, User, Lock, Building2, FileImage, Users, Plus, Trash2, Mail, Eye, EyeOff, KeyRound } from 'lucide-react';

// Removed FIXED_CARD_FEE_PERCENT constant to rely on store settings

export default function Settings() {
  const { settings, updateSettings } = useStore();
  const { user, updateCredentials, getUsers, createUser, deleteUser, setUserRole, setUserPassword, canChangeEmail, isAdmin } =
    useAuth();
  const [form, setForm] = useState(settings);
  const [logoPreview, setLogoPreview] = useState<string | undefined>(settings.logo);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Settings can finish loading after this page opened (e.g. right after a restart). Refresh the form
  // from them unless something was already typed, so saving never overwrites real details with defaults.
  const syncedSettingsRef = useRef(settings);
  useEffect(() => {
    const previous = syncedSettingsRef.current;
    const untouched = JSON.stringify(form) === JSON.stringify(previous) && logoPreview === previous.logo;
    if (untouched) {
      setForm(settings);
      setLogoPreview(settings.logo);
    }
    syncedSettingsRef.current = settings;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings]);

  // Credential state
  const [credForm, setCredForm] = useState({
    fullName: user?.fullName || '',
    email: user?.email || '',
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
  });

  // New user form state
  const [newCashierOpen, setNewCashierOpen] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [newCashierForm, setNewCashierForm] = useState({
    fullName: '',
    email: '',
    password: '',
    confirmPassword: '',
    role: 'cashier' as UserRole,
  });
  const [userBusy, setUserBusy] = useState(false);
  // Password reset for another user
  const [passwordTarget, setPasswordTarget] = useState<{ email: string; fullName: string } | null>(null);
  const [passwordForm, setPasswordForm] = useState({ password: '', confirmPassword: '' });

  const handleSave = () => {
    if (!form.storeName.trim()) {
      toast.error('Store name is required');
      return;
    }
    updateSettings({
      ...form,
      storeName: form.storeName.trim(),
      address: form.address.trim(),
      phone: form.phone.trim(),
      logo: logoPreview,
    });
    toast.success('Settings saved successfully');
  };

  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 2 * 1024 * 1024) {
        toast.error('Logo must be less than 2MB');
        return;
      }

      const reader = new FileReader();
      reader.onloadend = () => {
        const base64 = reader.result as string;
        setLogoPreview(base64);
      };
      reader.readAsDataURL(file);
    }
  };

  const removeLogo = () => {
    setLogoPreview(undefined);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleCreateCashier = async () => {
    if (!newCashierForm.fullName.trim()) {
      toast.error('Please enter a full name');
      return;
    }
    if (!newCashierForm.email.trim()) {
      toast.error('Please enter an email');
      return;
    }
    if (!newCashierForm.password) {
      toast.error('Please enter a password');
      return;
    }
    if (newCashierForm.password.length < 6) {
      toast.error('Password must be at least 6 characters');
      return;
    }
    if (newCashierForm.password !== newCashierForm.confirmPassword) {
      toast.error('Passwords do not match');
      return;
    }

    setUserBusy(true);
    const success = await createUser({
      fullName: newCashierForm.fullName.trim(),
      email: newCashierForm.email.trim(),
      password: newCashierForm.password,
      role: newCashierForm.role,
    });
    setUserBusy(false);

    if (success) {
      toast.success(`${newCashierForm.role === 'admin' ? 'Admin' : 'Cashier'} account created. They can sign in on any PC.`);
      setNewCashierForm({ fullName: '', email: '', password: '', confirmPassword: '', role: 'cashier' });
      setNewCashierOpen(false);
      setShowNewPassword(false);
    }
  };

  const handleDeleteUser = async (email: string) => {
    setUserBusy(true);
    const success = await deleteUser(email);
    setUserBusy(false);
    if (success) toast.success('User deleted');
  };

  const handleRoleChange = async (email: string, role: UserRole) => {
    setUserBusy(true);
    const success = await setUserRole(email, role);
    setUserBusy(false);
    if (success) toast.success('Role updated. It applies the next time they sign in.');
  };

  const handleSetPassword = async () => {
    if (!passwordTarget) return;
    if (passwordForm.password.length < 6) {
      toast.error('Password must be at least 6 characters');
      return;
    }
    if (passwordForm.password !== passwordForm.confirmPassword) {
      toast.error('Passwords do not match');
      return;
    }
    setUserBusy(true);
    const success = await setUserPassword(passwordTarget.email, passwordForm.password);
    setUserBusy(false);
    if (success) {
      toast.success(`New password set for ${passwordTarget.fullName}`);
      setPasswordTarget(null);
      setPasswordForm({ password: '', confirmPassword: '' });
    }
  };

  const handleCredentialsSave = async () => {
    if (!user) return;

    if (credForm.newPassword) {
      if (!credForm.currentPassword) {
        toast.error('Please enter your current password');
        return;
      }
      if (credForm.newPassword !== credForm.confirmPassword) {
        toast.error('New passwords do not match');
        return;
      }
      if (credForm.newPassword.length < 6) {
        toast.error('Password must be at least 6 characters');
        return;
      }
    }

    const updates: Partial<UserCredentials> = {};
    if (credForm.fullName.trim() && credForm.fullName.trim() !== user.fullName) {
      updates.fullName = credForm.fullName.trim();
    }
    if (canChangeEmail && credForm.email.trim() && credForm.email.trim() !== user.email) {
      updates.email = credForm.email.trim();
    }
    if (credForm.newPassword) {
      updates.password = credForm.newPassword;
    }

    if (Object.keys(updates).length === 0) {
      toast.info('No changes to save');
      return;
    }

    const success = await updateCredentials(user.email, updates, credForm.currentPassword);
    if (success) {
      toast.success('Account updated successfully');
      setCredForm(prev => ({ ...prev, currentPassword: '', newPassword: '', confirmPassword: '' }));
    }
  };

  return (
    <div className="p-6 max-w-4xl mx-auto page-transition">
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
        <p className="text-muted-foreground mt-1">Configure your store and account preferences</p>
      </div>

      <div className="space-y-6">
        {/* Logo Upload */}
        <Card className="card-interactive">
          <CardHeader>
            <div className="flex items-center gap-2">
              <FileImage className="h-5 w-5 text-primary" />
              <CardTitle>Company Logo</CardTitle>
            </div>
            <CardDescription>
              Upload your logo to display in the app and on printed receipts
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-start gap-6">
              <div className="relative">
                {logoPreview ? (
                  <div className="relative w-32 h-32 rounded-xl border-2 border-dashed border-border overflow-hidden bg-muted/50">
                    <img
                      src={logoPreview}
                      alt="Logo preview"
                      className="w-full h-full object-contain p-2"
                    />
                    <button
                      onClick={removeLogo}
                      aria-label="Remove logo"
                      title="Remove logo"
                      className="absolute top-1 right-1 p-1 rounded-full bg-destructive text-destructive-foreground hover:bg-destructive/90 transition-colors"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ) : (
                  <div
                    onClick={() => fileInputRef.current?.click()}
                    role="button"
                    tabIndex={0}
                    aria-label="Upload logo"
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') fileInputRef.current?.click(); }}
                    className="w-32 h-32 rounded-xl border-2 border-dashed border-border flex flex-col items-center justify-center cursor-pointer hover:border-primary hover:bg-accent/50 transition-all logo-placeholder"
                  >
                    <Upload className="h-8 w-8 text-muted-foreground mb-2" />
                    <span className="text-xs text-muted-foreground">Upload Logo</span>
                  </div>
                )}
              </div>
              <div className="flex-1 space-y-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleLogoUpload}
                  aria-label="Upload logo file"
                  className="hidden"
                />
                <Button
                  variant="outline"
                  onClick={() => fileInputRef.current?.click()}
                  className="w-full sm:w-auto"
                >
                  <Upload className="h-4 w-4 mr-2" />
                  {logoPreview ? 'Change Logo' : 'Select Image'}
                </Button>
                <p className="text-xs text-muted-foreground">
                  PNG, JPG or SVG. Max 2MB. Recommended: 200x200px
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Store Information */}
        <Card className="card-interactive">
          <CardHeader>
            <div className="flex items-center gap-2">
              <Building2 className="h-5 w-5 text-primary" />
              <CardTitle>Store Information</CardTitle>
            </div>
            <CardDescription>Details shown on receipts and throughout the app</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Store Name</Label>
              <Input
                value={form.storeName}
                onChange={(e) => setForm({ ...form, storeName: e.target.value })}
                placeholder="Enter your store name"
              />
            </div>
            <div className="space-y-2">
              <Label>Address</Label>
              <Textarea
                value={form.address}
                onChange={(e) => setForm({ ...form, address: e.target.value })}
                rows={2}
                placeholder="Store address"
              />
            </div>
            <div className="space-y-2">
              <Label>Phone</Label>
              <Input
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                placeholder="Contact number"
              />
            </div>
          </CardContent>
        </Card>

        {/* Tax & Pricing */}
        <Card className="card-interactive">
          <CardHeader>
            <div className="flex items-center gap-2">
              <Store className="h-5 w-5 text-primary" />
              <CardTitle>Tax & Pricing</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Tax Rate (%)</Label>
              <Input
                type="number"
                value={form.taxRate}
                onChange={(e) => setForm({ ...form, taxRate: parseFloat(e.target.value) || 0 })}
                min="0"
                max="100"
                step="0.1"
              />
            </div>
            <div className="space-y-2">
              <Label>Card Payment Fee (%)</Label>
              <Input
                type="number"
                value={form.cardFeePercent}
                onChange={(e) => setForm({ ...form, cardFeePercent: parseFloat(e.target.value) || 0 })}
                min="0"
                max="100"
                step="0.1"
              />
              <p className="text-sm text-muted-foreground">Additional fee applied to card payments and customer ledger payments.</p>
            </div>
            <div className="flex items-center justify-between p-4 rounded-lg bg-muted/50">
              <div>
                <Label>Allow Negative Stock</Label>
                <p className="text-sm text-muted-foreground">
                  Allow sales when stock reaches zero
                </p>
              </div>
              <Switch
                checked={form.allowNegativeStock}
                onCheckedChange={(checked) =>
                  setForm({ ...form, allowNegativeStock: checked })
                }
              />
            </div>
          </CardContent>
        </Card>

        {/* Receipt */}
        <Card className="card-interactive">
          <CardHeader>
            <CardTitle>Receipt Settings</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <Label>Footer Message</Label>
              <Textarea
                value={form.receiptFooterMessage}
                onChange={(e) =>
                  setForm({ ...form, receiptFooterMessage: e.target.value })
                }
                rows={2}
                placeholder="Thank you message for receipts"
              />
            </div>
          </CardContent>
        </Card>

        {/* Thermal printer (this computer only) */}
        <ThermalPrinterSettings storeName={form.storeName} />

        <Button onClick={handleSave} size="lg" className="w-full sm:w-auto">
          Save Store Settings
        </Button>

        {/* User Management - Admin Only */}
        {isAdmin && (
          <>
            <Separator className="my-8" />
            
            <Card className="card-interactive">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Users className="h-5 w-5 text-primary" />
                    <CardTitle>User Management</CardTitle>
                  </div>
                  <Dialog open={newCashierOpen} onOpenChange={setNewCashierOpen}>
                    <DialogTrigger asChild>
                      <Button size="sm">
                        <Plus className="h-4 w-4 mr-2" />
                        Add User
                      </Button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>Create New User</DialogTitle>
                        <DialogDescription>
                          The account works on every PC. They sign in with this email and password.
                        </DialogDescription>
                      </DialogHeader>
                      <div className="space-y-4 py-4">
                        <div className="space-y-2">
                          <Label htmlFor="newFullName">Full Name</Label>
                          <Input
                            id="newFullName"
                            value={newCashierForm.fullName}
                            onChange={(e) => setNewCashierForm({ ...newCashierForm, fullName: e.target.value })}
                            placeholder="Enter full name"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="newEmail">Email</Label>
                          <Input
                            id="newEmail"
                            type="email"
                            value={newCashierForm.email}
                            onChange={(e) => setNewCashierForm({ ...newCashierForm, email: e.target.value })}
                            placeholder="cashier@example.com"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="newPassword">Password</Label>
                          <div className="relative">
                            <Input
                              id="newPassword"
                              type={showNewPassword ? 'text' : 'password'}
                              value={newCashierForm.password}
                              onChange={(e) => setNewCashierForm({ ...newCashierForm, password: e.target.value })}
                              placeholder="Min 6 characters"
                            />
                            <button
                              type="button"
                              onClick={() => setShowNewPassword(!showNewPassword)}
                              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                            >
                              {showNewPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                            </button>
                          </div>
                        </div>
                        <div className="space-y-2">
                          <Label>Role</Label>
                          <Select
                            value={newCashierForm.role}
                            onValueChange={(v) => setNewCashierForm({ ...newCashierForm, role: v as UserRole })}
                          >
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="cashier">Cashier - POS, inventory, customers, suppliers</SelectItem>
                              <SelectItem value="admin">Admin - everything, incl. reports and settings</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="newConfirmPassword">Confirm Password</Label>
                          <Input
                            id="newConfirmPassword"
                            type="password"
                            value={newCashierForm.confirmPassword}
                            onChange={(e) => setNewCashierForm({ ...newCashierForm, confirmPassword: e.target.value })}
                            placeholder="Confirm password"
                          />
                        </div>
                      </div>
                      <DialogFooter>
                        <Button variant="outline" onClick={() => setNewCashierOpen(false)}>
                          Cancel
                        </Button>
                        <Button onClick={handleCreateCashier} disabled={userBusy}>
                          {userBusy ? 'Creating...' : 'Create Account'}
                        </Button>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>
                </div>
                <CardDescription>Staff accounts for every PC. Adding or changing users needs internet.</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {getUsers().map((u) => (
                    <div
                      key={u.email}
                      className="flex items-center justify-between p-4 rounded-lg bg-muted/30 border border-border/50"
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-gradient-to-br from-primary/80 to-purple-500/80 flex items-center justify-center text-sm font-bold text-white">
                          {u.fullName.charAt(0).toUpperCase()}
                        </div>
                        <div>
                          <p className="font-medium">{u.fullName}</p>
                          <div className="flex items-center gap-2 text-sm text-muted-foreground">
                            <Mail className="h-3 w-3" />
                            <span>{u.email}</span>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {u.email === user?.email ? (
                          <Badge variant={u.role === 'admin' ? 'default' : 'secondary'}>{u.role} (you)</Badge>
                        ) : (
                          <>
                            <Select
                              value={u.role}
                              disabled={userBusy}
                              onValueChange={(v) => void handleRoleChange(u.email, v as UserRole)}
                            >
                              <SelectTrigger className="h-8 w-28">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="cashier">Cashier</SelectItem>
                                <SelectItem value="admin">Admin</SelectItem>
                                {u.role === 'frontdesk' && <SelectItem value="frontdesk">Front desk</SelectItem>}
                              </SelectContent>
                            </Select>
                            <Button
                              variant="ghost"
                              size="icon"
                              title="Set a new password"
                              disabled={userBusy}
                              onClick={() => {
                                setPasswordForm({ password: '', confirmPassword: '' });
                                setPasswordTarget({ email: u.email, fullName: u.fullName });
                              }}
                            >
                              <KeyRound className="h-4 w-4" />
                            </Button>
                          </>
                        )}
                        {u.email !== user?.email && (
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button variant="ghost" size="icon" className="text-destructive hover:text-destructive hover:bg-destructive/10">
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>Delete User</AlertDialogTitle>
                                <AlertDialogDescription>
                                  Are you sure you want to delete {u.fullName}'s account? They will no longer be able to
                                  sign in on any PC. Their past sales are kept. This cannot be undone.
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                <AlertDialogAction
                                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                  onClick={() => void handleDeleteUser(u.email)}
                                >
                                  Delete
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            <Dialog open={!!passwordTarget} onOpenChange={(open) => !open && setPasswordTarget(null)}>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Set New Password</DialogTitle>
                  <DialogDescription>
                    For {passwordTarget?.fullName} ({passwordTarget?.email}). Tell them the new password; the old one
                    stops working.
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-4">
                  <div className="space-y-2">
                    <Label>New Password</Label>
                    <Input
                      type="password"
                      value={passwordForm.password}
                      onChange={(e) => setPasswordForm({ ...passwordForm, password: e.target.value })}
                      placeholder="Min 6 characters"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Confirm Password</Label>
                    <Input
                      type="password"
                      value={passwordForm.confirmPassword}
                      onChange={(e) => setPasswordForm({ ...passwordForm, confirmPassword: e.target.value })}
                      placeholder="Confirm password"
                    />
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setPasswordTarget(null)}>
                    Cancel
                  </Button>
                  <Button onClick={() => void handleSetPassword()} disabled={userBusy}>
                    {userBusy ? 'Saving...' : 'Set Password'}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </>
        )}

        <Separator className="my-8" />

        {/* Account Settings */}
        <Card className="card-interactive">
          <CardHeader>
            <div className="flex items-center gap-2">
              <User className="h-5 w-5 text-primary" />
              <CardTitle>Account Settings</CardTitle>
            </div>
            <CardDescription>Update your account details and password</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Full Name</Label>
                <Input
                  value={credForm.fullName}
                  onChange={(e) => setCredForm({ ...credForm, fullName: e.target.value })}
                  placeholder="Your full name"
                />
              </div>
              <div className="space-y-2">
                <Label>Email</Label>
                <Input
                  type="email"
                  value={credForm.email}
                  onChange={(e) => setCredForm({ ...credForm, email: e.target.value })}
                  placeholder="Email address"
                  disabled={!canChangeEmail}
                  title={canChangeEmail ? undefined : 'The sign-in email cannot be changed. Create a new user instead.'}
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Password Change */}
        <Card className="card-interactive">
          <CardHeader>
            <div className="flex items-center gap-2">
              <Lock className="h-5 w-5 text-primary" />
              <CardTitle>Change Password</CardTitle>
            </div>
            <CardDescription>Leave blank to keep current password</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Current Password</Label>
              <Input
                type="password"
                value={credForm.currentPassword}
                onChange={(e) =>
                  setCredForm({ ...credForm, currentPassword: e.target.value })
                }
                placeholder="Enter current password"
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>New Password</Label>
                <Input
                  type="password"
                  value={credForm.newPassword}
                  onChange={(e) =>
                    setCredForm({ ...credForm, newPassword: e.target.value })
                  }
                  placeholder="Enter new password"
                />
              </div>
              <div className="space-y-2">
                <Label>Confirm New Password</Label>
                <Input
                  type="password"
                  value={credForm.confirmPassword}
                  onChange={(e) =>
                    setCredForm({ ...credForm, confirmPassword: e.target.value })
                  }
                  placeholder="Confirm new password"
                />
              </div>
            </div>
          </CardContent>
        </Card>

        <Button onClick={() => void handleCredentialsSave()} variant="secondary" size="lg" className="w-full sm:w-auto">
          Update Account
        </Button>
      </div>
    </div>
  );
}
