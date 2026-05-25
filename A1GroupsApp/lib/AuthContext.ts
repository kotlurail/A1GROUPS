import { createContext, useContext } from 'react';

export interface AuthCtx { logout: () => Promise<void>; }

export const AuthContext = createContext<AuthCtx>({ logout: async () => {} });
export const useAuth = () => useContext(AuthContext);
