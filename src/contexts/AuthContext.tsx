import React, { useState, useEffect, useRef, ReactNode } from 'react';
import { User, UserRole, UserCredentials } from '@/types/pos';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';
import { AuthContext } from './AuthContextValue';

export interface AuthContextType {
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

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, timeoutMessage: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      window.setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
    }),
  ]);
}

const SESSION_REQUEST_TIMEOUT_MS = 3000;
const PROFILE_REQUEST_TIMEOUT_MS = 3000;
const LOGIN_REQUEST_TIMEOUT_MS = 5000;

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [dbUsers, setDbUsers] = useState<UserCredentials[]>([]);
  const hasLoggedInitTimeout = useRef(false);
  const hasLoggedSessionTimeout = useRef(false);
  const hasLoggedProfileTimeout = useRef(false);

  useEffect(() => {
    const initTimeout = window.setTimeout(() => {
      if (!hasLoggedInitTimeout.current) {
        console.warn('Auth initialization timed out. Continuing without blocking UI.');
        hasLoggedInitTimeout.current = true;
      }
      setIsLoading(false);
    }, 6000);

    // Check active sessions and sets the user
    const checkSession = async () => {
      setIsLoading(true);
      try {
        const { data: { session }, error } = await withTimeout(
          supabase.auth.getSession(),
          SESSION_REQUEST_TIMEOUT_MS,
          'Auth session request timed out'
        );
        
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
        const message = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();
        if (message.includes('timed out')) {
          if (!hasLoggedSessionTimeout.current) {
            console.warn('Auth session check timed out. Showing UI without blocking.');
            hasLoggedSessionTimeout.current = true;
          }
        } else {
          console.error("Failed to check session. Check network or Supabase URL:", err);
        }
        setIsLoading(false);
      } finally {
        window.clearTimeout(initTimeout);
      }
    };
    
    checkSession();

    // Listen for auth changes (Login, Logout)
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, session) => {
      if (session?.user) {
        await loadUserProfile(session.user.id, session.user.email!);
      } else {
        setUser(null);
        setIsLoading(false);
      }
    });

    return () => {
      window.clearTimeout(initTimeout);
      subscription.unsubscribe();
    };
  }, []);

  const loadUserProfile = async (userId: string, email: string) => {
    try {
      // Get user role from our new table
      const { data: roleData, error } = await withTimeout(
        supabase
          .from('user_roles')
          .select('role, full_name')
          .eq('user_id', userId)
          .single(),
        PROFILE_REQUEST_TIMEOUT_MS,
        'User profile request timed out'
      );

      if (error) {
        const message = (error.message || '').toLowerCase();
        const isSchemaOrServerIssue =
          message.includes('schema cache') ||
          message.includes('could not find the table') ||
          message.includes('relation') ||
          !!error.code?.startsWith('5');

        if (isSchemaOrServerIssue) {
          console.warn('User roles table is unavailable. Falling back to cashier role.');
        } else {
          console.error('Failed to fetch user role:', error);
        }

        setUser({
          id: userId,
          email: email,
          fullName: email.split('@')[0],
          role: 'cashier',
        });
        return;
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
      const message = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();
      if (message.includes('timed out')) {
        if (!hasLoggedProfileTimeout.current) {
          console.warn('User profile fetch timed out. Using fallback role.');
          hasLoggedProfileTimeout.current = true;
        }
      } else {
        console.error("Failed to load user profile:", err);
      }
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
    try {
      const { data, error } = await withTimeout(
        supabase.auth.signInWithPassword({
          email,
          password,
        }),
        LOGIN_REQUEST_TIMEOUT_MS,
        'Login request timed out'
      );

      if (error) {
        toast.error(error.message);
        return false;
      }

      // Optimistic local user so route transition is immediate.
      if (data?.user) {
        setUser({
          id: data.user.id,
          email: data.user.email || email,
          fullName: (data.user.email || email).split('@')[0],
          role: 'cashier',
        });
      }

      return true;
    } catch (err) {
      const rawMessage =
        err instanceof Error
          ? err.message
          : typeof err === 'string'
            ? err
            : JSON.stringify(err);
      const message = rawMessage.toLowerCase();
      const isNetworkError =
        message.includes('failed to fetch') ||
        message.includes('networkerror') ||
        message.includes('err_name_not_resolved') ||
        message.includes('name_not_resolved');

      if (isNetworkError) {
        toast.error('Unable to reach Supabase. Verify VITE_SUPABASE_URL and your internet connection.');
      } else if (message.includes('timed out')) {
        toast.error('Login timed out. Please try again.');
      } else {
        toast.error('Login failed. Please try again.');
      }
      return false;
    } finally {
      setIsLoading(false);
    }
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

