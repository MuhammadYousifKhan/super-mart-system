import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { User, UserRole, UserCredentials } from '@/types/pos';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<boolean>;
  logout: () => void;
  isAdmin: boolean;
  updateCredentials: (oldEmail: string, newCredentials: Partial<UserCredentials>) => boolean;
  getUsers: () => UserCredentials[];
  createUser: (credentials: Omit<UserCredentials, 'role'> & { role?: UserRole }) => boolean;
  deleteUser: (email: string) => boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [dbUsers, setDbUsers] = useState<UserCredentials[]>([]);

  useEffect(() => {
    // Check active sessions and sets the user
    const checkSession = async () => {
      setIsLoading(true);
      try {
        const { data: { session }, error } = await supabase.auth.getSession();
        
        if (error) {
          console.error("Auth session error:", error);
          setIsLoading(false);
          return;
        }

        if (session?.user) {
          await loadUserProfile(session.user.id, session.user.email!);
          if (session.user.role === 'admin') {
            await fetchAllUsers();
          }
        } else {
          setIsLoading(false);
        }
      } catch (err) {
        console.error("Failed to check session. Check network or Supabase URL:", err);
        setIsLoading(false);
      }
    };
    
    checkSession();

    // Listen for auth changes (Login, Logout)
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, session) => {
      if (session?.user) {
        await loadUserProfile(session.user.id, session.user.email!);
      } else {
        setUser(null);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const loadUserProfile = async (userId: string, email: string) => {
    try {
      // Get user role from our new table
      const { data: roleData, error } = await supabase
        .from('user_roles')
        .select('role, full_name')
        .eq('user_id', userId)
        .single();

      if (error) {
        throw error;
      }

      if (roleData) {
        setUser({
          id: userId,
          email: email,
          fullName: roleData.full_name || email.split('@')[0],
          role: roleData.role as UserRole,
        });
        if (roleData.role === 'admin') fetchAllUsers();
      } else {
        // Fallback if role missing
        setUser({
          id: userId,
          email: email,
          fullName: email.split('@')[0],
          role: 'cashier',
        });
      }
    } catch (err) {
      console.error("Failed to load user profile:", err);
      // Fallback if request fails (e.g., DNS error after successfully caching session)
      setUser({
        id: userId,
        email: email,
        fullName: email.split('@')[0],
        role: 'cashier',
      });
    } finally {
      setIsLoading(false);
    }
  };

  const fetchAllUsers = async () => {
    try {
      const { data, error } = await supabase.from('user_roles').select('email, role, full_name');
      if (data) {
        setDbUsers(data.map(d => ({
          email: d.email,
          password: '***', // We do not return actual passwords from Supabase
          fullName: d.full_name,
          role: d.role as UserRole
        })));
      }
    } catch (err) {
      console.error("Failed to fetch all users:", err);
    }
  };

  const login = async (email: string, password: string): Promise<boolean> => {
    setIsLoading(true);
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    
    setIsLoading(false);
    if (error) {
      toast.error(error.message);
      return false;
    }
    return true;
  };

  const logout = async () => {
    await supabase.auth.signOut();
    setUser(null);
  };

  // --------------------------------------------------------
  // NOTE: User Management (Create/Update/Delete) via UI requires a Supabase Backend.
  // We mock the local state updates so the UI doesn't crash, but tell the user to use 
  // the Supabase Dashboard for true management.
  // --------------------------------------------------------

  const updateCredentials = (oldEmail: string, newCredentials: Partial<UserCredentials>): boolean => {
    toast.error("Multi-user setup requires password resets to be handled via Supabase Dashboard or authenticated emails.");
    return false;
  };

  const getUsers = () => dbUsers;

  const createUser = (credentials: Omit<UserCredentials, 'role'> & { role?: UserRole }): boolean => {
    toast.info("With real Authentication enabled, you must create edge workers or use the Supabase Dashboard to safely provision new user accounts without losing your current admin session.");
    return false;
  };

  const deleteUser = (email: string): boolean => {
    toast.error("User deletion must be done from Supabase Auth Dashboard in production.");
    return false;
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoading,
        login,
        logout,
        isAdmin: user?.role === 'admin',
        updateCredentials,
        getUsers,
        createUser,
        deleteUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
}
