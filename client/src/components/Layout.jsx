import { useAuthUser } from "../security/AuthContext";
import { useNavigate, Link, Outlet } from "react-router-dom";
import "../style/layout.css";
import defaultPhoto from '../images/defaultphoto.png';
import logoIcon from '../images/icon.png';
import { useState, useEffect } from "react";

export default function Layout() {
  const { user, logout, isAuthenticated } = useAuthUser();
  const navigate = useNavigate();
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);

  const handleLogout = async () => {
    await logout();
    navigate("/");
    setIsMenuOpen(false);
  };

  const handleTrendSelect = (type) => {
    navigate(`/explore?type=${type}`);
    setIsMenuOpen(false);
  };

  const toggleMenu = () => {
    setIsMenuOpen(!isMenuOpen);
  };

  const handleNavClick = () => {
    setIsMenuOpen(false);
  };

  const toggleDropdown = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDropdownOpen(!isDropdownOpen);
  };

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (!event.target.closest('.nav-item.dropdown')) {
        setIsDropdownOpen(false);
      }
    };

    document.addEventListener('click', handleClickOutside);
    return () => {
      document.removeEventListener('click', handleClickOutside);
    };
  }, []);

  return (
    <div className="app">
      <header className="nav-header">
        <div className="logo">
          <img src={logoIcon} alt="InvestNexus Logo" className="logo-icon" />
          <h1>InvestNexus</h1>
        </div>
        
        <div className="menu-toggle" onClick={toggleMenu}>
          <span></span>
          <span></span>
          <span></span>
        </div>

        <nav className={`main-nav ${isMenuOpen ? 'active' : ''}`}>
          <div className={`nav-item dropdown explore-nav ${isDropdownOpen ? 'active' : ''}`}>
            <span onClick={toggleDropdown}>Explore</span>
            <div className="dropdown-content">
              <div onClick={() => {
                handleTrendSelect('GAINERS');
                setIsDropdownOpen(false);
                handleNavClick();
              }}>Gainers</div>
              <div onClick={() => {
                handleTrendSelect('LOSERS');
                setIsDropdownOpen(false);
                handleNavClick();
              }}>Losers</div>
              <div onClick={() => {
                handleTrendSelect('MOST_ACTIVE');
                setIsDropdownOpen(false);
                handleNavClick();
              }}>Most Actives</div>
            </div>
          </div>
          <Link to="/app/news" className="nav-link news-nav" onClick={handleNavClick}>News</Link>
          <Link to="/app/portfolio" className="nav-link portfolio-nav" onClick={handleNavClick}>Portfolio</Link>
          <Link to="/app/analytics" className="nav-link analytics-nav" onClick={handleNavClick}>Analyze</Link>
        </nav>
        
        <div className={`auth-nav ${isMenuOpen ? 'active' : ''}`}>
          {isAuthenticated ? (
            <>
              <Link to="/app/profile" className="profile-link" onClick={handleNavClick}>
                <img 
                  src={user?.userPhoto || defaultPhoto}
                  alt="Profile"
                  className="profile-icon"
                />
                <span>{user?.userName}</span>
              </Link>
              <button className="logout-btn" onClick={() => {
                handleLogout();
                handleNavClick();
              }}>
                Log Out
              </button>
            </>
          ) : (
            <>
              <button className="login-btn" onClick={() => {
                navigate("/login");
                handleNavClick();
              }}>
                Log In
              </button>
              <button className="signup-btn" onClick={() => {
                navigate("/register");
                handleNavClick();
              }}>
                Sign Up
              </button>
            </>
          )}
        </div>
      </header>

      <div 
        className={`overlay ${isMenuOpen ? 'active' : ''}`} 
        onClick={() => setIsMenuOpen(false)}
      />

      <main className="app-main">
        <Outlet />
      </main>
    </div>
  );
}