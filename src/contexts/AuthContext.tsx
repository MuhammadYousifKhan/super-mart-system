import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { User, UserRole, UserCredentials } from '@/types/pos';

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

// Default users for the system
const DEFAULT_USERS: UserCredentials[] = [
  {
    email: 'admin@pos.com',
    password: 'admin123',
    fullName: 'System Administrator',
    role: 'admin',
  },
  {
    email: 'cashier@pos.com',
    password: 'cashier123',
    fullName: 'John Cashier',
    role: 'cashier',
  },
];

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [users, setUsers] = useState<UserCredentials[]>(DEFAULT_USERS);

  useEffect(() => {
    // Load users from localStorage
    const savedUsers = localStorage.getItem('pos_users');
    if (savedUsers) {
      try {
        const parsed: UserCredentials[] = JSON.parse(savedUsers);

        // Repair malformed emails (e.g., user accidentally removed @domain)
        const repaired = parsed.map((u) => {
          if (!u.email.includes('@')) {
            return { ...u, email: `${u.email}@pos.com` };
          }
          return u;
        });

        // Ensure at least one admin exists; if none, add default admin
        const hasAdmin = repaired.some((u) => u.role === 'admin');
        const finalUsers = hasAdmin ? repaired : [{
          email: 'admin@pos.com',
          password: 'admin123',
          fullName: 'System Administrator',
          role: 'admin',
        }, ...repaired];

        setUsers(finalUsers);
      } catch {
        localStorage.setItem('pos_users', JSON.stringify(DEFAULT_USERS));
      }
    } else {
      localStorage.setItem('pos_users', JSON.stringify(DEFAULT_USERS));
    }

    // Load current user
    const savedUser = localStorage.getItem('pos_current_user');
    if (savedUser) {
      try {
        setUser(JSON.parse(savedUser));
      } catch {
        localStorage.removeItem('pos_current_user');
      }
    }
    setIsLoading(false);
  }, []);

  // Save users to localStorage when changed
  useEffect(() => {
    localStorage.setItem('pos_users', JSON.stringify(users));
  }, [users]);

  const login = async (email: string, password: string): Promise<boolean> => {
    const foundUser = users.find(
      (u) => u.email.toLowerCase() === email.toLowerCase() && u.password === password
    );
    if (foundUser) {
      const loggedInUser: User = {
        id: `user-${foundUser.role}-${Date.now()}`,
        email: foundUser.email,
        fullName: foundUser.fullName,
        role: foundUser.role,
      };
      setUser(loggedInUser);
      localStorage.setItem('pos_current_user', JSON.stringify(loggedInUser));
      return true;
    }
    return false;
  };

  const logout = () => {
    setUser(null);
    localStorage.removeItem('pos_current_user');
  };

  const updateCredentials = (
    oldEmail: string,
    newCredentials: Partial<UserCredentials>
  ): boolean => {
    const userIndex = users.findIndex(
      (u) => u.email.toLowerCase() === oldEmail.toLowerCase()
    );
    if (userIndex === -1) return false;

    const updatedUsers = [...users];
    updatedUsers[userIndex] = { ...updatedUsers[userIndex], ...newCredentials };
    setUsers(updatedUsers);

    // Update current user if it's the same user
    if (user && user.email.toLowerCase() === oldEmail.toLowerCase()) {
      const updatedCurrentUser: User = {
        ...user,
        email: newCredentials.email || user.email,
        fullName: newCredentials.fullName || user.fullName,
      };
      setUser(updatedCurrentUser);
      localStorage.setItem('pos_current_user', JSON.stringify(updatedCurrentUser));
    }

    return true;
  };

  const getUsers = () => users;

  const createUser = (
    credentials: Omit<UserCredentials, 'role'> & { role?: UserRole }
  ): boolean => {
    // Check if email already exists
    const existingUser = users.find(
      (u) => u.email.toLowerCase() === credentials.email.toLowerCase()
    );
    if (existingUser) return false;

    const newUser: UserCredentials = {
      email: credentials.email,
      password: credentials.password,
      fullName: credentials.fullName,
      role: credentials.role || 'cashier',
    };
    setUsers([...users, newUser]);
    return true;
  };

  const deleteUser = (email: string): boolean => {
    // Prevent deleting the current user or the last admin
    if (user?.email.toLowerCase() === email.toLowerCase()) return false;
    
    const userToDelete = users.find(
      (u) => u.email.toLowerCase() === email.toLowerCase()
    );
    if (!userToDelete) return false;

    // Prevent deleting the last admin
    if (userToDelete.role === 'admin') {
      const adminCount = users.filter((u) => u.role === 'admin').length;
      if (adminCount <= 1) return false;
    }

    setUsers(users.filter((u) => u.email.toLowerCase() !== email.toLowerCase()));
    return true;
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
