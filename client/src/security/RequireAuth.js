import { Navigate, Outlet } from "react-router-dom";
import { useAuthUser } from "./AuthContext";

export default function RequireAuth() {
  const { isAuthenticated } = useAuthUser();

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return <Outlet />;
}
