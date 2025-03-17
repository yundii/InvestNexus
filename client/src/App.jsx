import { useAuthUser } from "./security/AuthContext";
import { useNavigate, Outlet, Link } from "react-router-dom";
import "./style/app.css";

export default function App() {
  const { user, logout } = useAuthUser();
  const navigate = useNavigate();

  const handleLogout = async () => {
    await logout();
    navigate("/");
  };

  return (
    <div className="app">
      <main className="app-main">
        <Outlet />
      </main>
    </div>
  );
}
