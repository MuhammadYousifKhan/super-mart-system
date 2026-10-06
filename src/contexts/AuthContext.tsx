import React, { useState, useEffect, useRef, ReactNode, useCallback } from 'react';
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
  resetPassword: (email: string) => Promise<boolean>;
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
// Saved profile
// The signed-in user is remembered on this PC until they sign out, so the app can
// reopen (even without internet) without asking the server who they are.
// ============================================================
const CACHED_PROFILE_KEY = 'pos_cached_profile_v1';

function readCachedProfile(): User | null {
  try {
    const raw = localStorage.getItem(CACHED_PROFILE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && parsed.id && parsed.email && parsed.role ? (parsed as User) : null;
  } catch {
    return null;
  }
}

function writeCachedProfile(user: User) {
  try {
    localStorage.setItem(CACHED_PROFILE_KEY, JSON.stringify(user));
  } catch { /* storage full or blocked: the app still works for this run */ }
}

function clearCachedProfile() {
  try {
    localStorage.removeItem(CACHED_PROFILE_KEY);
  } catch { /* ignore */ }
}

function cachedRoleFor(userId: string): UserRole | null {
  const cached = readCachedProfile();
  return cached && cached.id === userId ? cached.role : null;
}

/** Removes the Supabase session from this PC (signOut cannot do it while offline). */
function clearStoredSupabaseSession() {
  try {
    Object.keys(localStorage)
      .filter((key) => key.startsWith('sb-') && key.endsWith('-auth-token'))
      .forEach((key) => localStorage.removeItem(key));
  } catch { /* ignore */ }
}

function isNetworkLikeError(err: unknown): boolean {
  const name = (err as { name?: string } | null)?.name ?? '';
  const status = (err as { status?: number } | null)?.status;
  const message = (err instanceof Error ? err.message : typeof err === 'string' ? err : JSON.stringify(err ?? '')).toLowerCase();
  return (
    name === 'AuthRetryableFetchError' ||
    status === 0 ||
    message.includes('failed to fetch') ||
    message.includes('networkerror') ||
    message.includes('network request failed') ||
    message.includes('load failed') ||
    message.includes('timed out') ||
    message.includes('name_not_resolved') ||
    message.includes('err_internet_disconnected')
  );
}

// ============================================================
// Supabase helpers (used only when Supabase is configured)
// ============================================================

function withTimeout<T>(promise: PromiseLike<T>, timeoutMs: number, timeoutMessage: string): Promise<T> {
  return Promise.race([
    Promise.resolve(promise),
    new Promise<T>((_, reject) => {
      window.setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
    }),
  ]);
}

const SESSION_REQUEST_TIMEOUT_MS = 8000;
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
  const currentUserRef = useRef<User | null>(null);

  // ----------------------------------------------------------
  // LOCAL MODE: simple credential check against localStorage
  // ----------------------------------------------------------
  useEffect(() => {
    currentUserRef.current = user;
  }, [user]);

  const fetchAllUsers = useCallback(async () => {
    if (IS_LOCAL_MODE) return;
    try {
      const { data } = await supabase.from('user_roles').select('email, role, full_name');
      if (data) {
        setDbUsers(
          data.map((d) => ({
            email: d.email,
            password: '***',
            fullName: d.full_name,
            role: d.role as UserRole,
          }))
        );
      }
    } catch (err) {
      console.error('Failed to fetch all users:', err);
    }
  }, []);

  const applyUser = useCallback((next: User) => {
    setUser(next);
    writeCachedProfile(next);
  }, []);

  const loadUserProfile = useCallback(async (userId: string, email: string, authUser: SupabaseAuthUser | null = null) => {
    try {
      // Falls back to the role saved at the last successful sign-in, so an admin who is offline
      // is not demoted to cashier just because the role lookup could not reach the server.
      const lastKnownRoleForThisUser: UserRole | null =
        currentUserRef.current?.id === userId ? currentUserRef.current.role : cachedRoleFor(userId);

      // Primary lookup by authenticated user id
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

        applyUser({
          id: userId,
          email,
          fullName: resolveDisplayNameFromAuthUser(authUser, email),
          role: lastKnownRoleForThisUser ?? 'cashier',
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

          applyUser({
            id: userId,
            email,
            fullName: resolveDisplayNameFromAuthUser(authUser, email),
            role: lastKnownRoleForThisUser ?? 'cashier',
          });
          return;
        }

        resolvedRoleRow = (roleByEmail as UserRoleRow | null) || null;
      }


      if (resolvedRoleRow) {
        const resolvedRole = normalizeUserRole(resolvedRoleRow.role);
        applyUser({
          id: userId,
          email,
          fullName: resolveDisplayName(resolvedRoleRow, email),
          role: resolvedRole,
        });
        if (resolvedRole === 'admin') fetchAllUsers();
      } else {
        console.warn('No role row found in user_roles for this login. Falling back to cashier role.');
        applyUser({
          id: userId,
          email,
          fullName: resolveDisplayNameFromAuthUser(authUser, email),
          role: lastKnownRoleForThisUser ?? 'cashier',
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
      applyUser({
        id: userId,
        email: email,
        fullName: resolveDisplayNameFromAuthUser(authUser, email),
        role: (currentUserRef.current?.id === userId ? currentUserRef.current.role : cachedRoleFor(userId)) ?? 'cashier',
      });
    } finally {
      setIsLoading(false);
    }
  }, [fetchAllUsers, applyUser]);

  useEffect(() => {
    if (IS_LOCAL_MODE) {
      console.info(
        '%c[LOCAL MODE] Supabase is not configured. Using demo accounts.\n' +
        'Login with: admin@pos.com / password  (or cashier@pos.com / frontdesk@pos.com)',
        'color: #f59e0b; font-weight: bold;'
      );

      const savedSession = localStorage.getItem('pos_local_session');
      if (savedSession) {
        try {
          setUser(JSON.parse(savedSession));
        } catch { /* ignore bad data */ }
      }

      setIsLoading(false);
      return;
    }

    // Open straight from the saved profile (works offline); the checks below confirm it.
    const cached = readCachedProfile();
    if (cached) {
      setUser(cached);
      setIsLoading(false);
    }

    const endSession = () => {
      clearCachedProfile();
      clearStoredSupabaseSession();
      setUser(null);
      setIsLoading(false);
    };

    const checkSession = async () => {
      if (!cached) setIsLoading(true);
      try {
        const { data: { session }, error } = await withTimeout(
          supabase.auth.getSession(),
          SESSION_REQUEST_TIMEOUT_MS,
          'Auth session request timed out'
        );

        if (error) {
          if (isNetworkLikeError(error) || !navigator.onLine) {
            // Can't reach the server: stay signed in from the saved profile.
            setIsLoading(false);
            return;
          }
          // The server rejected the stored session (e.g. revoked): sign out for real.
          console.error('Auth session error:', error);
          endSession();
          return;
        }

        if (session?.user) {
          await loadUserProfile(session.user.id, session.user.email!, session.user);
        } else if (cached && !navigator.onLine) {
          setIsLoading(false);
        } else {
          endSession();
        }
      } catch (err) {
        // Timeout or no connection: keep working from the saved profile.
        const message = err instanceof Error ? err.message : String(err);
        console.warn('Could not verify the session (offline?):', message);
        setIsLoading(false);
      }
    };

    void checkSession();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === 'INITIAL_SESSION') return;

      if (session?.user) {
        const existingUser = currentUserRef.current;

        // Only trigger global loading if we don't have a user yet, or if the user changed.
        // This prevents the "blank screen" blink on tab focus/background refresh.
        const isNewUserOrLogin = !existingUser || existingUser.id !== session.user.id;

        if (isNewUserOrLogin) {
          setIsLoading(true);
        }

        await loadUserProfile(session.user.id, session.user.email!, session.user);
      } else {
        clearCachedProfile();
        setUser(null);
        setIsLoading(false);
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [loadUserProfile]);

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
      // Sign-in is the one step that needs internet. (Auto refresh is stopped after an offline sign-out.)
      void supabase.auth.startAutoRefresh();
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
        // Signing in is the one step that needs internet; say which problem it is.
        toast.error(
          typeof navigator !== 'undefined' && !navigator.onLine
            ? 'No internet connection. You need to be online to sign in.'
            : 'Cannot reach the server. Check the internet connection and that the Supabase project is running.'
        );
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
    // Forget the saved profile first so the app can never reopen as this user after sign-out.
    clearCachedProfile();
    setUser(null);

    if (IS_LOCAL_MODE) {
      localStorage.removeItem('pos_local_session');
      return;
    }

    let revokedOnServer = true;
    try {
      const { error } = await supabase.auth.signOut();
      revokedOnServer = !error;
    } catch {
      revokedOnServer = false;
    }

    if (!revokedOnServer) {
      // Offline: signOut leaves the session on this PC, so remove it ourselves and stop the
      // client from refreshing (and re-saving) it if the connection comes back.
      await supabase.auth.stopAutoRefresh();
      clearStoredSupabaseSession();
    }
  };

  // ----------------------------------------------------------
  // Reset Password
  // ----------------------------------------------------------
  const resetPassword = async (email: string): Promise<boolean> => {
    setIsLoading(true);

    if (IS_LOCAL_MODE) {
      const users = getLocalUsers();
      const userExists = users.find(u => u.email.toLowerCase() === email.toLowerCase());
      
      if (userExists) {
        toast.info(`Local Mode: Password for ${email} is "${userExists.password}"`);
        setIsLoading(false);
        return true;
      } else {
        toast.error('Email not found in system.');
        setIsLoading(false);
        return false;
      }
    }

    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: window.location.origin + '/login',
      });
      if (error) {
        toast.error(error.message);
        return false;
      }
      toast.success('Password reset link sent to your email.');
      return true;
    } catch (err) {
      toast.error('Failed to send reset email. Please try again.');
      return false;
    } finally {
      setIsLoading(false);
    }
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
        resetPassword,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}


