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

function withTimeout<T>(promise: PromiseLike<T>, timeoutMs: number, timeoutMessage: string): Promise<T> {
  return Promise.race([
    Promise.resolve(promise),
    new Promise<T>((_, reject) => {
      window.setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
    }),
  ]);
}

const SESSION_REQUEST_TIMEOUT_MS = 15000;
const PROFILE_REQUEST_TIMEOUT_MS = 10000;

type UserRoleRow = {
  role?: string | null;
  full_name?: string | null;
  fullName?: string | null;
  name?: string | null;
  email?: string | null;
  user_id?: string | null;
  userId?: string | null;
};

function normalizeUserRole(role: string | null | undefined): UserRole {
  const normalized = (role || '').trim().toLowerCase();
  if (normalized === 'admin') return 'admin';
  if (normalized === 'frontdesk') return 'frontdesk';
  return 'cashier';
}

function resolveDisplayName(row: UserRoleRow | null, fallbackEmail: string): string {
  return row?.full_name || row?.fullName || row?.name || fallbackEmail.split('@')[0];
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [dbUsers, setDbUsers] = useState<UserCredentials[]>([]);
  const hasLoggedProfileTimeout = useRef(false);

  useEffect(() => {
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
        const message = err instanceof Error ? err.message : String(err);
        console.error("Failed to check session. Check network or Supabase URL:", message);
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
        setIsLoading(false);
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  const loadUserProfile = async (userId: string, email: string) => {
    try {
      // Primary lookup by authenticated user id
      const { data: roleByUserId, error: byUserIdError } = await withTimeout(
        supabase
          .from('user_roles')
          .select('*')
          .eq('user_id', userId)
          .maybeSingle(),
        PROFILE_REQUEST_TIMEOUT_MS,
        'User role query by user_id timed out'
      );

      let resolvedRoleRow: UserRoleRow | null = (roleByUserId as UserRoleRow | null) || null;

      // Fallback lookup by email in case existing rows were inserted without correct user_id mapping
      if (!resolvedRoleRow) {
        const { data: roleByEmail, error: byEmailError } = await withTimeout(
          supabase
            .from('user_roles')
            .select('*')
            .eq('email', email)
            .maybeSingle(),
          PROFILE_REQUEST_TIMEOUT_MS,
          'User role query by email timed out'
        );

        if (byEmailError) {
          const message = (byEmailError.message || '').toLowerCase();
          const isSchemaOrServerIssue =
            message.includes('schema cache') ||
            message.includes('could not find the table') ||
            message.includes('relation') ||
            !!byEmailError.code?.startsWith('5');

          if (isSchemaOrServerIssue) {
            console.warn('User roles table is unavailable. Falling back to cashier role.');
          } else {
            console.error('Failed to fetch user role by email fallback:', byEmailError);
          }

          setUser({
            id: userId,
            email,
            fullName: email.split('@')[0],
            role: 'cashier',
          });
          return;
        }

        resolvedRoleRow = (roleByEmail as UserRoleRow | null) || null;
      }

      if (byUserIdError) {
        const message = (byUserIdError.message || '').toLowerCase();
        const isSchemaOrServerIssue =
          message.includes('schema cache') ||
          message.includes('could not find the table') ||
          message.includes('relation') ||
          !!byUserIdError.code?.startsWith('5');

        if (isSchemaOrServerIssue) {
          console.warn('User roles table is unavailable. Falling back to cashier role.');
        } else {
          console.error('Failed to fetch user role by user_id:', byUserIdError);
        }

        setUser({
          id: userId,
          email,
          fullName: email.split('@')[0],
          role: 'cashier',
        });
        return;
      }

      if (resolvedRoleRow) {
        const resolvedRole = normalizeUserRole(resolvedRoleRow.role);
        setUser({
          id: userId,
          email,
          fullName: resolveDisplayName(resolvedRoleRow, email),
          role: resolvedRole,
        });
        if (resolvedRole === 'admin') fetchAllUsers();
      } else {
        console.warn('No role row found in user_roles for this login. Falling back to cashier role.');
        setUser({
          id: userId,
          email,
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
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) {
        toast.error(error.message);
        return false;
      }

      // Resolve role from user_roles immediately after auth to avoid temporary cashier role.
      if (data?.user) {
        await loadUserProfile(data.user.id, data.user.email || email);
      } else {
        toast.error('Login succeeded but no user session was returned.');
        return false;
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

