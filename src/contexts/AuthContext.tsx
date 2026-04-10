import React, { useState, useEffect, useRef, ReactNode } from 'react';
import { User, UserRole, UserCredentials } from '@/types/pos';
import type { User as SupabaseAuthUser } from '@supabase/supabase-js';
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

// ============================================================
// Local / Demo Mode
// Activated automatically when VITE_SUPABASE_URL is not set.
// ============================================================
const IS_LOCAL_MODE = !import.meta.env.VITE_SUPABASE_URL;

const DEFAULT_LOCAL_USERS: UserCredentials[] = [
  { email: 'admin@pos.com', password: 'password', fullName: 'Admin User', role: 'admin' },
  { email: 'cashier@pos.com', password: 'password', fullName: 'Cashier User', role: 'cashier' },
  { email: 'frontdesk@pos.com', password: 'password', fullName: 'Front Desk', role: 'frontdesk' },
];

function getLocalUsers(): UserCredentials[] {
  try {
    const stored = localStorage.getItem('pos_local_users');
    if (stored) return JSON.parse(stored);
  } catch { /* ignore */ }
  return DEFAULT_LOCAL_USERS;
}

function saveLocalUsers(users: UserCredentials[]) {
  localStorage.setItem('pos_local_users', JSON.stringify(users));
}

// ============================================================
// Supabase helpers (unchanged, used only when Supabase is configured)
// ============================================================

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

