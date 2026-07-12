import React from "react";
import { Navigate } from "react-router-dom";

const ADMIN_EMAIL = "alanmorales117@gmail.com";

function getStoredUserStatus() {
  try {
    const user = JSON.parse(localStorage.getItem("user") || "{}") as {
      banned?: boolean;
      blocked?: boolean;
      email?: string;
      isBanned?: boolean;
      isBlocked?: boolean;
      role?: string;
    };
    const email = (user.email || "").toLowerCase();

    return {
      blocked: Boolean(user.banned || user.blocked || user.isBanned || user.isBlocked),
      role: email === ADMIN_EMAIL ? "admin" : (user.role || "").toLowerCase(),
    };
  } catch {
    return { blocked: false, role: "" };
  }
}

export default function ProtectedRoute({
  children,
  requireAdmin = false,
}: {
  children: React.ReactNode;
  requireAdmin?: boolean;
}) {
  const token = localStorage.getItem("token");
  const { blocked, role } = getStoredUserStatus();

  if (!token) return <Navigate to="/" replace />;

  if (blocked) {
    localStorage.removeItem("token");
    return <Navigate to="/" replace />;
  }

  if (requireAdmin && !role.includes("admin")) {
    return <Navigate to="/dashboard" replace />;
  }

  return <>{children}</>;
}
