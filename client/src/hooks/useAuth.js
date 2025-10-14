import { createContext, useContext, useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

const AuthContext = createContext();

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const navigate = useNavigate();
  
  useEffect(() => {
    // Load user from local storage on mount
    const savedUser = localStorage.getItem('user');
    if (savedUser) {
      setUser(JSON.parse(savedUser));
    }
  }, []);
  
  const login = async (email, password) => {
    try {
      const data = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      }).then(res => {
        if (!res.ok) throw new Error('Login failed');
        return res.json();
      });
      // Store both user info and token
      const userData = {
        ...data.user,
        token: data.token
      };
      setUser(userData);
      localStorage.setItem('user', JSON.stringify(userData));
    } catch (err) {
      console.error('Login error:', err);
      throw err;
    }
  };
  
  const logout = () => {
    setUser(null);
    localStorage.removeItem('user');
    navigate('/login');
  };
  
  return (
    <AuthContext.Provider value={{ user, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
}

// Role-based route guard HOC
export function withRole(allowedRoles) {
  return (WrappedComponent) => {
    return function WithRoleComponent(props) {
      const { user } = useAuth();
      const navigate = useNavigate();
      
      useEffect(() => {
        if (!user || !allowedRoles.includes(user.role)) {
          navigate('/');
          // Assuming you have a toast implementation
          toast.error('Admin access required');
        }
      }, [user, navigate]);
      
      if (!user || !allowedRoles.includes(user.role)) {
        return null;
      }
      
      return <WrappedComponent {...props} />;
    };
  };
}