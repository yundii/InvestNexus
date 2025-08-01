import { createContext, useContext, useState, useEffect } from "react";
import { io } from "socket.io-client";

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [socket, setSocket] = useState(null);

  // Initialize WebSocket connection
  useEffect(() => {
    const newSocket = io("http://localhost:8000", {
      withCredentials: true
    });

    newSocket.on('connect', () => {
      console.log('Connected to WebSocket server');
    });

    newSocket.on('stock-price-update', (data) => {
      console.log('Stock price update:', data);
      // You can emit this to components that need real-time updates
      newSocket.emit('price-update-received', data);
    });

    newSocket.on('disconnect', () => {
      console.log('Disconnected from WebSocket server');
    });

    setSocket(newSocket);

    return () => {
      newSocket.close();
    };
  }, []);

  const login = async (email, password) => {
    try {
      const response = await fetch("http://localhost:8000/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email, password }),
      });
      
      if (response.ok) {
        const userData = await response.json();
        setUser({
          ...userData,
          userPhoto: userData.userPhoto
        });
        
        // Join user's portfolio room for real-time updates
        if (socket) {
          socket.emit('join-portfolio', userData.id);
        }
        
        return true;
      }
      return false;
    } catch (error) {
      console.error('Login failed:', error);
      return false;
    }
  };

  const register = async (email, password, userName, phoneNumber) => {
    const response = await fetch("http://localhost:8000/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ email, password, userName, phoneNumber }),
    });
    if (response.ok) {
      const userData = await response.json();
      setUser(userData);
      await login(email, password);
    }
  };

  const logout = async () => {
    await fetch("http://localhost:8000/logout", {
      method: "POST",
      credentials: "include",
    });
    setUser(null);
  };

  const updateUser = (userData) => {
    setUser(userData);
  };

  return (
    <AuthContext.Provider value={{ 
      user, 
      login, 
      logout, 
      register, 
      updateUser, 
      socket,
      isAuthenticated: !!user 
    }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuthUser = () => useContext(AuthContext);