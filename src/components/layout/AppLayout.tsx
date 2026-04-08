import { ReactNode } from 'react';
import { useAuth } from '@/contexts/useAuth';
import { Sidebar } from './Sidebar';

interface AppLayoutProps {
  children: ReactNode;
}

export function AppLayout({ children }: AppLayoutProps) {
  const { user } = useAuth();

  if (!user) {
    return <>{children}</>;
  }

  return (
    <div className="flex h-screen overflow-hidden bg-background relative">
      {/* Ambient Background Glow */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-primary/20 via-background to-background pointer-events-none" />
      
      <Sidebar />
      <main className="flex-1 overflow-auto relative z-10 pt-14 md:pt-0">
        {children}
      </main>
    </div>
  );
}
