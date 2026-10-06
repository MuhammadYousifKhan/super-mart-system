import { NavLink, useLocation } from 'react-router-dom';
import { useAuth } from '@/contexts/useAuth';
import { useStore } from '@/contexts/useStore';
import { cn } from '@/lib/utils';
import { useState, useEffect } from 'react';
import {
  LayoutDashboard,
  ShoppingCart,
  Package,
  Truck,
  BarChart3,
  Settings,
  LogOut,
  Store,
  Menu,
  X,
  Users,
  Sun,
  Moon,
  CloudUpload,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useTheme } from '@/contexts/ThemeContext';

const adminNavItems = [
  { path: '/pos', icon: ShoppingCart, label: 'POS Terminal' },
  { path: '/inventory', icon: Package, label: 'Inventory' },
  { path: '/customers', icon: Users, label: 'Customers' },
  { path: '/suppliers', icon: Truck, label: 'Suppliers' },
  { path: '/analytics', icon: BarChart3, label: 'Analytics' },
  { path: '/settings', icon: Settings, label: 'Settings' },
];

const cashierNavItems = [
  { path: '/pos', icon: ShoppingCart, label: 'POS Terminal' },
  { path: '/inventory', icon: Package, label: 'Inventory' },
  { path: '/customers', icon: Users, label: 'Customers' },
  { path: '/suppliers', icon: Truck, label: 'Suppliers' },
];

export function Sidebar() {
  const { user, logout, isAdmin } = useAuth();
  const { settings, manualSync } = useStore();
  const { theme, toggle } = useTheme();
  const location = useLocation();
  const [isMobileOpen, setIsMobileOpen] = useState(false);

  const navItems = isAdmin ? adminNavItems : cashierNavItems;

  // Close sidebar when route changes on mobile
  useEffect(() => {
    setIsMobileOpen(false);
  }, [location.pathname]);

  // Close sidebar when clicking outside on mobile
  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth >= 768) {
        setIsMobileOpen(false);
      }
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  return (
    <>
      {/* Mobile Header Bar */}
      <div className="md:hidden fixed top-0 left-0 right-0 z-50 glass-sidebar border-b border-border/50 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          {settings.logo ? (
            <div className="w-8 h-8 rounded-lg overflow-hidden bg-sidebar-accent/50 flex items-center justify-center border border-border/50">
              <img
                src={settings.logo}
                alt={settings.storeName}
                className="w-full h-full object-contain"
              />
            </div>
          ) : (
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-primary to-primary/60 flex items-center justify-center shadow-[0_0_15px_hsl(var(--primary)/0.5)]">
              <Store className="w-4 h-4 text-primary-foreground" />
            </div>
          )}
          <h1 className="font-bold text-base text-white truncate">
            {settings.storeName || 'Point of Sale'}
          </h1>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="text-sidebar-foreground hover:bg-sidebar-accent/50 p-2"
          onClick={() => setIsMobileOpen(!isMobileOpen)}
        >
          {isMobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
        </Button>
      </div>

      {/* Mobile Overlay */}
      {isMobileOpen && (
        <div
          className="md:hidden fixed inset-0 bg-black/60 backdrop-blur-sm z-40"
          onClick={() => setIsMobileOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside className={cn(
        "glass-sidebar text-sidebar-foreground flex flex-col h-full relative z-50 transition-transform duration-300",
        // Mobile: fixed positioning with slide animation
        "fixed md:relative",
        "w-72 md:w-64",
        "top-0 left-0",
        isMobileOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"
      )}>
      {/* Logo/Brand Section */}
      <div className="p-6 border-b border-border/50">
        <div className="flex items-center gap-3">
          {settings.logo ? (
            <div className="w-10 h-10 rounded-xl overflow-hidden bg-sidebar-accent/50 backdrop-blur-sm flex items-center justify-center border border-border/50 shadow-inner">
              <img
                src={settings.logo}
                alt={settings.storeName}
                className="w-full h-full object-contain"
              />
            </div>
          ) : (
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary to-primary/60 flex items-center justify-center shadow-[0_0_15px_hsl(var(--primary)/0.5)]">
              <Store className="w-5 h-5 text-primary-foreground" />
            </div>
          )}
          <div className="flex-1 min-w-0">
            <h1 className="font-bold text-lg tracking-tight text-sidebar-foreground truncate">
              {settings.storeName || 'Point of Sale'}
            </h1>
            <div className="flex items-center gap-1.5">
              <div className="w-1.5 h-1.5 rounded-full bg-success animate-pulse" />
              <p className="text-xs text-sidebar-foreground/70 capitalize font-medium">
                {user?.role} Mode
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 p-4 space-y-2">
        {navItems.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all duration-300 relative overflow-hidden group',
                isActive
                  ? 'text-primary bg-primary/10 border border-primary/20 shadow-[0_0_20px_hsl(var(--primary)/0.15)]'
                  : 'text-sidebar-foreground/80 hover:text-sidebar-foreground hover:bg-sidebar-accent border border-transparent'
              )
            }
          >
            {({ isActive }) => (
              <>
                <item.icon className={cn("w-5 h-5 transition-transform duration-300 group-hover:scale-110", isActive && "animate-pulse")} />
                <span className="relative z-10">{item.label}</span>
                {isActive && <div className="absolute inset-0 bg-gradient-to-r from-primary/10 to-transparent opacity-50" />}
              </>
            )}
          </NavLink>
        ))}
      </nav>

      {/* User Section */}
      <div className="p-4 border-t border-border/50 bg-sidebar-accent/30">
        <div className="flex items-center gap-3 mb-4 px-2">
          <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-primary/80 to-purple-500/80 flex items-center justify-center text-xs font-bold text-white shadow-lg">
            {user?.fullName?.charAt(0)}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-sidebar-foreground truncate">
              {user?.fullName}
            </p>
            <p className="text-xs text-sidebar-foreground/60 truncate">{user?.email}</p>
          </div>
        </div>
        <div className="space-y-2">
          <Button
            variant="ghost"
            className="w-full justify-start text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent transition-all border border-transparent hover:border-border/30 rounded-xl"
            onClick={() => void manualSync()}
          >
            <CloudUpload className="w-4 h-4 mr-3" />
            Sync to Cloud
          </Button>

          <Button
            variant="ghost"
            className="w-full justify-start text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent transition-all border border-transparent hover:border-border/30 rounded-xl"
            onClick={toggle}
          >
            {theme === 'dark' ? <Sun className="w-4 h-4 mr-3" /> : <Moon className="w-4 h-4 mr-3" />}
            {theme === 'dark' ? 'Light Mode' : 'Dark Mode'}
          </Button>

          <Button
            variant="ghost"
            className="w-full justify-start text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent transition-all border border-transparent hover:border-border/30 rounded-xl"
            onClick={logout}
          >
            <LogOut className="w-4 h-4 mr-3" />
            Sign Out
          </Button>
        </div>
      </div>
    </aside>
    </>
  );
}
