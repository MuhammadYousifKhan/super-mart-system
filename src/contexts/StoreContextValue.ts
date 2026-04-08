import { createContext } from 'react';
import type { StoreContextType } from './StoreContext';

export const StoreContext = createContext<StoreContextType | undefined>(undefined);
