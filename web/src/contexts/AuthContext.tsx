"use client";

import React, { createContext, useContext } from "react";

/**
 * Simplified AuthContext for GC desktop app - no login/logout needed.
 * Kept as a thin wrapper so existing components that call useAuth() still work.
 */

interface AuthContextType {
  user: { id: 0; username: "local"; email: "" };
  isLoading: false;
}

const staticValue: AuthContextType = {
  user: { id: 0, username: "local", email: "" },
  isLoading: false,
};

const AuthContext = createContext<AuthContextType>(staticValue);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  return (
    <AuthContext.Provider value={staticValue}>{children}</AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