function resolveDisplayNameFromAuthUser(authUser: SupabaseAuthUser | null, fallbackEmail: string): string {
  const metadata = authUser?.user_metadata || {};
  return (
    metadata.full_name ||
    metadata.fullName ||
    metadata.name ||
    metadata.display_name ||
    fallbackEmail.split('@')[0]
  );
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [dbUsers, setDbUsers] = useState<UserCredentials[]>([]);
  const hasLoggedProfileTimeout = useRef(false);

  // ----------------------------------------------------------
  // LOCAL MODE: simple credential check against localStorage
  // ----------------------------------------------------------
  useEffect(() => {
    if (IS_LOCAL_MODE) {
      console.info(
        '%c[LOCAL MODE] Supabase is not configured. Using demo accounts.\n' +
        'Login with: admin@pos.com / password  (or cashier@pos.com / frontdesk@pos.com)',
        'color: #f59e0b; font-weight: bold;'
      );

      // Restore session from localStorage
      const savedSession = localStorage.getItem('pos_local_session');
      if (savedSession) {
        try {
          setUser(JSON.parse(savedSession));
        } catch { /* ignore bad data */ }
      }
      setIsLoading(false);
      return;
    }

    // ----------------------------------------------------------
    // SUPABASE MODE (original logic)
    // ----------------------------------------------------------
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
          await loadUserProfile(session.user.id, session.user.email!, session.user);
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

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, session) => {
      if (session?.user) {
        await loadUserProfile(session.user.id, session.user.email!, session.user);
      } else {
        setUser(null);
        setIsLoading(false);
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  const loadUserProfile = async (userId: string, email: string, authUser: SupabaseAuthUser | null = null) => {
    try {
      const { data: roleByUserId, error: byUserIdError } = await withTimeout(
        supabase.from('user_roles').select('*').eq('user_id', userId).maybeSingle(),
        PROFILE_REQUEST_TIMEOUT_MS,
        'User role query by user_id timed out'
      );

      if (byUserIdError) {
        const message = (byUserIdError.message || '').toLowerCase();
        const isSchemaOrServerIssue =
          message.includes('schema cache') ||
          message.includes('could not find the table') ||
          message.includes('relation') ||
          !!byUserIdError.code?.startsWith('5');

        if (isSchemaOrServerIssue) {
          console.warn('User roles table is unavailable. Falling back to cashier role.');
          toast.warning('User roles table not found. Defaulting to Cashier. Run SUPABASE_SETUP.sql (including user_roles).');
        } else {
          console.error('Failed to fetch user role by user_id:', byUserIdError);
          toast.warning('Could not load your role. Defaulting to Cashier. Check RLS + user_roles row.');
        }

        setUser({
          id: userId,
          email,
          fullName: resolveDisplayNameFromAuthUser(authUser, email),
          role: 'cashier',
        });
        return;
      }

      let resolvedRoleRow: UserRoleRow | null = (roleByUserId as UserRoleRow | null) || null;

      if (!resolvedRoleRow) {
        const { data: roleByEmail, error: byEmailError } = await withTimeout(
          supabase.from('user_roles').select('*').eq('email', email).maybeSingle(),
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
            toast.warning('User roles table not found. Defaulting to Cashier. Run SUPABASE_SETUP.sql (including user_roles).');
          } else {
            console.error('Failed to fetch user role by email fallback:', byEmailError);
            toast.warning('Could not load your role. Defaulting to Cashier. Check RLS + user_roles row.');
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
          password: '***',
          fullName: d.full_name,
          role: d.role as UserRole
        })));
      }
    } catch (err) {
      console.error("Failed to fetch all users:", err);
    }
  };

  // ----------------------------------------------------------
  // Login
  // ----------------------------------------------------------
  const login = async (email: string, password: string): Promise<boolean> => {
    setIsLoading(true);

    // LOCAL MODE
    if (IS_LOCAL_MODE) {
      const users = getLocalUsers();
      const match = users.find(
        u => u.email.toLowerCase() === email.toLowerCase() && u.password === password
      );

      if (match) {
        const localUser: User = {
          id: `local-${match.email}`,
          email: match.email,
          fullName: match.fullName,
          role: match.role,
        };
        setUser(localUser);
        localStorage.setItem('pos_local_session', JSON.stringify(localUser));
        setIsLoading(false);
        return true;
      } else {
        toast.error('Invalid email or password');
        setIsLoading(false);
        return false;
      }
    }

    // SUPABASE MODE
    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });

      if (error) {
        toast.error(error.message);
        return false;
      }

      if (data?.user) {
        await loadUserProfile(data.user.id, data.user.email || email, data.user);
      } else {
        toast.error('Login succeeded but no user session was returned.');
        return false;
      }

      return true;
    } catch (err) {
      const rawMessage =
        err instanceof Error ? err.message : typeof err === 'string' ? err : JSON.stringify(err);
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

  // ----------------------------------------------------------
  // Logout
  // ----------------------------------------------------------
  const logout = async () => {
    if (IS_LOCAL_MODE) {
      localStorage.removeItem('pos_local_session');
      setUser(null);
      return;
    }
    await supabase.auth.signOut();
    setUser(null);
  };

  // ----------------------------------------------------------
  // User management
  // ----------------------------------------------------------
  const updateCredentials = (oldEmail: string, newCredentials: Partial<UserCredentials>): boolean => {
    if (IS_LOCAL_MODE) {
      const users = getLocalUsers();
      const idx = users.findIndex(u => u.email.toLowerCase() === oldEmail.toLowerCase());
      if (idx === -1) { toast.error('User not found'); return false; }
      users[idx] = { ...users[idx], ...newCredentials };
      saveLocalUsers(users);
      setDbUsers([...users]);
      toast.success('Credentials updated (local mode)');
      return true;
    }
    toast.error("Multi-user setup requires password resets to be handled via Supabase Dashboard or authenticated emails.");
    return false;
  };

  const getUsers = (): UserCredentials[] => {
    if (IS_LOCAL_MODE) return getLocalUsers();
    return dbUsers;
  };

  const createUser = (credentials: Omit<UserCredentials, 'role'> & { role?: UserRole }): boolean => {
    if (IS_LOCAL_MODE) {
      const users = getLocalUsers();
      if (users.find(u => u.email.toLowerCase() === credentials.email.toLowerCase())) {
        toast.error('A user with this email already exists');
        return false;
      }
      const newUser: UserCredentials = {
        email: credentials.email,
        password: credentials.password,
        fullName: credentials.fullName,
        role: credentials.role || 'cashier',
      };
      users.push(newUser);
      saveLocalUsers(users);
      setDbUsers([...users]);
      toast.success('User created (local mode)');
      return true;
    }
    toast.info("With real Authentication enabled, you must create edge workers or use the Supabase Dashboard to safely provision new user accounts without losing your current admin session.");
    return false;
  };

  const deleteUser = (email: string): boolean => {
    if (IS_LOCAL_MODE) {
      let users = getLocalUsers();
      users = users.filter(u => u.email.toLowerCase() !== email.toLowerCase());
      saveLocalUsers(users);
      setDbUsers([...users]);
      toast.success('User deleted (local mode)');
      return true;
    }
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


