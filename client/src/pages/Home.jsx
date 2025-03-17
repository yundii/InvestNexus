import { useNavigate} from "react-router-dom";
import "../style/home.css";

export default function Home() {
  //const { isAuthenticated } = useAuthUser();
  const navigate = useNavigate();

  return (
    <div className="home-container">
      {/* <header className="nav-header">
        <div className="logo">
          <h1>InvestNexus</h1>
        </div>
        <nav className="main-nav">
          <Link to="/explore">Explore</Link>
          <Link to="/app/news">News</Link>
          <Link to="/app/portfolio">Portfolio</Link>
          <Link to="/app/analytics">Analyze</Link>
        </nav>
        <div className="auth-nav">
          <button className="login-btn" onClick={() => navigate("/login")}>
            Log In
          </button>
          <button className="signup-btn" onClick={() => navigate("/register")}>
            Sign Up
          </button>
        </div>
      </header> */}

      <main className="hero-section">
        <div className="hero-content">
          <h1>
            CONNECT
            <br />
            ANALYZE
            <br />
            GROW
          </h1>
          <button className="start-now-btn" onClick={() => navigate("/login")}>
            Start Now
          </button>
        </div>
      </main>
    </div>
  );
}
