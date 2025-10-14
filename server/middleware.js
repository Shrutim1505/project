import jwt from 'jsonwebtoken';
import { nanoid } from 'nanoid';
import { ErrorTypes, createError } from './errors.js';
import { getDB } from './db.js';

// Role hierarchy for permission checks
const ROLE_LEVELS = {
  STUDENT: 0,
  TA: 1,
  ADMIN: 2
};

export function checkRole(minRole) {
  return async (req, res, next) => {
    const user = req.user;
    if (!user) return res.status(401).json({ error: 'Unauthorized', code: 'UNAUTHORIZED' });
    
    const userLevel = ROLE_LEVELS[user.role.toLowerCase()] ?? -1;
    const requiredLevel = ROLE_LEVELS[minRole.toLowerCase()] ?? 999;
    
    if (userLevel < requiredLevel) {
      return res.status(403).json({ error: 'Forbidden', code: 'FORBIDDEN' });
    }
    next();
  };
}

export async function authMiddleware(req, res, next) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  
  if (!token) {
    return res.status(401).json({ error: 'Unauthorized', code: 'UNAUTHORIZED' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'dev-secret');
    const db = await getDB();
    
    // Verify user still exists and is active
    const user = await db.get(
      'SELECT id, name, email, role FROM users WHERE id = ?',
      decoded.sub
    );
    
    if (!user) {
      return res.status(401).json({ error: 'User not found', code: 'UNAUTHORIZED' });
    }

    req.user = user;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid token', code: 'UNAUTHORIZED' });
  }
}

// Audit logging moved to rbac.js