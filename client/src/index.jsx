import React from "react";
import * as ReactDOMClient from "react-dom/client";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "./security/AuthContext";
import RequireAuth from "./security/RequireAuth";
import Layout from "./components/Layout";
import Home from "./pages/Home";
import Login from "./pages/Login";
import Register from "./pages/Register";
import Portfolio from "./pages/Portfolio";
import Explore from "./pages/Explore";
import News from "./pages/News";
import Analytics from "./pages/Analytics";
import Profile from "./pages/Profile";
import StockDetails from "./pages/StockDetails";

const root = ReactDOMClient.createRoot(document.getElementById("root"));

root.render(
  <AuthProvider>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<Home />} />
          <Route path="login" element={<Login />} />
          <Route path="register" element={<Register />} />
          <Route path="explore" element={<Explore />} />
          <Route path="stock/:symbol" element={<StockDetails />} />
          
          {/* Protected routes */}
          <Route
            path="app"
            element={<RequireAuth />}
          >
            <Route index element={<Navigate to="/explore" replace />} />
            <Route path="news" element={<News />} />
            <Route path="portfolio" element={<Portfolio />} />
            <Route path="analytics" element={<Analytics />} />
            <Route path="profile" element={<Profile />} />
          </Route>
        </Route>
      </Routes>
    </BrowserRouter>
  </AuthProvider>
);
