import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { HashRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "@/contexts/AuthContext";
import { useAuth } from "@/contexts/useAuth";
import { StoreProvider } from "@/contexts/StoreContext";
import { ThemeProvider } from "@/contexts/ThemeContext";
import { AppLayout } from "@/components/layout/AppLayout";
import Login from "./pages/Login";
import POSTerminal from "./pages/POSTerminal";
import Inventory from "./pages/Inventory";
import Analytics from "./pages/Analytics";
import Customers from "./pages/Customers";
import Suppliers from "./pages/Suppliers";
import Settings from "./pages/Settings";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

function ProtectedRoute({ children, adminOnly = false }: { children: React.ReactNode; adminOnly?: boolean }) {
  const { user, isLoading, isAdmin } = useAuth();
  
  if (isLoading) return <div className="flex items-center justify-center h-screen">Loading...</div>;
  if (!user) return <Navigate to="/login" replace />;
  if (adminOnly && !isAdmin) return <Navigate to="/pos" replace />;
  
  return <>{children}</>;
}

function AppRoutes() {
  const { user } = useAuth();
  
  return (
    <Routes>
      <Route path="/login" element={user ? <Navigate to="/pos" replace /> : <Login />} />
      <Route path="/" element={<Navigate to="/pos" replace />} />
      <Route path="/pos" element={<ProtectedRoute><AppLayout><POSTerminal /></AppLayout></ProtectedRoute>} />
      <Route path="/inventory" element={<ProtectedRoute><AppLayout><Inventory /></AppLayout></ProtectedRoute>} />
      <Route path="/customers" element={<ProtectedRoute><AppLayout><Customers /></AppLayout></ProtectedRoute>} />
      <Route path="/suppliers" element={<ProtectedRoute><AppLayout><Suppliers /></AppLayout></ProtectedRoute>} />
      <Route path="/analytics" element={<ProtectedRoute adminOnly><AppLayout><Analytics /></AppLayout></ProtectedRoute>} />
      <Route path="/settings" element={<ProtectedRoute adminOnly><AppLayout><Settings /></AppLayout></ProtectedRoute>} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <ThemeProvider>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <HashRouter
          future={{
            v7_startTransition: true,
            v7_relativeSplatPath: true,
          }}
        >
          <AuthProvider>
            <StoreProvider>
              <AppRoutes />
            </StoreProvider>
          </AuthProvider>
        </HashRouter>
      </TooltipProvider>
    </ThemeProvider>
  </QueryClientProvider>
);

export default App;
